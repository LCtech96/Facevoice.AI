import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { SITE_URL } from '@/lib/seo/site'
import { hashPassword, newToken, openToken, passwordProblem, sealToken, tokenHashOf, TOKEN_RE } from '@/lib/todo-auth'
import { fetchLinkPreview } from '@/lib/todo-preview'
import { updateSetting } from '@/lib/settings-store'
import { EMAIL_RE, IMAGE_TYPES, LIMITS, extractLinks, isDoneListTitle, positionAt, type TodoBoardState, type TodoCalendarTask, type TodoHomeBoard, type TodoHomeData, type TodoLinkPreview, type TodoTask } from '@/lib/todo-shared'

// Dati delle todo list condivise. Ogni funzione che tocca liste, attivita' o foto
// riceve la todo list gia' verificata (dal link + cookie, o dall'admin) e filtra
// SEMPRE per il suo id: da una todo list non si raggiunge mai un'altra, ne' altri
// dati del sito. Solo il server (service role) legge e scrive queste tabelle.

export class TodoError extends Error {
  constructor(message: string, public status = 400, public setup = false) {
    super(message)
  }
}

export const SETUP_MESSAGE = 'Esegui prima lo SQL della todo list.'
export const BUCKET = 'todo-images'

type DbError = { code?: string; message?: string } | null | undefined

export function isMissingSetup(error: DbError): boolean {
  if (!error) return false
  const code = error.code || ''
  const msg = error.message || ''
  if (['42P01', 'PGRST205', 'PGRST202', '42883'].includes(code)) return true
  return /todo_(boards|lists|tasks|reminders_sent|login_attempts|task_add_image|task_remove_image)/.test(msg) && /does not exist|schema cache|could not find/i.test(msg)
}

function check(error: DbError, what: string) {
  if (!error) return
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

export async function createBoard(name: unknown, password: unknown, by: string | null): Promise<{ board: BoardRow; token: string }> {
  const title = oneLine(name, LIMITS.boardName)
  if (!title) throw new TodoError('Dai un nome alla todo list.')
  const problem = passwordProblem(password)
  if (problem) throw new TodoError(problem)
  const token = newToken()
  const row = {
    name: title,
    token_hash: tokenHashOf(token),
    token_enc: sealToken(token),
    password_hash: await hashPassword(password as string),
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

/** Password nuova: chi era dentro con la vecchia deve rimetterla. */
export async function changePassword(id: string, password: unknown): Promise<BoardRow> {
  const problem = passwordProblem(password)
  if (problem) throw new TodoError(problem)
  const password_hash = await hashPassword(password as string)
  const board = await bumpBoard(id, () => ({ password_hash }))
  await supabaseAdmin.from('todo_login_attempts').delete().eq('board_id', id)
  return board
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
// Contenuto della todo list
// ---------------------------------------------------------------------

type StoredImage = { id: string; path: string; name: string }
type TaskRow = Omit<TodoTask, 'images'> & { board_id: string; images: StoredImage[] }

const TASK_COLS =
  'id, board_id, list_id, title, notes, done, priority, position, deadline, assignee, notify_email, reminders_per_day, remind_hours_before, links, images, updated_at'

/** Tutto il contenuto: tabelle e attivita' in ordine. imageSrc trasforma il percorso in un indirizzo. */
export async function loadState(board: BoardRow, imageSrc: (path: string) => string): Promise<TodoBoardState> {
  const [lists, tasks] = await Promise.all([
    supabaseAdmin.from('todo_lists').select('id, title, position').eq('board_id', board.id).order('position', { ascending: true }).order('created_at', { ascending: true }),
    supabaseAdmin.from('todo_tasks').select(TASK_COLS).eq('board_id', board.id).order('position', { ascending: true }).order('created_at', { ascending: true }),
  ])
  check(lists.error || tasks.error, 'contenuto todo list')
  return {
    board: { name: board.name },
    lists: ((lists.data || []) as TodoBoardState['lists']).map(({ id, title, position }) => ({ id, title, position })),
    tasks: ((tasks.data || []) as TaskRow[]).map(({ board_id: _b, images, links, ...t }) => ({
      ...t,
      links: Array.isArray(links) ? links : [],
      images: (Array.isArray(images) ? images : []).map((img) => ({ id: img.id, name: img.name, src: imageSrc(img.path) })),
    })),
  }
}

async function renumber(table: 'todo_lists' | 'todo_tasks', boardId: string, rows: { id: string }[]) {
  await Promise.all(rows.map((r, i) => supabaseAdmin.from(table).update({ position: (i + 1) * 1024 }).eq('id', r.id).eq('board_id', boardId)))
}

async function listOf(boardId: string, listId: unknown) {
  if (!isId(listId)) throw new TodoError('Tabella non trovata.', 404)
  const { data, error } = await supabaseAdmin.from('todo_lists').select('id, title').eq('id', listId).eq('board_id', boardId).maybeSingle()
  check(error, 'tabella')
  if (!data) throw new TodoError('Tabella non trovata: forse l’ha cancellata qualcun altro.', 404)
  return data as { id: string; title: string }
}

async function taskOf(boardId: string, taskId: unknown): Promise<TaskRow> {
  if (!isId(taskId)) throw new TodoError('Attività non trovata.', 404)
  const { data, error } = await supabaseAdmin.from('todo_tasks').select(TASK_COLS).eq('id', taskId).eq('board_id', boardId).maybeSingle()
  check(error, 'attività')
  if (!data) throw new TodoError('Attività non trovata: forse l’ha cancellata qualcun altro.', 404)
  return data as TaskRow
}

async function siblings(table: 'todo_lists' | 'todo_tasks', boardId: string, listId: string | null, excludeId: string | null) {
  let q = supabaseAdmin.from(table).select('id, position').eq('board_id', boardId)
  if (listId) q = q.eq('list_id', listId)
  const { data, error } = await q.order('position', { ascending: true }).order('created_at', { ascending: true })
  check(error, 'ordine')
  return ((data || []) as { id: string; position: number }[]).filter((r) => r.id !== excludeId)
}

async function placeAt(table: 'todo_lists' | 'todo_tasks', boardId: string, listId: string | null, id: string, index: number): Promise<number> {
  let others = await siblings(table, boardId, listId, id)
  let pos = positionAt(others.map((o) => o.position), index)
  if (pos === null) {
    await renumber(table, boardId, others)
    others = others.map((o, i) => ({ ...o, position: (i + 1) * 1024 }))
    pos = positionAt(others.map((o) => o.position), index) as number
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

export async function addList(board: BoardRow, title: unknown) {
  const t = oneLine(title, LIMITS.listTitle)
  if (!t) throw new TodoError('Dai un nome alla tabella.')
  if ((await countRows('todo_lists', board.id)) >= LIMITS.listsPerBoard) throw new TodoError(`Al massimo ${LIMITS.listsPerBoard} tabelle per todo list.`)
  const position = await lastPosition('todo_lists', board.id, null)
  const { data, error } = await supabaseAdmin.from('todo_lists').insert({ board_id: board.id, title: t, position }).select('id, title, position').single()
  check(error, 'nuova tabella')
  return data
}

export async function renameList(board: BoardRow, listId: unknown, title: unknown) {
  const t = oneLine(title, LIMITS.listTitle)
  if (!t) throw new TodoError('Dai un nome alla tabella.')
  await listOf(board.id, listId)
  const { error } = await supabaseAdmin.from('todo_lists').update({ title: t, updated_at: nowIso() }).eq('id', listId as string).eq('board_id', board.id)
  check(error, 'nome tabella')
}

export async function moveList(board: BoardRow, listId: unknown, index: unknown) {
  await listOf(board.id, listId)
  const position = await placeAt('todo_lists', board.id, null, listId as string, Number(index) || 0)
  const { error } = await supabaseAdmin.from('todo_lists').update({ position, updated_at: nowIso() }).eq('id', listId as string).eq('board_id', board.id)
  check(error, 'spostamento tabella')
}

export async function deleteList(board: BoardRow, listId: unknown) {
  await listOf(board.id, listId)
  const { data } = await supabaseAdmin.from('todo_tasks').select('images').eq('board_id', board.id).eq('list_id', listId as string)
  const { error } = await supabaseAdmin.from('todo_lists').delete().eq('id', listId as string).eq('board_id', board.id)
  check(error, 'eliminazione tabella')
  await removeObjects(pathsOf((data || []) as { images: unknown }[]))
}

/** Ordina una tabella per importanza (prima le urgenti, le fatte in fondo). */
export async function sortListByPriority(board: BoardRow, listId: unknown) {
  await listOf(board.id, listId)
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
  if ('assignee' in f) out.assignee = oneLine(f.assignee, LIMITS.assignee) || null
  if ('notify_email' in f) {
    const e = typeof f.notify_email === 'string' ? f.notify_email.trim().toLowerCase() : ''
    if (e && (e.length > LIMITS.email || !EMAIL_RE.test(e))) throw new TodoError('Indirizzo email non valido.')
    out.notify_email = e || null
  }
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

export async function addTask(board: BoardRow, listId: unknown, fields: unknown) {
  await listOf(board.id, listId)
  const clean = cleanTaskFields(fields)
  if (!clean.title) throw new TodoError('Scrivi il titolo dell’attività.')
  if ((await countRows('todo_tasks', board.id)) >= LIMITS.tasksPerBoard) throw new TodoError(`Al massimo ${LIMITS.tasksPerBoard} attività per todo list.`)
  const position = await lastPosition('todo_tasks', board.id, listId as string)
  const { data, error } = await supabaseAdmin
    .from('todo_tasks')
    .insert({ ...clean, board_id: board.id, list_id: listId, position })
    .select('id, title, notes')
    .single()
  check(error, 'nuova attività')
  const row = data as { id: string; title: string; notes: string }
  return { id: row.id, linksChanged: extractLinks(`${row.title}\n${row.notes || ''}`).length > 0 }
}

export type TaskChange = { linksChanged: boolean; becameDone: boolean; listId: string }

export async function updateTask(board: BoardRow, taskId: unknown, fields: unknown): Promise<TaskChange> {
  const clean = cleanTaskFields(fields)
  if (!Object.keys(clean).length) return { linksChanged: false, becameDone: false, listId: '' }
  const before = await taskOf(board.id, taskId)
  const { error } = await supabaseAdmin
    .from('todo_tasks')
    .update({ ...clean, updated_at: nowIso() })
    .eq('id', taskId as string)
    .eq('board_id', board.id)
  check(error, 'modifica attività')
  const text = (t: { title: string; notes: string }) => extractLinks(`${t.title}\n${t.notes || ''}`).join(' ')
  const after = { title: (clean.title as string) ?? before.title, notes: (clean.notes as string) ?? before.notes }
  return { linksChanged: text(after) !== text(before), becameDone: clean.done === true && !before.done, listId: before.list_id }
}

export type TaskMove = { fromListId: string; toListId: string; intoDoneList: boolean }

export async function moveTask(board: BoardRow, taskId: unknown, listId: unknown, index: unknown): Promise<TaskMove> {
  const task = await taskOf(board.id, taskId)
  const target = await listOf(board.id, listId)
  const position = await placeAt('todo_tasks', board.id, listId as string, taskId as string, Number(index) || 0)
  const { error } = await supabaseAdmin
    .from('todo_tasks')
    .update({ list_id: listId, position, updated_at: nowIso() })
    .eq('id', taskId as string)
    .eq('board_id', board.id)
  check(error, 'spostamento attività')
  let intoDoneList = false
  if (task.list_id !== target.id && isDoneListTitle(target.title)) {
    // Da «Fatto» a «Fatte» non e' una cosa finita adesso.
    const { data: from } = await supabaseAdmin.from('todo_lists').select('title').eq('id', task.list_id).eq('board_id', board.id).maybeSingle()
    intoDoneList = !(from && isDoneListTitle((from as { title: string }).title))
  }
  return { fromListId: task.list_id, toListId: target.id, intoDoneList }
}

export async function deleteTask(board: BoardRow, taskId: unknown) {
  const task = await taskOf(board.id, taskId)
  const { error } = await supabaseAdmin.from('todo_tasks').delete().eq('id', task.id).eq('board_id', board.id)
  check(error, 'eliminazione attività')
  await removeObjects(pathsOf([task]))
}

// ---------------------------------------------------------------------
// Schermata generale: cartelle dei progetti e calendario delle scadenze
// ---------------------------------------------------------------------

/** Tutte le righe, a pagine di 1000 (il database non ne da' di piu' per volta). */
async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: DbError }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < 100_000; from += 1000) {
    const { data, error } = await page(from, from + 999)
    check(error, 'schermata generale')
    const rows = (data || []) as T[]
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

/** Conteggi e scadenze SOLO dei progetti dati (gia' verificati da chi chiama). */
export async function homeData(boards: BoardRow[], at = Date.now()): Promise<TodoHomeData> {
  if (!boards.length) return { boards: [], tasks: [] }
  const ids = boards.map((b) => b.id)
  type ListRow = { id: string; board_id: string; title: string }
  type Row = { id: string; board_id: string; list_id: string; title: string; deadline: string | null; done: boolean; priority: number }
  const [lists, tasks] = await Promise.all([
    allRows<ListRow>((from, to) => supabaseAdmin.from('todo_lists').select('id, board_id, title').in('board_id', ids).order('id', { ascending: true }).range(from, to)),
    allRows<Row>((from, to) => supabaseAdmin.from('todo_tasks').select('id, board_id, list_id, title, deadline, done, priority').in('board_id', ids).order('id', { ascending: true }).range(from, to)),
  ])
  const allowed = new Set(ids)
  const doneLists = new Set(lists.filter((l) => allowed.has(l.board_id) && isDoneListTitle(l.title)).map((l) => l.id))
  const rows = tasks.filter((t) => allowed.has(t.board_id))
  const stats = new Map<string, TodoHomeBoard>(boards.map((b) => [b.id, { id: b.id, name: b.name, todo: 0, late: 0, done: 0, next: null }]))
  const calendar: TodoCalendarTask[] = []
  for (const t of rows) {
    const st = stats.get(t.board_id) as TodoHomeBoard
    const finished = t.done || doneLists.has(t.list_id)
    const due = t.deadline ? Date.parse(t.deadline) : NaN
    if (finished) st.done++
    else {
      st.todo++
      if (Number.isFinite(due) && due < at) st.late++
      if (Number.isFinite(due) && due >= at && (!st.next || due < Date.parse(st.next))) st.next = t.deadline
    }
    if (t.deadline && Number.isFinite(due)) calendar.push({ id: t.id, board_id: t.board_id, title: t.title, deadline: t.deadline, done: finished, priority: t.priority })
  }
  calendar.sort((a, b) => Date.parse(a.deadline) - Date.parse(b.deadline) || a.title.localeCompare(b.title, 'it'))
  return { boards: boards.map((b) => stats.get(b.id) as TodoHomeBoard), tasks: calendar }
}

// ---------------------------------------------------------------------
// Avviso «fatta» all'admin: al massimo uno ogni 2 minuti per attivita'
// ---------------------------------------------------------------------

export const DONE_NOTICE_WINDOW_MS = 2 * 60_000
const DONE_NOTICES_KEY = 'todo_done_notices'

const missingColumn = (error: DbError) => Boolean(error) && (['42703', 'PGRST204'].includes(error?.code || '') || /done_notified_at/.test(error?.message || ''))

/** true se tocca a questa richiesta mandare l'avviso (prenotazione sulla riga, o in app_settings se manca la colonna). */
export async function claimDoneNotice(boardId: string, taskId: string, at = Date.now()): Promise<boolean> {
  const now = new Date(at).toISOString()
  const first = await supabaseAdmin.from('todo_tasks').update({ done_notified_at: now }).eq('id', taskId).eq('board_id', boardId).is('done_notified_at', null).select('id')
  if (!first.error) {
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
  if (!missingColumn(first.error)) return false
  // Colonna non ancora creata: segno in app_settings (solo gli ultimi minuti).
  let mine = false
  const parse = (raw: string | null): Record<string, number> => {
    try {
      const v = raw ? JSON.parse(raw) : {}
      return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
    } catch {
      return {}
    }
  }
  try {
    await updateSetting(DONE_NOTICES_KEY, parse, (cur) => {
      mine = false
      const last = Number(cur[taskId]) || 0
      if (at - last < DONE_NOTICE_WINDOW_MS) return false
      const next: Record<string, number> = {}
      for (const [k, v] of Object.entries(cur)) if (at - Number(v) < DONE_NOTICE_WINDOW_MS) next[k] = Number(v)
      next[taskId] = at
      mine = true
      return next
    })
  } catch {
    return false
  }
  return mine
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

export async function imageUploadUrl(board: BoardRow, taskId: unknown, contentType: unknown, size: unknown) {
  const task = await taskOf(board.id, taskId)
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

export async function addImage(board: BoardRow, taskId: unknown, path: unknown, name: unknown) {
  const task = await taskOf(board.id, taskId)
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

export async function removeImage(board: BoardRow, taskId: unknown, imageId: unknown) {
  const task = await taskOf(board.id, taskId)
  if (!isId(imageId)) throw new TodoError('Immagine non trovata.', 404)
  const { data, error } = await supabaseAdmin.rpc('todo_task_remove_image', { p_task: task.id, p_board: board.id, p_image_id: imageId })
  check(error, 'rimozione immagine')
  const removed = data as StoredImage | null
  if (removed?.path) await removeObjects([removed.path])
}

/** Link a tempo per vedere una foto di questa todo list (null se il percorso non e' suo). */
export async function imageViewUrl(board: BoardRow, path: string): Promise<string | null> {
  if (typeof path !== 'string' || !new RegExp(`^${board.id}/[0-9a-f-]{36}/[0-9a-f-]{36}\\.(jpg|png|webp|gif)$`).test(path)) return null
  const { data } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, 3600)
  return data?.signedUrl || null
}
