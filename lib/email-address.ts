// Indirizzi email: riconoscere quelli automatici (no-reply, notifiche…) e il
// dominio dell'azienda, per rispondere a un indirizzo che qualcuno legge davvero.

const AUTOMATIC_LOCAL = /(^|[^a-z])(no-?reply|do-?not-?reply|donotreply|automated|mailer-daemon|notifications?|notify|bounces?|postmaster)([^a-z]|$)/i

/** Indirizzo a cui non risponde nessuno (no-reply, notifiche automatiche…). */
export const isAutomaticEmail = (address: string) => AUTOMATIC_LOCAL.test(address.split('@')[0] || '')

/** Dominio principale: "fiumicino.galdierirent.it" → "galdierirent.it". */
export function baseDomain(address: string): string | null {
  const host = address.split('@')[1]?.toLowerCase().trim()
  if (!host || !host.includes('.')) return null
  return host.split('.').slice(-2).join('.')
}

/** Indirizzi email scritti in un testo. */
export const emailsInText = (text: string) =>
  [...new Set((text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((e) => e.toLowerCase().replace(/[.,;:]+$/, '')))]

const VALID_EMAIL = /^[a-z0-9._%+-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/

/** Decodifica le entita' HTML con cui molti siti nascondono le email (&#109; &#x6d; &#64; &commat;...). */
export const decodeEntities = (text: string) =>
  text
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&commat;/gi, '@')
    .replace(/&period;/gi, '.')
    .replace(/&amp;/gi, '&')

/**
 * Indirizzo email pulito, o null se non e' un indirizzo vero. Ripara quelli
 * letti male dai siti: entita' HTML, "mailto:", barre o virgolette finali
 * (es. "info@sito.it\\"), segnaposto di codice ("${salon.email}").
 */
export function cleanEmail(raw: string | null | undefined): string | null {
  if (!raw) return null
  let value = decodeEntities(String(raw))
  try {
    value = decodeURIComponent(value)
  } catch {}
  value = value
    .trim()
    .replace(/^mailto:/i, '')
    .split('?')[0]
    .replace(/^[^a-z0-9]+/i, '')
    .replace(/[^a-z]+$/i, '')
    .toLowerCase()
  if (!VALID_EMAIL.test(value) || isPlaceholderEmail(value)) return null
  return value
}

// Segnaposto letti dai siti o dal codice: "esempio@mail.com", "a@a.it",
// "components@modals.js" (nome di un file, non un dominio).
const PLACEHOLDER_LOCAL = /^(esempio|example|tuaemail|tua-email|tuoindirizzo|youremail|your-email|yourname|nome\.cognome|mario\.rossi)$/
const PLACEHOLDER_DOMAIN = /^(example\.(com|it|org|net)|esempio\.(com|it)|dominio\.(com|it)|domain\.com|tuosito\.it|sito\.it|[a-z]\.[a-z]{2})$/
const FILE_EXTENSION_TLD = /\.(js|mjs|ts|tsx|jsx|css|scss|php|html?|json|xml|png|jpe?g|gif|svg|webp|ico|map|woff2?)$/

/** Indirizzo che sembra valido ma e' un segnaposto o il nome di un file. */
export function isPlaceholderEmail(address: string): boolean {
  const [local = '', domain = ''] = address.toLowerCase().split('@')
  return PLACEHOLDER_LOCAL.test(local) || PLACEHOLDER_DOMAIN.test(domain) || FILE_EXTENSION_TLD.test(domain)
}
