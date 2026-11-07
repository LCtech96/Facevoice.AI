import { createSign } from 'crypto'
import {
  DELAY,
  PLACES_SERVICE,
  serviceLabel,
  type AnthropicData,
  type BillingData,
  type BillingGroup,
  type BillingLine,
  type Counts,
  type GoogleAccessMode,
  type Money,
  type MoneyUsage,
  type MonitoringData,
  type Source,
  type TrafficPoint,
  type TrafficSeries,
} from '@/lib/consumi'

// Consumi reali letti da Google e da Anthropic, solo sul server (pagina Consumi).
//
// - Richieste per API e per chiave: Cloud Monitoring, metrica
//   serviceruntime.googleapis.com/api/request_count (risorsa consumed_api), al
//   minuto con qualche minuto di ritardo.
// - Costi: export standard della fatturazione in BigQuery (cost, credits,
//   usage.amount_in_pricing_units, export_time). Google lo aggiorna piu' volte al
//   giorno, non al minuto.
// - Costi di Claude: Usage & Cost Admin API di Anthropic (cost_report).
//
// Accesso a Google con un service account, in uno di due modi:
// - senza chiave (GOOGLE_WIF_PROVIDER + GOOGLE_USAGE_SA_EMAIL): il token OIDC che Vercel
//   da' a ogni richiesta (header x-vercel-oidc-token, oppure VERCEL_OIDC_TOKEN) si scambia
//   con Google (Security Token Service, Workload Identity Federation) e poi con un token
//   del service account (IAM Service Account Credentials, generateAccessToken);
// - con la chiave JSON (GOOGLE_USAGE_SA_JSON, vince se c'e'): JWT firmato RS256 con la sua
//   chiave privata, scambiato con un token di accesso.
// Il token del service account resta in memoria fino a poco prima della scadenza. Chiave,
// token (di Vercel e di Google) e chiavi API non finiscono mai in risposte, errori o log.

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const STS_URL = 'https://sts.googleapis.com/v1/token'
const IAM_CREDENTIALS_URL = 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts'
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'
export const MISSING_VERCEL_TOKEN = 'Token di Vercel mancante: attiva OIDC Federation nelle impostazioni del progetto Vercel.'
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/monitoring.read',
  'https://www.googleapis.com/auth/bigquery.readonly',
  'https://www.googleapis.com/auth/cloud-platform.read-only',
]
const TIMEOUT_MS = 15_000
const ROME = 'Europe/Rome'
const PACIFIC = 'America/Los_Angeles'

const MONITORING_TTL = 60_000
const BILLING_TTL = 5 * 60_000
const ANTHROPIC_TTL = 15 * 60_000
const KEY_NAMES_TTL = 10 * 60_000
/** Un errore si ricorda per poco: al giro dopo si riprova. */
const ERROR_TTL = 30_000
/**
 * Tempo massimo per i costi (accesso, query e attese): la rotta ha 30 secondi in tutto, e
 * se BigQuery ci mette di piu' va in errore solo il blocco dei costi.
 */
const BILLING_BUDGET_MS = 20_000
/** Attesa chiesta a BigQuery (timeoutMs): ben sotto l'interruzione del sito, cosi' arriva "non ancora finita". */
const BQ_WAIT_MS = 8_000
/** Margine di rete oltre l'attesa chiesta a BigQuery prima di interrompere la richiesta. */
const BQ_NET_MS = 4_000
/** Byte massimi che la query sulla fatturazione puo' leggere (oltre, BigQuery la ferma senza costi). */
export const MAX_BYTES_BILLED = 1_000_000_000

export class UsageError extends Error {
  constructor(message: string, public status = 502) {
    super(message)
  }
}

// ---------------------------------------------------------------------
// Segreti: mai mostrati
// ---------------------------------------------------------------------

/** Toglie da un testo tutto cio' che somiglia a un segreto (token, chiavi, JWT). */
export function scrub(text: string): string {
  return String(text)
    .replace(/-----BEGIN[\s\S]*?(-----END[^-]*-----|$)/g, '[nascosto]')
    .replace(/ya29\.[\w.-]+/g, '[nascosto]')
    .replace(/AIza[\w-]{10,}/g, '[nascosto]')
    .replace(/sk-ant-[\w-]+/g, '[nascosto]')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[nascosto]')
    .replace(/Bearer\s+[\w.~+/=-]+/gi, 'Bearer [nascosto]')
    .slice(0, 300)
}

// ---------------------------------------------------------------------
// Configurazione (ogni fonte e' facoltativa)
// ---------------------------------------------------------------------

export type ServiceAccount = { clientEmail: string; privateKey: string; keyId: string }

/** Service account da GOOGLE_USAGE_SA_JSON (JSON della chiave, anche in base64). null se manca. */
export function readServiceAccount(raw = process.env.GOOGLE_USAGE_SA_JSON): ServiceAccount | null {
  const value = raw?.trim()
  if (!value) return null
  let parsed: Record<string, unknown> | null = null
  try {
    const text = value.startsWith('{') ? value : Buffer.from(value, 'base64').toString('utf8')
    const json = JSON.parse(text)
    parsed = json && typeof json === 'object' && !Array.isArray(json) ? json : null
  } catch {
    parsed = null
  }
  const clientEmail = typeof parsed?.client_email === 'string' ? parsed.client_email.trim() : ''
  // Su Vercel gli a capo della chiave a volte arrivano come "\n" scritti.
  const privateKey = typeof parsed?.private_key === 'string' ? parsed.private_key.replace(/\\n/g, '\n') : ''
  if (!clientEmail || !/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(privateKey)) {
    throw new UsageError('GOOGLE_USAGE_SA_JSON non è valida: incolla tutto il file JSON della chiave del service account.', 500)
  }
  const keyId = typeof parsed?.private_key_id === 'string' && /^[\w-]{1,100}$/.test(parsed.private_key_id) ? parsed.private_key_id : ''
  return { clientEmail, privateKey, keyId }
}

const WIF_PROVIDER = /^projects\/(\d{1,20})\/locations\/global\/workloadIdentityPools\/([a-z0-9-]{4,32})\/providers\/([a-z0-9-]{4,32})$/
const WIF_PREFIX = /^(?:https:)?\/\/iam\.googleapis\.com\//i

/**
 * Provider di Workload Identity Federation (GOOGLE_WIF_PROVIDER): nome della risorsa
 * "projects/NUMERO/locations/global/workloadIdentityPools/POOL/providers/PROVIDER",
 * anche con "//iam.googleapis.com/" o "https://iam.googleapis.com/" davanti. null se manca.
 */
export function wifProvider(raw = process.env.GOOGLE_WIF_PROVIDER): string | null {
  const value = raw?.trim().replace(WIF_PREFIX, '').replace(/\/+$/, '')
  if (!value) return null
  if (WIF_PROVIDER.test(value)) return value
  if (/^projects\/[^/]+\/locations\/global\/workloadIdentityPools\/[a-z0-9-]+\/providers\/[a-z0-9-]+$/.test(value)) {
    throw new UsageError('GOOGLE_WIF_PROVIDER non è valida: dopo "projects/" serve il numero del progetto (solo cifre), non il suo nome.', 500)
  }
  throw new UsageError(
    'GOOGLE_WIF_PROVIDER non è valida: copia il nome del provider, es. projects/123456789/locations/global/workloadIdentityPools/vercel/providers/vercel.',
    500
  )
}

const SA_EMAIL = /^[a-z0-9][a-z0-9._-]{0,99}@[a-z0-9][a-z0-9.-]{0,200}\.gserviceaccount\.com$/i

/** Email del service account da usare senza chiave (GOOGLE_USAGE_SA_EMAIL). null se manca. */
export function serviceAccountEmail(raw = process.env.GOOGLE_USAGE_SA_EMAIL): string | null {
  const value = raw?.trim()
  if (!value) return null
  if (!SA_EMAIL.test(value)) {
    throw new UsageError('GOOGLE_USAGE_SA_EMAIL non è valida: scrivi l’email del service account (…@progetto.iam.gserviceaccount.com).', 500)
  }
  return value.toLowerCase()
}

const has = (name: string) => Boolean(process.env[name]?.trim())

/** Modo di accesso a Google: la chiave JSON vince; senza chiave servono entrambe le variabili. */
export function googleAccessMode(): GoogleAccessMode | null {
  if (has('GOOGLE_USAGE_SA_JSON')) return 'json'
  if (has('GOOGLE_WIF_PROVIDER') && has('GOOGLE_USAGE_SA_EMAIL')) return 'wif'
  return null
}

/** Variabili che mancano per entrare in Google (si indica il modo senza chiave). [] se c'e' un modo. */
function missingAccess(): string[] {
  if (googleAccessMode()) return []
  return ['GOOGLE_WIF_PROVIDER', 'GOOGLE_USAGE_SA_EMAIL'].filter((name) => !has(name))
}

export type GoogleCredentials =
  | { mode: 'json'; sa: ServiceAccount }
  | { mode: 'wif'; provider: string; serviceAccount: string }

/** Credenziali del modo attivo (errore in italiano se una variabile e' scritta male). null se mancano. */
export function readGoogleCredentials(): GoogleCredentials | null {
  const mode = googleAccessMode()
  if (mode === 'json') return { mode, sa: readServiceAccount()! }
  if (mode === 'wif') return { mode, provider: wifProvider()!, serviceAccount: serviceAccountEmail()! }
  return null
}

/** Dati della richiesta in corso che servono per entrare in Google (passati dalla rotta). */
export type GoogleRequest = { vercelToken?: string | null }

/** Token OIDC di Vercel: quello della richiesta (header x-vercel-oidc-token), se no VERCEL_OIDC_TOKEN. */
export function vercelOidcToken(fromRequest?: string | null): string | null {
  return fromRequest?.trim() || process.env.VERCEL_OIDC_TOKEN?.trim() || null
}

const PROJECT_ID = /^(?:[a-z0-9.-]+:)?[a-z][a-z0-9-]{4,28}[a-z0-9]$/

/** Progetti Google da cui leggere le richieste (GOOGLE_USAGE_PROJECTS, separati da virgola). */
export function usageProjects(raw = process.env.GOOGLE_USAGE_PROJECTS): { projects: string[]; invalid: string[] } {
  const all = [...new Set((raw || '').split(/[,\s]+/).map((p) => p.trim()).filter(Boolean))]
  return { projects: all.filter((p) => PROJECT_ID.test(p)).slice(0, 10), invalid: all.filter((p) => !PROJECT_ID.test(p)) }
}

export type BillingTable = { project: string; dataset: string; table: string; full: string }

/** Progetto Google della chiave della beta (per ripartire il costo Places sugli utenti). */
export function betaProjectId(raw = process.env.GOOGLE_BETA_PROJECT): string | null {
  const value = raw?.trim() || ''
  return PROJECT_ID.test(value) ? value : null
}

/**
 * Tabella dell'export standard (GOOGLE_BILLING_EXPORT_TABLE = progetto.dataset.tabella). null se manca.
 * Scritta solo dataset.tabella: il progetto e' GOOGLE_BETA_PROJECT.
 */
export function billingTable(raw = process.env.GOOGLE_BILLING_EXPORT_TABLE, fallbackProject = betaProjectId()): BillingTable | null {
  const value = raw?.trim().replace(/^`|`$/g, '')
  if (!value) return null
  const m = value.match(/^(.+)\.([A-Za-z0-9_]{1,1024})\.([A-Za-z0-9_]{1,1024})$/)
  if (m && PROJECT_ID.test(m[1])) return { project: m[1], dataset: m[2], table: m[3], full: `${m[1]}.${m[2]}.${m[3]}` }
  const short = value.match(/^([A-Za-z0-9_]{1,1024})\.([A-Za-z0-9_]{1,1024})$/)
  if (short && fallbackProject && PROJECT_ID.test(fallbackProject)) {
    return { project: fallbackProject, dataset: short[1], table: short[2], full: `${fallbackProject}.${short[1]}.${short[2]}` }
  }
  throw new UsageError('GOOGLE_BILLING_EXPORT_TABLE non è valida: scrivi progetto.dataset.tabella (es. mio-progetto.fatturazione.gcp_billing_export_v1_…).', 500)
}

/**
 * Progetto in cui BigQuery esegue la query (jobs.query, serve "BigQuery Job User"): il progetto
 * della tabella dell'export, se no GOOGLE_BETA_PROJECT. Mai il project_id della chiave JSON,
 * che senza chiave non c'e'.
 */
export function bigQueryJobProject(table: Pick<BillingTable, 'project'> | null, fallbackProject = betaProjectId()): string | null {
  return table?.project || fallbackProject || null
}

// ---------------------------------------------------------------------
// Accesso a Google: JWT RS256 -> token di accesso (in memoria)
// ---------------------------------------------------------------------

const b64url = (input: string | Buffer) => Buffer.from(input).toString('base64url')

/** JWT firmato con la chiave del service account, da scambiare con un token di accesso. */
export function signServiceAccountJwt(sa: ServiceAccount, scopes = GOOGLE_SCOPES, nowSec = Math.floor(Date.now() / 1000)): string {
  const header = { alg: 'RS256', typ: 'JWT', ...(sa.keyId ? { kid: sa.keyId } : {}) }
  const claims = { iss: sa.clientEmail, scope: scopes.join(' '), aud: TOKEN_URL, iat: nowSec, exp: nowSec + 3600 }
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`
  let signature: Buffer
  try {
    signature = createSign('RSA-SHA256').update(input).sign(sa.privateKey)
  } catch {
    throw new UsageError('La chiave privata in GOOGLE_USAGE_SA_JSON non è valida.', 500)
  }
  return `${input}.${b64url(signature)}`
}

let tokenCache: { id: string; token: string; expiresAt: number } | null = null
let tokenPending: { id: string; promise: Promise<string> } | null = null

/**
 * Token del service account in memoria (uno solo, per chiave JSON o accesso senza chiave):
 * riusato finche' non sta per scadere, e richieste insieme fanno un solo scambio.
 */
async function cachedToken(id: string, load: () => Promise<{ token: string; ttlMs: number }>): Promise<string> {
  if (tokenCache && tokenCache.id === id && Date.now() < tokenCache.expiresAt) return tokenCache.token
  if (tokenPending && tokenPending.id === id) return tokenPending.promise
  const promise = (async () => {
    const { token, ttlMs } = await load()
    const ttl = Math.max(60_000, Math.min(3_600_000, Number.isFinite(ttlMs) ? ttlMs : 3_600_000))
    // Si rinnova prima della scadenza (5 minuti prima, o a meta' se dura poco).
    tokenCache = { id, token, expiresAt: Date.now() + ttl - Math.min(300_000, ttl / 2) }
    return token
  })()
  tokenPending = { id, promise }
  try {
    return await promise
  } finally {
    if (tokenPending?.promise === promise) tokenPending = null
  }
}

/** Token di accesso di Google con la chiave JSON, riusato finche' non sta per scadere. */
export async function googleAccessToken(sa: ServiceAccount): Promise<string> {
  return cachedToken(`${sa.clientEmail}|${sa.keyId}`, async () => {
    const assertion = signServiceAccountJwt(sa)
    const res = await safeFetch(
      TOKEN_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
      },
      'Google (accesso)'
    )
    const data = (await res.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown; error?: unknown } | null
    if (!res.ok || typeof data?.access_token !== 'string' || !data.access_token) {
      const code = typeof data?.error === 'string' && /^[a-z_]{1,40}$/.test(data.error) ? data.error : String(res.status)
      throw new UsageError(`Google ha rifiutato il service account (${code}): controlla GOOGLE_USAGE_SA_JSON.`, 502)
    }
    return { token: data.access_token, ttlMs: (Number(data.expires_in) || 3600) * 1000 }
  })
}

type GoogleErrorBody = {
  error?: string | { code?: unknown; message?: unknown; status?: unknown; details?: { reason?: unknown; metadata?: { service?: unknown } }[] }
  error_description?: unknown
}

/** Codice di errore OAuth di Google (es. invalid_grant), mai la descrizione. */
const oauthCode = (data: GoogleErrorBody | null) => (typeof data?.error === 'string' && /^[a-z_]{1,40}$/.test(data.error) ? data.error : '')

/** Google risponde che un'API non e' attiva nel progetto (SERVICE_DISABLED). */
function apiDisabled(data: GoogleErrorBody | null): boolean {
  const e = data?.error
  if (e && typeof e === 'object') {
    if (Array.isArray(e.details) && e.details.some((d) => d?.reason === 'SERVICE_DISABLED')) return true
    if (typeof e.message === 'string' && /has not been used in project|it is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(e.message)) return true
  }
  return typeof data?.error_description === 'string' && /has not been used in project|it is disabled|SERVICE_DISABLED/i.test(data.error_description)
}

/** Scambia il token OIDC di Vercel con un token federato di Google (Security Token Service). */
async function exchangeVercelToken(provider: string, subjectToken: string): Promise<string> {
  const res = await safeFetch(
    STS_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
        audience: `//iam.googleapis.com/${provider}`,
        scope: CLOUD_PLATFORM_SCOPE,
        requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
        subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
        subject_token: subjectToken,
      }).toString(),
    },
    'Google (scambio del token di Vercel)'
  )
  const data = (await res.json().catch(() => null)) as (GoogleErrorBody & { access_token?: unknown }) | null
  if (res.ok && typeof data?.access_token === 'string' && data.access_token) return data.access_token
  if (apiDisabled(data)) throw new UsageError('Attiva “Security Token Service API” su Google Cloud (progetto del pool), poi riprova.', 502)
  const code = oauthCode(data)
  if (code === 'invalid_target' || res.status === 404) {
    throw new UsageError('Google non trova il pool o il provider: controlla GOOGLE_WIF_PROVIDER.', 502)
  }
  if (code === 'unauthorized_client') {
    throw new UsageError(
      'Google ha rifiutato il token di Vercel per la condizione del provider: vale solo per il progetto Vercel e l’ambiente scritti nella condizione (es. Production).',
      502
    )
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    throw new UsageError(`Google ha rifiutato il token di Vercel${code ? ` (${code})` : ''}: controlla pool, provider, segmento di pubblico e condizione.`, 502)
  }
  if (res.status === 429) throw new UsageError('Google (scambio del token di Vercel): troppe richieste, riprova tra un minuto.', 502)
  throw new UsageError(`Google (scambio del token di Vercel): ${res.ok ? 'risposta senza token' : `errore ${res.status}`}, riprova tra poco.`, 502)
}

/** Token del service account (generateAccessToken) con il token federato. */
async function impersonate(serviceAccount: string, federatedToken: string): Promise<{ token: string; ttlMs: number }> {
  const res = await safeFetch(
    `${IAM_CREDENTIALS_URL}/${serviceAccount}:generateAccessToken`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${federatedToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ scope: GOOGLE_SCOPES, lifetime: '3600s' }),
    },
    'Google (token del service account)'
  )
  const data = (await res.json().catch(() => null)) as (GoogleErrorBody & { accessToken?: unknown; expireTime?: unknown }) | null
  if (res.ok && typeof data?.accessToken === 'string' && data.accessToken) {
    const expires = typeof data.expireTime === 'string' ? Date.parse(data.expireTime) : NaN
    return { token: data.accessToken, ttlMs: Number.isFinite(expires) ? expires - Date.now() : 3_600_000 }
  }
  if (apiDisabled(data)) throw new UsageError('Attiva “IAM Service Account Credentials API” su Google Cloud (progetto del service account), poi riprova.', 502)
  if (res.status === 403) throw new UsageError('Il service account non ha “Workload Identity User” per questo pool: concedi l’accesso dal pool al service account.', 502)
  if (res.status === 404) throw new UsageError('Google non trova il service account: controlla GOOGLE_USAGE_SA_EMAIL.', 502)
  if (res.status === 400) throw new UsageError('Google ha rifiutato la richiesta del token del service account: controlla GOOGLE_USAGE_SA_EMAIL.', 502)
  if (res.status === 401) throw new UsageError('Google ha rifiutato il token federato: riprova tra poco.', 502)
  if (res.status === 429) throw new UsageError('Google (token del service account): troppe richieste, riprova tra un minuto.', 502)
  throw new UsageError(`Google (token del service account): ${res.ok ? 'risposta senza token' : `errore ${res.status}`}, riprova tra poco.`, 502)
}

/**
 * Token del service account senza chiave: token OIDC di Vercel -> token federato (STS) ->
 * token del service account (generateAccessToken). Riusato finche' non sta per scadere:
 * il token di Vercel serve solo quando bisogna rifare lo scambio.
 */
export async function federatedAccessToken(provider: string, serviceAccount: string, vercelToken?: string | null): Promise<string> {
  return cachedToken(`wif|${provider}|${serviceAccount}`, async () => {
    const subject = vercelOidcToken(vercelToken)
    if (!subject) throw new UsageError(MISSING_VERCEL_TOKEN, 500)
    return impersonate(serviceAccount, await exchangeVercelToken(provider, subject))
  })
}

/** Token di accesso per il modo attivo (chiave JSON o senza chiave). */
export function accessTokenFor(creds: GoogleCredentials, google: GoogleRequest = {}): Promise<string> {
  return creds.mode === 'json' ? googleAccessToken(creds.sa) : federatedAccessToken(creds.provider, creds.serviceAccount, google.vercelToken)
}

async function safeFetch(url: string, init: RequestInit, source: string, timeoutMs = TIMEOUT_MS): Promise<Response> {
  try {
    return await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    const seconds = Math.max(1, Math.round(timeoutMs / 1000))
    throw new UsageError(timeout ? `${source}: nessuna risposta in ${seconds} secondi, riprova tra poco.` : `${source}: non raggiungibile, riprova tra poco.`, 504)
  }
}

function googleErrorText(source: string, status: number, data: unknown): string {
  const raw = (data as { error?: { message?: unknown } } | null)?.error?.message
  const detail = typeof raw === 'string' && raw.trim() ? ` (${scrub(raw.trim()).slice(0, 220)})` : ''
  if (status === 401) {
    return `${source}: accesso rifiutato, controlla ${googleAccessMode() === 'wif' ? 'GOOGLE_WIF_PROVIDER e GOOGLE_USAGE_SA_EMAIL' : 'GOOGLE_USAGE_SA_JSON'}.`
  }
  if (status === 403) return `${source}: manca un permesso al service account${detail}.`
  if (status === 404) return `${source}: non trovato${detail}.`
  if (status === 429) return `${source}: troppe richieste a Google, riprova tra un minuto.`
  return `${source}: errore ${status}${detail}.`
}

async function googleJson(url: string, token: string, source: string, body?: unknown, timeoutMs = TIMEOUT_MS): Promise<any> {
  const res = await safeFetch(
    url,
    {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    source,
    timeoutMs
  )
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new UsageError(googleErrorText(source, res.status, data), res.status)
  return data
}

// ---------------------------------------------------------------------
// Memoria breve (per istanza del server) e risposte di ogni fonte
// ---------------------------------------------------------------------

const memory = new Map<string, { until: number; value: unknown }>()
const inflight = new Map<string, Promise<unknown>>()

async function remember<T>(key: string, ttl: number, load: () => Promise<T>, ttlFor?: (value: T) => number): Promise<T> {
  const hit = memory.get(key)
  if (hit && Date.now() < hit.until) return hit.value as T
  const running = inflight.get(key)
  if (running) return running as Promise<T>
  const promise = load()
    .then((value) => {
      memory.set(key, { until: Date.now() + (ttlFor ? ttlFor(value) : ttl), value })
      return value
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, promise)
  return promise
}

/** Solo per le prove: svuota memoria e token. */
export function resetUsageMemory() {
  memory.clear()
  inflight.clear()
  tokenCache = null
  tokenPending = null
  unpartitioned = false
}

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof UsageError ? scrub(error.message) : fallback

/** Esegue una fonte: mai eccezioni, al massimo { status: 'errore' } con un messaggio pulito. */
async function sourceOf<T>(key: string, ttl: number, delay: string, load: () => Promise<T>): Promise<Source<T>> {
  return remember<Source<T>>(
    key,
    ttl,
    async () => {
      try {
        return { status: 'ok', data: await load(), fetchedAt: new Date().toISOString(), delay }
      } catch (error) {
        const message = errorMessage(error, 'Errore inatteso: riprova tra poco.')
        console.error(`consumi (${key.split(':')[0]}):`, message)
        return { status: 'errore', message, fetchedAt: new Date().toISOString(), delay }
      }
    },
    (value) => (value.status === 'ok' ? ttl : ERROR_TTL)
  )
}

// ---------------------------------------------------------------------
// Ore e giorni in ora italiana
// ---------------------------------------------------------------------

type Parts = { y: number; m: number; d: number; h: number; mi: number; s: number }
const PART_FORMATS = new Map<string, Intl.DateTimeFormat>()

function partsIn(instant: number, tz: string): Parts {
  let f = PART_FORMATS.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    })
    PART_FORMATS.set(tz, f)
  }
  const out: Record<string, number> = {}
  for (const p of f.formatToParts(new Date(instant))) if (p.type !== 'literal') out[p.type] = Number(p.value)
  return { y: out.year, m: out.month, d: out.day, h: out.hour % 24, mi: out.minute, s: out.second }
}

const offsetIn = (instant: number, tz: string) => {
  const p = partsIn(instant, tz)
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(instant / 1000) * 1000
}

/** Inizio del giorno o del mese (mezzanotte locale) nel fuso tz. */
export function zonedStart(now: number, tz: string, unit: 'day' | 'month'): number {
  const p = partsIn(now, tz)
  const wall = Date.UTC(p.y, p.m - 1, unit === 'month' ? 1 : p.d)
  let t = wall - offsetIn(wall, tz)
  t = wall - offsetIn(t, tz)
  return t
}

const pad = (v: number) => String(v).padStart(2, '0')
const hhmm = (instant: number) => {
  const p = partsIn(instant, ROME)
  return `${pad(p.h)}:${pad(p.mi)}`
}
const dayLabel = (instant: number) => {
  const p = partsIn(instant, ROME)
  return `${p.d}/${p.m}`
}

/** Mese di fatturazione di Google (AAAAMM, ora del Pacifico come la console). */
export function invoiceMonth(now: number): string {
  const p = partsIn(now, PACIFIC)
  return `${p.y}${pad(p.m)}`
}

const iso = (t: number) => new Date(t).toISOString()
/** Formato TIMESTAMP canonico di BigQuery: "2026-11-07 00:00:00+00:00". */
export const bqTimestamp = (t: number) => iso(t).replace('T', ' ').replace(/\.\d{3}Z$/, '+00:00')

// ---------------------------------------------------------------------
// Cloud Monitoring: richieste per API e per credenziale
// ---------------------------------------------------------------------

const REQUEST_FILTER = 'metric.type="serviceruntime.googleapis.com/api/request_count" AND resource.type="consumed_api"'
const GROUP_BY = ['resource.label.service', 'resource.label.credential_id', 'resource.label.method', 'metric.label.response_code_class']

/** Ricerche Places Text Search (metodo SearchText): le sole che la beta registra per utente. */
const isSearchText = (s: RawSeries) =>
  s.resource?.labels?.service === PLACES_SERVICE && /(^|\.)SearchText$/.test(s.resource?.labels?.method || '')

type RawSeries = {
  metric?: { labels?: Record<string, string> }
  resource?: { labels?: Record<string, string> }
  points?: { interval?: { endTime?: string }; value?: { int64Value?: string | number; doubleValue?: number } }[]
}

/** Finestre di oggi: ultimi 60 minuti chiusi, ore intere da mezzanotte, giorni interi dal primo del mese. */
export function monitoringWindows(now: number) {
  const minuteEnd = Math.floor(now / 60_000) * 60_000
  const todayStart = zonedStart(now, ROME, 'day')
  const monthStart = zonedStart(now, ROME, 'month')
  const hourEnd = Math.max(todayStart, Math.floor(now / 3_600_000) * 3_600_000)
  return {
    minuteEnd,
    minuteStart: minuteEnd - 3_600_000,
    todayStart,
    hourEnd,
    hours: Math.max(0, Math.round((hourEnd - todayStart) / 3_600_000)),
    monthStart,
    days: Math.max(0, Math.round((todayStart - monthStart) / 86_400_000)),
  }
}

async function listSeries(token: string, project: string, start: number, end: number, periodSec: number): Promise<RawSeries[]> {
  const out: RawSeries[] = []
  let pageToken = ''
  for (let page = 0; page < 5; page++) {
    const q = new URLSearchParams({
      filter: REQUEST_FILTER,
      'interval.startTime': iso(start),
      'interval.endTime': iso(end),
      'aggregation.alignmentPeriod': `${periodSec}s`,
      'aggregation.perSeriesAligner': 'ALIGN_DELTA',
      'aggregation.crossSeriesReducer': 'REDUCE_SUM',
      view: 'FULL',
    })
    for (const field of GROUP_BY) q.append('aggregation.groupByFields', field)
    if (pageToken) q.set('pageToken', pageToken)
    const data = await googleJson(
      `https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(project)}/timeSeries?${q}`,
      token,
      `Google Monitoring (${project})`
    )
    if (Array.isArray(data?.timeSeries)) out.push(...data.timeSeries)
    pageToken = typeof data?.nextPageToken === 'string' ? data.nextPageToken : ''
    if (!pageToken) break
  }
  return out
}

/** Nomi delle chiavi API del progetto (solo nome e id, mai la chiave). null senza permesso. */
async function keyNames(token: string, project: string): Promise<Map<string, string> | null> {
  return remember(`keys:${project}`, KEY_NAMES_TTL, async () => {
    try {
      const names = new Map<string, string>()
      let pageToken = ''
      for (let page = 0; page < 5; page++) {
        const q = new URLSearchParams({ pageSize: '300' })
        if (pageToken) q.set('pageToken', pageToken)
        const data = await googleJson(
          `https://apikeys.googleapis.com/v2/projects/${encodeURIComponent(project)}/locations/global/keys?${q}`,
          token,
          'Google API Keys'
        )
        for (const key of Array.isArray(data?.keys) ? data.keys : []) {
          const name = typeof key?.displayName === 'string' ? key.displayName.trim().slice(0, 80) : ''
          if (!name) continue
          if (typeof key.uid === 'string') names.set(key.uid, name)
          if (typeof key.name === 'string') names.set(key.name.split('/').pop() || '', name)
        }
        pageToken = typeof data?.nextPageToken === 'string' ? data.nextPageToken : ''
        if (!pageToken) break
      }
      return names
    } catch {
      return null
    }
  })
}

const looksLikeKey = (v: string) => /AIza[\w-]{10,}/.test(v)
const shortId = (v: string) => (v.length > 16 ? `${v.slice(0, 8)}…${v.slice(-4)}` : v)

/** Id della credenziale da mostrare: una chiave API vera non esce mai intera. */
export function safeCredentialId(id: string): string {
  return looksLikeKey(id) ? `chiave …${id.slice(-4)}` : id.slice(0, 120)
}

/** Nome leggibile della credenziale: nome della chiave se Google lo da', altrimenti l'id. */
export function credentialLabel(id: string, names: Map<string, string> | null): string {
  if (!id) return 'Senza credenziale'
  if (looksLikeKey(id)) return `Chiave …${id.slice(-4)}`
  const i = id.indexOf(':')
  const kind = i > 0 ? id.slice(0, i) : ''
  const value = i > 0 ? id.slice(i + 1) : id
  if (kind === 'apikey') {
    const name = names?.get(value)
    return name ? `Chiave “${name}”` : `Chiave ${shortId(value)}`
  }
  if (kind === 'serviceaccount') return `Service account ${shortId(value)}`
  if (kind === 'oauth2' || kind === 'oauth') return `Accesso OAuth ${shortId(value)}`
  return shortId(id)
}

const pointValue = (p: NonNullable<RawSeries['points']>[number]) => {
  const v = Number(p?.value?.int64Value ?? p?.value?.doubleValue ?? 0)
  return Number.isFinite(v) && v > 0 ? v : 0
}

type Acc = { minutes: Counts[]; hours: Counts[]; days: Counts[] }
const emptyCounts = (k: number): Counts[] => Array.from({ length: k }, () => ({ ok: 0, error: 0 }))

/** Mette i punti di Google negli intervalli giusti (dal piu' vecchio al piu' recente). */
function addPoints(target: Counts[], series: RawSeries, windowEnd: number, periodMs: number) {
  const ok = (series.metric?.labels?.response_code_class || '').startsWith('2')
  for (const p of series.points || []) {
    const end = Date.parse(p?.interval?.endTime || '')
    if (!Number.isFinite(end)) continue
    const idx = target.length - 1 - Math.round((windowEnd - end) / periodMs)
    if (idx < 0 || idx >= target.length) continue
    const v = pointValue(p)
    if (ok) target[idx].ok += v
    else target[idx].error += v
  }
}

const total = (list: Counts[]): Counts => list.reduce((a, c) => ({ ok: a.ok + c.ok, error: a.error + c.error }), { ok: 0, error: 0 })

/** Minuti, ore di oggi e giorni del mese di una credenziale, con i totali (l'ultima ora e oggi sono in corso). */
function summarize(a: Acc, w: ReturnType<typeof monitoringWindows>) {
  const minutes: TrafficPoint[] = a.minutes.map((c, i) => {
    const start = w.minuteEnd - (60 - i) * 60_000
    return { t: iso(start), label: hhmm(start), ...c }
  })
  // L'ora in corso: i minuti gia' contati dopo l'ultima ora intera.
  const current = total(a.minutes.filter((_, i) => w.minuteEnd - (59 - i) * 60_000 > w.hourEnd))
  const hours: TrafficPoint[] = [
    ...a.hours.map((c, i) => {
      const start = w.hourEnd - (w.hours - i) * 3_600_000
      return { t: iso(start), label: `${hhmm(start).slice(0, 2)}:00`, ...c }
    }),
    { t: iso(w.hourEnd), label: `${hhmm(w.hourEnd).slice(0, 2)}:00`, ...current },
  ]
  const today = total(hours)
  const days: TrafficPoint[] = [
    ...a.days.map((c, i) => {
      const start = w.todayStart - (w.days - i) * 86_400_000
      return { t: iso(start), label: dayLabel(start + 43_200_000), ...c }
    }),
    { t: iso(w.todayStart), label: dayLabel(w.todayStart + 43_200_000), ...today },
  ]
  return { minutes, hours, days, lastHour: total(a.minutes), today, month: total(days) }
}

/** Tre letture per progetto: ultimi 60 minuti al minuto, oggi all'ora, questo mese al giorno. */
export async function readMonitoring(token: string, projects: string[], now: number): Promise<MonitoringData> {
  const w = monitoringWindows(now)
  const warnings: string[] = []
  let namesOk = true
  const series: TrafficSeries[] = []
  const results = await Promise.allSettled(
    projects.map(async (project) => {
      const [minutes, hours, days, names] = await Promise.all([
        listSeries(token, project, w.minuteStart, w.minuteEnd, 60),
        w.hours > 0 ? listSeries(token, project, w.todayStart, w.hourEnd, 3600) : Promise.resolve([] as RawSeries[]),
        w.days > 0 ? listSeries(token, project, w.monthStart, w.todayStart, 86_400) : Promise.resolve([] as RawSeries[]),
        keyNames(token, project),
      ])
      return { project, minutes, hours, days, names }
    })
  )
  let failed = 0
  for (const r of results) {
    if (r.status === 'rejected') {
      failed++
      warnings.push(errorMessage(r.reason, 'Google Monitoring: errore inatteso.'))
      continue
    }
    const { project, names } = r.value
    if (!names) namesOk = false
    const acc = new Map<string, Acc>()
    // Stessa somma, solo per le ricerche Text Search di Places (per la ripartizione del costo).
    const text = new Map<string, Acc>()
    const get = (map: Map<string, Acc>, s: RawSeries) => {
      const service = s.resource?.labels?.service || 'sconosciuta'
      const cred = s.resource?.labels?.credential_id || ''
      const key = `${service}\u0000${cred}`
      let a = map.get(key)
      if (!a) {
        a = { minutes: emptyCounts(60), hours: emptyCounts(w.hours), days: emptyCounts(w.days) }
        map.set(key, a)
      }
      return a
    }
    const add = (s: RawSeries, pick: (a: Acc) => Counts[], end: number, periodMs: number) => {
      addPoints(pick(get(acc, s)), s, end, periodMs)
      if (isSearchText(s)) addPoints(pick(get(text, s)), s, end, periodMs)
    }
    for (const s of r.value.minutes) add(s, (a) => a.minutes, w.minuteEnd, 60_000)
    for (const s of r.value.hours) add(s, (a) => a.hours, w.hourEnd, 3_600_000)
    for (const s of r.value.days) add(s, (a) => a.days, w.todayStart, 86_400_000)

    for (const [key, a] of acc) {
      const [service, cred] = key.split('\u0000')
      const t = text.get(key)
      series.push({
        project,
        service,
        serviceLabel: serviceLabel(service),
        credentialId: safeCredentialId(cred),
        credentialLabel: credentialLabel(cred, names),
        ...summarize(a, w),
        ...(service === PLACES_SERVICE ? { textSearchMonth: t ? summarize(t, w).month : { ok: 0, error: 0 } } : {}),
      })
    }
  }
  if (projects.length && failed === projects.length) throw new UsageError(warnings[0] || 'Google Monitoring: nessun progetto letto.')
  if (!namesOk) warnings.push('Nomi delle chiavi non disponibili: dai al service account il ruolo “API Keys Viewer” per vederli.')
  series.sort((a, b) => b.month.ok + b.month.error - (a.month.ok + a.month.error))
  return { projects, series, keyNames: namesOk, warnings, windowEnd: iso(w.minuteEnd), monthStart: iso(w.monthStart) }
}

/**
 * Richieste reali per API e chiave (cache 60 secondi). google: dati della richiesta in corso
 * (token OIDC di Vercel per l'accesso senza chiave), passati dalla rotta.
 */
export async function getMonitoring(now = Date.now(), google: GoogleRequest = {}): Promise<Source<MonitoringData>> {
  const missing = [...missingAccess(), ...['GOOGLE_USAGE_PROJECTS'].filter((name) => !has(name))]
  if (missing.length) return { status: 'da_collegare', missing, delay: DELAY.monitoring }
  const { projects, invalid } = usageProjects()
  if (!projects.length) {
    return { status: 'errore', message: 'GOOGLE_USAGE_PROJECTS non contiene id di progetto validi.', fetchedAt: iso(now), delay: DELAY.monitoring }
  }
  return sourceOf(`monitoring:${projects.join(',')}`, MONITORING_TTL, DELAY.monitoring, async () => {
    const data = await readMonitoring(await accessTokenFor(readGoogleCredentials()!, google), projects, now)
    if (invalid.length) data.warnings.push(`Progetti ignorati (id non validi): ${invalid.map((p) => p.slice(0, 40)).join(', ')}.`)
    return data
  })
}

// ---------------------------------------------------------------------
// Export della fatturazione in BigQuery: costi reali
// ---------------------------------------------------------------------

let unpartitioned = false

/**
 * Query di sola lettura sull'export standard, per progetto e SKU: mese di fatturazione
 * (come la console), oggi e mese italiano (uso dal 1° a mezzanotte, ora italiana: lo stesso
 * periodo delle richieste contate, per ripartire il costo). Le prime ore italiane del 1°
 * Google le fattura ancora nel mese prima: per questo si leggono anche quelle righe.
 */
export function billingQuery(table: BillingTable, partitioned: boolean): string {
  const credits = 'IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) AS c), 0)'
  const usage = 'IFNULL(usage.amount_in_pricing_units, 0)'
  const inMonth = 'invoice.month = @invoice_month'
  const inRome = 'usage_start_time >= @rome_month_start'
  const inToday = 'usage_start_time >= @today_start'
  const dateFilter = partitioned ? '_PARTITIONTIME >= @partition_start' : 'usage_start_time >= @partition_start'
  return `SELECT
  IFNULL(project.id, '') AS project_id,
  IFNULL(service.description, '') AS service_name,
  IFNULL(sku.description, '') AS sku_name,
  currency,
  IFNULL(usage.pricing_unit, '') AS unit,
  SUM(IF(${inMonth}, cost, 0)) AS gross_month,
  SUM(IF(${inMonth}, ${credits}, 0)) AS credits_month,
  SUM(IF(${inMonth}, ${usage}, 0)) AS usage_month,
  SUM(IF(${inToday}, cost, 0)) AS gross_today,
  SUM(IF(${inToday}, ${credits}, 0)) AS credits_today,
  SUM(IF(${inToday}, ${usage}, 0)) AS usage_today,
  FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', MAX(export_time)) AS last_export,
  SUM(IF(${inRome}, cost, 0)) AS gross_rome_month,
  SUM(IF(${inRome}, ${credits}, 0)) AS credits_rome_month,
  SUM(IF(${inRome}, ${usage}, 0)) AS usage_rome_month
FROM \`${table.project}.${table.dataset}.${table.table}\`
WHERE ${dateFilter}
  AND (${inMonth} OR ${inRome})
GROUP BY project_id, service_name, sku_name, currency, unit
ORDER BY gross_month DESC
LIMIT 500`
}

type Row = Record<string, string | null>

/**
 * Esegue la query entro deadline (istante in ms). BigQuery aspetta al massimo BQ_WAIT_MS e poi
 * risponde "non ancora finita"; il sito interrompe solo dopo BQ_NET_MS in piu', quindi le attese
 * successive partono davvero. Finito il tempo: errore solo per il blocco dei costi.
 */
async function runQuery(
  token: string,
  project: string,
  query: string,
  params: { name: string; type: string; value: string }[],
  deadline: number
): Promise<Row[]> {
  const base = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(project)}/queries`
  const tooSlow = () => new UsageError('BigQuery: la lettura dei costi ci mette troppo, riprova tra poco.', 504)
  const wait = () => Math.min(BQ_WAIT_MS, deadline - Date.now() - BQ_NET_MS)
  let w = wait()
  if (w < 1000) throw tooSlow()
  let data = await googleJson(
    base,
    token,
    'BigQuery',
    {
      query,
      useLegacySql: false,
      parameterMode: 'NAMED',
      queryParameters: params.map((p) => ({ name: p.name, parameterType: { type: p.type }, parameterValue: { value: p.value } })),
      timeoutMs: w,
      maxResults: 1000,
      useQueryCache: true,
      maximumBytesBilled: String(MAX_BYTES_BILLED),
    },
    w + BQ_NET_MS
  )
  for (let i = 0; i < 3 && data?.jobComplete === false; i++) {
    const jobId = data?.jobReference?.jobId
    const location = data?.jobReference?.location
    if (typeof jobId !== 'string' || !/^[\w-]{1,1024}$/.test(jobId)) break
    w = wait()
    if (w < 1000) break
    const q = new URLSearchParams({ timeoutMs: String(w), maxResults: '1000' })
    if (typeof location === 'string' && /^[\w-]{1,40}$/.test(location)) q.set('location', location)
    data = await googleJson(`${base}/${jobId}?${q}`, token, 'BigQuery', undefined, w + BQ_NET_MS)
  }
  if (data?.jobComplete === false) throw tooSlow()
  const fields: string[] = Array.isArray(data?.schema?.fields) ? data.schema.fields.map((f: { name?: unknown }) => String(f?.name || '')) : []
  return (Array.isArray(data?.rows) ? data.rows : []).map((r: { f?: { v?: unknown }[] }) =>
    Object.fromEntries(fields.map((name, i) => {
      const v = r?.f?.[i]?.v
      return [name, v === null || v === undefined ? null : String(v)]
    }))
  )
}

const num = (v: string | null | undefined) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}
const money = (gross: number, credits: number): Money => ({ gross, credits, net: gross + credits })
const addMoney = (a: Money, b: Money): Money => money(a.gross + b.gross, a.credits + b.credits)
const zero = (): Money => money(0, 0)

/** Righe di BigQuery -> costi per SKU, per progetto e servizio, totali per valuta. */
export function parseBillingRows(rows: Row[], table: string, month: string, romeMonthStart: string): BillingData {
  let lastExport: string | null = null
  const lines: BillingLine[] = rows.map((r) => {
    const exported = r.last_export && !Number.isNaN(Date.parse(r.last_export)) ? new Date(r.last_export).toISOString() : null
    if (exported && (!lastExport || exported > lastExport)) lastExport = exported
    const currency = (r.currency || '').trim().toUpperCase()
    return {
      project: (r.project_id || '').slice(0, 80),
      service: (r.service_name || 'Servizio senza nome').slice(0, 120),
      sku: (r.sku_name || 'Voce senza nome').slice(0, 160),
      currency: /^[A-Z]{3}$/.test(currency) ? currency : 'EUR',
      unit: (r.unit || '').slice(0, 40),
      month: { ...money(num(r.gross_month), num(r.credits_month)), usage: num(r.usage_month) },
      today: { ...money(num(r.gross_today), num(r.credits_today)), usage: num(r.usage_today) },
      romeMonth: { ...money(num(r.gross_rome_month), num(r.credits_rome_month)), usage: num(r.usage_rome_month) },
    }
  })
  const used = (m: MoneyUsage) => m.gross !== 0 || m.credits !== 0 || m.usage !== 0
  const groups = new Map<string, BillingGroup>()
  const totals = new Map<string, { currency: string; month: Money; today: Money }>()
  for (const l of lines) {
    const key = `${l.project}\u0000${l.service}\u0000${l.currency}`
    const g = groups.get(key) || { project: l.project, service: l.service, currency: l.currency, month: zero(), today: zero() }
    g.month = addMoney(g.month, l.month)
    g.today = addMoney(g.today, l.today)
    groups.set(key, g)
    const t = totals.get(l.currency) || { currency: l.currency, month: zero(), today: zero() }
    t.month = addMoney(t.month, l.month)
    t.today = addMoney(t.today, l.today)
    totals.set(l.currency, t)
  }
  return {
    table,
    invoiceMonth: month,
    romeMonthStart,
    lastExport,
    lines: lines.filter((l) => used(l.month) || used(l.today) || used(l.romeMonth)),
    groups: [...groups.values()].sort((a, b) => b.month.net - a.month.net),
    totals: [...totals.values()].sort((a, b) => b.month.net - a.month.net),
  }
}

/** Costi reali del mese di fatturazione e di oggi (cache 5 minuti). google: come getMonitoring. */
export async function getBilling(now = Date.now(), google: GoogleRequest = {}): Promise<Source<BillingData>> {
  const missing = [...missingAccess(), ...['GOOGLE_BILLING_EXPORT_TABLE'].filter((name) => !has(name))]
  if (missing.length) return { status: 'da_collegare', missing, delay: DELAY.billing }
  let table: BillingTable
  let jobProject: string
  try {
    table = billingTable()!
    jobProject = bigQueryJobProject(table)!
  } catch (error) {
    return { status: 'errore', message: errorMessage(error, 'GOOGLE_BILLING_EXPORT_TABLE non è valida.'), fetchedAt: iso(now), delay: DELAY.billing }
  }
  return sourceOf(`billing:${table.full}`, BILLING_TTL, DELAY.billing, async () => {
    const deadline = Date.now() + BILLING_BUDGET_MS
    const token = await accessTokenFor(readGoogleCredentials()!, google)
    const month = invoiceMonth(now)
    const romeMonthStart = zonedStart(now, ROME, 'month')
    // Primo giorno del mese di fatturazione (Pacifico) o del mese italiano, il piu' vecchio,
    // con un giorno di margine per i fusi.
    const partitionStart = Math.min(zonedStart(now, PACIFIC, 'month'), romeMonthStart) - 86_400_000
    const params = [
      { name: 'invoice_month', type: 'STRING', value: month },
      { name: 'today_start', type: 'TIMESTAMP', value: bqTimestamp(zonedStart(now, ROME, 'day')) },
      { name: 'partition_start', type: 'TIMESTAMP', value: bqTimestamp(partitionStart) },
      { name: 'rome_month_start', type: 'TIMESTAMP', value: bqTimestamp(romeMonthStart) },
    ]
    let rows: Row[]
    try {
      rows = await runQuery(token, jobProject, billingQuery(table, !unpartitioned), params, deadline)
    } catch (error) {
      // Export vecchio senza partizioni: si filtra per data di utilizzo.
      if (!unpartitioned && error instanceof UsageError && /_PARTITIONTIME/i.test(error.message)) {
        unpartitioned = true
        rows = await runQuery(token, jobProject, billingQuery(table, false), params, deadline)
      } else if (error instanceof UsageError && /bytes billed/i.test(error.message)) {
        throw new UsageError(
          `BigQuery: la lettura dei costi supererebbe ${MAX_BYTES_BILLED / 1e9} GB ed è stata fermata (nessun costo). Controlla che GOOGLE_BILLING_EXPORT_TABLE sia l’export standard.`,
          400
        )
      } else throw error
    }
    return parseBillingRows(rows, table.full, month, iso(romeMonthStart))
  })
}

// ---------------------------------------------------------------------
// Anthropic: costi reali di Claude (Usage & Cost Admin API)
// ---------------------------------------------------------------------

type CostBucket = { starting_at?: string; results?: { amount?: string; currency?: string; description?: string | null }[] }

/** Somma i giorni del cost_report: gli importi sono centesimi di dollaro in stringa. */
export function parseAnthropicBuckets(buckets: CostBucket[], monthStart: number, todayStart: number): AnthropicData {
  let month = 0
  let today = 0
  const lines = new Map<string, number>()
  for (const b of buckets) {
    const start = Date.parse(b?.starting_at || '')
    if (!Number.isFinite(start) || start < monthStart) continue
    for (const r of Array.isArray(b.results) ? b.results : []) {
      if (r?.currency && r.currency !== 'USD') continue
      const cents = Number(r?.amount)
      if (!Number.isFinite(cents)) continue
      const usd = cents / 100
      month += usd
      if (start >= todayStart) today += usd
      const label = (typeof r.description === 'string' && r.description.trim()) || 'Altro'
      lines.set(label.slice(0, 120), (lines.get(label.slice(0, 120)) || 0) + usd)
    }
  }
  return {
    currency: 'USD',
    monthStart: iso(monthStart),
    month,
    today,
    byLine: [...lines.entries()]
      .map(([description, amount]) => ({ description, amount }))
      .filter((l) => l.amount !== 0)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 12),
  }
}

/** Costo di Claude dal primo del mese (UTC, come Anthropic) a oggi (cache 15 minuti). */
export async function getAnthropicCost(now = Date.now()): Promise<Source<AnthropicData>> {
  if (!has('ANTHROPIC_ADMIN_API_KEY')) return { status: 'da_collegare', missing: ['ANTHROPIC_ADMIN_API_KEY'], delay: DELAY.anthropic }
  return sourceOf('anthropic:cost', ANTHROPIC_TTL, DELAY.anthropic, async () => {
    const key = process.env.ANTHROPIC_ADMIN_API_KEY!.trim()
    const d = new Date(now)
    const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
    const todayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
    const buckets: CostBucket[] = []
    let page = ''
    for (let i = 0; i < 3; i++) {
      const q = new URLSearchParams({
        starting_at: iso(monthStart),
        ending_at: iso(todayStart + 86_400_000),
        bucket_width: '1d',
        limit: '31',
      })
      q.append('group_by[]', 'description')
      if (page) q.set('page', page)
      const res = await safeFetch(
        `https://api.anthropic.com/v1/organizations/cost_report?${q}`,
        { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', Accept: 'application/json' } },
        'Anthropic'
      )
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          throw new UsageError('Anthropic ha rifiutato ANTHROPIC_ADMIN_API_KEY: serve una chiave Admin dell’organizzazione (sk-ant-admin…).', 502)
        }
        const raw = data?.error?.message
        throw new UsageError(`Anthropic: errore ${res.status}${typeof raw === 'string' && raw.trim() ? ` (${scrub(raw).slice(0, 200)})` : ''}.`, 502)
      }
      if (Array.isArray(data?.data)) buckets.push(...data.data)
      if (!data?.has_more || typeof data?.next_page !== 'string' || !data.next_page) break
      page = data.next_page
    }
    return parseAnthropicBuckets(buckets, monthStart, todayStart)
  })
}
