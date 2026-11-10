import { supabaseAdmin } from '@/lib/supabase-admin'
import { readSetting, updateSetting } from '@/lib/settings-store'
import { isMissingSetup, type BoardRow } from '@/lib/todo-store'
import { isDoneListTitle, nameKey, romeDay, romeParts, romeToUtc, type TodoBellData, type TodoBellItem, type TodoBellKind } from '@/lib/todo-shared'

// Campanella: cosa c'e' da fare nei progetti di chi guarda (la persona: solo i suoi;
// l'admin: tutti), dal piu' urgente. Attivita' non fatte: in ritardo, in scadenza oggi,
// in scadenza presto (48 ore o la finestra dei solleciti dell'attivita'), solleciti
// mandati per email negli ultimi 7 giorni e attivita' nuove (non aggiunte da chi
// guarda). «Da leggere»: avvisi diventati attuali dopo l'ultima apertura della
// campanella. Ultima apertura e attivita' aggiunte da ognuno stanno in app_settings.

const HOUR = 3600_000
const DAY = 24 * HOUR
export const SOON_MS = 48 * HOUR
export const REMINDER_DAYS = 7
export const NEW_MS = 3 * DAY
const NEW_MAX_MS = 14 * DAY
export const MAX_ITEMS = 50
const KEY = 'todo_bell'

const RANK: Record<TodoBellKind, number> = { overdue: 0, today: 1, soon: 2, reminder: 3, new: 4 }

export type BellTask = {
  id: string
  board_id: string
  list_id: string
  title: string
  deadline: string | null
  done: boolean
  created_at: string | null
  assignee: string | null
  notify_email: string | null
  remind_hours_before: number | null
}
export type BellReminder = { task_id: string; board_id: string; sent_at: string; email: string | null }
export type BellInput = {
  boards: { id: string; name: string }[]
  lists: { id: string; board_id: string; title: string }[]
  tasks: BellTask[]
  reminders: BellReminder[]
  /** Attivita' aggiunte da chi guarda (non sono «nuove» per lui). */
  own: Set<string>
  seenAt: number | null
  /** La persona (per «Assegnata a te» e per i solleciti mandati a lei); null per l'admin. */
  person: { name: string; email: string | null } | null
  now: number
}

const two = (n: number) => String(n).padStart(2, '0')
const hhmm = (ms: number) => {
  const p = romeParts(ms)
  return `${two(p.hour)}:${two(p.minute)}`
}
const dayStart = (ms: number) => {
  const p = romeParts(ms)
  return romeToUtc(p.year, p.month, p.day, 0, 0)
}
const nextDay = (day: string) => {
  const [y, m, d] = day.split('-').map(Number)
  return romeDay(romeToUtc(y, m, d, 12, 0) + DAY)
}
const shortDate = (ms: number) => new Date(ms).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', weekday: 'short', day: 'numeric', month: 'short' })

/** «In ritardo di 2 giorni», «In ritardo di 3 ore», «In ritardo di 20 minuti». */
export function lateLabel(ms: number): string {
  const min = Math.max(1, Math.floor(ms / 60_000))
  if (min < 60) return `In ritardo di ${min} ${min === 1 ? 'minuto' : 'minuti'}`
  const h = Math.floor(min / 60)
  if (h < 24) return `In ritardo di ${h} ${h === 1 ? 'ora' : 'ore'}`
  const d = Math.floor(h / 24)
  return `In ritardo di ${d} ${d === 1 ? 'giorno' : 'giorni'}`
}

/** «Scade oggi alle 18:00», «Scade domani alle 10:00», «Scade gio 12 nov alle 9:30». */
export function dueLabel(deadline: number, now: number): string {
  const day = romeDay(deadline)
  const today = romeDay(now)
  if (day === today) return `Scade oggi alle ${hhmm(deadline)}`
  if (day === nextDay(today)) return `Scade domani alle ${hhmm(deadline)}`
  return `Scade ${shortDate(deadline)} alle ${hhmm(deadline)}`
}

function sentLabel(sent: number, now: number): string {
  const day = romeDay(sent)
  const today = romeDay(now)
  if (day === today) return `Sollecito inviato oggi alle ${hhmm(sent)}`
  if (nextDay(day) === today) return `Sollecito inviato ieri alle ${hhmm(sent)}`
  return `Sollecito inviato ${shortDate(sent)}`
}

const time = (iso: string | null | undefined) => {
  const ms = iso ? Date.parse(iso) : NaN
  return Number.isFinite(ms) ? ms : null
}

/** Gli avvisi (al massimo 50, dal piu' urgente) e quanti sono da leggere. */
export function computeBell(input: BellInput): TodoBellData {
  const { now, seenAt, person } = input
  const boardName = new Map(input.boards.map((b) => [b.id, b.name]))
  const doneLists = new Set(input.lists.filter((l) => boardName.has(l.board_id) && isDoneListTitle(l.title)).map((l) => l.id))
  const email = person?.email ? person.email.toLowerCase() : null
  const myName = person ? nameKey(person.name) : ''

  // Ultimo sollecito per attivita' (per la persona: solo quelli mandati alla sua email).
  const lastSent = new Map<string, number>()
  for (const r of input.reminders) {
    if (!boardName.has(r.board_id)) continue
    if (person && (!email || (r.email || '').trim().toLowerCase() !== email)) continue
    const t = time(r.sent_at)
    if (t === null || t > now || t < now - REMINDER_DAYS * DAY) continue
    if (t > (lastSent.get(r.task_id) ?? 0)) lastSent.set(r.task_id, t)
  }

  const newSince = Math.min(now - NEW_MS, seenAt !== null ? Math.max(seenAt, now - NEW_MAX_MS) : now - NEW_MS)
  const items: (TodoBellItem & { rank: number; due: number | null })[] = []
  for (const t of input.tasks) {
    const name = boardName.get(t.board_id)
    if (name === undefined || t.done || doneLists.has(t.list_id)) continue
    const due = time(t.deadline)
    const created = time(t.created_at)
    // Aggiunta da altri dopo l'ultima apertura: l'avviso e' da leggere anche se la scadenza e' di prima.
    const fresh = created !== null && !input.own.has(t.id) ? created : 0
    const sent = lastSent.get(t.id) ?? null
    const window = Math.max(SOON_MS, Math.min(168, Math.max(1, t.remind_hours_before || 24)) * HOUR)
    let kind: TodoBellKind | null = null
    let label = ''
    let at = 0
    if (due !== null && due <= now) {
      kind = 'overdue'
      label = lateLabel(now - due)
      at = Math.max(due, fresh)
    } else if (due !== null && romeDay(due) === romeDay(now)) {
      kind = 'today'
      label = dueLabel(due, now)
      at = Math.max(dayStart(due), fresh)
    } else if (due !== null && due - now <= window) {
      kind = 'soon'
      label = dueLabel(due, now)
      at = Math.max(due - window, fresh)
    }
    if (kind && sent !== null) {
      label += ' · sollecito inviato'
      at = Math.max(at, sent)
    }
    if (!kind && sent !== null) {
      kind = 'reminder'
      label = sentLabel(sent, now)
      at = sent
    }
    const assigned = Boolean(person) && ((myName !== '' && nameKey(t.assignee || '') === myName) || (email !== null && (t.notify_email || '').toLowerCase() === email))
    if (!kind && created !== null && created >= newSince && created <= now && !input.own.has(t.id)) {
      kind = 'new'
      label = assigned ? 'Assegnata a te' : 'Nuova attività'
      at = created
    }
    if (!kind) continue
    at = Math.min(at, now)
    items.push({
      id: `${t.id}:${kind}`,
      taskId: t.id,
      boardId: t.board_id,
      boardName: name,
      title: t.title,
      kind,
      label,
      deadline: t.deadline,
      at: new Date(at).toISOString(),
      unread: seenAt === null || at > seenAt,
      rank: RANK[kind],
      due,
    })
  }
  items.sort((a, b) => a.rank - b.rank || (a.due ?? Infinity) - (b.due ?? Infinity) || Date.parse(b.at) - Date.parse(a.at) || a.title.localeCompare(b.title, 'it'))
  const unread = items.filter((i) => i.unread).length
  return { items: items.slice(0, MAX_ITEMS).map(({ rank: _rank, due: _due, ...item }) => item), unread }
}

// ---------------------------------------------------------------------
// Ultima apertura e attivita' aggiunte da ognuno (app_settings)
// ---------------------------------------------------------------------

type ViewerState = { seen?: string; own?: [string, number][] }
type BellStore = { viewers: Record<string, ViewerState> }

function parse(raw: string | null): BellStore {
  try {
    const v = raw ? JSON.parse(raw) : null
    return { viewers: v && typeof v.viewers === 'object' && v.viewers && !Array.isArray(v.viewers) ? v.viewers : {} }
  } catch {
    return { viewers: {} }
  }
}

/** Chiave di chi guarda: l'id dell'accesso della persona, o «admin». */
export const viewerKey = (v: { kind: 'admin' } | { kind: 'person'; id: string }) => (v.kind === 'admin' ? 'admin' : `p:${v.id}`)

async function viewerState(key: string): Promise<ViewerState> {
  try {
    return parse((await readSetting(KEY)).value).viewers[key] || {}
  } catch {
    return {}
  }
}

/** Campanella aperta: tutto quello che c'e' adesso diventa «letto». */
export async function markBellSeen(key: string, at = Date.now()): Promise<string> {
  const seen = new Date(at).toISOString()
  await updateSetting(KEY, parse, (cur) => ({ viewers: { ...cur.viewers, [key]: { ...(cur.viewers[key] || {}), seen } } }))
  return seen
}

/** Attivita' aggiunta da chi guarda: per lui non e' una «nuova attivita'». */
export async function rememberOwnTask(key: string, taskId: string, at = Date.now()): Promise<void> {
  await updateSetting(KEY, parse, (cur) => {
    const prev = cur.viewers[key] || {}
    const own: [string, number][] = (Array.isArray(prev.own) ? prev.own : []).filter((e) => Array.isArray(e) && e[1] > at - NEW_MAX_MS).slice(-299)
    own.push([taskId, at])
    return { viewers: { ...cur.viewers, [key]: { ...prev, own } } }
  })
}

/** Accesso eliminato: via anche il suo stato della campanella. */
export async function forgetBellViewer(key: string): Promise<void> {
  await updateSetting(KEY, parse, (cur) => {
    if (!cur.viewers[key]) return false
    const viewers = { ...cur.viewers }
    delete viewers[key]
    return { viewers }
  }).catch(() => undefined)
}

type DbError = { code?: string; message?: string } | null

async function pages<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: DbError }>, max = 20_000): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await page(from, from + 999)
    if (error) {
      if (isMissingSetup(error)) return out
      throw new Error(`campanella: ${(error.message || '').slice(0, 160)}`)
    }
    const rows = (data || []) as T[]
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

/**
 * Avvisi SOLO dei progetti dati (gia' verificati da chi chiama: per la persona quelli
 * del suo accesso, per l'admin tutti). Ogni lettura filtra per quei progetti.
 */
export async function bellFor(boards: Pick<BoardRow, 'id' | 'name'>[], viewer: { key: string; person: { name: string; email: string | null } | null }, now = Date.now()): Promise<TodoBellData> {
  if (!boards.length) return { items: [], unread: 0 }
  const ids = boards.map((b) => b.id)
  const since = new Date(now - REMINDER_DAYS * DAY).toISOString()
  const [lists, tasks, reminders, state] = await Promise.all([
    pages<BellInput['lists'][number]>((from, to) => supabaseAdmin.from('todo_lists').select('id, board_id, title').in('board_id', ids).order('id', { ascending: true }).range(from, to)),
    pages<BellTask>((from, to) =>
      supabaseAdmin
        .from('todo_tasks')
        .select('id, board_id, list_id, title, deadline, done, created_at, assignee, notify_email, remind_hours_before')
        .in('board_id', ids)
        .eq('done', false)
        .order('id', { ascending: true })
        .range(from, to)
    ),
    pages<BellReminder>((from, to) => supabaseAdmin.from('todo_reminders_sent').select('task_id, board_id, sent_at, email').in('board_id', ids).gte('sent_at', since).order('sent_at', { ascending: false }).range(from, to), 5000),
    viewerState(viewer.key),
  ])
  const allowed = new Set(ids)
  const seen = state.seen ? Date.parse(state.seen) : NaN
  return computeBell({
    boards: boards.map((b) => ({ id: b.id, name: b.name })),
    lists: lists.filter((l) => allowed.has(l.board_id)),
    tasks: tasks.filter((t) => allowed.has(t.board_id)),
    reminders: reminders.filter((r) => allowed.has(r.board_id)),
    own: new Set((Array.isArray(state.own) ? state.own : []).map((e) => e[0])),
    seenAt: Number.isFinite(seen) ? seen : null,
    person: viewer.person,
    now,
  })
}
