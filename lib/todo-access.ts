import { randomUUID } from 'crypto'
import { readSetting, updateSetting } from '@/lib/settings-store'
import { hashPassword, passwordProblem, readAccessSession, verifyPassword } from '@/lib/todo-auth'
import { TodoError, listBoards } from '@/lib/todo-store'
import { EMAIL_RE, LIMITS, isUuid, nameKey, portalPath } from '@/lib/todo-shared'

// Accessi delle persone ai progetti (es. «Monia» vede i progetti A, B e C).
// Li crea solo l'admin: nome, password scelta da lui (salvata solo come hash scrypt)
// e i progetti. Si entra da un'unica pagina (/todo) con nome e password. Tutto sta in
// una riga di app_settings (pochi accessi, modifiche sicure anche in contemporanea).
// Cambiare password o eliminare l'accesso fa uscire subito la persona (versione nel
// cookie); togliere un progetto lo nasconde alla richiesta successiva. L'email della
// persona (una per persona) serve per il codice di entrata e per i solleciti con il
// link diretto alla sua pagina dei progetti.

export type AccessRow = {
  id: string
  name: string
  name_key: string
  /** Email della persona (minuscole); null per gli accessi creati prima che servisse. */
  email: string | null
  password_hash: string
  board_ids: string[]
  session_version: number
  created_at: string
  updated_at: string
}

type AccessStore = { people: AccessRow[] }

const KEY = 'todo_accesses'
const ATTEMPTS_KEY = 'todo_portal_attempts'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parse(raw: string | null): AccessStore {
  try {
    const v = raw ? JSON.parse(raw) : null
    const people = Array.isArray(v?.people) ? (v.people as AccessRow[]) : []
    return {
      people: people
        .filter((p) => p && typeof p.id === 'string' && typeof p.password_hash === 'string')
        .map((p) => ({ ...p, email: typeof p.email === 'string' && p.email ? p.email : null, board_ids: Array.isArray(p.board_ids) ? p.board_ids : [] })),
    }
  } catch {
    return { people: [] }
  }
}

async function save(fn: (people: AccessRow[]) => AccessRow[] | false): Promise<AccessRow[]> {
  try {
    const out = await updateSetting(KEY, parse, (cur) => {
      const next = fn(cur.people)
      return next === false ? false : { people: next }
    })
    return out.people
  } catch (error) {
    if (error instanceof TodoError) throw error
    console.error('todo: accessi:', error instanceof Error ? error.message.slice(0, 160) : 'errore')
    throw new TodoError('Salvataggio non riuscito: riprova.', 500)
  }
}

export async function listAccesses(): Promise<AccessRow[]> {
  return parse((await readSetting(KEY)).value).people
}

export async function accessById(id: string): Promise<AccessRow | null> {
  if (typeof id !== 'string' || !UUID_RE.test(id)) return null
  return (await listAccesses()).find((p) => p.id === id.toLowerCase()) || null
}

/** Cosa vede l'admin di un accesso (mai l'hash). */
export const accessView = (a: AccessRow, existing?: Set<string>) => ({
  id: a.id,
  name: a.name,
  email: a.email,
  boardIds: existing ? a.board_ids.filter((b) => existing.has(b)) : a.board_ids,
  createdAt: a.created_at,
})

function cleanName(name: unknown): string {
  const n = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, LIMITS.personName) : ''
  if (!n) throw new TodoError('Scrivi il nome della persona.')
  return n
}

/** Email obbligatoria (serve per il codice di entrata), valida, in minuscolo. */
export function cleanEmail(email: unknown): string {
  const e = typeof email === 'string' ? email.trim().toLowerCase() : ''
  if (!e) throw new TodoError('Scrivi l’email della persona: serve per il codice di entrata.')
  if (e.length > LIMITS.email || !EMAIL_RE.test(e)) throw new TodoError('Indirizzo email non valido.')
  return e
}

const emailTaken = (people: AccessRow[], email: string, exceptId?: string) => people.find((p) => p.id !== exceptId && p.email === email)

/** «m***a@gmail.com»: si vede a chi e' partito il codice senza mostrare l'indirizzo intero. */
export function maskEmail(email: string | null): string {
  if (!email) return ''
  const at = email.lastIndexOf('@')
  if (at < 1) return '***'
  const local = email.slice(0, at)
  const masked = local.length <= 2 ? `${local[0]}***` : `${local[0]}***${local[local.length - 1]}`
  return `${masked}${email.slice(at)}`
}

/** Solo progetti che esistono davvero. */
async function cleanBoardIds(ids: unknown): Promise<string[]> {
  if (!Array.isArray(ids)) return []
  const wanted = ids.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)).map((x) => x.toLowerCase())
  if (!wanted.length) return []
  const existing = new Set((await listBoards()).map((b) => b.id))
  return [...new Set(wanted.filter((id) => existing.has(id)))]
}

const nowIso = () => new Date().toISOString()

export async function createAccess(name: unknown, password: unknown, boardIds: unknown, email?: unknown): Promise<AccessRow> {
  const n = cleanName(name)
  const mail = cleanEmail(email)
  const problem = passwordProblem(password)
  if (problem) throw new TodoError(problem)
  const boards = await cleanBoardIds(boardIds)
  const password_hash = await hashPassword(password as string)
  const row: AccessRow = { id: randomUUID(), name: n, name_key: nameKey(n), email: mail, password_hash, board_ids: boards, session_version: 1, created_at: nowIso(), updated_at: nowIso() }
  await save((people) => {
    if (people.some((p) => p.name_key === row.name_key)) throw new TodoError(`Esiste già un accesso con il nome «${n}»: sceglilo dall’elenco.`, 409)
    const other = emailTaken(people, mail)
    if (other) throw new TodoError(`Questa email è già usata da «${other.name}».`, 409)
    return [...people, row]
  })
  return row
}

async function change(id: string, patch: (a: AccessRow) => Partial<AccessRow>): Promise<AccessRow> {
  let changed: AccessRow | null = null
  await save((people) => {
    const i = people.findIndex((p) => p.id === id)
    if (i < 0) throw new TodoError('Accesso non trovato.', 404)
    changed = { ...people[i], ...patch(people[i]), updated_at: nowIso() }
    return people.map((p, j) => (j === i ? (changed as AccessRow) : p))
  })
  return changed as unknown as AccessRow
}

/** Aggiunge progetti (quelli che aveva gia' restano). */
export async function grantBoards(id: string, boardIds: unknown): Promise<AccessRow> {
  const boards = await cleanBoardIds(boardIds)
  if (!boards.length) throw new TodoError('Scegli almeno un progetto.')
  return change(id, (a) => ({ board_ids: [...new Set([...a.board_ids, ...boards])] }))
}

/** Toglie progetti. */
export async function revokeBoards(id: string, boardIds: unknown): Promise<AccessRow> {
  const drop = new Set(Array.isArray(boardIds) ? boardIds.filter((x): x is string => typeof x === 'string').map((x) => x.toLowerCase()) : [])
  return change(id, (a) => ({ board_ids: a.board_ids.filter((b) => !drop.has(b)) }))
}

/** Email nuova (una per persona). I codici gia' mandati all'email di prima non valgono piu'. */
export async function setAccessEmail(id: string, email: unknown): Promise<AccessRow> {
  const mail = cleanEmail(email)
  let changed: AccessRow | null = null
  await save((people) => {
    const i = people.findIndex((p) => p.id === id)
    if (i < 0) throw new TodoError('Accesso non trovato.', 404)
    const other = emailTaken(people, mail, id)
    if (other) throw new TodoError(`Questa email è già usata da «${other.name}».`, 409)
    changed = { ...people[i], email: mail, updated_at: nowIso() }
    return people.map((p, j) => (j === i ? (changed as AccessRow) : p))
  })
  return changed as unknown as AccessRow
}

/** Password nuova: la persona esce e deve rientrare con quella nuova. */
export async function changeAccessPassword(id: string, password: unknown): Promise<AccessRow> {
  const problem = passwordProblem(password)
  if (problem) throw new TodoError(problem)
  const password_hash = await hashPassword(password as string)
  return change(id, (a) => ({ password_hash, session_version: a.session_version + 1 }))
}

export async function deleteAccess(id: string): Promise<void> {
  await save((people) => {
    if (!people.some((p) => p.id === id)) throw new TodoError('Accesso non trovato.', 404)
    return people.filter((p) => p.id !== id)
  })
}

/** Progetto eliminato: si toglie da tutti gli accessi. */
export async function forgetBoard(boardId: string): Promise<void> {
  await save((people) => (people.some((p) => p.board_ids.includes(boardId)) ? people.map((p) => ({ ...p, board_ids: p.board_ids.filter((b) => b !== boardId) })) : false))
}

// Hash di riserva: con un nome che non esiste si fa lo stesso lavoro (stessi tempi di risposta).
let dummyHash: Promise<string> | null = null

/** Accesso con nome e password giusti, altrimenti null. */
export async function checkLogin(name: unknown, password: unknown): Promise<AccessRow | null> {
  const key = nameKey(typeof name === 'string' ? name.slice(0, 200) : '')
  const person = key ? (await listAccesses()).find((p) => p.name_key === key) : undefined
  if (!person) {
    dummyHash ||= hashPassword('nessuno-qui-123')
    await verifyPassword(password, await dummyHash)
    return null
  }
  return (await verifyPassword(password, person.password_hash)) ? person : null
}

/** Persona del cookie, se la versione e' ancora quella (password non cambiata, accesso non eliminato). */
export async function accessForSession(session: { id: string; version: number } | null): Promise<AccessRow | null> {
  if (!session) return null
  const person = await accessById(session.id)
  return person && person.session_version === session.version ? person : null
}

/** Dove andare dopo l'entrata: il progetto (e l'attivita') chiesti, solo se sono della persona. */
export function nextForAccess(access: Pick<AccessRow, 'board_ids'>, boardId: unknown, taskId: unknown): string {
  if (!isUuid(boardId) || !access.board_ids.includes(boardId.toLowerCase())) return '/todo'
  return portalPath(boardId, isUuid(taskId) ? taskId : null)
}

/**
 * Link del singolo progetto aperto da chi e' gia' entrato nella pagina generale e ha
 * quel progetto: si va li' (niente password del progetto). Altrimenti null.
 */
export async function portalPathForLink(boardId: string, accessCookie: string | undefined | null): Promise<string | null> {
  const person = await accessForSession(readAccessSession(accessCookie)).catch(() => null)
  return person && person.board_ids.includes(boardId) ? portalPath(boardId) : null
}

/** La persona della pagina generale a cui va un sollecito: stessa email e quel progetto. */
export function portalPersonFor(task: { board_id: string; notify_email: string | null; assignee?: string | null }, people: AccessRow[]): AccessRow | null {
  const has = (p: AccessRow) => p.board_ids.includes(task.board_id)
  const email = (task.notify_email || '').trim().toLowerCase()
  if (email) {
    const byEmail = people.find((p) => p.email === email && has(p))
    if (byEmail) return byEmail
  }
  // Per nome solo se la persona non ha un'email salvata: con un'email diversa il
  // sollecito va a qualcun altro, che il link della pagina generale non lo apre.
  const key = nameKey(task.assignee || '')
  if (!key) return null
  return people.find((p) => p.name_key === key && !p.email && has(p)) || null
}

// ---------------------------------------------------------------------
// Tentativi di accesso dalla pagina generale: 10 per nome e 30 per IP ogni 15 minuti
// ---------------------------------------------------------------------

export const PORTAL_WINDOW_MS = 15 * 60_000
export const PORTAL_MAX_NAME = 10
export const PORTAL_MAX_IP = 30

type Attempt = { ip: string; name: string; t: number }
const parseAttempts = (raw: string | null): { list: Attempt[] } => {
  try {
    const v = raw ? JSON.parse(raw) : null
    return { list: Array.isArray(v?.list) ? v.list : [] }
  } catch {
    return { list: [] }
  }
}

/** Prenota un tentativo prima di controllare la password (anche tanti insieme non superano il limite). */
export async function reservePortalAttempt(ipHash: string, name: string, at = Date.now()): Promise<{ ok: true } | { ok: false; minutes: number }> {
  const key = nameKey(name).slice(0, 80)
  let blockedUntil = 0
  await updateSetting(ATTEMPTS_KEY, parseAttempts, (cur) => {
    blockedUntil = 0
    const recent = cur.list.filter((a) => a && a.t > at - PORTAL_WINDOW_MS).slice(-2000)
    const byIp = recent.filter((a) => a.ip === ipHash)
    const byName = recent.filter((a) => a.name === key)
    if (byIp.length >= PORTAL_MAX_IP) blockedUntil = byIp[0].t + PORTAL_WINDOW_MS
    else if (byName.length >= PORTAL_MAX_NAME) blockedUntil = byName[0].t + PORTAL_WINDOW_MS
    if (blockedUntil) return false
    return { list: [...recent, { ip: ipHash, name: key, t: at }] }
  })
  if (!blockedUntil) return { ok: true }
  return { ok: false, minutes: Math.max(1, Math.ceil((blockedUntil - at) / 60_000)) }
}

/** Accesso riuscito: i tentativi di quell'IP con quel nome si azzerano. */
export async function clearPortalAttempts(ipHash: string, name: string): Promise<void> {
  const key = nameKey(name).slice(0, 80)
  await updateSetting(ATTEMPTS_KEY, parseAttempts, (cur) => {
    const next = cur.list.filter((a) => !(a.ip === ipHash && a.name === key))
    return next.length === cur.list.length ? false : { list: next }
  }).catch(() => undefined)
}
