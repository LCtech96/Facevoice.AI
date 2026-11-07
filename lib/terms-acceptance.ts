import { createHash } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { readSetting, updateSetting } from '@/lib/settings-store'
import { TERMS_VERSION, termsFor, termsItemList, type PublishedTerms } from '@/lib/terms'

// Accettazione dei termini e condizioni, solo sul server. In app_settings una chiave per
// persona, terms_acceptance:<userId>, con lo storico delle accettazioni: versione, impronta
// SHA-256 del testo esatto, le tre caselle spuntate, data e ora del server, IP, browser ed
// email. Data, IP e browser li decide sempre il server, mai chi chiama.
// Storico breve: la prima accettazione resta sempre, poi le piu' recenti (MAX_HISTORY in tutto).

export const TERMS_KEY_PREFIX = 'terms_acceptance:'
const MAX_HISTORY = 10
const MAX_IP = 64
const MAX_UA = 400
const MAX_EMAIL = 200
const MAX_ITEM = 2000

export type TermsSource = 'signup' | 'gate'

export type TermsAcceptance = {
  version: string
  /** SHA-256 (esadecimale) del testo della versione accettata. */
  textHash: string
  /** Testi esatti delle tre caselle spuntate (a, b, c). */
  items: string[]
  acceptedAt: string
  ip: string
  userAgent: string
  email: string
  /** signup: alla registrazione; gate: al blocco "accetta i termini" dell'area clienti. */
  source: TermsSource
}

type Stored = { history: TermsAcceptance[] }

export const termsKey = (userId: string) => `${TERMS_KEY_PREFIX}${userId}`

export const termsTextHash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

/**
 * Versione pubblicata con il suo testo, solo se il testo corrisponde ancora all'impronta
 * fissata alla pubblicazione (una versione pubblicata non si cambia); altrimenti null.
 */
export function publishedTerms(version: string): PublishedTerms | null {
  const terms = termsFor(version)
  if (!terms) return null
  if (termsTextHash(terms.text) !== terms.hash) {
    console.error(`termini: il testo della versione ${version} non corrisponde piu' alla sua impronta`)
    return null
  }
  return terms
}

const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '')

function entryFrom(v: unknown): TermsAcceptance | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const e = v as Record<string, unknown>
  const version = clip(e.version, 40)
  const acceptedAt = clip(e.acceptedAt, 40)
  if (!version || !acceptedAt || Number.isNaN(Date.parse(acceptedAt))) return null
  return {
    version,
    textHash: /^[0-9a-f]{64}$/.test(String(e.textHash)) ? String(e.textHash) : '',
    items: Array.isArray(e.items) ? e.items.map((i) => clip(i, MAX_ITEM)).filter(Boolean).slice(0, 3) : [],
    acceptedAt,
    ip: clip(e.ip, MAX_IP),
    userAgent: clip(e.userAgent, MAX_UA),
    email: clip(e.email, MAX_EMAIL),
    source: e.source === 'signup' ? 'signup' : 'gate',
  }
}

function parseStored(raw: string | null): Stored {
  if (!raw) return { history: [] }
  try {
    const value = JSON.parse(raw) as { history?: unknown }
    const history = Array.isArray(value?.history) ? value.history.map(entryFrom).filter((e): e is TermsAcceptance => Boolean(e)) : []
    return { history }
  } catch {
    return { history: [] }
  }
}

/** Storico delle accettazioni di una persona, dalla piu' vecchia. */
export async function acceptanceHistory(userId: string): Promise<TermsAcceptance[]> {
  const { value } = await readSetting(termsKey(userId))
  return parseStored(value).history
}

/** Ultima accettazione (di qualunque versione), oppure null. */
export async function latestAcceptance(userId: string): Promise<TermsAcceptance | null> {
  const history = await acceptanceHistory(userId)
  return history[history.length - 1] ?? null
}

/** Ha accettato la versione in vigore? (Errori di lettura: eccezione, decide chi chiama.) */
export async function hasCurrentAcceptance(userId: string): Promise<boolean> {
  const history = await acceptanceHistory(userId)
  return history.some((e) => e.version === TERMS_VERSION)
}

/** Primo indirizzo di x-forwarded-for (quello del visitatore su Vercel), poi x-real-ip. */
export function requestIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return clip(forwarded || headers.get('x-real-ip') || '', MAX_IP)
}

export const requestUserAgent = (headers: Headers) => clip(headers.get('user-agent') || '', MAX_UA)

/**
 * Controlla la richiesta di accettazione: { version: TERMS_VERSION, accept: { a: true, b: true, c: true } }.
 * null se va bene, altrimenti il messaggio da mostrare.
 */
export function acceptanceError(body: unknown): string | null {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  if (b.version !== TERMS_VERSION) return 'I termini sono stati aggiornati: ricarica la pagina e rileggili.'
  const accept = b.accept && typeof b.accept === 'object' ? (b.accept as Record<string, unknown>) : {}
  if (accept.a !== true || accept.b !== true || accept.c !== true) return 'Per continuare spunta tutte e tre le caselle.'
  return null
}

/**
 * Registra l'accettazione della versione in vigore con data e ora del server.
 * Se l'ultima accettazione e' gia' questa versione non aggiunge niente e la restituisce.
 */
export async function recordAcceptance(input: {
  userId: string
  email: string
  ip: string
  userAgent: string
  source: TermsSource
  now?: Date
}): Promise<{ entry: TermsAcceptance; created: boolean }> {
  const terms = publishedTerms(TERMS_VERSION)
  if (!terms) throw new Error('termini in vigore non disponibili')
  const entry: TermsAcceptance = {
    version: terms.version,
    textHash: terms.hash,
    items: termsItemList(terms),
    acceptedAt: (input.now ?? new Date()).toISOString(),
    ip: clip(input.ip, MAX_IP),
    userAgent: clip(input.userAgent, MAX_UA),
    email: clip(input.email, MAX_EMAIL).toLowerCase(),
    source: input.source,
  }
  let result = { entry, created: true }
  await updateSetting(termsKey(input.userId), parseStored, (current) => {
    const last = current.history[current.history.length - 1]
    if (last && last.version === entry.version && last.textHash === entry.textHash) {
      result = { entry: last, created: false }
      return false
    }
    const history = [...current.history, entry]
    // La prima accettazione resta sempre; delle altre solo le piu' recenti.
    const trimmed = history.length > MAX_HISTORY ? [history[0], ...history.slice(-(MAX_HISTORY - 1))] : history
    return { history: trimmed }
  })
  return result
}

/** Ultima accettazione di ogni persona che ne ha una (per il pannello di Facevoice). */
export async function latestAcceptances(): Promise<Map<string, TermsAcceptance>> {
  const out = new Map<string, TermsAcceptance>()
  const PAGE = 1000
  for (let from = 0; from < 50_000; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('app_settings')
      .select('key, value')
      .like('key', `${TERMS_KEY_PREFIX}%`)
      .order('key', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`accettazioni non lette: ${error.message}`)
    for (const row of data || []) {
      const userId = String(row.key).slice(TERMS_KEY_PREFIX.length)
      const history = parseStored(typeof row.value === 'string' ? row.value : JSON.stringify(row.value ?? null)).history
      const last = history[history.length - 1]
      if (userId && last) out.set(userId, last)
    }
    if (!data || data.length < PAGE) break
  }
  return out
}
