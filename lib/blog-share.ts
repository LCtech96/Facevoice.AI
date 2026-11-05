import { readSetting } from '@/lib/settings-store'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { publishInstagramCarousel, publishPagePhotos } from '@/lib/meta/graph'
import { sendPushToAdmins } from '@/lib/push'
import { SITE_URL } from '@/lib/seo/site'
import { createCarousel } from '@/lib/blog-image'
import { coverHook, slidesFor } from '@/lib/blog-slides'
import { loadContentDirections, nextPaletteMix } from '@/lib/content-directions'
import { draftFromCarousel, MAX_IMAGES, MIN_IMAGES, recordCarousel, type PostDraft } from '@/lib/social-posts'
import type { CarouselSource, Slide } from '@/lib/blog-image'

// Dopo ogni articolo pubblicato nel blog (automatico o scritto a mano):
// 1) carosello di almeno 3 immagini con i colori Facevoice (copertina, una slide
//    per argomento, chiusura); la prima slide diventa la copertina del blog se
//    l'articolo non ne ha una;
// 2) lo stesso carosello sulla Pagina Facebook (post con piu' foto) e su Instagram;
// 3) notifica sul telefono con l'esito di tutto. Mai un post con una sola immagine.

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
    // Al massimo 5 hashtag: Instagram non ne accetta di piu'.
    '#intelligenzaartificiale #AI #innovazione #aziende #FacevoiceAI',
  ]
    .filter(Boolean)
    .join('\n\n')

export type ShareOutcome = {
  facebook: 'posted' | 'off' | 'failed'
  instagram: 'posted' | 'off' | 'failed'
  image: 'ai' | 'grafica' | 'esistente' | 'nessuna'
  slides: number
  /** Slide di contenuto con la loro immagine. */
  slideImages: number
  hook: string | null
  /** Carosello salvato: dalla super chat si puo' ripubblicare dove non e' uscito. */
  draftId?: string
  errors: string[]
}

type BlogPostInput = { id?: string; title: string; content: string; slug?: string | null; image_url?: string | null }

/** Copertina, Facebook, Instagram e notifica per un articolo appena pubblicato. */
export async function shareBlogPost(post: BlogPostInput, origin: 'auto' | 'manual'): Promise<ShareOutcome> {
  const settings = await shareSettings()
  const path = `/blog/${post.slug || post.id}`
  const url = `${SITE_URL}${path}`
  const outcome: ShareOutcome = { facebook: 'off', instagram: 'off', image: 'nessuna', slides: 0, slideImages: 0, hook: null, errors: [] }

  // 1) Carosello (serve a tutti e due i social; senza carosello non si pubblica sui social).
  let slides: string[] = []
  let slideTexts: Slide[] = []
  let source: CarouselSource | null = null
  if (settings.shareFacebook || settings.shareInstagram || (settings.coverImage && !post.image_url)) {
    try {
      const directions = (await loadContentDirections()).text || null
      const [texts, hook, mix] = await Promise.all([slidesFor(post.title, post.content, directions), coverHook(post.title, post.content, directions), nextPaletteMix()])
      const carousel = await createCarousel(post.title, texts, teaserOf(post.content, 800), post.image_url, { hook, mix, imageNotes: directions, imageSeconds: 120 })
      slideTexts = texts
      slides = carousel.urls
      source = carousel.source
      outcome.image = carousel.photo
      outcome.slides = slides.length
      outcome.slideImages = carousel.slideImages
      outcome.hook = hook
      if (!post.image_url && settings.coverImage && (post.id || post.slug)) {
        const query = supabaseAdmin.from('blog_posts').update({ image_url: slides[0] })
        await (post.id ? query.eq('id', post.id) : query.eq('slug', post.slug!))
      }
    } catch (error) {
      outcome.errors.push(`carosello: ${error instanceof Error ? error.message : error}`)
    }
  }
  const carouselReady = slides.length >= 3

  // 2) Facebook: post con tutte le slide e il link all'articolo nel testo.
  if (settings.shareFacebook) {
    const sent = carouselReady ? await publishPagePhotos(slides, facebookText(post.title, post.content, url)) : { error: 'carosello non pronto: non pubblico un post singolo' }
    outcome.facebook = sent.error ? 'failed' : 'posted'
    if (sent.error) outcome.errors.push(`Facebook: ${sent.error}`)
  }

  // 3) Instagram: lo stesso carosello con la didascalia.
  if (settings.shareInstagram) {
    const sent = carouselReady ? await publishInstagramCarousel(slides, instagramCaption(post.title, post.content)) : { error: 'carosello non pronto: non pubblico un post singolo' }
    outcome.instagram = sent.error ? 'failed' : 'posted'
    if (sent.error) outcome.errors.push(`Instagram: ${sent.error}`)
  }

  if (carouselReady) {
    const saved = await recordCarousel({
      title: post.title,
      hook: outcome.hook,
      slides: slideTexts,
      caption: instagramCaption(post.title, post.content),
      facebook: facebookText(post.title, post.content, url),
      urls: slides,
      source,
      results: {
        instagram: outcome.instagram === 'posted' ? 'ok' : undefined,
        facebook: outcome.facebook === 'posted' ? 'ok' : undefined,
        errors: outcome.errors,
      },
    })
    outcome.draftId = saved.id
  }

  console.log(
    `blog share: "${post.title}" · gancio "${outcome.hook || '(titolo)'}" · carosello ${outcome.slides} slide (foto ${outcome.image}, ${outcome.slideImages} slide con immagine) · Facebook ${outcome.facebook} · Instagram ${outcome.instagram}${
      outcome.errors.length ? ` · ${outcome.errors.join(' | ')}` : ''
    }`
  )
  const posted = [outcome.facebook === 'posted' && 'Facebook', outcome.instagram === 'posted' && 'Instagram'].filter(Boolean)
  await sendPushToAdmins({
    title: origin === 'auto' ? '📰 Nuovo articolo nel blog' : '📝 Nuovo post nel blog',
    body: [post.title, posted.length ? `Carosello di ${outcome.slides} immagini pubblicato su ${posted.join(' e ')}.` : '', outcome.errors.join(' · ')]
      .filter(Boolean)
      .join(' · ')
      .slice(0, 240),
    url: path,
  }).catch(() => undefined)
  return outcome
}

/**
 * Nuovo carosello (con immagini nuove) per un articolo gia' pubblicato nel blog,
 * in bozza: dalla super chat Luca lo vede e lo pubblica dove vuole.
 */
export async function carouselDraftFromBlogPost(slug?: string | null, total?: number): Promise<PostDraft> {
  let query = supabaseAdmin.from('blog_posts').select('id, title, content, slug, image_url, created_at').order('created_at', { ascending: false }).limit(1)
  if (slug?.trim()) query = supabaseAdmin.from('blog_posts').select('id, title, content, slug, image_url, created_at').eq('slug', slug.trim()).limit(1)
  const { data } = await query
  const post = data?.[0]
  if (!post) throw new Error('articolo non trovato')
  const directions = (await loadContentDirections()).text || null
  const [texts, hook, mix] = await Promise.all([slidesFor(post.title, post.content, directions), coverHook(post.title, post.content, directions), nextPaletteMix()])
  // Numero chiesto da Luca: immagini in tutto (copertina e slide finale comprese), da 2 a 10.
  const maxSlides = total && Number.isFinite(total) ? Math.max(MIN_IMAGES, Math.min(MAX_IMAGES, Math.round(total))) - 2 : 4
  const used = texts.slice(0, maxSlides)
  // La copertina del blog e' gia' la prima slide del carosello vecchio: qui si rifa' tutto.
  const carousel = await createCarousel(post.title, used, teaserOf(post.content, 800), null, { hook, mix, imageNotes: directions, imageSeconds: 100, maxSlides })
  const url = `${SITE_URL}/blog/${post.slug || post.id}`
  return draftFromCarousel({
    title: post.title,
    hook: hook || post.title,
    slides: used,
    caption: instagramCaption(post.title, post.content),
    facebook: facebookText(post.title, post.content, url),
    urls: carousel.urls,
    source: carousel.source,
  })
}
