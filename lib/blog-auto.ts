import { supabaseAdmin } from '@/lib/supabase-admin'
import { readSetting, updateSetting } from '@/lib/settings-store'
import { callAI, hasAIProvider } from '@/lib/ai'
import { sendPushToAdmins } from '@/lib/push'
import { SITE_URL } from '@/lib/seo/site'
import { internalOrigin } from '@/lib/internal-origin'

// Blog automatico: nei giorni scelti (es. martedi' e venerdi') il sito legge le
// ultime notizie sull'intelligenza artificiale da testate vere (feed RSS), l'AI
// scrive un articolo in italiano SOLO su quelle notizie, con i link alle fonti, e
// lo pubblica nel blog. Senza notizie reali non si pubblica niente: un articolo
// con "scoop" inventati farebbe piu' danni che non pubblicare.

const SETTINGS_KEY = 'blog_auto:settings'
/** Link gia' usati negli articoli precedenti: la stessa notizia non torna due volte. */
const USED_KEY = 'blog_auto:used'
/** Notizie piu' vecchie di cosi' non sono "novita'". */
const MAX_AGE_MS = 5 * 86_400_000
const MIN_NEWS = 3

export const NEWS_FEEDS: { name: string; url: string; aiOnly: boolean }[] = [
  { name: 'ANSA Tecnologia', url: 'https://www.ansa.it/sito/notizie/tecnologia/tecnologia_rss.xml', aiOnly: false },
  { name: 'AI4Business', url: 'https://www.ai4business.it/feed/', aiOnly: true },
  { name: 'Wired Italia', url: 'https://www.wired.it/feed/rss', aiOnly: false },
  { name: 'Agenda Digitale', url: 'https://www.agendadigitale.eu/feed/', aiOnly: false },
  { name: 'Google News', url: 'https://news.google.com/rss/search?q=intelligenza+artificiale+when:3d&hl=it&gl=IT&ceid=IT:it', aiOnly: true },
  { name: 'TechCrunch', url: 'https://techcrunch.com/category/artificial-intelligence/feed/', aiOnly: true },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', aiOnly: true },
  { name: 'MIT Technology Review', url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed', aiOnly: true },
]

const AI_TOPIC =
  /intelligenza artificiale|\bIA\b|\bAI\b|\bA\.I\.|openai|chatgpt|\bgpt-?\d|gemini|anthropic|claude|copilot|mistral|deepseek|\bllama\b|nvidia|chatbot|machine learning|apprendimento automatico|\bLLM\b|modell[oi] linguistic|generativ|deepfake|robot|ai act/i

export type BlogAutoSettings = {
  enabled: boolean
  /** Giorni della settimana (0 = domenica … 6 = sabato). */
  days: number[]
  /** Ora italiana "HH:MM". */
  time: string
}

export type BlogAutoState = {
  /** Ultimo giorno (italiano) in cui e' partita la generazione automatica. */
  lastDate: string | null
  lastStatus: 'running' | 'published' | 'skipped' | 'error' | null
  lastNote: string | null
  lastPost: { title: string; url: string } | null
  updatedAt: string | null
}

const DEFAULTS: BlogAutoSettings = { enabled: false, days: [2, 5], time: '09:40' }
const EMPTY_STATE: BlogAutoState = { lastDate: null, lastStatus: null, lastNote: null, lastPost: null, updatedAt: null }
const STATE_KEY = 'blog_auto:state'

export function cleanSettings(input: Partial<BlogAutoSettings> | null | undefined, base = DEFAULTS): BlogAutoSettings {
  const days = Array.isArray(input?.days)
    ? [...new Set(input.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : base.days
  return {
    enabled: typeof input?.enabled === 'boolean' ? input.enabled : base.enabled,
    days: days.length ? days : base.days,
    time: typeof input?.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(input.time) ? input.time : base.time,
  }
}

const parseJson = <T,>(raw: string | null, fallback: T): T => {
  try {
    return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback }
  } catch {
    return { ...fallback }
  }
}
const parseSettings = (raw: string | null) => cleanSettings(parseJson<Partial<BlogAutoSettings>>(raw, {}))
const parseState = (raw: string | null) => parseJson<BlogAutoState>(raw, EMPTY_STATE)

export const loadBlogAutoSettings = async () => parseSettings((await readSetting(SETTINGS_KEY)).value)
export const loadBlogAutoState = async () => parseState((await readSetting(STATE_KEY)).value)
export const saveBlogAutoSettings = (input: Partial<BlogAutoSettings>) =>
  updateSetting(SETTINGS_KEY, parseSettings, (current) => cleanSettings({ ...current, ...input }, current))

const setState = (patch: Partial<BlogAutoState>) =>
  updateSetting(STATE_KEY, parseState, (current) => ({ ...current, ...patch, updatedAt: new Date().toISOString() }))

function romeNow(now = new Date()) {
  return {
    date: now.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' }),
    time: now.toLocaleTimeString('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false }),
    weekday: new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Rome' })).getDay(),
  }
}

// ---------------------------------------------------------------------
// Notizie dai feed RSS / Atom
// ---------------------------------------------------------------------

export type NewsItem = { source: string; title: string; link: string; summary: string; date: number }

const decode = (text: string) =>
  text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#8217;/g, '’')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim()

const tag = (block: string, name: string) => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'))
  return m ? decode(m[1]) : ''
}

/** Legge le voci di un feed RSS 2.0 o Atom. */
export function parseFeed(xml: string, source: string): NewsItem[] {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || []
  return blocks
    .map((block) => {
      const atomLink = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i) || block.match(/<link[^>]*href=["']([^"']+)["']/i)
      const link = tag(block, 'link') || atomLink?.[1] || tag(block, 'guid')
      const when = tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated') || tag(block, 'dc:date')
      return {
        source,
        title: tag(block, 'title'),
        link: link.trim(),
        summary: (tag(block, 'description') || tag(block, 'summary') || tag(block, 'content')).slice(0, 500),
        date: when ? new Date(when).getTime() : NaN,
      }
    })
    .filter((item) => item.title && /^https?:\/\//.test(item.link) && Number.isFinite(item.date))
}

/** Notizie recenti sull'AI da tutte le fonti, dalla piu' nuova, senza doppioni ne' link gia' usati. */
export async function fetchAINews(used: Set<string> = new Set()): Promise<NewsItem[]> {
  const results = await Promise.all(
    NEWS_FEEDS.map(async (feed) => {
      try {
        const res = await fetch(feed.url, {
          signal: AbortSignal.timeout(8000),
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FacevoiceAI/1.0; +https://www.facevoice.ai)' },
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const items = parseFeed(await res.text(), feed.name)
        return feed.aiOnly ? items : items.filter((i) => AI_TOPIC.test(`${i.title} ${i.summary}`))
      } catch (error) {
        console.error(`blog auto: feed ${feed.name} non letto:`, error instanceof Error ? error.message : error)
        return []
      }
    })
  )
  const seen = new Set<string>()
  return results
    .flat()
    .filter((item) => Date.now() - item.date < MAX_AGE_MS && item.date < Date.now() + 3_600_000)
    .filter((item) => {
      const key = item.title.toLowerCase().replace(/[^a-z0-9à-ù]+/g, ' ').slice(0, 60)
      if (used.has(item.link) || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => b.date - a.date)
}

// ---------------------------------------------------------------------
// Scrittura e pubblicazione
// ---------------------------------------------------------------------

const PROMPT = `Sei la redazione del blog di Facevoice AI, agenzia digitale e software house con sede a Terrasini (Palermo) che realizza siti, app, automazioni, chatbot e soluzioni di intelligenza artificiale per le aziende.

Scrivi un articolo di blog in italiano sulle novità più importanti della settimana nel mondo dell'intelligenza artificiale, usando SOLO le notizie elencate dall'utente.

Regole (obbligatorie):
- Usa solo i fatti presenti nelle notizie fornite. Non inventare nomi, numeri, date, citazioni, prodotti o dettagli. Se un dettaglio non c'è, non scriverlo.
- Scegli da 3 a 5 notizie, le più rilevanti e interessanti per imprenditori e professionisti italiani. Evita notizie di cronaca nera o politiche divisive.
- Per ogni notizia: cosa è successo, in 2-4 frasi chiare, e perché conta per un'azienda.
- Tono: informato, chiaro, niente sensazionalismo, niente "clamoroso" o "shock". Niente promesse.
- Formato testo semplice (verrà mostrato così com'è): niente markdown, niente asterischi, niente #. Separa i paragrafi con una riga vuota. Per ogni notizia un breve sottotitolo su una riga da solo.
- Lunghezza: 450-750 parole.
- In chiusura un paragrafo breve e naturale su come un'azienda può iniziare a usare l'AI (senza pubblicità aggressiva; puoi citare Facevoice AI una volta).
- Non scrivere link né l'elenco delle fonti: li aggiungiamo noi in fondo, dai numeri che indichi in "used". In "used" metti SOLO i numeri delle notizie di cui parli davvero.

Rispondi SOLO con JSON valido, senza testo prima o dopo:
{"title": "titolo dell'articolo (max 90 caratteri, senza virgolette)", "content": "testo completo dell'articolo", "used": [numeri delle notizie usate]}`

function parseArticle(raw: string): { title: string; content: string; used: number[] } | null {
  const json = raw.match(/\{[\s\S]*\}/)?.[0]
  if (!json) return null
  try {
    const data = JSON.parse(json)
    const title = String(data.title || '').replace(/^["«]|["»]$/g, '').trim()
    const content = String(data.content || '')
      .replace(/\*\*?|__|^#+\s*/gm, '')
      .replace(/\n*Fonti:[\s\S]*$/i, '')
      .trim()
    const used = Array.isArray(data.used) ? data.used.map(Number).filter(Number.isInteger) : []
    return title && content.length > 800 ? { title: title.slice(0, 140), content, used } : null
  } catch {
    return null
  }
}

const slugify = (title: string) =>
  title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

async function uniqueSlug(base: string) {
  for (let n = 0; n < 50; n++) {
    const slug = n ? `${base}-${n + 1}` : base
    const { data } = await supabaseAdmin.from('blog_posts').select('id').eq('slug', slug).limit(1)
    if (!data?.length) return slug
  }
  return `${base}-${Date.now().toString(36)}`
}

export type GenerateResult = { ok: true; title: string; url: string } | { ok: false; reason: string; skipped?: boolean }

/** Legge le notizie, fa scrivere l'articolo e lo pubblica. */
export async function generateNewsPost(): Promise<GenerateResult> {
  if (!hasAIProvider()) return { ok: false, reason: 'nessuna chiave AI configurata' }
  const usedRaw = (await readSetting(USED_KEY)).value
  const usedList: string[] = usedRaw ? (JSON.parse(usedRaw) as string[]) : []
  const news = (await fetchAINews(new Set(usedList))).slice(0, 18)
  if (news.length < MIN_NEWS) {
    return { ok: false, skipped: true, reason: `solo ${news.length} notizie nuove trovate nelle fonti: articolo non pubblicato per non inventare` }
  }

  const list = news
    .map((n, i) => `${i + 1}. [${n.source}, ${new Date(n.date).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })}] ${n.title}\n${n.summary}\nLink: ${n.link}`)
    .join('\n\n')
  const today = new Date().toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const result = await callAI([{ role: 'user', content: `Oggi è ${today}. Notizie:\n\n${list}` }], PROMPT, {
    feature: 'blog_automatico',
    temperature: 0.5,
    maxOutputTokens: 4096,
  })
  const article = parseArticle(result.message || '')
  if (!article) return { ok: false, reason: 'risposta AI non valida' }

  // Le fonti le aggiunge il codice, dai numeri indicati dall'AI: i link restano esatti.
  const cited = [...new Set(article.used)].map((i) => news[i - 1]).filter((n): n is NewsItem => Boolean(n))
  if (cited.length < 2) return { ok: false, reason: 'l’articolo non indicava le notizie usate: non pubblicato' }
  const content = `${article.content}\n\nFonti:\n${cited.map((n) => `${n.source}: ${n.title}\n${n.link}`).join('\n\n')}`

  const slug = await uniqueSlug(slugify(article.title) || `novita-ai-${Date.now().toString(36)}`)
  const { data: post, error } = await supabaseAdmin
    .from('blog_posts')
    .insert({ title: article.title, content, image_url: null, author: 'Facevoice AI', slug })
    .select('id, slug')
    .single()
  if (error || !post) return { ok: false, reason: error?.message || 'salvataggio non riuscito' }

  await supabaseAdmin
    .from('app_settings')
    .upsert({ key: USED_KEY, value: JSON.stringify([...cited.map((n) => n.link), ...usedList].slice(0, 400)), updated_at: new Date().toISOString() })
  return { ok: true, title: article.title, url: `${SITE_URL}/blog/${post.slug || post.id}` }
}

// ---------------------------------------------------------------------
// Pianificazione (dal cron di ogni minuto)
// ---------------------------------------------------------------------

/** Esegue la generazione e registra l'esito (con notifica). */
export async function runBlogAuto(manual: boolean) {
  await setState({ lastStatus: 'running', lastNote: manual ? 'Avviato a mano' : null })
  let result: GenerateResult
  try {
    result = await generateNewsPost()
  } catch (error) {
    result = { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
  console.log(`blog auto: ${result.ok ? `pubblicato "${result.title}"` : `non pubblicato (${result.reason})`}`)
  await setState(
    result.ok
      ? { lastStatus: 'published', lastNote: null, lastPost: { title: result.title, url: result.url } }
      : { lastStatus: result.skipped ? 'skipped' : 'error', lastNote: result.reason }
  )
  await sendPushToAdmins({
    title: result.ok ? '📰 Nuovo articolo nel blog' : 'Blog automatico: articolo non pubblicato',
    body: result.ok ? result.title : result.reason,
    url: result.ok ? result.url.replace(SITE_URL, '') : '/admin',
  }).catch(() => undefined)
  return result
}

/** Chiede la generazione in una funzione nuova (tempo pieno, fino a 5 minuti). */
export async function requestBlogRun(origin: string, manual: boolean) {
  const key = (process.env.CRON_SECRET || '').trim()
  if (!key) throw new Error('CRON_SECRET mancante')
  const res = await fetch(`${internalOrigin(origin)}/api/admin/blog-auto/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': key },
    body: JSON.stringify({ manual }),
  })
  if (!res.ok) throw new Error(`avvio rifiutato: ${res.status}`)
}

/** Dal cron: nei giorni e all'ora scelti, una volta al giorno. */
export async function blogAutoTick(origin: string) {
  const settings = await loadBlogAutoSettings()
  if (!settings.enabled) return
  const now = romeNow()
  if (!settings.days.includes(now.weekday) || now.time < settings.time) return
  let claimed = false
  await updateSetting(STATE_KEY, parseState, (state) => {
    if (state.lastDate === now.date) return false
    claimed = true
    return { ...state, lastDate: now.date, lastStatus: 'running' as const, lastNote: null, updatedAt: new Date().toISOString() }
  })
  if (!claimed) return
  await requestBlogRun(origin, false).catch(async (error) => {
    console.error('blog auto: avvio non riuscito:', error)
    await setState({ lastStatus: 'error', lastNote: `avvio non riuscito: ${error instanceof Error ? error.message : error}` })
  })
}
