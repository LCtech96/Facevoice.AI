import { readSetting } from '@/lib/settings-store'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { publishInstagramPost, publishPagePost } from '@/lib/meta/graph'
import { sendPushToAdmins } from '@/lib/push'
import { SITE_URL } from '@/lib/seo/site'
import { createCover, jpegCopyOf } from '@/lib/blog-image'

// Dopo ogni articolo pubblicato nel blog (automatico o scritto a mano):
// 1) copertina (generata dall'AI, o grafica di riserva) se l'articolo non ne ha una;
// 2) post sulla Pagina Facebook con anteprima e link;
// 3) post su Instagram con la copertina e la didascalia;
// 4) notifica sul telefono con l'esito di tutto.

const SETTINGS_KEY = 'blog_auto:settings'

export type ShareSettings = { shareFacebook: boolean; shareInstagram: boolean; coverImage: boolean }

/** Interruttori del riquadro Blog in Gestione (tutti accesi di default). */
export async function shareSettings(): Promise<ShareSettings> {
  try {
    const raw = (await readSetting(SETTINGS_KEY)).value
    const s = raw ? JSON.parse(raw) : {}
    return { shareFacebook: s.shareFacebook !== false, shareInstagram: s.shareInstagram !== false, coverImage: s.coverImage !== false }
  } catch {
    return { shareFacebook: true, shareInstagram: true, coverImage: true }
  }
}

/** Inizio dell'articolo (senza le fonti), fino a circa `max` caratteri e a fine frase. */
function teaserOf(content: string, max = 420): string {
  const paragraphs = content
    .split(/\n\s*Fonti:/i)[0]
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 40)
  let teaser = ''
  for (const p of paragraphs) {
    if ((teaser + ' ' + p).length > max) break
    teaser = teaser ? `${teaser}\n\n${p}` : p
  }
  if (!teaser && paragraphs[0]) {
    const cut = paragraphs[0].slice(0, max - 20)
    teaser = `${cut.slice(0, Math.max(cut.lastIndexOf('. ') + 1, 200))}…`
  }
  return teaser
}

/** Testo del post Facebook: titolo, l'inizio dell'articolo e il link. */
export const facebookText = (title: string, content: string, url: string) =>
  [title, teaserOf(content), `Leggi l’articolo completo 👉 ${url}`].filter(Boolean).join('\n\n')

/** Didascalia Instagram: i link non sono cliccabili, quindi si rimanda al sito. */
export const instagramCaption = (title: string, content: string) =>
  [
    title,
    teaserOf(content, 700),
    'Articolo completo sul nostro blog: facevoice.ai/blog (link in bio).',
    '#intelligenzaartificiale #AI #innovazione #digitale #aziende #FacevoiceAI',
  ]
    .filter(Boolean)
    .join('\n\n')

export type ShareOutcome = {
  facebook: 'posted' | 'off' | 'failed'
  instagram: 'posted' | 'off' | 'failed'
  image: 'ai' | 'grafica' | 'esistente' | 'nessuna'
  errors: string[]
}

type BlogPostInput = { id?: string; title: string; content: string; slug?: string | null; image_url?: string | null }

/** Copertina, Facebook, Instagram e notifica per un articolo appena pubblicato. */
export async function shareBlogPost(post: BlogPostInput, origin: 'auto' | 'manual'): Promise<ShareOutcome> {
  const settings = await shareSettings()
  const path = `/blog/${post.slug || post.id}`
  const url = `${SITE_URL}${path}`
  const outcome: ShareOutcome = { facebook: 'off', instagram: 'off', image: post.image_url ? 'esistente' : 'nessuna', errors: [] }

  // 1) Copertina: serve al blog e, soprattutto, a Instagram.
  let imageUrl = post.image_url || null
  let jpegReady = false
  if (!imageUrl && (settings.coverImage || settings.shareInstagram)) {
    try {
      const cover = await createCover(post.title, teaserOf(post.content, 800))
      imageUrl = cover.url
      jpegReady = true
      outcome.image = cover.source
      if (post.id || post.slug) {
        const query = supabaseAdmin.from('blog_posts').update({ image_url: imageUrl })
        await (post.id ? query.eq('id', post.id) : query.eq('slug', post.slug!))
      }
    } catch (error) {
      outcome.errors.push(`copertina: ${error instanceof Error ? error.message : error}`)
    }
  }

  // 2) Facebook (l'anteprima del link mostra la copertina dell'articolo).
  if (settings.shareFacebook) {
    const sent = await publishPagePost(facebookText(post.title, post.content, url), url)
    outcome.facebook = sent.error ? 'failed' : 'posted'
    if (sent.error) outcome.errors.push(`Facebook: ${sent.error}`)
  }

  // 3) Instagram: solo con un'immagine JPEG pubblica.
  if (settings.shareInstagram) {
    try {
      if (!imageUrl) throw new Error('nessuna immagine (Instagram pubblica solo post con immagine)')
      const jpeg = jpegReady || /\.jpe?g($|\?)/i.test(imageUrl) ? imageUrl : await jpegCopyOf(imageUrl)
      const sent = await publishInstagramPost(jpeg, instagramCaption(post.title, post.content))
      if (sent.error) throw new Error(sent.error)
      outcome.instagram = 'posted'
    } catch (error) {
      outcome.instagram = 'failed'
      outcome.errors.push(`Instagram: ${error instanceof Error ? error.message : error}`)
    }
  }

  console.log(
    `blog share: "${post.title}" · copertina ${outcome.image} · Facebook ${outcome.facebook} · Instagram ${outcome.instagram}${
      outcome.errors.length ? ` · ${outcome.errors.join(' | ')}` : ''
    }`
  )
  const posted = [outcome.facebook === 'posted' && 'Facebook', outcome.instagram === 'posted' && 'Instagram'].filter(Boolean)
  await sendPushToAdmins({
    title: origin === 'auto' ? '📰 Nuovo articolo nel blog' : '📝 Nuovo post nel blog',
    body: [post.title, posted.length ? `Pubblicato anche su ${posted.join(' e ')}.` : '', outcome.errors.join(' · ')]
      .filter(Boolean)
      .join(' · ')
      .slice(0, 240),
    url: path,
  }).catch(() => undefined)
  return outcome
}
