import { cleanEmail, decodeEntities, isAutomaticEmail } from '@/lib/email-address'
import { detectLanguage } from '@/lib/detect-language'
import { safeWebGet, WebFetchError } from './web-fetch'

// Lettura del sito di un'azienda trovata con Trova clienti (come il Motore clienti del sito
// principale): email pubblica dell'azienda, social, cosa fa. Sempre con la lettura sicura
// (lib/saas/web-fetch.ts: mai indirizzi interni, tempo e peso massimi), al massimo 3 pagine
// dello stesso sito (home e pagina contatti).

export type SiteInfo = {
  reachable: boolean
  email: string | null
  instagram: string | null
  facebook: string | null
  /** Testo visibile della home (per l'AI). */
  text: string
  title: string
  description: string
  language: string | null
}

const MAX_PAGE_BYTES = 600_000
const PAGE_TIMEOUT_MS = 8000

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
const IGNORED_EMAIL = /\.(png|jpe?g|gif|webp|svg|css|js)$|sentry|wixpress|example\.|domain\.|dominio\.|tuodominio|yourdomain|@2x|u00/i
// Indirizzi di sistema o del servizio che ospita il sito (dal sito principale): non sono dell'azienda.
const SYSTEM_EMAIL =
  /^(abuse|postmaster|hostmaster|webmaster|noreply|no-reply|donotreply|mailer-daemon|dmca|legal|privacy|gdpr|dpo|rpd|support-noreply)[@._-]|@(altervista\.(org|it)|aruba\.it|register\.it|wix\.com|godaddy\.com|siteground\.\w+|ovh\.\w+|netsons\.\w+|tophost\.it|serverplan\.com)$/i
// Piattaforme generiche (costruttori di siti, prenotazioni, consegne, social) e caselle PEC.
const PLATFORM_DOMAIN =
  /@([a-z0-9-]+\.)*(wix|wixsite|squarespace|wordpress|jimdo|webnode|weebly|godaddysites|shopify|booking|airbnb|tripadvisor|thefork|justeat|glovoapp|glovo|deliveroo|ubereats|facebook|instagram|google|yelp|paginegialle|paginebianche|subito|immobiliare|idealista|houzz|treatwell|miodottore|doctolib|fresha|uala|prenotazioni24)\.[a-z.]+$|@([a-z0-9-]+\.)*(pec|legalmail|arubapec|postacert|pecimprese|cert)\.[a-z.]+$|@pec\./i
const FREE_MAIL = /@(gmail|googlemail|libero|hotmail|outlook|live|yahoo|ymail|icloud|me|mac|tiscali|alice|virgilio|tin|fastwebnet|aol|gmx|email|inwind|msn|protonmail|proton|tim|vodafone|katamail|teletu)\.[a-z.]+$/i
/** Casella di un servizio di posta gratuito (Gmail, Libero…): il dominio non e' dell'azienda. */
export const isFreeMail = (email: string) => FREE_MAIL.test(email)
// Caselle di un ruolo (non di una persona).
const ROLE_LOCAL =
  /(^|[._-])(info|informazioni|contatti|contatto|contact|contacts|hello|ciao|hola|booking|book|prenota|prenotazioni|reservations?|reserva|ordini|orders?|amministrazione|admin|segreteria|office|ufficio|sales|commerciale|vendite|shop|negozio|store|staff|reception|eventi|events|marketing|studio|direzione|clienti|customer|servizio|service|welcome|mail|email|team|bar|ristorante|hotel|pizzeria)([._-]|\d|$)/i
const NAME_STOP = new Set(['della', 'dello', 'delle', 'degli', 'dalla', 'dal', 'del', 'srl', 'snc', 'sas', 'spa', 'srls', 'the', 'and', 'con', 'per', 'via', 'casa', 'studio', 'centro'])

/** Parole del nome dell'azienda (per riconoscere le sue caselle anche su Gmail). */
export function nameTokens(name: string): string[] {
  return [
    ...new Set(
      name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length >= 4 && !NAME_STOP.has(t))
    ),
  ]
}

/** Dominio del sito senza "www." (es. "pizzeriagusto.it"). */
export const siteDomain = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

const sameSite = (email: string, domain: string) => Boolean(domain) && (email.endsWith(`@${domain}`) || email.endsWith(`.${domain}`) || domain.endsWith(`.${email.split('@')[1]}`))

/** Casella di una persona (nome.cognome, m.rossi): non si scrive a persone, solo alle caselle dell'azienda. */
export function looksPersonal(email: string, tokens: string[]): boolean {
  const local = email.split('@')[0]
  if (ROLE_LOCAL.test(local) || tokens.some((t) => local.includes(t))) return false
  return /^[a-z]{2,15}[._-][a-z]{2,20}\d{0,4}$/.test(local) || /^[a-z][._-][a-z]{3,20}\d{0,4}$/.test(local)
}

/**
 * La migliore email pubblica dell'azienda tra quelle trovate, o null: prima quelle del dominio
 * del sito (meglio se di un ruolo, info@…), poi Gmail e simili solo se il nome della casella
 * richiama l'azienda o un ruolo. Mai caselle di persone, di sistema, PEC o di piattaforme.
 */
export function pickBusinessEmail(found: string[], options: { domain: string; name: string }): string | null {
  const tokens = nameTokens(options.name)
  const clean = [...new Set(found.map((e) => cleanEmail(e)).filter((e): e is string => Boolean(e)))].filter(
    (e) => !IGNORED_EMAIL.test(e) && !SYSTEM_EMAIL.test(e) && !PLATFORM_DOMAIN.test(e) && !isAutomaticEmail(e) && !looksPersonal(e, tokens)
  )
  const own = clean.filter((e) => sameSite(e, options.domain))
  const role = (e: string) => ROLE_LOCAL.test(e.split('@')[0])
  const named = (e: string) => tokens.some((t) => e.includes(t))
  if (own.length) return own.find(role) || own[0]
  // Fuori dal dominio del sito: solo se il nome della casella o il dominio richiamano l'azienda
  // (le email di altri domini sono spesso dell'agenzia che ha fatto il sito).
  const free = clean.filter((e) => FREE_MAIL.test(e) && (named(e) || role(e)))
  if (free.length) return free.find(named) || free[0]
  return clean.find((e) => !FREE_MAIL.test(e) && named(e.split('@')[1] || '')) || null
}

export function visibleText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim()
}

function pickSocial(html: string, host: 'instagram.com' | 'facebook.com'): string | null {
  const re = new RegExp(`https?://(?:www\\.)?${host.replace('.', '\\.')}/[A-Za-z0-9_.\\-/]+`, 'gi')
  const links = (html.match(re) || []).filter((link) => !/\/(sharer|share|plugins|tr|dialog|p|reel|explore|hashtag)\b/i.test(link))
  return links[0]?.replace(/\/+$/, '').slice(0, 200) || null
}

function emailsIn(rawHtml: string): string[] {
  // Molti siti scrivono le email come entita' HTML (&#109;&#97;...) per nasconderle ai robot.
  const html = decodeEntities(rawHtml)
  const fromMailto = [...html.matchAll(/mailto:([^"'?\s>]+)/gi)].map((m) => m[1])
  return [...fromMailto, ...(html.match(EMAIL_RE) || [])]
}

const meta = (html: string, name: string) =>
  decodeEntities(
    html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i'))?.[1] ||
      html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, 'i'))?.[1] ||
      ''
  ).trim()

/** Una pagina HTML del sito ("" se non si legge). */
async function fetchPage(url: string): Promise<{ html: string; url: string } | null> {
  try {
    const res = await safeWebGet(url, { maxBytes: MAX_PAGE_BYTES, timeoutMs: PAGE_TIMEOUT_MS, accept: 'text/html,application/xhtml+xml' })
    if (res.status !== 200 || !/html/.test(res.contentType || 'text/html')) return null
    return { html: res.body.toString('utf8').slice(0, MAX_PAGE_BYTES), url: res.url }
  } catch (error) {
    if (!(error instanceof WebFetchError)) console.warn('trova clienti: sito non letto:', error instanceof Error ? error.message : error)
    return null
  }
}

const EMPTY: SiteInfo = { reachable: false, email: null, instagram: null, facebook: null, text: '', title: '', description: '', language: null }

/** Legge home e (se serve) pagina contatti dello stesso sito: email dell'azienda, social e testo. */
export async function readBusinessSite(website: string, businessName: string): Promise<SiteInfo> {
  let base: URL
  try {
    base = new URL(website)
  } catch {
    return EMPTY
  }
  const home = await fetchPage(base.href)
  if (!home) return EMPTY
  const domain = siteDomain(home.url) || siteDomain(base.href)
  let html = home.html
  let email = pickBusinessEmail(emailsIn(home.html), { domain, name: businessName })
  if (!email) {
    // Pagina contatti dello stesso sito: dal link nella home, altrimenti i percorsi piu' comuni.
    const linked = [...home.html.matchAll(/href=["']([^"'#]*(contatt|contact|dove-siamo|chi-siamo|about)[^"'#]*)["']/gi)].map((m) => m[1])
    const candidates = [...linked, '/contatti', '/contact']
      .map((path) => {
        try {
          return new URL(decodeEntities(path), home.url)
        } catch {
          return null
        }
      })
      .filter((u): u is URL => Boolean(u && /^https?:$/.test(u.protocol) && siteDomain(u.href) === domain && u.href !== home.url))
    const seen = new Set<string>()
    for (const url of candidates) {
      if (seen.has(url.href) || seen.size >= 2) continue
      seen.add(url.href)
      const page = await fetchPage(url.href)
      if (!page) continue
      html += page.html
      email = pickBusinessEmail(emailsIn(page.html), { domain, name: businessName })
      if (email) break
    }
  }
  const text = visibleText(home.html).slice(0, 5000)
  const title = visibleText(home.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').slice(0, 160)
  const description = (meta(home.html, 'description') || meta(home.html, 'og:description')).slice(0, 400)
  const lang = home.html.match(/<html[^>]*\slang=["']?([a-z]{2})/i)?.[1]?.toLowerCase() || (text.length > 80 ? detectLanguage(text) : null)
  return {
    reachable: true,
    email,
    instagram: pickSocial(html, 'instagram.com'),
    facebook: pickSocial(html, 'facebook.com'),
    text,
    title,
    description,
    language: lang || null,
  }
}
