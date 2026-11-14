import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'crypto'
import { isIPv6 } from 'net'
import type { User } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { readSetting, updateSetting } from '@/lib/settings-store'
import { newSlotId, releaseSlot, reserveSlot } from '@/lib/limiter'

// Password per i collaboratori: il titolare di un account (entrato con Google o con la
// sua email e password) puo' attivare una password IN PIU', da dare ad altre persone
// insieme alla sua email. Non e' la password dell'account Supabase: qui se ne salva
// solo l'impronta (scrypt) e chi entra con lei riceve un accesso firmato da noi, che
// vale solo per le API dell'area clienti. Cosi' il titolare non perde mai le sue
// sessioni, e chi ha la password non ha poteri sull'account Supabase (email, password,
// verifica in due passaggi). Cambiarla o spegnerla fa uscire subito tutti quelli
// entrati con la password di prima: ogni accesso porta la «versione» e la si confronta
// a ogni richiesta.

const ACCESS_KEY = (userId: string) => `password_access:${userId}`
const EMAIL_KEY = (email: string) => `shared_login:${sha256(normEmail(email))}`
const FAILS_EMAIL_KEY = (email: string) => `shared_login_fails:${sha256(normEmail(email))}`
const FAILS_EMAIL_IP_KEY = (email: string, ipHash: string) => `shared_login_fails:${sha256(`${normEmail(email)}|${ipHash}`)}`
const FAILS_IP_KEY = (ipHash: string) => `shared_login_ip:${ipHash}`
/** Utente che non esiste: si legge comunque, cosi' i tempi non dicono chi ha la password dei collaboratori. */
const NOBODY = '00000000-0000-0000-0000-000000000000'

export const TOKEN_PREFIX = 'fvs1.'
/** Accesso dei collaboratori: dura 30 giorni, ma smette subito di valere se la password cambia o si spegne. */
export const SHARED_TOKEN_TTL_S = 30 * 24 * 3600
export const PASSWORD_MIN = 8
/** Limite dell'algoritmo delle password (come Supabase). */
export const PASSWORD_MAX = 72

const FAIL_WINDOW_MS = 15 * 60_000
/** Per email e dispositivo/rete: chi sbaglia non blocca i collaboratori che entrano da altrove. */
const MAX_FAILS_EMAIL_IP = 8
/** Per email in tutto: tetto largo contro i tentativi distribuiti. */
const MAX_FAILS_EMAIL = 60
const MAX_FAILS_IP = 30
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type SharedAccess = {
  enabled: boolean
  /** Sale a ogni cambio e spegnimento: gli accessi con la versione di prima non valgono piu'. */
  version: number
  /** Impronta scrypt della password; null se spenta. */
  hash: string | null
  /** Email da dare ai collaboratori (quella dell'account quando si e' attivata). */
  email: string | null
  changedAt: string | null
}

export type SharedRevoked = 'changed' | 'disabled' | 'expired'

export const normEmail = (email: string) => email.trim().toLowerCase()
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

// ---------------------------------------------------------------------
// Impronta della password (scrypt con sale, confronto a tempo costante)
// ---------------------------------------------------------------------

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 }

function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCallback(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key))))
}

export async function hashSharedPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 })
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`
}

export async function verifySharedPassword(password: string, stored: string | null): Promise<boolean> {
  const parts = (stored || '').split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    // Nessuna password: si fa comunque il calcolo, cosi' i tempi non dicono se l'email ha la password.
    await hashSharedPassword(password).catch(() => undefined)
    return false
  }
  const [, n, r, p, salt, expectedB64] = parts
  const expected = Buffer.from(expectedB64, 'base64')
  const key = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 })
  return key.length === expected.length && timingSafeEqual(key, expected)
}

/** Problema della password scelta, o null se va bene. */
export function sharedPasswordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) return `La password deve avere almeno ${PASSWORD_MIN} caratteri.`
  if (Buffer.byteLength(password) > PASSWORD_MAX) return 'La password è troppo lunga (massimo 72 caratteri).'
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) return 'Usa almeno una lettera e un numero.'
  return null
}

// ---------------------------------------------------------------------
// Accesso firmato dei collaboratori: fvs1.<utente>.<versione>.<scadenza>.<firma>
// ---------------------------------------------------------------------

function serverKey(): Buffer | null {
  const base = (process.env.SHARED_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  return base ? createHmac('sha256', base).update('fv-shared-session-v1').digest() : null
}

const sign = (payload: string) => {
  const key = serverKey()
  return key ? createHmac('sha256', key).update(payload).digest('base64url') : null
}

export const isSharedToken = (token: string) => token.startsWith(TOKEN_PREFIX)

export function signSharedToken(userId: string, version: number, at = Date.now()): { token: string; exp: number } | null {
  const exp = Math.floor(at / 1000) + SHARED_TOKEN_TTL_S
  const payload = `${TOKEN_PREFIX}${userId.toLowerCase()}.${version}.${exp}`
  const sig = sign(payload)
  return sig ? { token: `${payload}.${sig}`, exp } : null
}

export function readSharedToken(token: string, at = Date.now()): { userId: string; version: number; exp: number } | null {
  if (!isSharedToken(token) || token.length > 300) return null
  const parts = token.slice(TOKEN_PREFIX.length).split('.')
  if (parts.length !== 4) return null
  const [userId, versionText, expText, sig] = parts
  const version = Number(versionText)
  const exp = Number(expText)
  if (!UUID_RE.test(userId) || !Number.isInteger(version) || version < 1 || !Number.isInteger(exp) || exp * 1000 <= at) return null
  const expected = sign(`${TOKEN_PREFIX}${userId}.${versionText}.${expText}`)
  if (!expected) return null
  const a = Buffer.from(expected)
  const b = Buffer.from(sig || '')
  return a.length === b.length && timingSafeEqual(a, b) ? { userId: userId.toLowerCase(), version, exp } : null
}

// ---------------------------------------------------------------------
// Stato salvato (app_settings, solo il server lo legge)
// ---------------------------------------------------------------------

function parseAccess(raw: string | null): SharedAccess {
  try {
    const v = raw ? JSON.parse(raw) : null
    return {
      enabled: v?.enabled === true,
      version: Number.isInteger(v?.version) && v.version > 0 ? v.version : 0,
      hash: typeof v?.hash === 'string' ? v.hash : null,
      email: typeof v?.email === 'string' ? v.email : null,
      changedAt: typeof v?.changedAt === 'string' ? v.changedAt : null,
    }
  } catch {
    return { enabled: false, version: 0, hash: null, email: null, changedAt: null }
  }
}

export async function readSharedAccess(userId: string): Promise<SharedAccess> {
  return parseAccess((await readSetting(ACCESS_KEY(userId))).value)
}

/** Attiva o cambia la password dei collaboratori: chi era entrato con quella di prima esce subito. */
export async function setSharedPassword(user: Pick<User, 'id' | 'email'>, password: string): Promise<SharedAccess> {
  const email = normEmail(user.email || '')
  if (!email) throw new Error('account senza email')
  const hash = await hashSharedPassword(password)
  // Prima l'email da dare ai collaboratori (porta a questo account): se non si salva, errore e niente
  // risulta attivo. Da sola non apre niente: serve anche la password attiva qui sotto.
  const { error } = await supabaseAdmin.from('app_settings').upsert({ key: EMAIL_KEY(email), value: user.id, updated_at: new Date().toISOString() })
  if (error) throw new Error(`email dei collaboratori non salvata: ${error.message}`)
  return updateSetting(ACCESS_KEY(user.id), parseAccess, (cur) => ({
    enabled: true,
    version: cur.version + 1,
    hash,
    email,
    changedAt: new Date().toISOString(),
  }))
}

/** Spegne la password dei collaboratori: escono subito tutti quelli entrati con lei. */
export async function disableSharedPassword(userId: string): Promise<SharedAccess> {
  const before = await readSharedAccess(userId)
  const next = await updateSetting(ACCESS_KEY(userId), parseAccess, (cur) => ({
    enabled: false,
    version: cur.version + 1,
    hash: null,
    email: cur.email,
    changedAt: new Date().toISOString(),
  }))
  if (before.email) {
    // La password e' gia' spenta (versione nuova): se questa pulizia non riesce, l'email non apre comunque niente.
    const { error } = await supabaseAdmin.from('app_settings').delete().eq('key', EMAIL_KEY(before.email)).eq('value', userId)
    if (error) console.error('password collaboratori: email non tolta', error.message.slice(0, 160))
  }
  return next
}

// ---------------------------------------------------------------------
// Controllo a ogni richiesta e accesso con la password
// ---------------------------------------------------------------------

/** Account bloccato o eliminato: la password dei collaboratori non apre piu' niente. */
const blocked = (user: User, at = Date.now()) => {
  // banned_until e deleted_at arrivano dall'API admin ma non sono nel tipo User di supabase-js.
  const u = user as User & { banned_until?: string | null; deleted_at?: string | null }
  return Boolean((u.banned_until && Date.parse(u.banned_until) > at) || u.deleted_at)
}

async function liveUser(userId: string): Promise<User | null> {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId)
  if (error && !/not.?found/i.test(error.message)) throw new Error(`utente non letto: ${error.message}`)
  return data?.user && !blocked(data.user) ? data.user : null
}

/**
 * Accesso dei collaboratori, controllato adesso: { user } se vale, { revoked } se la password e'
 * cambiata o spenta o l'accesso e' scaduto (o falso): in tutti questi casi l'app fa uscire subito.
 * Errori del database: eccezione (chi chiama non deve far uscire nessuno per un errore temporaneo).
 */
export async function checkSharedToken(token: string): Promise<{ user: User } | { revoked: SharedRevoked }> {
  const parsed = readSharedToken(token)
  if (!parsed) return { revoked: 'expired' }
  const access = await readSharedAccess(parsed.userId)
  if (!access.enabled || !access.hash) return { revoked: 'disabled' }
  if (access.version !== parsed.version) return { revoked: 'changed' }
  const user = await liveUser(parsed.userId)
  return user ? { user } : { revoked: 'disabled' }
}

export type SharedLoginResult =
  | { ok: true; token: string; exp: number; userId: string; email: string }
  | { ok: false; status: 401 | 429 | 503; error: string }

const WRONG = 'Email o password non corretti.'
const TOO_MANY = 'Troppi tentativi: riprova tra qualche minuto.'
const UNAVAILABLE = 'Accesso non disponibile in questo momento, riprova.'

/**
 * Entrata con l'email del titolare e la password dei collaboratori. Errore sempre uguale (non si
 * scopre chi ha la password) e stesso lavoro in ogni caso (letture e un calcolo scrypt). Un errore
 * del database o di Supabase risponde 503 e il tentativo non conta: non si dice «password
 * sbagliata» a chi l'ha scritta giusta.
 */
export async function sharedLogin(emailRaw: unknown, passwordRaw: unknown, ipHash: string, now = Date.now()): Promise<SharedLoginResult> {
  const email = typeof emailRaw === 'string' ? normEmail(emailRaw) : ''
  const password = typeof passwordRaw === 'string' ? passwordRaw : ''
  if (!email || !password || email.length > 200 || Buffer.byteLength(password) > PASSWORD_MAX) return { ok: false, status: 401, error: WRONG }
  const attempt = newSlotId()
  const keys: [string, number][] = [
    [FAILS_IP_KEY(ipHash), MAX_FAILS_IP],
    [FAILS_EMAIL_IP_KEY(email, ipHash), MAX_FAILS_EMAIL_IP],
    [FAILS_EMAIL_KEY(email), MAX_FAILS_EMAIL],
  ]
  const reserved: string[] = []
  const releaseAll = () => Promise.all(reserved.map((key) => releaseSlot(key, attempt)))
  try {
    // Tutti i limiti prenotati prima di controllare la password (in caso di errore si chiude).
    for (const [key, max] of keys) {
      if (!(await reserveSlot(key, [{ windowMs: FAIL_WINDOW_MS, max }], attempt, now))) {
        await releaseAll()
        return { ok: false, status: 429, error: TOO_MANY }
      }
      reserved.push(key)
    }
  } catch {
    await releaseAll()
    return { ok: false, status: 503, error: UNAVAILABLE }
  }

  let failed = false
  const mapped = await readSetting(EMAIL_KEY(email)).then(
    (r) => r.value,
    () => ((failed = true), null)
  )
  const userId = mapped && UUID_RE.test(mapped) ? mapped : null
  // Stessa lettura anche quando l'email non ha la password dei collaboratori (tempi uguali).
  const access = await readSharedAccess(userId || NOBODY).catch(() => ((failed = true), null))
  // Il calcolo si fa sempre (anche dopo un errore), cosi' i tempi restano uguali.
  const good = await verifySharedPassword(password, userId && access?.enabled && access.email === email ? access.hash : null)
  if (failed) {
    await releaseAll()
    return { ok: false, status: 503, error: UNAVAILABLE }
  }
  if (!good || !access || !userId) return { ok: false, status: 401, error: WRONG }
  let user: User | null
  try {
    user = await liveUser(userId)
  } catch {
    await releaseAll()
    return { ok: false, status: 503, error: UNAVAILABLE }
  }
  if (!user) return { ok: false, status: 401, error: WRONG }

  const signed = signSharedToken(userId, access.version, now)
  await releaseAll()
  if (!signed) return { ok: false, status: 503, error: UNAVAILABLE }
  return { ok: true, token: signed.token, exp: signed.exp, userId, email }
}

/** IPv6 scritto per intero (8 gruppi), anche quando e' abbreviato con «::». null se non e' un IPv6. */
function expandIPv6(raw: string): string[] | null {
  const ip = raw.replace(/^\[|\](:\d+)?$/g, '').split('%')[0].toLowerCase()
  if (!ip.includes(':') || !isIPv6(ip)) return null
  const [head, tail] = ip.includes('::') ? ip.split('::') : [ip, null]
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  // Un IPv4 in coda (::ffff:1.2.3.4) conta come due gruppi.
  const last = (tail !== null ? right : left).slice(-1)[0] || ''
  const v4Groups = last.includes('.') ? 1 : 0
  const missing = 8 - (left.length + right.length + v4Groups)
  const groups = tail !== null ? [...left, ...Array(Math.max(0, missing)).fill('0'), ...right] : left
  return groups.map((g) => (g.includes('.') ? g : g.padStart(4, '0')))
}

/** IPv4 dentro un IPv6 (::ffff:1.2.3.4, ::ffff:102:304, ::1.2.3.4): l'IPv4, altrimenti null. */
function embeddedIPv4(groups: string[]): string | null {
  const last = groups[groups.length - 1] || ''
  if (last.includes('.')) {
    // Scritto con i punti in coda: i gruppi prima sono 6 (5 zeri e ffff, o 6 zeri).
    const head = groups.slice(0, -1)
    const mapped = head.length === 6 && head.slice(0, 5).every((g) => g === '0000') && (head[5] === 'ffff' || head[5] === '0000')
    return mapped ? last : null
  }
  if (groups.length === 8 && groups.slice(0, 5).every((g) => g === '0000') && groups[5] === 'ffff') {
    const n = parseInt(groups[6] + groups[7], 16)
    return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
  }
  return null
}

/**
 * Impronta dell'IP (non si salva l'indirizzo). IPv6: per blocco /64, cosi' non basta cambiare
 * l'ultima parte. Un IPv4 conta per se' anche quando arriva dentro un IPv6 o con la porta.
 */
export function ipHashOf(headers: Headers): string {
  let raw = (headers.get('x-forwarded-for') || '').split(',')[0].trim() || headers.get('x-real-ip')?.trim() || 'sconosciuto'
  const withPort = raw.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/)
  if (withPort) raw = withPort[1]
  const v6 = expandIPv6(raw)
  const v4 = v6 ? embeddedIPv4(v6) : null
  const ip = v4 || (v6 ? v6.slice(0, 4).join(':') : raw.toLowerCase())
  return createHmac('sha256', serverKey() || Buffer.from('fv-ip')).update(ip).digest('hex').slice(0, 32)
}
