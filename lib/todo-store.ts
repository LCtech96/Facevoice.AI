import { randomBytes, randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { SITE_URL } from '@/lib/seo/site'
import { hashPassword, newToken, openToken, passwordProblem, sealToken, tokenHashOf, TOKEN_RE, type SessionInfo } from '@/lib/todo-auth'
import { fetchLinkPreview } from '@/lib/todo-preview'
import {
  ADMIN_NAME,
  EMAIL_RE,
  IMAGE_TYPES,
  LIMITS,
  extractLinks,
  nameKey,
  positionAt,
  taskVisibleTo,
  type TodoBoardState,
  type TodoLinkPreview,
  type TodoList,
  type TodoTask,
} from '@/lib/todo-shared'

// Dati delle todo list condivise. Ogni funzione che tocca liste, attivita' o foto
// riceve la todo list gia' verificata (dal link + cookie, o dall'admin) e filtra
// SEMPRE per il suo id: da una todo list non si raggiunge mai un'altra, ne' altri
// dati del sito. Solo il server (service role) legge e scrive queste tabelle.
//
// Dentro una todo list conta anche CHI chiede (Viewer): l'admin vede e modifica tutto;
// una persona vede solo le attivita' assegnate a lei, quelle che ha creato e quelle
// generali dell'admin (senza persona). Modifica solo le sue; quelle degli altri che
// vede puo' solo spostarle e segnarle come fatte. Le attivita' che non vede, per lei,
// non esistono (sempre "non trovata"). Tabelle: quelle dell'admin le vedono tutti ma
// le gestisce solo l'admin; quelle di una persona le vedono solo lei e l'admin.

export class TodoError extends Error {
  constructor(message: string, public status = 400, public setup = false, public update = false) {
    super(message)
  }
}

export const SETUP_MESSAGE = 'Esegui prima lo SQL della todo list.'
export const PEOPLE_SETUP_MESSAGE = 'Esegui lo SQL aggiornato della todo list.'
export const BUCKET = 'todo-images'

type DbError = { code?: string; message?: string } | null | undefined

export function isMissingSetup(error: DbError): boolean {
  if (!error) return false
  const code = error.code || ''
  const msg = error.message || ''
  if (['42P01', 'PGRST205', 'PGRST202', '42883'].includes(code)) return true
  return /todo_(boards|lists|tasks|reminders_sent|login_attempts|task_add_image|task_remove_image)/.test(msg) && /does not exist|schema cache|could not find/i.test(msg)
}

/** Manca lo SQL delle persone (tabella todo_members o le colonne nuove). */
export function isMissingPeople(error: DbError): boolean {
  if (!error) return false
  const code = error.code || ''
  const msg = error.message || ''
  if (/todo_members|created_by_member|assignee_member|done_notified_at/.test(msg)) return ['42P01', 'PGRST205', '42703', 'PGRST204'].includes(code) || /does not exist|schema cache|could not find/i.test(msg)
  return code === '42703' || code === 'PGRST204'
}

function check(error: DbError, what: string) {
  if (!error) return
  if (isMissingPeople(error)) throw new TodoError(PEOPLE_SETUP_MESSAGE, 503, true, true)
  if (isMissingSetup(error)) throw new TodoError(SETUP_MESSAGE, 503, true)
  console.error(`todo: ${what}:`, error.code || '', (error.message || '').slice(0, 200))
  throw new TodoError('Qualcosa non è andato: riprova.', 500)
}

const nowIso = () => new Date().toISOString()
const oneLine = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isId = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v)

// ---------------------------------------------------------------------
// Todo list (lato admin)
// ---------------------------------------------------------------------

export type BoardRow = {
  id: string
  name: string
  token_hash: string
  token_enc: string
  password_hash: string
  session_version: number
  created_at: string
  updated_at: string
}

const BOARD_COLS = 'id, name, token_hash, token_enc, password_hash, session_version, created_at, updated_at'

/** Dominio dei link: sul sito vero sempre www.facevoice.ai, nelle anteprime quello della richiesta. */
export function todoOrigin(requestOrigin?: string | null): string {
  if (process.env.VERCEL_ENV === 'production') return SITE_URL
  if (requestOrigin && /^https?:\/\/[\w.:-]+$/.test(requestOrigin)) return requestOrigin
  return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : SITE_URL
}

export const boardLink = (origin: string, token: string) => `${origin}/todo/${token}`

export function boardLinkOf(board: Pick<BoardRow, 'token_enc'>, origin: string): string | null {
  const token = openToken(board.token_enc)
  return token ? boardLink(origin, token) : null
}

/** Cosa vede l'admin di una todo list (mai hash o segreti). */
export const adminView = (b: BoardRow, link: string | null) => ({ id: b.id, name: b.name, createdAt: b.created_at, updatedAt: b.updated_at, link })

export async function listBoards(): Promise<BoardRow[]> {
  const { data, error } = await supabaseAdmin.from('todo_boards').select(BOARD_COLS).order('created_at', { ascending: false })
  check(error, 'elenco todo list')
  return (data || []) as BoardRow[]
}

export async function boardById(id: string): Promise<BoardRow | null> {
  if (!isId(id)) return null
  const { data, error } = await supabaseAdmin.from('todo_boards').select(BOARD_COLS).eq('id', id).maybeSingle()
  check(error, 'todo list')
  return (data as BoardRow) || null
}

/** Todo list aperta da un link valido (altrimenti null). */
export async function boardByToken(token: string): Promise<BoardRow | null> {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null
  const { data, error } = await supabaseAdmin.from('todo_boards').select(BOARD_COLS).eq('token_hash', tokenHashOf(token)).maybeSingle()
  check(error, 'todo list dal link')
  return (data as BoardRow) || null
}

const DEFAULT_LISTS = ['Da fare', 'In corso', 'Fatto']

export async function createBoard(name: unknown, by: string | null): Promise<{ board: BoardRow; token: string }> {
  const title = oneLine(name, LIMITS.boardName)
  if (!title) throw new TodoError('Dai un nome alla todo list.')
  const token = newToken()
  const row = {
    name: title,
    token_hash: tokenHashOf(token),
    token_enc: sealToken(token),
    // La password unica della todo list non si usa piu' (ognuno ha la sua): qui una casuale che nessuno conosce.
    password_hash: await hashPassword(randomBytes(24).toString('base64url')),
    session_version: 1,
    created_by: by,
  }
  const { data, error } = await supabaseAdmin.from('todo_boards').insert(row).select(BOARD_COLS).single()
  check(error, 'nuova todo list')
  const board = data as BoardRow
  const { error: listError } = await supabaseAdmin
    .from('todo_lists')
    .insert(DEFAULT_LISTS.map((t, i) => ({ board_id: board.id, title: t, position: (i + 1) * 1024 })))
  check(listError, 'tabelle iniziali')
  return { board, token }
}

async function bumpBoard(id: string, patch: (b: BoardRow) => Partial<BoardRow>): Promise<BoardRow> {
  // Confronto sulla versione: due cambi nello stesso istante non si annullano a vicenda.
  for (let i = 0; i < 3; i++) {
    const b = await boardById(id)
    if (!b) throw new TodoError('Todo list non trovata.', 404)
    const { data, error } = await supabaseAdmin
      .from('todo_boards')
      .update({ ...patch(b), session_version: b.session_version + 1, updated_at: nowIso() })
      .eq('id', id)
      .eq('session_version', b.session_version)
      .select(BOARD_COLS)
    check(error, 'aggiornamento todo list')
    if (data && data.length) return data[0] as BoardRow
  }
  throw new TodoError('Modifica in corso da un’altra parte: riprova.', 409)
}

export async function renameBoard(id: string, name: unknown): Promise<BoardRow> {
  const title = oneLine(name, LIMITS.boardName)
  if (!title) throw new TodoError('Dai un nome alla todo list.')
  const { data, error } = await supabaseAdmin.from('todo_boards').update({ name: title, updated_at: nowIso() }).eq('id', id).select(BOARD_COLS)
  check(error, 'nome todo list')
  if (!data || !data.length) throw new TodoError('Todo list non trovata.', 404)
  return data[0] as BoardRow
}

/** Link nuovo: quello di prima smette di funzionare e chi era dentro esce. */
export async function regenerateLink(id: string): Promise<{ board: BoardRow; token: string }> {
  const token = newToken()
  const board = await bumpBoard(id, () => ({ token_hash: tokenHashOf(token), token_enc: sealToken(token) }))
  return { board, token }
}

export async function deleteBoard(id: string): Promise<void> {
  const board = await boardById(id)
  if (!board) throw new TodoError('Todo list non trovata.', 404)
  const { data } = await supabaseAdmin.from('todo_tasks').select('images').eq('board_id', id)
  const { error } = await supabaseAdmin.from('todo_boards').delete().eq('id', id)
  check(error, 'eliminazione todo list')
  await removeObjects(pathsOf((data || []) as { images: unknown }[]))
}

// ---------------------------------------------------------------------
// Tentativi di password: al massimo 10 per todo list e 30 per IP ogni 15 minuti
// ---------------------------------------------------------------------

export const ATTEMPT_WINDOW_MS = 15 * 60_000
export const MAX_ATTEMPTS_BOARD = 10
export const MAX_ATTEMPTS_IP = 30

/**
 * Prenota un tentativo PRIMA di controllare la password: si scrive la riga e poi si
 * contano le righe recenti, cosi' anche tanti tentativi insieme non superano il limite.
 */
export async function reserveAttempt(boardId: string, ipHash: string, at = Date.now()): Promise<{ ok: true } | { ok: false; minutes: number }> {
  const since = new Date(at - ATTEMPT_WINDOW_MS).toISOString()
  const { data: mine, error } = await supabaseAdmin
    .from('todo_login_attempts')
    .insert({ board_id: boardId, ip_hash: ipHash, created_at: new Date(at).toISOString() })
    .select('id')
    .single()
  check(error, 'tentativo')
  const [byBoard, byIp] = await Promise.all([
    supabaseAdmin.from('todo_login_attempts').select('created_at').eq('board_id', boardId).gte('created_at', since).order('created_at', { ascending: true }),
    supabaseAdmin.from('todo_login_attempts').select('created_at').eq('ip_hash', ipHash).gte('created_at', since).order('created_at', { ascending: true }),
  ])
  check(byBoard.error || byIp.error, 'conteggio tentativi')
  const boardRows = (byBoard.data || []) as { created_at: string }[]
  const ipRows = (byIp.data || []) as { created_at: string }[]
  let oldest: string | null = null
  if (boardRows.length > MAX_ATTEMPTS_BOARD) oldest = boardRows[0].created_at
  else if (ipRows.length > MAX_ATTEMPTS_IP) oldest = ipRows[0].created_at
  if (!oldest) return { ok: true }
  // Il tentativo bloccato non conta: il blocco non si allunga a ogni prova.
  await supabaseAdmin.from('todo_login_attempts').delete().eq('id', (mine as { id: number }).id)
  const until = Date.parse(oldest) + ATTEMPT_WINDOW_MS
  return { ok: false, minutes: Math.max(1, Math.ceil((until - at) / 60_000)) }
}

/** Password giusta: i tentativi di quell'IP su questa todo list si azzerano. */
export async function clearAttempts(boardId: string, ipHash: string): Promise<void> {
  await supabaseAdmin.from('todo_login_attempts').delete().eq('board_id', boardId).eq('ip_hash', ipHash)
}

// ---------------------------------------------------------------------
// Persone (ognuna con il suo nome e la sua password)
// ---------------------------------------------------------------------

export type MemberRow = {
  id: string
  board_id: string
  name: string
  name_key: string
  email: string | null
  password_hash: string
  session_version: number
  created_at: string
}

const MEMBER_COLS = 'id, board_id, name, name_key, email, password_hash, session_version, created_at'

/** Chi chiede: l'admin, oppure una persona della todo list. */
export type Viewer = { admin: true; member: null } | { admin: false; member: MemberRow }
export const ADMIN_VIEWER: Viewer = { admin: true, member: null }

/** Cosa vede l'admin di una persona (mai l'hash della password). */
export const memberView = (m: MemberRow) => ({ id: m.id, name: m.name, email: m.email, createdAt: m.created_at })

/** Lo SQL delle persone c'e'? (altrimenti TodoError con «Esegui lo SQL aggiornato»). */
export async function probePeople(): Promise<void> {
  const { error } = await supabaseAdmin.from('todo_members').select('id').limit(1)
  check(error, 'persone')
  const cols = await supabaseAdmin.from('todo_tasks').select('id, created_by_member, assignee_member, done_notified_at').limit(1)
  check(cols.error, 'colonne persone')
}

export async function listMembers(boardId: string): Promise<MemberRow[]> {
  const { data, error } = await supabaseAdmin.from('todo_members').select(MEMBER_COLS).eq('board_id', boardId).order('created_at', { ascending: true })
  check(error, 'persone')
  return (data || []) as MemberRow[]
}

export async function memberById(boardId: string, id: unknown): Promise<MemberRow | null> {
  if (!isId(id)) return null
  const { data, error } = await supabaseAdmin.from('todo_members').select(MEMBER_COLS).eq('id', id).eq('board_id', boardId).maybeSingle()
  check(error, 'persona')
  return (data as MemberRow) || null
}

/** Persona dal nome scritto nel modulo (senza badare a maiuscole e accenti). */
export async function memberForLogin(boardId: string, name: unknown): Promise<MemberRow | null> {
  const key = nameKey(oneLine(name, LIMITS.memberName))
  if (!key) return null
  const { data, error } = await supabaseAdmin.from('todo_members').select(MEMBER_COLS).eq('board_id', boardId).eq('name_key', key).maybeSingle()
  check(error, 'persona')
  return (data as MemberRow) || null
}

/** Chi e' davvero il cookie: l'admin, o una persona che c'e' ancora con la stessa password. */
export async function viewerFor(board: BoardRow, session: SessionInfo | null): Promise<Viewer | null> {
  if (!session) return null
  if (session.memberId === null) return ADMIN_VIEWER
  const member = await memberById(board.id, session.memberId)
  if (!member || member.session_version !== session.memberVersion) return null
  return { admin: false, member }
}

function cleanEmail(value: unknown): string | null {
  const e = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (e && (e.length > LIMITS.email || !EMAIL_RE.test(e))) throw new TodoError('Indirizzo email non valido.')
  return e || null
}

export async function addMember(board: BoardRow, input: { name?: unknown; email?: unknown; password?: unknown }): Promise<MemberRow> {
  const name = oneLine(input.name, LIMITS.memberName)
  const key = nameKey(name)
  if (!key) throw new TodoError('Scrivi il nome della persona.')
  const email = cleanEmail(input.email)
  const problem = passwordProblem(input.password)
  if (problem) throw new TodoError(problem)
  const members = await listMembers(board.id)
  if (members.length >= LIMITS.membersPerBoard) throw new TodoError(`Al massimo ${LIMITS.membersPerBoard} persone per todo list.`)
  if (members.some((m) => m.name_key === key)) throw new TodoError('C’è già una persona con questo nome in questa todo list.')
  const { data, error } = await supabaseAdmin
    .from('todo_members')
    .insert({ board_id: board.id, name, name_key: key, email, password_hash: await hashPassword(input.password as string), session_version: 1 })
    .select(MEMBER_COLS)
    .single()
  if (error?.code === '23505') throw new TodoError('C’è già una persona con questo nome in questa todo list.')
  check(error, 'nuova persona')
  const member = data as MemberRow
  // Attivita' di prima assegnate a questo nome (testo libero): ora sono sue.
  const { data: old } = await supabaseAdmin.from('todo_tasks').select('id, assignee').eq('board_id', board.id).is('assignee_member', null).not('assignee', 'is', null)
  const ids = ((old || []) as { id: string; assignee: string | null }[]).filter((t) => nameKey(t.assignee || '') === key).map((t) => t.id)
  if (ids.length) await supabaseAdmin.from('todo_tasks').update({ assignee_member: member.id }).eq('board_id', board.id).in('id', ids)
  return member
}

async function memberOf(board: BoardRow, memberId: unknown): Promise<MemberRow> {
  const m = await memberById(board.id, memberId)
  if (!m) throw new TodoError('Persona non trovata.', 404)
  return m
}

/** Password nuova: esce solo questa persona (deve rientrare con la password nuova). */
export async function setMemberPassword(board: BoardRow, memberId: unknown, password: unknown): Promise<MemberRow> {
  const problem = passwordProblem(password)
  if (problem) throw new TodoError(problem)
  const password_hash = await hashPassword(password as string)
  for (let i = 0; i < 3; i++) {
    const m = await memberOf(board, memberId)
    const { data, error } = await supabaseAdmin
      .from('todo_members')
      .update({ password_hash, session_version: m.session_version + 1, updated_at: nowIso() })
      .eq('id', m.id)
      .eq('board_id', board.id)
      .eq('session_version', m.session_version)
      .select(MEMBER_COLS)
    check(error, 'password persona')
    if (data && data.length) {
      await supabaseAdmin.from('todo_login_attempts').delete().eq('board_id', board.id)
      return data[0] as MemberRow
    }
  }
  throw new TodoError('Modifica in corso da un’altra parte: riprova.', 409)
}

export async function setMemberEmail(board: BoardRow, memberId: unknown, email: unknown): Promise<MemberRow> {
  const m = await memberOf(board, memberId)
  const { data, error } = await supabaseAdmin.from('todo_members').update({ email: cleanEmail(email), updated_at: nowIso() }).eq('id', m.id).eq('board_id', board.id).select(MEMBER_COLS)
  check(error, 'email persona')
  return (data as MemberRow[])[0]
}

/**
 * Persona tolta: non entra piu' (il cookie non trova piu' la persona). Le sue attivita'
 * e tabelle restano, visibili solo all'admin (e a chi sono assegnate).
 */
export async function removeMember(board: BoardRow, memberId: unknown): Promise<void> {
  const m = await memberOf(board, memberId)
  const { error } = await supabaseAdmin.from('todo_members').delete().eq('id', m.id).eq('board_id', board.id)
  check(error, 'rimozione persona')
}

// ---------------------------------------------------------------------
// Contenuto della todo list
// ---------------------------------------------------------------------

type StoredImage = { id: string; path: string; name: string }
type TaskRow = {
  id: string
  board_id: string
  list_id: string
  title: string
  notes: string
  done: boolean
  priority: number
  position: number
  deadline: string | null
  assignee: string | null
  assignee_member: string | null
  created_by_member: string | null
  notify_email: string | null
  reminders_per_day: number
  remind_hours_before: number
  links: TodoLinkPreview[]
  images: StoredImage[]
  updated_at: string
}
type ListRow = { id: string; title: string; position: number; created_by_member: string | null }

const TASK_COLS =
  'id, board_id, list_id, title, notes, done, priority, position, deadline, assignee, assignee_member, created_by_member, notify_email, reminders_per_day, remind_hours_before, links, images, updated_at'
const LIST_COLS = 'id, title, position, created_by_member'

const me = (v: Viewer) => (v.admin ? null : v.member.id)
const canSeeTask = (v: Viewer, t: Pick<TaskRow, 'assignee_member' | 'created_by_member'>) => v.admin || taskVisibleTo(t, v.member.id)
const canEditTask = (v: Viewer, t: Pick<TaskRow, 'created_by_member'>) => v.admin || t.created_by_member === v.member.id
/** Tabelle dove si possono creare attivita': quelle dell'admin e le proprie. */
const canAddTo = (v: Viewer, l: Pick<ListRow, 'created_by_member'>) => v.admin || l.created_by_member === null || l.created_by_member === v.member.id
const canManage = (v: Viewer, l: Pick<ListRow, 'created_by_member'>) => v.admin || l.created_by_member === v.member.id

/** Tabelle che vede: dell'admin, sue, e quelle dove c'e' un'attivita' che vede. */
function visibleListIds(v: Viewer, lists: Pick<ListRow, 'id' | 'created_by_member'>[], tasks: Pick<TaskRow, 'list_id' | 'assignee_member' | 'created_by_member'>[]): Set<string> {
  if (v.admin) return new Set(lists.map((l) => l.id))
  const ids = new Set(lists.filter((l) => l.created_by_member === null || l.created_by_member === v.member.id).map((l) => l.id))
  for (const t of tasks) if (canSeeTask(v, t)) ids.add(t.list_id)
  return ids
}

const readOnlyMessage = (t: Pick<TaskRow, 'created_by_member'>) =>
  t.created_by_member === null ? `Creata da ${ADMIN_NAME}: puoi solo spostarla.` : 'Creata da un’altra persona: puoi solo spostarla.'

/** Tutto il contenuto che CHI CHIEDE puo' vedere. imageSrc trasforma il percorso in un indirizzo. */
export async function loadState(board: BoardRow, viewer: Viewer, imageSrc: (path: string) => string): Promise<TodoBoardState> {
  const [lists, tasks, members] = await Promise.all([
    supabaseAdmin.from('todo_lists').select(LIST_COLS).eq('board_id', board.id).order('position', { ascending: true }).order('created_at', { ascending: true }),
    supabaseAdmin.from('todo_tasks').select(TASK_COLS).eq('board_id', board.id).order('position', { ascending: true }).order('created_at', { ascending: true }),
    listMembers(board.id),
  ])
  check(lists.error || tasks.error, 'contenuto todo list')
  const names = new Map(members.map((m) => [m.id, m.name]))
  const nameOf = (id: string | null) => (id === null ? ADMIN_NAME : names.get(id) || 'Persona rimossa')
  const allTasks = (tasks.data || []) as TaskRow[]
  const allLists = (lists.data || []) as ListRow[]
  const shownTasks = allTasks.filter((t) => canSeeTask(viewer, t))
  const listIds = visibleListIds(viewer, allLists, allTasks)
  const shownLists = allLists.filter((l) => listIds.has(l.id))
  // Per le persone le posizioni diventano 1, 2, 3...: dai numeri non si capisce se in mezzo c'e' altro.
  const rank = new Map<string, number>()
  if (!viewer.admin) {
    shownLists.forEach((l, i) => rank.set(l.id, (i + 1) * 1024))
    const perList = new Map<string, number>()
    for (const t of shownTasks) {
      const n = (perList.get(t.list_id) || 0) + 1
      perList.set(t.list_id, n)
      rank.set(t.id, n * 1024)
    }
  }
  const outLists: TodoList[] = shownLists.map((l) => ({
    id: l.id,
    title: l.title,
    position: rank.get(l.id) ?? l.position,
    created_by_member: l.created_by_member,
    owner_name: nameOf(l.created_by_member),
    can_manage: canManage(viewer, l),
    can_add: canAddTo(viewer, l),
  }))
  const outTasks: TodoTask[] = shownTasks.map(({ board_id: _b, images, links, position, ...t }) => ({
    ...t,
    position: rank.get(t.id) ?? position,
    assignee_name: t.assignee_member ? names.get(t.assignee_member) || t.assignee || 'Persona rimossa' : t.assignee,
    creator_name: nameOf(t.created_by_member),
    can_edit: canEditTask(viewer, t),
    can_move: true,
    links: Array.isArray(links) ? links : [],
    images: (Array.isArray(images) ? images : []).map((img) => ({ id: img.id, name: img.name, src: imageSrc(img.path) })),
  }))
  return {
    board: { name: board.name },
    me: viewer.admin ? { id: null, name: ADMIN_NAME, admin: true } : { id: viewer.member.id, name: viewer.member.name, admin: false },
    members: members.map((m) => ({ id: m.id, name: m.name })),
    lists: outLists,
    tasks: outTasks,
  }
}

async function renumber(table: 'todo_lists' | 'todo_tasks', boardId: string, rows: { id: string }[]) {
  await Promise.all(rows.map((r, i) => supabaseAdmin.from(table).update({ position: (i + 1) * 1024 }).eq('id', r.id).eq('board_id', boardId)))
}

/**
 * Tabella per un'operazione. Le tabelle di altre persone, per chi non le possiede, non esistono.
 * need 'add': ci si possono creare attivita'; 'manage': rinominare, spostare, ordinare, eliminare.
 */
async function listOf(boardId: string, viewer: Viewer, listId: unknown, need: 'add' | 'manage' | 'any' = 'add'): Promise<ListRow> {
  if (!isId(listId)) throw new TodoError('Tabella non trovata.', 404)
  const { data, error } = await supabaseAdmin.from('todo_lists').select(LIST_COLS).eq('id', listId).eq('board_id', boardId).maybeSingle()
  check(error, 'tabella')
  const list = data as ListRow | null
  if (!list) throw new TodoError('Tabella non trovata: forse l’ha cancellata qualcun altro.', 404)
  if (need === 'any') return list
  if (!canAddTo(viewer, list)) throw new TodoError('Tabella non trovata.', 404)
  if (need === 'manage' && !canManage(viewer, list)) throw new TodoError(`Questa tabella è di ${ADMIN_NAME}: non puoi modificarla.`, 403)
  return list
}

/**
 * Attivita' per un'operazione. Se chi chiede non la vede: "non trovata" (come se non ci fosse).
 * need 'move': spostare o segnare fatta (chi la vede); 'edit': tutto il resto (chi l'ha creata e l'admin).
 */
async function taskOf(boardId: string, viewer: Viewer, taskId: unknown, need: 'see' | 'move' | 'edit'): Promise<TaskRow> {
  if (!isId(taskId)) throw new TodoError('Attività non trovata.', 404)
  const { data, error } = await supabaseAdmin.from('todo_tasks').select(TASK_COLS).eq('id', taskId).eq('board_id', boardId).maybeSingle()
  check(error, 'attività')
  const task = data as TaskRow | null
  if (!task || !canSeeTask(viewer, task)) throw new TodoError('Attività non trovata: forse l’ha cancellata qualcun altro.', 404)
  if (need === 'edit' && !canEditTask(viewer, task)) throw new TodoError(readOnlyMessage(task), 403)
  return task
}

type Sibling = { id: string; position: number; created_by_member: string | null; assignee_member?: string | null; list_id?: string }

async function siblings(table: 'todo_lists' | 'todo_tasks', boardId: string, listId: string | null, excludeId: string | null): Promise<Sibling[]> {
  let q = supabaseAdmin.from(table).select(table === 'todo_tasks' ? 'id, position, created_by_member, assignee_member, list_id' : 'id, position, created_by_member').eq('board_id', boardId)
  if (listId) q = q.eq('list_id', listId)
  const { data, error } = await q.order('position', { ascending: true }).order('created_at', { ascending: true })
  check(error, 'ordine')
  return ((data || []) as unknown as Sibling[]).filter((r) => r.id !== excludeId)
}

/**
 * Posizione per mettere un elemento all'indice `index` tra quelli che chi chiede VEDE.
 * Se lo spazio e' finito si rinumerano tutti (l'ordine resta uguale per tutti).
 */
async function placeAt(table: 'todo_lists' | 'todo_tasks', boardId: string, listId: string | null, id: string, index: number, shown: (row: Sibling) => boolean = () => true): Promise<number> {
  let all = await siblings(table, boardId, listId, id)
  let pos = positionAt(all.filter(shown).map((o) => o.position), index)
  if (pos === null) {
    await renumber(table, boardId, all)
    all = all.map((o, i) => ({ ...o, position: (i + 1) * 1024 }))
    pos = positionAt(all.filter(shown).map((o) => o.position), index) as number
  }
  return pos
}

async function countRows(table: 'todo_lists' | 'todo_tasks', boardId: string) {
  const { count, error } = await supabaseAdmin.from(table).select('id', { count: 'exact', head: true }).eq('board_id', boardId)
  check(error, 'conteggio')
  return count || 0
}

const lastPosition = async (table: 'todo_lists' | 'todo_tasks', boardId: string, listId: string | null) => {
  const rows = await siblings(table, boardId, listId, null)
  return rows.length ? rows[rows.length - 1].position + 1024 : 1024
}

export async function addList(board: BoardRow, viewer: Viewer, title: unknown) {
  const t = oneLine(title, LIMITS.listTitle)
  if (!t) throw new TodoError('Dai un nome alla tabella.')
  if ((await countRows('todo_lists', board.id)) >= LIMITS.listsPerBoard) throw new TodoError(`Al massimo ${LIMITS.listsPerBoard} tabelle per todo list.`)
  const position = await lastPosition('todo_lists', board.id, null)
  const { data, error } = await supabaseAdmin.from('todo_lists').insert({ board_id: board.id, title: t, position, created_by_member: me(viewer) }).select('id, title, position').single()
  check(error, 'nuova tabella')
  return data
}

export async function renameList(board: BoardRow, viewer: Viewer, listId: unknown, title: unknown) {
  const t = oneLine(title, LIMITS.listTitle)
  if (!t) throw new TodoError('Dai un nome alla tabella.')
  await listOf(board.id, viewer, listId, 'manage')
  const { error } = await supabaseAdmin.from('todo_lists').update({ title: t, updated_at: nowIso() }).eq('id', listId as string).eq('board_id', board.id)
  check(error, 'nome tabella')
}

export async function moveList(board: BoardRow, viewer: Viewer, listId: unknown, index: unknown) {
  await listOf(board.id, viewer, listId, 'manage')
  let shown: (row: Sibling) => boolean = () => true
  if (!viewer.admin) {
    // L'indice arriva dalla pagina della persona: conta solo le tabelle che vede.
    const [lists, tasks] = await Promise.all([siblings('todo_lists', board.id, null, null), siblings('todo_tasks', board.id, null, null)])
    const ids = visibleListIds(viewer, lists, tasks as Required<Sibling>[])
    shown = (row) => ids.has(row.id)
  }
  const position = await placeAt('todo_lists', board.id, null, listId as string, Number(index) || 0, shown)
  const { error } = await supabaseAdmin.from('todo_lists').update({ position, updated_at: nowIso() }).eq('id', listId as string).eq('board_id', board.id)
  check(error, 'spostamento tabella')
}

export async function deleteList(board: BoardRow, viewer: Viewer, listId: unknown) {
  await listOf(board.id, viewer, listId, 'manage')
  const { data } = await supabaseAdmin.from('todo_tasks').select('id, images, created_by_member').eq('board_id', board.id).eq('list_id', listId as string)
  let rows = (data || []) as { id: string; images: unknown; created_by_member: string | null }[]
  if (!viewer.admin) {
    // Una persona elimina la sua tabella: le sue attivita' se ne vanno, quelle degli altri
    // (messe li' dall'admin) finiscono in fondo alla prima tabella dell'admin.
    const others = rows.filter((r) => r.created_by_member !== viewer.member.id)
    if (others.length) {
      const target = (await siblings('todo_lists', board.id, null, null)).find((l) => l.created_by_member === null)
      if (!target) throw new TodoError('Non puoi eliminare questa tabella adesso.', 409)
      let position = await lastPosition('todo_tasks', board.id, target.id)
      for (const o of others) {
        const { error } = await supabaseAdmin.from('todo_tasks').update({ list_id: target.id, position, updated_at: nowIso() }).eq('id', o.id).eq('board_id', board.id)
        check(error, 'spostamento attività')
        position += 1024
      }
      rows = rows.filter((r) => r.created_by_member === viewer.member.id)
    }
  }
  const { error } = await supabaseAdmin.from('todo_lists').delete().eq('id', listId as string).eq('board_id', board.id)
  check(error, 'eliminazione tabella')
  await removeObjects(pathsOf(rows))
}

/** Ordina una tabella per importanza (prima le urgenti, le fatte in fondo). */
export async function sortListByPriority(board: BoardRow, viewer: Viewer, listId: unknown) {
  await listOf(board.id, viewer, listId, 'manage')
  const { data, error } = await supabaseAdmin
    .from('todo_tasks')
    .select('id, priority, done, position')
    .eq('board_id', board.id)
    .eq('list_id', listId as string)
    .order('position', { ascending: true })
  check(error, 'ordine per importanza')
  const rows = ((data || []) as { id: string; priority: number; done: boolean; position: number }[])
    .map((r, i) => ({ ...r, i }))
    .sort((a, b) => Number(a.done) - Number(b.done) || b.priority - a.priority || a.i - b.i)
  await renumber('todo_tasks', board.id, rows)
}

/** Controlla e ripulisce i campi mandati dalla pagina (solo quelli presenti cambiano). */
export function cleanTaskFields(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object') throw new TodoError('Dati non validi.')
  const f = input as Record<string, unknown>
  const out: Record<string, unknown> = {}
  if ('title' in f) {
    const t = oneLine(f.title, LIMITS.taskTitle)
    if (!t) throw new TodoError('Scrivi il titolo dell’attività.')
    out.title = t
  }
  if ('notes' in f) {
    if (typeof f.notes !== 'string') throw new TodoError('Note non valide.')
    out.notes = f.notes.replace(/\r\n/g, '\n').slice(0, LIMITS.notes)
  }
  if ('done' in f) {
    if (typeof f.done !== 'boolean') throw new TodoError('Valore non valido.')
    out.done = f.done
    out.done_at = f.done ? nowIso() : null
  }
  if ('priority' in f) {
    const p = Number(f.priority)
    if (!Number.isInteger(p) || p < 0 || p > 4) throw new TodoError('Importanza non valida.')
    out.priority = p
  }
  if ('deadline' in f) {
    if (f.deadline === null || f.deadline === '') out.deadline = null
    else {
      const ms = typeof f.deadline === 'string' ? Date.parse(f.deadline) : NaN
      if (!Number.isFinite(ms) || ms < Date.UTC(2000, 0, 1) || ms > Date.UTC(2100, 0, 1)) throw new TodoError('Scadenza non valida.')
      out.deadline = new Date(ms).toISOString()
    }
  }
  // A chi e' assegnata: una persona della todo list (o nessuno). Il vecchio testo libero non si scrive piu'.
  if ('assignee_member' in f) {
    if (f.assignee_member === null || f.assignee_member === '') out.assignee_member = null
    else if (isId(f.assignee_member)) out.assignee_member = f.assignee_member.toLowerCase()
    else throw new TodoError('Persona non trovata.')
  }
  if ('notify_email' in f) out.notify_email = cleanEmail(f.notify_email)
  if ('reminders_per_day' in f) {
    const n = Number(f.reminders_per_day)
    if (!Number.isInteger(n) || n < 1 || n > 6) throw new TodoError('I solleciti al giorno vanno da 1 a 6.')
    out.reminders_per_day = n
  }
  if ('remind_hours_before' in f) {
    const h = Number(f.remind_hours_before)
    if (!Number.isInteger(h) || h < 1 || h > 168) throw new TodoError('L’inizio dei solleciti va da 1 ora a 7 giorni prima.')
    out.remind_hours_before = h
  }
  return out
}

/** La persona assegnata deve essere di questa todo list; il suo nome resta anche nel vecchio campo. */
async function resolveAssignee(boardId: string, clean: Record<string, unknown>) {
  if (!('assignee_member' in clean)) return
  if (clean.assignee_member === null) {
    clean.assignee = null
    return
  }
  const m = await memberById(boardId, clean.assignee_member)
  if (!m) throw new TodoError('Persona non trovata.', 400)
  clean.assignee_member = m.id
  clean.assignee = m.name
}

export async function addTask(board: BoardRow, viewer: Viewer, listId: unknown, fields: unknown) {
  await listOf(board.id, viewer, listId, 'add')
  const clean = cleanTaskFields(fields)
  if (!clean.title) throw new TodoError('Scrivi il titolo dell’attività.')
  await resolveAssignee(board.id, clean)
  if ((await countRows('todo_tasks', board.id)) >= LIMITS.tasksPerBoard) throw new TodoError(`Al massimo ${LIMITS.tasksPerBoard} attività per todo list.`)
  const position = await lastPosition('todo_tasks', board.id, listId as string)
  const { data, error } = await supabaseAdmin
    .from('todo_tasks')
    .insert({ ...clean, board_id: board.id, list_id: listId, position, created_by_member: me(viewer) })
    .select('id, title, notes')
    .single()
  check(error, 'nuova attività')
  const row = data as { id: string; title: string; notes: string }
  return { id: row.id, linksChanged: extractLinks(`${row.title}\n${row.notes || ''}`).length > 0 }
}

/**
 * Modifica campo per campo. Chi vede un'attivita' non sua puo' solo segnarla fatta/da fare.
 * completed: e' appena diventata fatta (per l'avviso all'admin).
 */
export async function updateTask(board: BoardRow, viewer: Viewer, taskId: unknown, fields: unknown): Promise<{ linksChanged: boolean; completed: boolean; listId: string }> {
  const clean = cleanTaskFields(fields)
  const before = await taskOf(board.id, viewer, taskId, Object.keys(clean).every((k) => k === 'done' || k === 'done_at') ? 'move' : 'edit')
  if (!Object.keys(clean).length) return { linksChanged: false, completed: false, listId: before.list_id }
  await resolveAssignee(board.id, clean)
  const { error } = await supabaseAdmin
    .from('todo_tasks')
    .update({ ...clean, updated_at: nowIso() })
    .eq('id', before.id)
    .eq('board_id', board.id)
  check(error, 'modifica attività')
  const text = (t: { title: string; notes: string }) => extractLinks(`${t.title}\n${t.notes || ''}`).join(' ')
  const after = { title: (clean.title as string) ?? before.title, notes: (clean.notes as string) ?? before.notes }
  return { linksChanged: text(after) !== text(before), completed: clean.done === true && !before.done, listId: before.list_id }
}

/**
 * Sposta un'attivita' (tabella e ordine). Chi la vede puo' spostarla; nelle tabelle di una
 * persona entrano solo le sue attivita'. Cambiano solo tabella e posizione di questa attivita'.
 */
export async function moveTask(board: BoardRow, viewer: Viewer, taskId: unknown, listId: unknown, index: unknown): Promise<{ fromListId: string; toListId: string }> {
  const task = await taskOf(board.id, viewer, taskId, 'move')
  const list = await listOf(board.id, viewer, listId, list_id_is(task, listId) ? 'any' : 'add')
  if (!viewer.admin && list.id !== task.list_id && list.created_by_member !== null && task.created_by_member !== viewer.member.id) {
    throw new TodoError(`Questa attività si può spostare solo nelle tabelle di ${ADMIN_NAME}.`, 403)
  }
  const shown = viewer.admin ? undefined : (row: Sibling) => taskVisibleTo({ assignee_member: row.assignee_member ?? null, created_by_member: row.created_by_member }, viewer.member.id)
  const position = await placeAt('todo_tasks', board.id, list.id, task.id, Number(index) || 0, shown)
  const { error } = await supabaseAdmin
    .from('todo_tasks')
    .update({ list_id: list.id, position, updated_at: nowIso() })
    .eq('id', task.id)
    .eq('board_id', board.id)
  check(error, 'spostamento attività')
  return { fromListId: task.list_id, toListId: list.id }
}

const list_id_is = (task: TaskRow, listId: unknown) => typeof listId === 'string' && listId.toLowerCase() === task.list_id

export async function deleteTask(board: BoardRow, viewer: Viewer, taskId: unknown) {
  const task = await taskOf(board.id, viewer, taskId, 'edit')
  const { error } = await supabaseAdmin.from('todo_tasks').delete().eq('id', task.id).eq('board_id', board.id)
  check(error, 'eliminazione attività')
  await removeObjects(pathsOf([task]))
}

// ---------------------------------------------------------------------
// Avviso all'admin quando una persona finisce un'attivita'
// ---------------------------------------------------------------------

/** Spostata avanti e indietro in pochi minuti: un solo avviso. */
export const DONE_NOTICE_WINDOW_MS = 2 * 60_000

/**
 * Prenota l'avviso "fatta" per questa attivita' (una volta sola anche con richieste insieme).
 * false: avviso gia' mandato da meno di 2 minuti (o SQL non aggiornato).
 */
export async function claimDoneNotice(boardId: string, taskId: string, at = Date.now()): Promise<boolean> {
  const now = new Date(at).toISOString()
  const first = await supabaseAdmin.from('todo_tasks').update({ done_notified_at: now }).eq('id', taskId).eq('board_id', boardId).is('done_notified_at', null).select('id')
  if (first.error) return false
  if (first.data && first.data.length) return true
  const again = await supabaseAdmin
    .from('todo_tasks')
    .update({ done_notified_at: now })
    .eq('id', taskId)
    .eq('board_id', boardId)
    .lt('done_notified_at', new Date(at - DONE_NOTICE_WINDOW_MS).toISOString())
    .select('id')
  return !again.error && Boolean(again.data && again.data.length)
}

// ---------------------------------------------------------------------
// Anteprime dei link
// ---------------------------------------------------------------------

/**
 * Aggiorna le anteprime dei link di un'attivita' (si chiama dopo la risposta).
 * Le anteprime gia' scaricate si riusano; se nel frattempo il testo e' cambiato
 * non si scrive niente (ci pensa il giro partito da quella modifica).
 */
export async function refreshLinks(boardId: string, taskId: string, fetcher: (url: string) => Promise<TodoLinkPreview> = fetchLinkPreview) {
  const read = async () => {
    const { data } = await supabaseAdmin.from('todo_tasks').select('title, notes, links').eq('id', taskId).eq('board_id', boardId).maybeSingle()
    return data as { title: string; notes: string; links: TodoLinkPreview[] } | null
  }
  const task = await read()
  if (!task) return
  const urls = extractLinks(`${task.title}\n${task.notes || ''}`)
  const known = new Map((Array.isArray(task.links) ? task.links : []).map((l) => [l.url, l]))
  const fresh = await Promise.all(urls.map(async (url) => known.get(url) || (await fetcher(url).catch(() => ({ url })))))
  if (JSON.stringify(fresh) === JSON.stringify(task.links || [])) return
  const now = await read()
  if (!now || extractLinks(`${now.title}\n${now.notes || ''}`).join(' ') !== urls.join(' ')) return
  await supabaseAdmin.from('todo_tasks').update({ links: fresh }).eq('id', taskId).eq('board_id', boardId)
}

// ---------------------------------------------------------------------
// Foto (caricate dal browser direttamente nello spazio privato, con un link a tempo)
// ---------------------------------------------------------------------

let bucketReady = false
async function ensureBucket() {
  if (bucketReady) return
  // La prima volta si crea lo spazio privato (se c'e' gia', l'errore si ignora).
  await supabaseAdmin.storage
    .createBucket(BUCKET, { public: false, fileSizeLimit: LIMITS.imageBytes, allowedMimeTypes: Object.keys(IMAGE_TYPES) })
    .catch(() => undefined)
  bucketReady = true
}

function pathsOf(rows: { images: unknown }[]): string[] {
  return rows.flatMap((r) => (Array.isArray(r.images) ? (r.images as StoredImage[]) : []).map((i) => i?.path).filter((p): p is string => typeof p === 'string'))
}

async function removeObjects(paths: string[]) {
  for (let i = 0; i < paths.length; i += 100) {
    await supabaseAdmin.storage.from(BUCKET).remove(paths.slice(i, i + 100)).catch(() => undefined)
  }
}

export async function imageUploadUrl(board: BoardRow, viewer: Viewer, taskId: unknown, contentType: unknown, size: unknown) {
  const task = await taskOf(board.id, viewer, taskId, 'edit')
  const ext = typeof contentType === 'string' ? IMAGE_TYPES[contentType] : undefined
  if (!ext) throw new TodoError('Si possono caricare solo immagini JPG, PNG, WEBP o GIF.')
  const bytes = Number(size)
  if (!Number.isFinite(bytes) || bytes <= 0) throw new TodoError('File vuoto.')
  if (bytes > LIMITS.imageBytes) throw new TodoError('Immagine troppo grande (massimo 10 MB).')
  if ((task.images || []).length >= LIMITS.imagesPerTask) throw new TodoError(`Al massimo ${LIMITS.imagesPerTask} immagini per attività.`)
  await ensureBucket()
  const path = `${board.id}/${task.id}/${randomUUID()}.${ext}`
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).createSignedUploadUrl(path)
  if (error || !data?.signedUrl) {
    console.error('todo: link di caricamento non creato:', error?.message?.slice(0, 160))
    throw new TodoError('Caricamento non disponibile in questo momento.', 500)
  }
  return { signedUrl: data.signedUrl, path }
}

export async function addImage(board: BoardRow, viewer: Viewer, taskId: unknown, path: unknown, name: unknown) {
  const task = await taskOf(board.id, viewer, taskId, 'edit')
  const re = new RegExp(`^${board.id}/${task.id}/[0-9a-f-]{36}\\.(jpg|png|webp|gif)$`)
  if (typeof path !== 'string' || !re.test(path)) throw new TodoError('Immagine non valida.')
  const folder = `${board.id}/${task.id}`
  const file = path.slice(folder.length + 1)
  // Il file deve esserci davvero, essere un'immagine e non superare il limite.
  const { data: found } = await supabaseAdmin.storage.from(BUCKET).list(folder, { search: file, limit: 5 })
  const item = (found || []).find((f) => f.name === file) as { name: string; metadata?: { size?: number; mimetype?: string } } | undefined
  const size = Number(item?.metadata?.size)
  const mime = item?.metadata?.mimetype || ''
  if (!item || !Number.isFinite(size) || size > LIMITS.imageBytes || !IMAGE_TYPES[mime]) {
    if (item) await removeObjects([path])
    throw new TodoError('Caricamento non riuscito: riprova con un’immagine JPG, PNG, WEBP o GIF fino a 10 MB.')
  }
  const image: StoredImage = { id: randomUUID(), path, name: oneLine(name, 120) || 'immagine' }
  const { data, error } = await supabaseAdmin.rpc('todo_task_add_image', { p_task: task.id, p_board: board.id, p_image: image })
  check(error, 'aggiunta immagine')
  if (data !== true) {
    await removeObjects([path])
    throw new TodoError(`Al massimo ${LIMITS.imagesPerTask} immagini per attività.`)
  }
  return { id: image.id }
}

export async function removeImage(board: BoardRow, viewer: Viewer, taskId: unknown, imageId: unknown) {
  const task = await taskOf(board.id, viewer, taskId, 'edit')
  if (!isId(imageId)) throw new TodoError('Immagine non trovata.', 404)
  const { data, error } = await supabaseAdmin.rpc('todo_task_remove_image', { p_task: task.id, p_board: board.id, p_image_id: imageId })
  check(error, 'rimozione immagine')
  const removed = data as StoredImage | null
  if (removed?.path) await removeObjects([removed.path])
}

/** Link a tempo per vedere una foto (null se il percorso non e' di un'attivita' che chi chiede vede). */
export async function imageViewUrl(board: BoardRow, viewer: Viewer, path: string): Promise<string | null> {
  if (typeof path !== 'string' || !new RegExp(`^${board.id}/[0-9a-f-]{36}/[0-9a-f-]{36}\\.(jpg|png|webp|gif)$`).test(path)) return null
  const taskId = path.split('/')[1]
  if (!isId(taskId)) return null
  const { data, error } = await supabaseAdmin.from('todo_tasks').select('id, images, assignee_member, created_by_member').eq('id', taskId).eq('board_id', board.id).maybeSingle()
  check(error, 'foto')
  const task = data as Pick<TaskRow, 'id' | 'images' | 'assignee_member' | 'created_by_member'> | null
  if (!task || !canSeeTask(viewer, task)) return null
  if (!(Array.isArray(task.images) ? task.images : []).some((img) => img?.path === path)) return null
  const { data: signed } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, 3600)
  return signed?.signedUrl || null
}
