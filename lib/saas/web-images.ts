import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { groundedSearch, type GroundedResult } from '@/lib/ai'
import type { GroundedAnswer } from '@/lib/gemini'
import { assertAIAllowed } from '@/lib/usage-limits'
import { storeWebImage } from './posts'
import { checkWebUrl, domainOf, safeWebGet, WEB_USER_AGENT } from './web-fetch'

// Eventi reali e le loro locandine per i caroselli dei clienti (strumento
// find_event_images dell'assistente):
// 1. ricerca Google dentro Gemini (grounding): eventi con date e luogo, e per ognuno le
//    pagine che lo confermano (dai metadati della ricerca, non da indirizzi scritti dall'AI);
//    se Gemini non puo' cercare, la stessa ricerca con Claude (web_search), con una regola
//    altrettanto stretta sulle pagine che confermano ogni evento (vedi claudeSourcePages);
// 2. per ogni evento si legge la pagina (sito ufficiale prima dei social, che si saltano) e
//    si prende l'immagine di anteprima (og:image / twitter:image), si scarica, si controlla
//    (JPEG, PNG o WebP, max 8 MB, almeno 400 px sul lato corto) e si salva nel nostro archivio;
// 3. se una locandina non c'e' (o per le slide generiche "tipiche del posto") si usa una
//    foto con licenza libera di Wikimedia Commons, con autore e licenza nel credito.
// Ogni immagine ha il credito ("Foto: dominio" o "Foto: autore / Wikimedia Commons (licenza)")
// e la pagina di provenienza: il post resta in bozza e il cliente verifica di poterle usare.

/** Funzione in ai_usage (gettoni e limite del piano): token + tariffa della ricerca Google. */
export const WEB_SEARCH_FEATURE = 'saas_ricerca_web'

export type WebImage = {
  /** Immagine nel nostro archivio (workspace-media). */
  image_url: string
  /** Pagina da cui viene (sito dell'evento o file su Wikimedia Commons). */
  source_url: string
  source_domain: string
  /** Riga piccola sulla slide: "Foto: dominio" o "Foto: autore / Wikimedia Commons (licenza)". */
  credit: string
}

export type WebItem = {
  /** 'event' = evento trovato con la ricerca; 'generic' = cosa tipica del posto (foto di Wikimedia). */
  kind: 'event' | 'generic'
  title: string
  dates: string | null
  start: string | null
  end: string | null
  place: string | null
  description: string
  /** Pagina che conferma l'evento (dalla ricerca Google). */
  source_url: string | null
  source_domain: string | null
  image: WebImage
}

export type FindEventImagesInput = {
  query: string
  place: string
  fromDate?: string | null
  toDate?: string | null
  count: number
  includeGeneric: boolean
  /** Solo foto generiche di Wikimedia (niente ricerca Google): per completare eventi trovati prima. */
  onlyGeneric?: boolean
  /** Foto gia' usate prima (pagine di provenienza) e cose tipiche gia' mostrate (titoli): non si ripetono. */
  exclude?: { sources?: string[]; titles?: string[] }
}

export type FindEventImagesResult = {
  items: WebItem[]
  requested: number
  /** Eventi reali trovati (con o senza immagine). */
  eventsFound: number
  /** Eventi trovati per cui non c'e' un'immagine utilizzabile (non sono in items). */
  withoutImage: { title: string; dates: string | null; source_url: string | null }[]
  queries: string[]
}

const PAGE_MAX_BYTES = 1_500_000
const PAGE_TIMEOUT_MS = 6000
const IMAGE_MAX_BYTES = 8 * 1024 * 1024
const IMAGE_TIMEOUT_MS = 10_000
const MIN_SHORT_SIDE = 400
const IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/pjpeg', 'image/png', 'image/webp']

// --- Fonti: siti ufficiali si', profili social no ------------------------------------

const SOCIAL_HOSTS = [
  'instagram.com', 'cdninstagram.com', 'facebook.com', 'fb.com', 'fb.me', 'fb.watch', 'fbcdn.net', 'fbsbx.com', 'messenger.com',
  'tiktok.com', 'tiktokcdn.com', 'twitter.com', 'x.com', 't.co', 'twimg.com', 'threads.net', 'threads.com', 'linkedin.com', 'licdn.com',
  'pinterest.com', 'pinimg.com', 'pin.it', 'youtube.com', 'youtu.be', 'ytimg.com', 'snapchat.com', 'tumblr.com', 'reddit.com', 'redd.it',
  'redditmedia.com', 'flickr.com', 'staticflickr.com', 'vk.com', 't.me', 'telegram.me', 'whatsapp.com', 'wa.me', 'bsky.app', 'mastodon.social',
]

/**
 * Social e siti di foto personali: le loro immagini non si usano mai (potrebbero essere
 * foto di privati). Nel dubbio si salta: anche le pagine evento sui social.
 */
export function isSocialHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '').replace(/\.$/, '')
  return SOCIAL_HOSTS.some((s) => h === s || h.endsWith(`.${s}`)) || /(^|\.)pinterest\.[a-z.]+$/.test(h)
}

const OFFICIAL_HOST = /(^|\.)comune\.[a-z-]+\.[a-z]+$|\.gov\.it$|(^|\.)regione\.[a-z-]+\.it$|beniculturali|cultura\.gov|visit|turism|tourism|teatro|museo|museum|fondazione|festival|sagra|unesco|cattedrale|diocesi|parco|biglietti|ticket/

const words = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 5)

/** Punteggio di una fonte per un evento: siti ufficiali e dell'organizzatore prima, social in fondo (mai per le immagini). */
export function sourceScore(url: string, title: string): number {
  const host = domainOf(url)
  if (!host) return -1000
  if (isSocialHost(host)) return -100
  let score = 0
  if (OFFICIAL_HOST.test(host)) score += 3
  const flat = host.replace(/[.-]/g, '')
  if (words(title).some((w) => flat.includes(w))) score += 2
  return score
}

// --- Risposta della ricerca: eventi e fonti -----------------------------------------

/** Oggetti JSON "foglia" (senza oggetti dentro) nel testo, con la loro posizione. */
export function leafObjects(text: string): { start: number; end: number; value: Record<string, unknown> }[] {
  const out: { start: number; end: number; value: Record<string, unknown> }[] = []
  const stack: { start: number; hasChild: boolean }[] = []
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') {
      if (stack.length) stack[stack.length - 1].hasChild = true
      stack.push({ start: i, hasChild: false })
    } else if (ch === '}') {
      const top = stack.pop()
      if (!top || top.hasChild) continue
      try {
        const value = JSON.parse(text.slice(top.start, i + 1))
        if (value && typeof value === 'object' && !Array.isArray(value)) out.push({ start: top.start, end: i + 1, value })
      } catch {}
    }
  }
  return out
}

/** Posizione (in caratteri) di un pezzo sostenuto dalla ricerca: gli indici di Gemini sono in byte. */
function supportSpan(text: string, s: GroundedAnswer['supports'][number]): [number, number] | null {
  const toChar = (bytes: number) => Buffer.from(text, 'utf8').subarray(0, bytes).toString('utf8').replace(/�$/, '').length
  if (s.text) {
    if (s.startIndex !== null) {
      const at = toChar(s.startIndex)
      if (text.startsWith(s.text, at)) return [at, at + s.text.length]
    }
    const at = text.indexOf(s.text)
    return at >= 0 ? [at, at + s.text.length] : null
  }
  if (s.startIndex !== null && s.endIndex !== null) return [toChar(s.startIndex), toChar(s.endIndex)]
  return null
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const dayLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
/** Giorno AAAA-MM-GG vero (non "2026-02-30"), o null. */
const isoDay = (v: unknown) => {
  const day = typeof v === 'string' ? v.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
  const time = Date.parse(`${day}T12:00:00Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === day ? day : null
}

export type FoundEvent = {
  title: string
  dates: string | null
  start: string | null
  end: string | null
  place: string | null
  description: string
  /** Pagine che confermano l'evento, dalla migliore. */
  sources: string[]
}
export type FoundTheme = { title: string; description: string; search: string }

const GOOGLE_REDIRECT_HOST = /^(vertexaisearch\.cloud\.google\.com)$/i

/**
 * Indirizzo vero di una pagina trovata dalla ricerca: i link di Gemini passano da
 * vertexaisearch.cloud.google.com/grounding-api-redirect/…, che rimanda alla pagina.
 * Si legge solo il rimando (HEAD, poi GET), senza seguirlo, con un tempo massimo.
 */
export async function resolveGroundingUrl(uri: string): Promise<string | null> {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return null
  }
  if (!GOOGLE_REDIRECT_HOST.test(url.hostname)) {
    try {
      return checkWebUrl(url).href
    } catch {
      return null
    }
  }
  for (const method of ['HEAD', 'GET'] as const) {
    try {
      const res = await fetch(url.href, { method, redirect: 'manual', headers: { 'User-Agent': WEB_USER_AGENT }, signal: AbortSignal.timeout(5000) })
      const location = res.headers.get('location')
      try {
        await res.body?.cancel()
      } catch {}
      if (!location) continue
      const target = checkWebUrl(new URL(location, url))
      return GOOGLE_REDIRECT_HOST.test(target.hostname) ? null : target.href
    } catch {}
  }
  return null
}

const sameSite = (host: string, chunkTitle: string) => {
  const a = host.replace(/^www\./, '')
  const b = chunkTitle.toLowerCase().trim().replace(/^www\./, '')
  return Boolean(b) && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(b) && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`))
}

/**
 * Indirizzo confrontabile: host in minuscolo senza "www.", percorso senza "/" finale, senza "#"
 * e senza parametri di tracciamento (utm_*, fbclid, gclid…); http e https contano uguali.
 */
export function normalizeUrl(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '')
  let path = url.pathname
  try {
    path = decodeURI(path)
  } catch {}
  path = path.replace(/\/+$/, '')
  const params = [...url.searchParams]
    .filter(([k]) => !/^(utm_.*|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|ref|ref_src|_ga|igshid)$/i.test(k))
    .sort(([a], [b]) => a.localeCompare(b))
  return `${host}${path}${params.length ? `?${new URLSearchParams(params)}` : ''}`
}

const plainWords = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

/** Parole dei nomi di eventi che non distinguono un evento da un altro. */
const GENERIC_NAME_WORDS = new Set(
  (
    'evento eventi event events mostra mostre concerto concerti concert festa feste festival sagra sagre fiera fiere mercatino mercatini mercato mercati ' +
    'spettacolo spettacoli show stagione rassegna edizione serata serate giornata giornate notte notti natale natalizio natalizia natalizi capodanno ' +
    'teatro museo piazza centro citta city live tour open days week weekend anno nuovo nuova gran grande della delle degli dello nella nelle negli ' +
    'sulla sulle alla alle agli dalla dalle tutti tutte ' +
    'gennaio febbraio marzo aprile maggio giugno luglio agosto settembre ottobre novembre dicembre ' +
    'lunedi martedi mercoledi giovedi venerdi sabato domenica'
  ).split(' ')
)

/** Parole che distinguono il nome di un evento (almeno 4 lettere, niente parole comuni, numeri o il luogo cercato). */
export function distinctiveWords(title: string, place = ''): string[] {
  const placeWords = new Set(plainWords(place))
  return [...new Set(plainWords(title).filter((w) => w.length >= 4 && !/^\d+$/.test(w) && !GENERIC_NAME_WORDS.has(w) && !placeWords.has(w)))]
}

const hostOf = (url: string) => (normalizeUrl(url) || '').split(/[/?]/)[0]

/**
 * Regola per la ricerca con Claude (Gemini non la usa). Claude spesso non mette citazioni
 * dentro un JSON: un evento senza pezzi citati e' confermato solo se
 * 1. la sua "fonte" (normalizzata, vedi normalizeUrl) e' una pagina che la ricerca ha davvero
 *    restituito (web_search_tool_result) o citato, oppure
 * 2. la "fonte" e' dello stesso sito (stesso host, senza "www.") di una pagina restituita il cui
 *    titolo o testo citato contiene le parole distintive del nome dell'evento (distinctiveWords:
 *    almeno 2, o l'unica se ne ha una sola).
 * Le fonti dell'evento sono le pagine della ricerca (l'indirizzo scritto dall'AI si aggiunge solo
 * se e' dello stesso sito, come con Gemini). Senza fonte, con una fonte di un sito che la ricerca
 * non ha restituito, o con un nome fatto solo di parole comuni ("Concerto di Natale") e una fonte
 * che non e' una pagina restituita: l'evento si scarta. E' la regola piu' stretta che non lascia
 * vuote le risposte vere (Claude copia gli indirizzi delle pagine trovate, a volte con "/" o
 * parametri in piu', o indica la pagina dell'evento dello stesso sito della pagina trovata).
 */
export function claudeSourcePages(given: string, title: string, place: string, answer: Pick<GroundedResult, 'chunks' | 'cited'>): number[] {
  const target = given ? normalizeUrl(given) : null
  if (!target) return []
  const all = answer.chunks.map((c, k) => ({ k, norm: normalizeUrl(c.uri) })).filter((c) => c.norm)
  const exact = all.filter((c) => c.norm === target).map((c) => c.k)
  if (exact.length) return exact
  const needed = distinctiveWords(title, place)
  if (!needed.length) return []
  const host = hostOf(given)
  const enough = Math.min(2, needed.length)
  return all
    .filter((c) => hostOf(answer.chunks[c.k].uri) === host)
    .filter((c) => {
      const said = new Set(plainWords(`${answer.chunks[c.k].title} ${(answer.cited?.[c.k] || []).join(' ')}`))
      return needed.filter((w) => said.has(w)).length >= enough
    })
    .map((c) => c.k)
}

/**
 * Eventi della risposta con le loro fonti. Le fonti vengono dai metadati della ricerca
 * (pezzi di testo dell'evento sostenuti da quali pagine); l'indirizzo scritto dall'AI si
 * aggiunge solo se e' dello stesso sito di una pagina che sostiene quell'evento. Un evento
 * senza nessun pezzo sostenuto dalla ricerca, senza data d'inizio o fuori dal periodo si
 * scarta: niente eventi inventati.
 */
export async function eventsFromAnswer(
  answer: GroundedAnswer & Partial<Pick<GroundedResult, 'provider' | 'cited'>>,
  range: { from: string; to: string },
  max: number,
  /** Luogo cercato: con Claude le sue parole non contano come parole distintive del nome. */
  place = ''
): Promise<{ events: FoundEvent[]; themes: FoundTheme[] }> {
  const claude = answer.provider === 'claude'
  const leaves = leafObjects(answer.text)
  const spans = answer.supports.map((s) => ({ span: supportSpan(answer.text, s), chunks: s.chunks }))
  const resolved = new Map<number, Promise<string | null>>()
  const chunkUrl = (k: number) => {
    if (!resolved.has(k)) resolved.set(k, answer.chunks[k]?.uri ? resolveGroundingUrl(answer.chunks[k].uri) : Promise.resolve(null))
    return resolved.get(k)!
  }
  // Tutti i rimandi delle pagine trovate si risolvono insieme (ognuno con il suo tempo massimo).
  answer.chunks.slice(0, 30).forEach((_, k) => void chunkUrl(k))
  const events: FoundEvent[] = []
  const themes: FoundTheme[] = []
  const seen = new Set<string>()
  for (const leaf of leaves) {
    const v = leaf.value
    const title = str(v.titolo ?? v.title, 90)
    if (!title) continue
    if (typeof v.foto === 'string' && !('data_inizio' in v) && !('fonte' in v)) {
      themes.push({ title, description: str(v.descrizione ?? v.description, 160), search: str(v.foto, 80) || title })
      continue
    }
    const key = words(title).join(' ') || title.toLowerCase()
    if (seen.has(key)) continue
    const start = isoDay(v.data_inizio)
    const endDay = isoDay(v.data_fine)
    const end = endDay && start && endDay >= start ? endDay : start
    // Senza una data d'inizio vera (AAAA-MM-GG) o fuori dal periodo chiesto (finito prima o che
    // comincia dopo): si scarta.
    if (!start || !end || end < range.from || start > range.to) {
      console.log(`ricerca web: evento scartato (date mancanti o fuori periodo): ${title}`)
      continue
    }
    // Pagine che sostengono il testo di questo evento: prima i pezzi tutti dentro l'evento.
    const inside = spans.filter((s) => s.span && s.span[0] >= leaf.start && s.span[1] <= leaf.end)
    const touching = inside.length ? inside : spans.filter((s) => s.span && s.span[0] < leaf.end && s.span[1] > leaf.start && s.span[1] - s.span[0] < (leaf.end - leaf.start) * 2)
    const indices = [...new Set(touching.flatMap((s) => s.chunks))].filter((k) => k >= 0 && k < answer.chunks.length).slice(0, 6)
    const given = str(v.fonte ?? v.source, 500)
    // Con Claude, senza pezzi citati: la fonte deve essere una pagina restituita dalla ricerca (claudeSourcePages).
    const pages = indices.length || !claude ? indices : claudeSourcePages(given, title, place, answer).slice(0, 6)
    // Nessun pezzo dell'evento sostenuto dalla ricerca: niente lo conferma (l'indirizzo scritto
    // dall'AI da solo non basta), si scarta.
    if (!pages.length) {
      console.log(`ricerca web: evento scartato (nessuna pagina della ricerca lo sostiene): ${title}`)
      continue
    }
    const urls = (await Promise.all(pages.map(chunkUrl))).filter((u): u is string => Boolean(u))
    // Indirizzo scritto dall'AI: si aggiunge solo se e' dello stesso sito di una delle pagine che
    // sostengono QUESTO evento (non di una pagina qualsiasi della ricerca).
    if (given) {
      try {
        const url = checkWebUrl(given)
        if (pages.some((k) => sameSite(url.hostname, answer.chunks[k]?.title || '')) || urls.some((u) => domainOf(u) === domainOf(url))) urls.push(url.href)
      } catch {}
    }
    // Con Claude la stessa pagina puo' tornare con "/" o parametri in piu': una volta sola.
    const same = (a: string, b: string) => (normalizeUrl(a) || a) === (normalizeUrl(b) || b)
    const unique = claude ? urls.filter((u, i) => urls.findIndex((x) => same(x, u)) === i) : [...new Set(urls)]
    const sources = unique.sort((a, b) => sourceScore(b, title) - sourceScore(a, title))
    if (!sources.length) {
      console.log(`ricerca web: evento scartato (nessuna pagina lo conferma): ${title}`)
      continue
    }
    seen.add(key)
    events.push({
      title,
      // Senza le date scritte: quelle dei giorni trovati ("15 novembre 2026" o "15 novembre 2026 – 6 gennaio 2027").
      dates: str(v.date ?? v.dates, 80) || (start === end ? dayLabel(start) : `${dayLabel(start)} – ${dayLabel(end)}`),
      start,
      end,
      place: str(v.luogo ?? v.place, 120) || null,
      description: str(v.descrizione ?? v.description, 220),
      sources,
    })
    if (events.length >= max) break
  }
  return { events, themes }
}

const romeToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

/** Ricerca Google degli eventi (una chiamata, con la tariffa della ricerca nel consumo dello spazio). */
export async function searchEvents(
  workspaceId: string,
  input: { query: string; place: string; from: string; to: string; count: number; includeGeneric: boolean }
): Promise<{ events: FoundEvent[]; themes: FoundTheme[]; queries: string[] }> {
  const prompt = `Oggi è il ${romeToday()}. Cerca con Google eventi REALI e confermati: ${input.query || 'eventi turistici e culturali, festival, sagre e tradizioni'} a ${input.place} e dintorni, con date tra il ${input.from} e il ${input.to}.
Preferisci le pagine ufficiali (comune, ente del turismo, organizzatore, teatro, museo, festival) e quelle con la locandina dell'evento.
Regole:
- Solo eventi che trovi davvero nelle pagine della ricerca, con le date scritte lì: niente eventi, date o luoghi inventati o dedotti. Meglio pochi che inventati.
- Solo eventi con almeno un giorno tra il ${input.from} e il ${input.to}.
- Al massimo ${input.count} eventi, diversi tra loro, in ordine di data.
- "fonte": l'indirizzo della pagina dell'evento che hai trovato (ufficiale se c'è), oppure "".${
    input.includeGeneric
      ? `\n- In "temi" metti fino a ${input.count} cose tipiche e famose di ${input.place} e dintorni (luoghi, tradizioni, cibo), da illustrare con una foto: "titolo" breve, "descrizione" una riga vera e generica (niente date), "foto" poche parole per cercare la foto su Wikimedia Commons.`
      : ''
  }
Rispondi SOLO con JSON: {"eventi": [{"titolo": "", "date": "es. 15-17 novembre 2026", "data_inizio": "AAAA-MM-GG", "data_fine": "AAAA-MM-GG", "luogo": "luogo e città", "descrizione": "una frase su cosa è", "fonte": ""}]${input.includeGeneric ? ', "temi": [{"titolo": "", "descrizione": "", "foto": ""}]' : ''}}`
  const answer = await groundedSearch(prompt, {
    feature: WEB_SEARCH_FEATURE,
    workspaceId,
    system: 'Cerchi informazioni vere sul web con Google e le riporti fedelmente, senza inventare niente. Rispondi solo con il JSON richiesto.',
    temperature: 0.2,
    maxOutputTokens: 6000,
    timeoutMs: 60_000,
    // Solo per la ricerca con Claude (riserva): posizione approssimata e fonti copiate dalla ricerca.
    place: { city: input.place, region: SICILY.test(input.place) ? 'Sicilia' : undefined },
    claudeSystem:
      'In "fonte" metti l\'indirizzo esatto, copiato uguale, di una pagina che la ricerca ti ha restituito e che parla di quell\'evento (la pagina dell\'evento se c\'è); se non ce l\'hai metti "". Gli eventi senza una pagina della ricerca che li conferma vengono scartati.',
  })
  const { events, themes } = await eventsFromAnswer(answer, { from: input.from, to: input.to }, input.count, input.place)
  console.log(`ricerca web (${answer.provider}): ${events.length} eventi confermati, ${answer.chunks.length} pagine, ricerche: ${answer.queries.join(' | ').slice(0, 300)}`)
  return { events, themes, queries: answer.queries }
}

// --- Immagine di una pagina ----------------------------------------------------------

const decodeEntities = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')

const LOGO_LIKE = /logo|favicon|placeholder|sprite|avatar|\bicon|spacer|blank\.|default[-_]?(og|share|image|img)|og[-_]?default|share[-_]?default|fallback/i
const META_KEYS = ['og:image:secure_url', 'og:image:url', 'og:image', 'twitter:image', 'twitter:image:src']

/** Immagini di anteprima dichiarate nella pagina (og:image, twitter:image), assolute, dalla migliore. */
export function pageImageUrls(html: string, pageUrl: string): { url: string; width?: number; height?: number }[] {
  const head = html.slice(0, 600_000)
  const found: { url: string; rank: number; width?: number; height?: number }[] = []
  let width: number | undefined
  let height: number | undefined
  const attr = (tag: string, name: string) => {
    const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i'))
    return m ? decodeEntities((m[1] ?? m[2] ?? m[3] ?? '').trim()) : ''
  }
  for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
    const key = (attr(tag, 'property') || attr(tag, 'name') || attr(tag, 'itemprop')).toLowerCase()
    const content = attr(tag, 'content')
    if (!content) continue
    if (key === 'og:image:width') width = Number(content) || undefined
    else if (key === 'og:image:height') height = Number(content) || undefined
    else if (META_KEYS.includes(key) || key === 'image') {
      try {
        const url = new URL(content, pageUrl)
        if (url.protocol === 'http:' || url.protocol === 'https:') found.push({ url: url.href, rank: key.startsWith('og:') ? 0 : key === 'image' ? 2 : 1 })
      } catch {}
    }
  }
  for (const tag of head.match(/<link\b[^>]*>/gi) || []) {
    if (!/\srel\s*=\s*["']?image_src/i.test(tag)) continue
    try {
      found.push({ url: new URL(attr(tag, 'href'), pageUrl).href, rank: 3 })
    } catch {}
  }
  const unique = [...new Map(found.sort((a, b) => a.rank - b.rank).map((f) => [f.url, f])).values()]
  // Le misure dichiarate valgono per la prima og:image.
  return unique.map((f, k) => (k === 0 && f.rank === 0 ? { url: f.url, width, height } : { url: f.url }))
}

/** Pagina (HTML, max 1,5 MB, 6 s) e le sue immagini di anteprima utilizzabili. */
export async function pageImages(pageUrl: string): Promise<{ page: string; images: string[] }> {
  if (isSocialHost(domainOf(pageUrl))) return { page: pageUrl, images: [] }
  const res = await safeWebGet(pageUrl, { maxBytes: PAGE_MAX_BYTES, timeoutMs: PAGE_TIMEOUT_MS, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1' })
  // Rimandata su un social (es. pagina evento su Facebook): si salta.
  if (res.status !== 200 || isSocialHost(domainOf(res.url))) return { page: res.url, images: [] }
  if (res.contentType && !/html|xml/.test(res.contentType)) return { page: res.url, images: [] }
  const images = pageImageUrls(res.body.toString('utf8'), res.url)
    .filter((img) => {
      if (isSocialHost(domainOf(img.url)) || LOGO_LIKE.test(new URL(img.url).pathname)) return false
      // Misure dichiarate troppo piccole: non si scarica nemmeno.
      if (img.width && img.height && Math.min(img.width, img.height) < MIN_SHORT_SIDE) return false
      return true
    })
    .map((img) => img.url)
    .slice(0, 2)
  return { page: res.url, images }
}

export type DownloadedImage = { buffer: Buffer; width: number; height: number; url: string; hash: string }

/** Scarica e controlla un'immagine: JPEG, PNG o WebP veri, max 8 MB, lato corto almeno 400 px, niente strisce o loghi. */
export async function downloadWebImage(url: string): Promise<DownloadedImage> {
  if (isSocialHost(domainOf(url))) throw new Error('immagine da un social: non si usa')
  const res = await safeWebGet(url, { maxBytes: IMAGE_MAX_BYTES, timeoutMs: IMAGE_TIMEOUT_MS, accept: 'image/jpeg,image/png,image/webp;q=0.9,*/*;q=0.1' })
  if (res.status !== 200) throw new Error(`immagine non scaricata (${res.status})`)
  if (isSocialHost(domainOf(res.url))) throw new Error('immagine da un social: non si usa')
  if (!IMAGE_TYPES.includes(res.contentType)) throw new Error(`tipo di file non ammesso (${res.contentType || 'sconosciuto'})`)
  const meta = await sharp(res.body, { limitInputPixels: 40_000_000 }).metadata()
  if (!meta.format || !['jpeg', 'png', 'webp'].includes(meta.format)) throw new Error('il file non è un’immagine JPEG, PNG o WebP')
  const width = meta.width || 0
  const height = meta.height || 0
  if (Math.min(width, height) < MIN_SHORT_SIDE) throw new Error(`immagine troppo piccola (${width}×${height})`)
  if (width / height > 2.4 || height / width > 2.6) throw new Error('immagine troppo stretta (banner o logo)')
  return { buffer: res.body, width, height, url: res.url, hash: createHash('sha1').update(res.body).digest('hex') }
}

// --- Wikimedia Commons ---------------------------------------------------------------

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php'
// Wikimedia chiede un User-Agent che dica chi siamo e come contattarci.
const COMMONS_UA = 'FacevoiceAI/1.0 (https://www.facevoice.ai)'

export type CommonsFile = { title: string; thumbUrl: string; pageUrl: string; author: string | null; licence: string; width: number; height: number }

const stripHtml = (html: string) => decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()

/** Licenza libera (CC0, pubblico dominio, CC BY, CC BY-SA) in forma breve, o null. */
export function freeLicence(shortName: string, code: string): string | null {
  const s = shortName.replace(/\s+/g, ' ').trim()
  const c = code.toLowerCase().trim()
  if (/\b(nc|nd)\b|non[- ]?commercial|no[- ]?deriv/i.test(`${s} ${c}`)) return null
  if (/^cc0\b/i.test(s) || c === 'cc0') return 'CC0'
  if (/^(public domain|pd\b|pubblico dominio)/i.test(s) || /^pd($|-)/.test(c)) return 'Public domain'
  const m = s.match(/^cc[- ]by(-sa)?(?:[- ](\d(?:\.\d)?))?/i) || c.match(/^cc-by(-sa)?(?:-(\d(?:\.\d)?))?/)
  if (m) return `CC BY${m[1] ? '-SA' : ''}${m[2] ? ` ${m[2]}` : ''}`
  return null
}

/** File di Commons per una ricerca: solo foto (JPEG, PNG, WebP) con licenza libera e autore. */
export async function commonsCandidates(search: string, limit = 12): Promise<CommonsFile[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrsearch: `${search} filetype:bitmap`,
    gsrnamespace: '6',
    gsrlimit: String(limit),
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '1280',
    iiextmetadatafilter: 'Artist|Attribution|LicenseShortName|License|NonFree|ObjectName',
    origin: '*',
  })
  const res = await fetch(`${COMMONS_API}?${params}`, {
    headers: { 'User-Agent': COMMONS_UA, 'Api-User-Agent': COMMONS_UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) return []
  const data = (await res.json().catch(() => null)) as { query?: { pages?: unknown } } | null
  const raw = data?.query?.pages
  const pages = (Array.isArray(raw) ? raw : Object.values((raw as Record<string, unknown>) || {})) as {
    title?: string
    index?: number
    imageinfo?: { thumburl?: string; url?: string; descriptionurl?: string; width?: number; height?: number; mime?: string; extmetadata?: Record<string, { value?: unknown }> }[]
  }[]
  const out: CommonsFile[] = []
  for (const page of [...pages].sort((a, b) => (a.index ?? 0) - (b.index ?? 0))) {
    const info = page.imageinfo?.[0]
    if (!info) continue
    const meta = info.extmetadata || {}
    const value = (k: string) => (typeof meta[k]?.value === 'string' ? (meta[k]!.value as string) : '')
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(String(info.mime || ''))) continue
    if (value('NonFree').toLowerCase() === 'true') continue
    const licence = freeLicence(stripHtml(value('LicenseShortName')), value('License'))
    if (!licence) continue
    // L'autore si accorcia (con i puntini) in commonsCredit, cosi' la licenza resta sempre nel credito.
    const author = (stripHtml(value('Attribution')) || stripHtml(value('Artist'))).slice(0, 200) || null
    // Licenze con attribuzione: senza autore non si usa.
    if (!author && !['CC0', 'Public domain'].includes(licence)) continue
    if (Math.min(info.width || 0, info.height || 0) < MIN_SHORT_SIDE) continue
    const thumbUrl = info.thumburl || info.url
    if (!thumbUrl || !info.descriptionurl) continue
    out.push({ title: String(page.title || '').replace(/^File:/, ''), thumbUrl, pageUrl: info.descriptionurl, author, licence, width: info.width || 0, height: info.height || 0 })
  }
  return out
}

/** Lunghezza massima del credito sulla slide (come creditOf in posts.ts e creditLine in blog-image.tsx). */
export const CREDIT_MAX = 90

/**
 * Credito di una foto di Commons: "Foto: <autore> / Wikimedia Commons (<licenza>)", entro
 * CREDIT_MAX caratteri. Si accorcia solo l'autore: la licenza (CC BY, CC BY-SA...) non si perde mai.
 */
export function commonsCredit(file: Pick<CommonsFile, 'author' | 'licence'>): string {
  const tail = `Wikimedia Commons (${file.licence})`
  const author = (file.author || '').replace(/\s+/g, ' ').trim()
  if (!author) return `Foto: ${tail}`
  const room = CREDIT_MAX - 'Foto: '.length - ' / '.length - tail.length
  const short = author.length > room ? `${author.slice(0, Math.max(1, room - 1)).trimEnd()}…` : author
  return `Foto: ${short} / ${tail}`
}

// --- Tutto insieme ------------------------------------------------------------------------

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const k = next++
      out[k] = await fn(items[k], k)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

const SICILY = /sicil|palermo|catania|messina|siracusa|trapani|agrigento|ragusa|enna|caltanissetta|cefal|monreale|taormina|\bnoto\b|marsala|bagheria|mondello|ortigia|erice|lampedusa|eolie|lipari/i

/**
 * Cose tipiche (se la ricerca non ne propone abbastanza): solo titoli e parole per Commons,
 * niente descrizioni inventate. Quelle siciliane solo se si parla della Sicilia.
 */
const fallbackThemes = (place: string, query: string): FoundTheme[] => [
  { title: `Il centro storico di ${place}`, description: '', search: `${place} centro storico` },
  { title: 'La cattedrale', description: '', search: `${place} cattedrale` },
  { title: 'I mercati storici', description: '', search: `${place} mercato` },
  { title: 'Le piazze', description: '', search: `${place} piazza` },
  ...(SICILY.test(`${place} ${query}`)
    ? [
        { title: 'I cannoli siciliani', description: '', search: 'cannoli siciliani' },
        { title: 'Le arancine', description: '', search: 'arancine arancini Sicilia' },
        { title: 'La granita siciliana', description: '', search: 'granita siciliana' },
        { title: 'Il carretto siciliano', description: '', search: 'carretto siciliano' },
        { title: "L'opera dei pupi", description: '', search: 'opera dei pupi' },
        { title: 'Le ceramiche siciliane', description: '', search: 'ceramica siciliana' },
      ]
    : [{ title: 'Il panorama', description: '', search: `${place} panorama` }]),
]

/**
 * Strumento find_event_images: eventi reali (ricerca Google) con le loro locandine, e se
 * chiesto foto libere di cose tipiche del posto, tutte salvate nel nostro archivio con
 * credito e fonte. Il limite del piano si controlla prima di ogni chiamata all'AI.
 */
export async function findEventImages(workspaceId: string, input: FindEventImagesInput): Promise<FindEventImagesResult> {
  // Solo foto generiche: nessuna chiamata all'AI (ne' tariffa della ricerca).
  if (!input.onlyGeneric) await assertAIAllowed(workspaceId)
  const count = Math.min(10, Math.max(1, Math.round(Number(input.count) || 1)))
  const place = input.place.trim().slice(0, 80)
  if (!place) throw new Error('manca la città o la zona in cui cercare')
  const from = isoDay(input.fromDate) || romeToday()
  const to = isoDay(input.toDate) && isoDay(input.toDate)! >= from ? isoDay(input.toDate)! : addDays(from, 90)
  const deadline = Date.now() + 120_000
  const timeLeft = () => deadline - Date.now()

  const { events, themes, queries } = input.onlyGeneric
    ? { events: [] as FoundEvent[], themes: [] as FoundTheme[], queries: [] as string[] }
    : await searchEvents(workspaceId, { query: input.query.trim().slice(0, 200), place, from, to, count, includeGeneric: input.includeGeneric })

  // 1. Pagine degli eventi (siti ufficiali prima, social mai) e loro immagini di anteprima.
  const candidates = await mapLimit(events, 4, async (event) => {
    const list: { page: string; image: string }[] = []
    for (const source of event.sources.filter((s) => sourceScore(s, event.title) > -100).slice(0, 3)) {
      if (list.length >= 2 || timeLeft() < 20_000) break
      try {
        const { page, images } = await pageImages(source)
        for (const image of images) list.push({ page, image })
      } catch (error) {
        console.log(`ricerca web: pagina non letta (${domainOf(source)}): ${error instanceof Error ? error.message : error}`)
      }
    }
    return list
  })
  // La stessa immagine per eventi diversi e' quella generica del sito (logo, banner): non e' una locandina.
  const uses = new Map<string, number>()
  candidates.forEach((list) => new Set(list.map((c) => c.image)).forEach((img) => uses.set(img, (uses.get(img) || 0) + 1)))

  // 2. Scarico, controllo e salvo (una per evento, mai due uguali).
  const hashes = new Set<string>()
  const usedCommons = new Set<string>((input.exclude?.sources || []).filter(Boolean))
  const host = async (buffer: Buffer) => storeWebImage(workspaceId, buffer)
  const images: (WebImage | null)[] = await mapLimit(events, 4, async (_event, k) => {
    for (const c of candidates[k]) {
      if ((uses.get(c.image) || 0) > 1 || timeLeft() < 10_000) continue
      try {
        const img = await downloadWebImage(c.image)
        if (hashes.has(img.hash)) continue
        hashes.add(img.hash)
        const domain = domainOf(c.page)
        return { image_url: await host(img.buffer), source_url: c.page, source_domain: domain, credit: `Foto: ${domain}` }
      } catch (error) {
        console.log(`ricerca web: immagine scartata (${domainOf(c.image)}): ${error instanceof Error ? error.message : error}`)
      }
    }
    return null
  })

  /** Foto libera da Commons per una delle ricerche, o null. */
  const fromCommons = async (searches: string[]): Promise<WebImage | null> => {
    for (const search of searches.filter(Boolean)) {
      if (timeLeft() < 8000) return null
      let files: CommonsFile[] = []
      try {
        files = await commonsCandidates(search)
      } catch {
        continue
      }
      for (const file of files.slice(0, 4)) {
        if (usedCommons.has(file.pageUrl)) continue
        usedCommons.add(file.pageUrl)
        try {
          const img = await downloadWebImage(file.thumbUrl)
          if (hashes.has(img.hash)) continue
          hashes.add(img.hash)
          return { image_url: await host(img.buffer), source_url: file.pageUrl, source_domain: 'commons.wikimedia.org', credit: commonsCredit(file) }
        } catch (error) {
          console.log(`ricerca web: foto di Commons scartata: ${error instanceof Error ? error.message : error}`)
        }
      }
    }
    return null
  }

  // 3. Eventi senza locandina: foto libera dell'evento o del suo luogo (Commons), mai lo stesso file due volte.
  await mapLimit(events, 3, async (event, k) => {
    if (images[k]) return
    const venue = (event.place || '').split(',')[0].trim()
    images[k] = await fromCommons([`${event.title} ${place}`, venue && venue.toLowerCase() !== place.toLowerCase() ? `${venue} ${place}` : ''])
  })

  const items: WebItem[] = []
  const withoutImage: FindEventImagesResult['withoutImage'] = []
  events.forEach((event, k) => {
    const source = event.sources[0] || null
    const base = { title: event.title, dates: event.dates, start: event.start, end: event.end, place: event.place, description: event.description, source_url: source, source_domain: source ? domainOf(source) : null }
    if (images[k]) items.push({ kind: 'event', ...base, image: images[k]! })
    else withoutImage.push({ title: event.title, dates: event.dates, source_url: source })
  })
  items.sort((a, b) => (a.start || '9999').localeCompare(b.start || '9999'))

  // 4. Slide generiche (cose tipiche del posto) per arrivare al numero chiesto.
  if ((input.includeGeneric || input.onlyGeneric) && items.length < count) {
    const shown = new Set((input.exclude?.titles || []).map((t) => t.toLowerCase()))
    const pool = [...themes, ...fallbackThemes(place, input.query)].filter(
      (t, i, all) => !shown.has(t.title.toLowerCase()) && all.findIndex((x) => x.title.toLowerCase() === t.title.toLowerCase()) === i
    )
    for (const theme of pool) {
      if (items.length >= count || timeLeft() < 8000) break
      const image = await fromCommons([theme.search, theme.title])
      if (!image) continue
      items.push({ kind: 'generic', title: theme.title, dates: null, start: null, end: null, place, description: theme.description, source_url: null, source_domain: null, image })
    }
  }
  return { items: items.slice(0, count), requested: count, eventsFound: events.length, withoutImage, queries }
}
