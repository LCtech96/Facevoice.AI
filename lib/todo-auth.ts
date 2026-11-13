import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'crypto'
import { isAdminEmail } from '@/lib/admin-auth'
import { LIMITS } from '@/lib/todo-shared'

// Accesso alle todo list condivise: link segreto (32 byte casuali), password scelta
// dall'admin (salvata solo come hash scrypt con sale) e, dopo la password giusta,
// un cookie firmato valido solo per quella todo list. Nel cookie c'e' la "versione
// di accesso" della todo list: cambiare password o rigenerare il link la aumenta e
// tutti i cookie di prima smettono di valere.

export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/
export const SESSION_TTL_S = 14 * 24 * 3600

const scryptAsync = (password: string, salt: Buffer, keylen: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCallback(password, salt, keylen, options, (error, key) => (error ? reject(error) : resolve(key))))
const SCRYPT = { N: 16384, r: 8, p: 1 }

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string') return 'Scrivi una password.'
  if (password.length < LIMITS.passwordMin) return `La password deve avere almeno ${LIMITS.passwordMin} caratteri.`
  if (password.length > LIMITS.passwordMax) return `La password può avere al massimo ${LIMITS.passwordMax} caratteri.`
  return null
}

export async function hashPassword(password: string): Promise<string> {
  const problem = passwordProblem(password)
  if (problem) throw new Error(problem)
  const salt = randomBytes(16)
  const key = await scryptAsync(password, salt, 32, SCRYPT)
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`
}

export async function verifyPassword(password: unknown, stored: string): Promise<boolean> {
  if (typeof password !== 'string' || !password || password.length > LIMITS.passwordMax || typeof stored !== 'string') return false
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, salt, hash] = parts
  const expected = Buffer.from(hash, 'base64')
  if (expected.length < 16) return false
  const key = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) })
  return key.length === expected.length && timingSafeEqual(key, expected)
}

/** Segreto del server, diverso per ogni uso (null se il server non ne ha uno). */
function serverKey(purpose: string): Buffer | null {
  const base = (process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  return base ? createHmac('sha256', base).update(purpose).digest() : null
}

export const hasServerKey = () => serverKey('todo') !== null

/** Link nuovo: 256 bit casuali. */
export const newToken = () => randomBytes(32).toString('base64url')
export const tokenHashOf = (token: string) => createHash('sha256').update(`todo-link:${token}`).digest('hex')

/** Copia cifrata del link (per «Copia link» dell'admin). */
export function sealToken(token: string): string {
  const key = serverKey('todo-link-seal')
  if (!key) throw new Error('Manca il segreto del server per cifrare il link.')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${data.toString('base64url')}`
}

export function openToken(sealed: string): string | null {
  try {
    const [v, iv, tag, data] = String(sealed).split('.')
    const key = serverKey('todo-link-seal')
    if (v !== 'v1' || !key) return null
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    const token = Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
    return TOKEN_RE.test(token) ? token : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------
// Cookie di accesso (uno per todo list)
// ---------------------------------------------------------------------

export type SessionBoard = { id: string; session_version: number }

/** Nome del cookie: diverso per ogni todo list, cosi' due liste aperte non si pestano i piedi. */
export const sessionCookieName = (boardId: string) => `fv_todo_${boardId.replace(/[^a-f0-9]/gi, '').slice(0, 16)}`

const sessionSig = (key: Buffer, boardId: string, version: number, exp: number) =>
  createHmac('sha256', key).update(`${boardId}.${version}.${exp}`).digest('base64url')

export function signSession(board: SessionBoard, at = Date.now()): string | null {
  const key = serverKey('todo-session')
  if (!key) return null
  const exp = Math.floor(at / 1000) + SESSION_TTL_S
  return `${board.session_version}.${exp}.${sessionSig(key, board.id, board.session_version, exp)}`
}

export function verifySession(value: string | undefined | null, board: SessionBoard, at = Date.now()): boolean {
  const key = serverKey('todo-session')
  if (!key || !value || typeof value !== 'string') return false
  const [versionText, expText, sig] = value.split('.')
  const version = Number(versionText)
  const exp = Number(expText)
  if (!sig || !Number.isInteger(version) || version !== board.session_version) return false
  if (!Number.isFinite(exp) || exp * 1000 < at || exp * 1000 > at + SESSION_TTL_S * 1000 + 60_000) return false
  const expected = Buffer.from(sessionSig(key, board.id, version, exp))
  const given = Buffer.from(sig)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

/**
 * Cookie autentico (firma giusta, non scaduto) ma di una versione vecchia: l'admin ha
 * cambiato la password (o rigenerato l'accesso) dopo che questa persona era entrata.
 */
export function sessionWasRevoked(value: string | undefined | null, board: SessionBoard, at = Date.now()): boolean {
  const key = serverKey('todo-session')
  if (!key || !value || typeof value !== 'string') return false
  const [versionText, expText, sig] = value.split('.')
  const version = Number(versionText)
  const exp = Number(expText)
  if (!sig || !Number.isInteger(version) || version === board.session_version) return false
  if (!Number.isFinite(exp) || exp * 1000 < at) return false
  const expected = Buffer.from(sessionSig(key, board.id, version, exp))
  const given = Buffer.from(sig)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

// ---------------------------------------------------------------------
// Cookie delle persone (accesso con nome e password a piu' progetti) e dell'admin
// ---------------------------------------------------------------------

/** Cookie della persona: id dell'accesso, versione (cambia con la password) e scadenza, firmati. */
export const ACCESS_COOKIE = 'fv_todo_access'
/** Cookie dell'admin per le pagine dei progetti (le foto si aprono senza intestazioni). */
export const ADMIN_COOKIE = 'fv_todo_admin'
export const ADMIN_SESSION_TTL_S = 12 * 3600

const sign = (purpose: string, payload: string) => {
  const key = serverKey(purpose)
  return key ? createHmac('sha256', key).update(payload).digest('base64url') : null
}

function sameSig(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * La pagina generale si apre una volta sola per dispositivo: il cookie dura 180 giorni
 * e si rinnova quando la persona la usa (dopo almeno un giorno). Password cambiata o
 * accesso eliminato lo annullano comunque subito (versione nel cookie).
 */
export const PORTAL_SESSION_TTL_S = 180 * 24 * 3600
export const PORTAL_REFRESH_AFTER_S = 24 * 3600

export function signAccessSession(access: { id: string; session_version: number }, at = Date.now()): string | null {
  const exp = Math.floor(at / 1000) + PORTAL_SESSION_TTL_S
  const payload = `${access.id}.${access.session_version}.${exp}`
  const sig = sign('todo-access-session', payload)
  return sig ? `${payload}.${sig}` : null
}

/** Id, versione e scadenza dal cookie della persona, se la firma e la scadenza vanno bene (la versione la confronta chi chiama). */
export function readAccessSession(value: string | undefined | null, at = Date.now()): { id: string; version: number; exp: number } | null {
  if (!value || typeof value !== 'string' || value.length > 200) return null
  const [id, versionText, expText, sig] = value.split('.')
  const version = Number(versionText)
  const exp = Number(expText)
  if (!sig || !ID_RE.test(id || '') || !Number.isInteger(version)) return null
  if (!Number.isFinite(exp) || exp * 1000 < at || exp * 1000 > at + PORTAL_SESSION_TTL_S * 1000 + 60_000) return null
  const expected = sign('todo-access-session', `${id}.${versionText}.${expText}`)
  return expected && sameSig(expected, sig) ? { id: id.toLowerCase(), version, exp } : null
}

/** Il cookie va rinnovato (emesso da piu' di un giorno). */
export const accessSessionNeedsRefresh = (session: { exp: number }, at = Date.now()) => session.exp * 1000 - at < (PORTAL_SESSION_TTL_S - PORTAL_REFRESH_AFTER_S) * 1000

// ---------------------------------------------------------------------
// Secondo passaggio dell'entrata: codice di 6 cifre per email
// ---------------------------------------------------------------------

/** Cookie «in attesa del codice»: dopo la password giusta, per 10 minuti; non apre nessun progetto. */
export const PENDING_COOKIE = 'fv_todo_pending'
export const PENDING_TTL_S = 10 * 60
const NONCE_RE = /^[A-Za-z0-9_-]{22}$/

export const newNonce = () => randomBytes(16).toString('base64url')

export function signPending(access: { id: string; session_version: number }, nonce: string, at = Date.now()): string | null {
  if (!NONCE_RE.test(nonce)) return null
  const exp = Math.floor(at / 1000) + PENDING_TTL_S
  const payload = `${access.id}.${access.session_version}.${nonce}.${exp}`
  const sig = sign('todo-login-pending', payload)
  return sig ? `${payload}.${sig}` : null
}

export function readPending(value: string | undefined | null, at = Date.now()): { id: string; version: number; nonce: string; exp: number } | null {
  if (!value || typeof value !== 'string' || value.length > 240) return null
  const [id, versionText, nonce, expText, sig] = value.split('.')
  const version = Number(versionText)
  const exp = Number(expText)
  if (!sig || !ID_RE.test(id || '') || !Number.isInteger(version) || !NONCE_RE.test(nonce || '')) return null
  if (!Number.isFinite(exp) || exp * 1000 < at || exp * 1000 > at + PENDING_TTL_S * 1000 + 60_000) return null
  const expected = sign('todo-login-pending', `${id}.${versionText}.${nonce}.${expText}`)
  return expected && sameSig(expected, sig) ? { id: id.toLowerCase(), version, nonce, exp } : null
}

/** Codice di 6 cifre casuale. */
export const newLoginCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0')

/** Impronta del codice (il codice in chiaro non si salva), legata a persona e tentativo. */
export function loginCodeHash(accessId: string, nonce: string, code: string): string | null {
  return sign('todo-login-code', `${accessId}.${nonce}.${code}`)
}

export const sameLoginCodeHash = (a: string, b: string) => typeof a === 'string' && typeof b === 'string' && sameSig(a, b)

// ---------------------------------------------------------------------
// Link segreto del calendario (iPhone, Google Calendar, Outlook): solo lettura
// ---------------------------------------------------------------------

export type CalendarSubject = { kind: 'person'; id: string; version: number } | { kind: 'admin'; seq: number }

/**
 * Link del calendario firmato. Persona: legato alla versione del suo accesso (password
 * cambiata o accesso eliminato: il link smette di funzionare). Admin: legato a un
 * numero che cambia con «Nuovo link».
 */
export function signCalendar(subject: CalendarSubject): string | null {
  const payload = subject.kind === 'person' ? `p.${subject.id.toLowerCase()}.${subject.version}` : `a.${subject.seq}`
  const sig = sign('todo-calendar', payload)
  return sig ? `${payload}.${sig}` : null
}

export function readCalendar(value: string | undefined | null): CalendarSubject | null {
  if (!value || typeof value !== 'string' || value.length > 200) return null
  const parts = value.split('.')
  let subject: CalendarSubject | null = null
  if (parts.length === 4 && parts[0] === 'p' && ID_RE.test(parts[1]) && /^\d{1,9}$/.test(parts[2])) subject = { kind: 'person', id: parts[1].toLowerCase(), version: Number(parts[2]) }
  else if (parts.length === 3 && parts[0] === 'a' && /^\d{1,9}$/.test(parts[1])) subject = { kind: 'admin', seq: Number(parts[1]) }
  if (!subject) return null
  const expected = sign('todo-calendar', parts.slice(0, -1).join('.'))
  return expected && sameSig(expected, parts[parts.length - 1]) ? subject : null
}

export function signAdminSession(email: string, at = Date.now()): string | null {
  const exp = Math.floor(at / 1000) + ADMIN_SESSION_TTL_S
  const who = Buffer.from(email.toLowerCase()).toString('base64url')
  const sig = sign('todo-admin-session', `${who}.${exp}`)
  return sig ? `${who}.${exp}.${sig}` : null
}

/** Email dell'admin dal suo cookie (firmato, non scaduto, ancora admin), altrimenti null. */
export function readAdminSession(value: string | undefined | null, at = Date.now()): string | null {
  if (!value || typeof value !== 'string' || value.length > 400) return null
  const [who, expText, sig] = value.split('.')
  const exp = Number(expText)
  if (!who || !sig || !Number.isFinite(exp) || exp * 1000 < at || exp * 1000 > at + ADMIN_SESSION_TTL_S * 1000 + 60_000) return null
  const expected = sign('todo-admin-session', `${who}.${expText}`)
  if (!expected || !sameSig(expected, sig)) return null
  const email = Buffer.from(who, 'base64url').toString('utf8')
  return isAdminEmail(email) ? email : null
}

/** Impronta dell'IP per il limite dei tentativi (l'IP in chiaro non si salva). */
export function ipHashOf(ip: string): string {
  const key = serverKey('todo-ip') || Buffer.from('todo-ip')
  return createHmac('sha256', key).update(ip || 'sconosciuto').digest('hex').slice(0, 32)
}
