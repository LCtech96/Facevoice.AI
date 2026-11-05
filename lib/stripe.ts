import { createHmac, randomUUID, timingSafeEqual } from 'crypto'

// Stripe senza librerie: chiamate REST con fetch (form urlencoded, chiave segreta
// nell'header Authorization, versione dell'API fissata) e controllo della firma
// dei webhook fatto qui. Chiavi in STRIPE_SECRET_KEY e STRIPE_WEBHOOK_SECRET.

/**
 * Versione dell'API fissata: le risposte hanno sempre la stessa forma, qualunque
 * sia la versione dell'account. In questa versione current_period_start/end
 * stanno sull'abbonamento (le versioni dal 2025 li spostano sulle voci: si
 * leggono comunque tutti e due, vedi lib/billing.ts).
 */
export const STRIPE_API_VERSION = '2024-06-20'

const API_BASE = 'https://api.stripe.com/v1'

export const stripeSecretKey = () => (process.env.STRIPE_SECRET_KEY || '').trim()
export const stripeWebhookSecret = () => (process.env.STRIPE_WEBHOOK_SECRET || '').trim()

/** Pagamenti online attivi: senza la chiave tutto resta come prima (piano gratis, contatto WhatsApp). */
export const stripeConfigured = () => Boolean(stripeSecretKey())

/** Modo della chiave: true reale (sk_live_/rk_live_), false di prova (sk_test_/rk_test_), null se non si capisce. */
export function stripeLiveMode(): boolean | null {
  const key = stripeSecretKey()
  if (/^(sk|rk)_live_/.test(key)) return true
  if (/^(sk|rk)_test_/.test(key)) return false
  return null
}

// --- Tipi (solo i campi usati) ---------------------------------------------------------

export type StripeList<T> = { object: 'list'; data: T[]; has_more: boolean }

export type StripePrice = {
  id: string
  active: boolean
  lookup_key: string | null
  unit_amount: number | null
  currency: string
  product: string | { id: string }
  metadata?: Record<string, string>
}

export type StripeSubscriptionItem = {
  id: string
  price: StripePrice
  quantity?: number
  current_period_start?: number
  current_period_end?: number
}

export type StripeSubscriptionStatus = 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid' | 'incomplete' | 'incomplete_expired' | 'paused'

export type StripeSubscription = {
  id: string
  object: 'subscription'
  status: StripeSubscriptionStatus
  customer: string | { id: string }
  items: { data: StripeSubscriptionItem[] }
  current_period_start?: number
  current_period_end?: number
  trial_start?: number | null
  trial_end?: number | null
  cancel_at_period_end: boolean
  cancel_at?: number | null
  created: number
  livemode?: boolean
  metadata?: Record<string, string>
  /** Cambio in attesa del pagamento (payment_behavior=pending_if_incomplete). */
  pending_update?: Record<string, unknown> | null
  latest_invoice?: string | StripeInvoice | null
}

export type StripeInvoice = {
  id: string
  status: string | null
  amount_paid: number
  hosted_invoice_url?: string | null
  payment_intent?: string | { id: string } | null
  charge?: string | { id: string } | null
}

export type StripeCheckoutSession = { id: string; url: string | null; status: 'open' | 'complete' | 'expired' | null; expires_at: number }

export type StripeCustomer = { id: string; deleted?: boolean; email?: string | null; metadata?: Record<string, string> }
export type StripeTaxRate = { id: string; active: boolean; percentage: number; inclusive: boolean; metadata?: Record<string, string> }
export type StripeEvent = { id: string; type: string; created: number; livemode: boolean; data: { object: Record<string, unknown> } }

/** Id di un oggetto Stripe che puo' arrivare come stringa o gia' espanso. */
export function stripeId(value: unknown): string | null {
  if (typeof value === 'string' && value) return value
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') return (value as { id: string }).id
  return null
}

// --- Richieste --------------------------------------------------------------------------

export class StripeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly type?: string,
    readonly code?: string,
    readonly declineCode?: string
  ) {
    super(message)
    this.name = 'StripeError'
  }
}

export const isStripeError = (error: unknown): error is StripeError => error instanceof StripeError

type Params = Record<string, unknown>

/** Chiave con le parentesi lasciate in chiaro: line_items[0][price]. */
const encodeKey = (key: string) => key.replace(/[^[\]]+/g, (part) => encodeURIComponent(part))

/**
 * Parametri annidati nel formato di Stripe:
 * { a: { b: 1 }, items: [{ price: 'x' }] } -> a[b]=1&items[0][price]=x.
 * undefined e null si saltano; le date diventano secondi Unix.
 */
export function encodeForm(params: Params): string {
  const out: string[] = []
  const add = (key: string, value: unknown) => {
    if (value === undefined || value === null) return
    if (value instanceof Date) {
      out.push(`${encodeKey(key)}=${Math.floor(value.getTime() / 1000)}`)
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => add(`${key}[${index}]`, item))
    } else if (typeof value === 'object') {
      for (const [child, item] of Object.entries(value as Params)) add(`${key}[${child}]`, item)
    } else {
      out.push(`${encodeKey(key)}=${encodeURIComponent(String(value))}`)
    }
  }
  for (const [key, value] of Object.entries(params)) add(key, value)
  return out.join('&')
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type RequestOptions = {
  /** Per le POST: stessa chiave = stessa operazione (anche ripetuta). Senza, una nuova a ogni chiamata. */
  idempotencyKey?: string
  timeoutMs?: number
}

/**
 * Chiamata all'API di Stripe. Le POST portano sempre una chiave di idempotenza,
 * la stessa nei nuovi tentativi: se la rete cade a meta', ripetere non crea
 * doppioni. Si riprova (al massimo 2 volte) solo su rete, 409 di idempotenza, 429 e 5xx.
 */
export async function stripeRequest<T>(method: 'GET' | 'POST' | 'DELETE', path: string, params?: Params, options: RequestOptions = {}): Promise<T> {
  const key = stripeSecretKey()
  if (!key) throw new StripeError('Stripe non configurato', 0)
  const form = params ? encodeForm(params) : ''
  const url = `${API_BASE}${path}${method !== 'POST' && form ? `?${form}` : ''}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    'Stripe-Version': STRIPE_API_VERSION,
  }
  if (method === 'POST') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    headers['Idempotency-Key'] = options.idempotencyKey || `fv-${randomUUID()}`
  }

  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await fetch(url, {
        method,
        headers,
        body: method === 'POST' ? form : undefined,
        cache: 'no-store',
        signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
      })
    } catch (error) {
      if (attempt < 2) {
        await sleep(300 * (attempt + 1))
        continue
      }
      throw new StripeError(`Stripe non raggiungibile: ${error instanceof Error ? error.message : String(error)}`, 0)
    }
    const data = (await res.json().catch(() => null)) as { error?: { message?: string; type?: string; code?: string; decline_code?: string } } | null
    if (res.ok) return data as T
    const retry = res.headers.get('stripe-should-retry')
    const retriable = retry === 'true' || (retry !== 'false' && (res.status === 409 || res.status === 429 || res.status >= 500))
    if (retriable && attempt < 2) {
      await sleep(500 * (attempt + 1))
      continue
    }
    const err = data?.error
    throw new StripeError(err?.message || `Stripe: errore ${res.status}`, res.status, err?.type, err?.code, err?.decline_code)
  }
}

// --- Firma dei webhook ------------------------------------------------------------------

/** Tolleranza sull'orario della firma (contro le richieste rimandate). */
export const WEBHOOK_TOLERANCE_SEC = 300

/** Firma come la calcola Stripe: HMAC-SHA256 di "t.payload" con la chiave del webhook, in esadecimale. */
export function stripeSignature(payload: string | Buffer, secret: string, timestamp: number): string {
  return createHmac('sha256', secret).update(`${timestamp}.`, 'utf8').update(payload).digest('hex')
}

/**
 * Controlla l'header Stripe-Signature ("t=...,v1=...,v1=...") sul corpo grezzo
 * della richiesta: almeno una firma v1 deve essere giusta (confronto a tempo
 * costante) e l'orario entro 5 minuti.
 */
export function verifyStripeSignature(payload: string | Buffer, header: string | null | undefined, secret: string, nowMs = Date.now()): boolean {
  if (!header || !secret) return false
  let timestamp = NaN
  const signatures: string[] = []
  for (const part of header.split(',')) {
    const at = part.indexOf('=')
    if (at < 0) continue
    const name = part.slice(0, at).trim()
    const value = part.slice(at + 1).trim()
    if (name === 't') timestamp = Number(value)
    else if (name === 'v1') signatures.push(value)
  }
  if (!Number.isInteger(timestamp) || !signatures.length) return false
  if (Math.abs(nowMs / 1000 - timestamp) > WEBHOOK_TOLERANCE_SEC) return false
  const expected = Buffer.from(stripeSignature(payload, secret, timestamp), 'hex')
  return signatures.some((signature) => {
    if (!/^[0-9a-f]{64}$/i.test(signature)) return false
    const given = Buffer.from(signature, 'hex')
    return given.length === expected.length && timingSafeEqual(given, expected)
  })
}
