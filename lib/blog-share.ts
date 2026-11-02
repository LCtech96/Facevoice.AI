import { readSetting } from '@/lib/settings-store'
import { publishPagePost } from '@/lib/meta/graph'
import { sendPushToAdmins } from '@/lib/push'
import { SITE_URL } from '@/lib/seo/site'

// Dopo ogni articolo pubblicato nel blog (automatico o scritto a mano): post sulla
// Pagina Facebook con anteprima e link, e notifica sul telefono con l'esito.

const SETTINGS_KEY = 'blog_auto:settings'

/** Condivisione su Facebook accesa? (Impostazione del riquadro Blog in Gestione, accesa di default.) */
export async function facebookShareEnabled(): Promise<boolean> {
  try {
    const raw = (await readSetting(SETTINGS_KEY)).value
    return raw ? JSON.parse(raw).shareFacebook !== false : true
  } catch {
    return true
  }
}

/** Testo del post: titolo, l'inizio dell'articolo (fino a fine frase) e il link. */
export function facebookText(title: string, content: string, url: string): string {
  const body = content.split(/\n\s*Fonti:/i)[0]
  const firstParagraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 40)
  let teaser = ''
  for (const p of firstParagraphs) {
    if ((teaser + ' ' + p).length > 420) break
    teaser = teaser ? `${teaser}\n\n${p}` : p
  }
  if (!teaser && firstParagraphs[0]) {
    const cut = firstParagraphs[0].slice(0, 400)
    teaser = `${cut.slice(0, Math.max(cut.lastIndexOf('. ') + 1, 200))}…`
  }
  return [title, teaser, `Leggi l’articolo completo 👉 ${url}`].filter(Boolean).join('\n\n')
}

export type ShareOutcome = { facebook: 'posted' | 'off' | 'failed'; error?: string }

/** Condivide su Facebook (se acceso) e manda la notifica. */
export async function shareBlogPost(post: { title: string; content: string; slug?: string | null; id?: string }, origin: 'auto' | 'manual'): Promise<ShareOutcome> {
  const path = `/blog/${post.slug || post.id}`
  const url = `${SITE_URL}${path}`
  let outcome: ShareOutcome = { facebook: 'off' }
  if (await facebookShareEnabled()) {
    const sent = await publishPagePost(facebookText(post.title, post.content, url), url)
    outcome = sent.error ? { facebook: 'failed', error: sent.error } : { facebook: 'posted' }
    console.log(`blog share: Facebook ${sent.error ? `non riuscito (${sent.error})` : 'pubblicato'} — "${post.title}"`)
  }
  const fb =
    outcome.facebook === 'posted'
      ? 'Pubblicato anche sulla Pagina Facebook.'
      : outcome.facebook === 'failed'
        ? `Facebook non riuscito: ${outcome.error}`
        : ''
  await sendPushToAdmins({
    title: origin === 'auto' ? '📰 Nuovo articolo nel blog' : '📝 Nuovo post nel blog',
    body: [post.title, fb].filter(Boolean).join(' · ').slice(0, 220),
    url: path,
  }).catch(() => undefined)
  return outcome
}
