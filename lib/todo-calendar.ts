import { supabaseAdmin } from '@/lib/supabase-admin'
import { readSetting, updateSetting } from '@/lib/settings-store'
import { readCalendar, signCalendar, type CalendarSubject } from '@/lib/todo-auth'
import { accessById, type AccessRow } from '@/lib/todo-access'
import { isMissingSetup, listBoards, todoOrigin, type BoardRow } from '@/lib/todo-store'
import { isDoneListTitle, portalPath, priorityLabel } from '@/lib/todo-shared'

// Calendario della todo list da aggiungere all'iPhone (o a Google Calendar, Outlook):
// un link segreto che il calendario rilegge da solo. Dentro ci sono le attivita' con
// una scadenza dei progetti di chi lo apre (l'admin: tutti; la persona: solo i suoi,
// controllati a ogni lettura). Solo lettura: dal calendario non si cambia niente.

const ADMIN_KEY = 'todo_calendar_admin'
/** Scadenze piu' vecchie di cosi' non si mandano (il calendario resta leggero). */
const PAST_DAYS = 120
const EVENT_MINUTES = 30
const MAX_TASKS = 5000

type AdminState = { seq: number }
const parseAdmin = (raw: string | null): AdminState => {
  try {
    const v = raw ? JSON.parse(raw) : null
    return { seq: Number.isInteger(v?.seq) && v.seq > 0 ? v.seq : 1 }
  } catch {
    return { seq: 1 }
  }
}

async function adminSeq(): Promise<number> {
  return parseAdmin((await readSetting(ADMIN_KEY)).value).seq
}

/** File del calendario: /api/todo/calendar/<link>.ics */
const feedPath = (token: string) => `/api/todo/calendar/${token}.ics`

export type CalendarLink = { url: string; webcal: string }

function linkFor(token: string | null, requestOrigin?: string | null): CalendarLink | null {
  if (!token) return null
  const url = `${todoOrigin(requestOrigin)}${feedPath(token)}`
  return { url, webcal: url.replace(/^https?:\/\//, 'webcal://') }
}

/** Link del calendario della persona (cambia se l'admin le cambia la password). */
export function personCalendarLink(access: Pick<AccessRow, 'id' | 'session_version'>, requestOrigin?: string | null): CalendarLink | null {
  return linkFor(signCalendar({ kind: 'person', id: access.id, version: access.session_version }), requestOrigin)
}

/** Link del calendario dell'admin (tutti i progetti). */
export async function adminCalendarLink(requestOrigin?: string | null): Promise<CalendarLink | null> {
  return linkFor(signCalendar({ kind: 'admin', seq: await adminSeq() }), requestOrigin)
}

/** «Nuovo link»: quello di prima smette di funzionare. */
export async function rotateAdminCalendar(requestOrigin?: string | null): Promise<CalendarLink | null> {
  const next = await updateSetting(ADMIN_KEY, parseAdmin, (cur) => ({ seq: cur.seq + 1 }))
  return linkFor(signCalendar({ kind: 'admin', seq: next.seq }), requestOrigin)
}

// ---------------------------------------------------------------------
// Il file .ics (RFC 5545)
// ---------------------------------------------------------------------

type CalTask = {
  id: string
  board_id: string
  list_id: string
  title: string
  notes: string | null
  deadline: string
  done: boolean
  priority: number
  assignee: string | null
  updated_at: string | null
}

/** Testo sicuro per il calendario: \ ; , e a capo vanno scritti in un modo speciale. */
const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')

const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

/** Righe lunghe spezzate a 75 byte (la riga dopo inizia con uno spazio), senza tagliare le lettere. */
function fold(line: string): string {
  const out: string[] = []
  let cur = ''
  let bytes = 0
  for (const ch of line) {
    const size = Buffer.byteLength(ch)
    const limit = out.length ? 74 : 75
    if (bytes + size > limit) {
      out.push(cur)
      cur = ''
      bytes = 0
    }
    cur += ch
    bytes += size
  }
  out.push(cur)
  return out.join('\r\n ')
}

export function buildIcs(input: {
  name: string
  tasks: CalTask[]
  boardName: Map<string, string>
  listTitle: Map<string, string>
  doneLists: Set<string>
  openUrl: (task: CalTask) => string
  now?: number
}): string {
  const now = input.now ?? Date.now()
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Facevoice AI//Todo//IT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(input.name)}`,
    'X-WR-TIMEZONE:Europe/Rome',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ]
  for (const t of input.tasks) {
    const start = Date.parse(t.deadline)
    if (!Number.isFinite(start)) continue
    const board = input.boardName.get(t.board_id) || 'Progetto'
    const finished = t.done || input.doneLists.has(t.list_id)
    const url = input.openUrl(t)
    const details = [
      `Progetto: ${board}`,
      input.listTitle.get(t.list_id) ? `Tabella: ${input.listTitle.get(t.list_id)}` : '',
      t.priority > 0 ? `Importanza: ${priorityLabel(t.priority)}` : '',
      t.assignee ? `Assegnata a: ${t.assignee}` : '',
      finished ? 'Stato: fatta' : '',
      (t.notes || '').trim() ? `\n${(t.notes || '').trim().slice(0, 1500)}` : '',
      `\nApri l’attività: ${url}`,
    ].filter(Boolean)
    const updated = t.updated_at ? Date.parse(t.updated_at) : NaN
    lines.push(
      'BEGIN:VEVENT',
      `UID:${t.id}@facevoice.ai`,
      `DTSTAMP:${stamp(now)}`,
      ...(Number.isFinite(updated) ? [`LAST-MODIFIED:${stamp(updated)}`] : []),
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(start + EVENT_MINUTES * 60_000)}`,
      `SUMMARY:${esc(`${finished ? '✓ ' : ''}${board} · ${t.title}`)}`,
      `DESCRIPTION:${esc(details.join('\n'))}`,
      `URL:${url}`,
      `CATEGORIES:${esc(board)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT'
    )
  }
  lines.push('END:VCALENDAR')
  return `${lines.map(fold).join('\r\n')}\r\n`
}

type DbError = { code?: string; message?: string } | null

async function pages<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: DbError }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < MAX_TASKS; from += 1000) {
    const { data, error } = await page(from, from + 999)
    if (error) {
      if (isMissingSetup(error)) return out
      throw new Error(`calendario: ${(error.message || '').slice(0, 160)}`)
    }
    const rows = (data || []) as T[]
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}

/** Chi apre il link e quali progetti vede (verificato adesso). null = link non valido. */
async function viewerOf(subject: CalendarSubject): Promise<{ boards: BoardRow[]; person: AccessRow | null } | null> {
  const all = await listBoards()
  if (subject.kind === 'admin') return subject.seq === (await adminSeq()) ? { boards: all, person: null } : null
  const person = await accessById(subject.id)
  if (!person || person.session_version !== subject.version) return null
  const allowed = new Set(person.board_ids)
  return { boards: all.filter((b) => allowed.has(b.id)), person }
}

/** Il file .ics di un link, o null se il link non vale (piu'). */
export async function calendarFeed(token: string, requestOrigin?: string | null, now = Date.now()): Promise<string | null> {
  const subject = readCalendar(token)
  if (!subject) return null
  const viewer = await viewerOf(subject)
  if (!viewer) return null
  const origin = todoOrigin(requestOrigin)
  const name = viewer.person ? `Progetti Facevoice · ${viewer.person.name}` : 'Progetti Facevoice'
  const ids = viewer.boards.map((b) => b.id)
  const openUrl = (t: CalTask) => (viewer.person ? `${origin}${portalPath(t.board_id, t.id)}` : `${origin}/admin/todo/${t.board_id}?t=${t.id}`)
  if (!ids.length) return buildIcs({ name, tasks: [], boardName: new Map(), listTitle: new Map(), doneLists: new Set(), openUrl, now })
  const since = new Date(now - PAST_DAYS * 86_400_000).toISOString()
  const [lists, tasks] = await Promise.all([
    pages<{ id: string; board_id: string; title: string }>((from, to) => supabaseAdmin.from('todo_lists').select('id, board_id, title').in('board_id', ids).order('id', { ascending: true }).range(from, to)),
    pages<CalTask>((from, to) =>
      supabaseAdmin
        .from('todo_tasks')
        .select('id, board_id, list_id, title, notes, deadline, done, priority, assignee, updated_at')
        .in('board_id', ids)
        .not('deadline', 'is', null)
        .gte('deadline', since)
        .order('deadline', { ascending: true })
        .range(from, to)
    ),
  ])
  const allowed = new Set(ids)
  const mine = lists.filter((l) => allowed.has(l.board_id))
  return buildIcs({
    name,
    tasks: tasks.filter((t) => allowed.has(t.board_id)),
    boardName: new Map(viewer.boards.map((b) => [b.id, b.name])),
    listTitle: new Map(mine.map((l) => [l.id, l.title])),
    doneLists: new Set(mine.filter((l) => isDoneListTitle(l.title)).map((l) => l.id)),
    openUrl,
    now,
  })
}
