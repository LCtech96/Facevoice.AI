import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'crypto'
import { LIMITS } from '@/lib/todo-shared'

// Accesso alle todo list condivise: link segreto (32 byte casuali), una persona per
// ognuno con nome e password personale (salvata solo come hash scrypt con sale) e,
// dopo nome e password giusti, un cookie firmato valido solo per quella todo list e
// quella persona. Nel cookie ci sono la "versione" della todo list (link nuovo: escono
// tutti) e quella della persona (password cambiata o persona tolta: esce solo lei).

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
export type SessionMember = { id: string; session_version: number }
/** Cosa dice un cookie valido: chi e' (memberId null = admin) e con quale versione della sua password. */
export type SessionInfo = { memberId: string | null; memberVersion: number }

/** L'admin entra con «Apri» senza password: il suo cookie dura meno. */
export const ADMIN_SESSION_TTL_S = 12 * 3600
const MEMBER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Nome del cookie: diverso per ogni todo list, cosi' due liste aperte non si pestano i piedi. */
export const sessionCookieName = (boardId: string) => `fv_todo_${boardId.replace(/[^a-f0-9]/gi, '').slice(0, 16)}`

const sessionSig = (key: Buffer, boardId: string, boardVersion: number, who: string, memberVersion: number, exp: number) =>
  createHmac('sha256', key).update(`${boardId}.${boardVersion}.${who}.${memberVersion}.${exp}`).digest('base64url')

/**
 * Cookie firmato: todo list + sua versione (link nuovo: escono tutti) + persona + versione
 * della sua password (password cambiata o persona tolta: esce solo lei). member null = admin.
 */
export function signSession(board: SessionBoard, member: SessionMember | null, at = Date.now()): string | null {
  const key = serverKey('todo-session')
  if (!key) return null
  const who = member ? member.id : 'admin'
  const memberVersion = member ? member.session_version : 0
  const exp = Math.floor(at / 1000) + (member ? SESSION_TTL_S : ADMIN_SESSION_TTL_S)
  return `${board.session_version}.${who}.${memberVersion}.${exp}.${sessionSig(key, board.id, board.session_version, who, memberVersion, exp)}`
}

/** Legge il cookie (firma, todo list, versione, scadenza). La persona va poi controllata nel database. */
export function readSession(value: string | undefined | null, board: SessionBoard, at = Date.now()): SessionInfo | null {
  const key = serverKey('todo-session')
  if (!key || !value || typeof value !== 'string') return null
  const parts = value.split('.')
  if (parts.length !== 5) return null
  const [boardText, who, memberText, expText, sig] = parts
  const boardVersion = Number(boardText)
  const memberVersion = Number(memberText)
  const exp = Number(expText)
  if (!sig || !Number.isInteger(boardVersion) || boardVersion !== board.session_version || !Number.isInteger(memberVersion)) return null
  const admin = who === 'admin'
  if (!admin && !MEMBER_ID_RE.test(who)) return null
  const ttl = admin ? ADMIN_SESSION_TTL_S : SESSION_TTL_S
  if (!Number.isFinite(exp) || exp * 1000 < at || exp * 1000 > at + ttl * 1000 + 60_000) return null
  const expected = Buffer.from(sessionSig(key, board.id, boardVersion, who, memberVersion, exp))
  const given = Buffer.from(sig)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  return { memberId: admin ? null : who.toLowerCase(), memberVersion }
}

/** Impronta dell'IP per il limite dei tentativi (l'IP in chiaro non si salva). */
export function ipHashOf(ip: string): string {
  const key = serverKey('todo-ip') || Buffer.from('todo-ip')
  return createHmac('sha256', key).update(ip || 'sconosciuto').digest('hex').slice(0, 32)
}
