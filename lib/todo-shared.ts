// Pezzi comuni della todo list condivisa, usati sia dal server sia dalla pagina:
// tipi, livelli di importanza, ora italiana, riconoscimento dei link.
// Niente import dal server: questo file finisce anche nel browser.

export const TIME_ZONE = 'Europe/Rome'

export type TodoLinkPreview = { url: string; title?: string; description?: string; image?: string; site?: string }
export type TodoImage = { id: string; name: string; src: string }

/** Nome con cui l'admin compare nella todo list (chi ha creato le attivita' senza persona). */
export const ADMIN_NAME = 'Luca'

export type TodoMember = { id: string; name: string }

export type TodoList = {
  id: string
  title: string
  position: number
  /** null: creata dall'admin (la vedono tutti). */
  created_by_member: string | null
  owner_name: string
  /** Rinominare, spostare, ordinare, eliminare. */
  can_manage: boolean
  /** Aggiungere attivita' o spostarci dentro le proprie. */
  can_add: boolean
}

export type TodoTask = {
  id: string
  list_id: string
  title: string
  notes: string
  done: boolean
  priority: number
  position: number
  deadline: string | null
  /** Vecchio campo di testo libero: resta per le attivita' di prima. */
  assignee: string | null
  assignee_member: string | null
  assignee_name: string | null
  /** null: creata dall'admin. */
  created_by_member: string | null
  creator_name: string
  /** Modificare tutto (titolo, note, foto, scadenza, eliminare). */
  can_edit: boolean
  /** Spostare (tabella e ordine) e segnare come fatta. */
  can_move: boolean
  notify_email: string | null
  reminders_per_day: number
  remind_hours_before: number
  links: TodoLinkPreview[]
  images: TodoImage[]
  updated_at: string
}

export type TodoMe = { id: string | null; name: string; admin: boolean }

export type TodoBoardState = { board: { name: string }; me: TodoMe; members: TodoMember[]; lists: TodoList[]; tasks: TodoTask[] }

/**
 * Chi vede un'attivita' (oltre all'admin, che vede tutto): la persona a cui e' assegnata,
 * chi l'ha creata, e tutti se l'ha creata l'admin senza assegnarla a nessuno.
 */
export function taskVisibleTo(task: { assignee_member: string | null; created_by_member: string | null }, memberId: string): boolean {
  if (task.assignee_member === memberId || task.created_by_member === memberId) return true
  return task.created_by_member === null && task.assignee_member === null
}

/** Nome confrontabile: senza accenti, maiuscole e spazi doppi ("Sèvara  " = "sevara"). */
export function nameKey(name: string): string {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Tabella "Fatto" (o simili): spostarci un'attivita' vuol dire averla finita. */
export function isDoneListTitle(title: string): boolean {
  return /^(fatt[oaie]|completat[oaie]|done|finit[oaie]|chius[oaie])$/.test(nameKey(title).replace(/[^a-z ]/g, '').trim())
}

export const PRIORITIES = [
  { value: 0, label: 'Nessuna', chip: 'border border-[var(--border-color)] text-[var(--text-secondary)]', bar: 'transparent' },
  { value: 1, label: 'Bassa', chip: 'bg-[#34C759]/15 text-[#34C759]', bar: '#34C759' },
  { value: 2, label: 'Media', chip: 'bg-[#FFCC00]/20 text-[#d4a500]', bar: '#FFCC00' },
  { value: 3, label: 'Alta', chip: 'bg-[#FF9500]/15 text-[#FF9500]', bar: '#FF9500' },
  { value: 4, label: 'Urgente', chip: 'bg-[#FF3B30]/15 text-[#FF3B30]', bar: '#FF3B30' },
] as const

export const priorityLabel = (p: number) => PRIORITIES.find((x) => x.value === p)?.label || 'Nessuna'

export const LIMITS = {
  boardName: 80,
  listTitle: 120,
  taskTitle: 300,
  notes: 5000,
  assignee: 120,
  memberName: 60,
  membersPerBoard: 50,
  email: 200,
  listsPerBoard: 50,
  tasksPerBoard: 2000,
  imagesPerTask: 20,
  imageBytes: 10 * 1024 * 1024,
  linksPerTask: 5,
  passwordMin: 6,
  passwordMax: 128,
}

export const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }

// ---------------------------------------------------------------------
// Ordine (posizioni con la virgola: spostare un elemento cambia solo quello)
// ---------------------------------------------------------------------

/**
 * Posizione per mettere un elemento all'indice `index` tra gli altri (gia' in ordine).
 * null: lo spazio tra i vicini e' finito, bisogna prima rinumerare.
 */
export function positionAt(others: number[], index: number): number | null {
  const n = others.length
  if (n === 0) return 1024
  const i = Math.max(0, Math.min(n, Math.floor(index)))
  if (i === 0) return others[0] - 1024
  if (i === n) return others[n - 1] + 1024
  const prev = others[i - 1]
  const next = others[i]
  if (!(next - prev > 1e-6)) return null
  return (prev + next) / 2
}

export const EMAIL_RE = /^[^@\s<>"',;]+@[^@\s<>"',;]+\.[^@\s<>"',;]{2,}$/

// ---------------------------------------------------------------------
// Ora italiana (Europe/Rome), indipendente dal fuso del server o del telefono
// ---------------------------------------------------------------------

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number }

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

/** Data e ora in Italia per un istante. */
export function romeParts(ms: number): Parts {
  const out: Record<string, number> = {}
  for (const p of fmt.formatToParts(new Date(ms))) if (p.type !== 'literal') out[p.type] = Number(p.value)
  return { year: out.year, month: out.month, day: out.day, hour: out.hour % 24, minute: out.minute, second: out.second }
}

/** Differenza (ms) tra l'ora italiana e UTC in quell'istante (+1h d'inverno, +2h d'estate). */
function romeOffset(ms: number): number {
  const p = romeParts(ms)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000
}

/** Istante (ms UTC) di una data e ora scritte in ora italiana. */
export function romeToUtc(year: number, month: number, day: number, hour = 0, minute = 0): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  let ms = guess - romeOffset(guess)
  // Vicino al cambio dell'ora la prima stima puo' sbagliare di un'ora: si corregge una volta.
  const again = guess - romeOffset(ms)
  if (again !== ms) ms = again
  return ms
}

/** Giorno italiano "AAAA-MM-GG" di un istante. */
export function romeDay(ms: number): string {
  const p = romeParts(ms)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** Valore per <input type="datetime-local"> (ora italiana) da una data ISO. */
export function isoToRomeInput(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  const p = romeParts(ms)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${p.year}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}`
}

/** Da <input type="datetime-local"> (ora italiana) a ISO; vuoto o non valido: null. */
export function romeInputToIso(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || '')
  if (!m) return null
  return new Date(romeToUtc(+m[1], +m[2], +m[3], +m[4], +m[5])).toISOString()
}

/** "lun 9 nov, 15:30" in ora italiana. */
export function formatRome(iso: string | null, withYear = false): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('it-IT', {
    timeZone: TIME_ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ---------------------------------------------------------------------
// Link nel testo
// ---------------------------------------------------------------------

const LINK_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi

function cleanLink(raw: string): string | null {
  let s = raw.replace(/[.,;:!?)\]}»'"]+$/, '')
  // Parentesi chiusa che fa parte del link (es. Wikipedia): si tiene se ce n'e' una aperta.
  if (raw.slice(s.length).startsWith(')') && s.includes('(')) s += ')'
  if (/^www\./i.test(s)) s = `https://${s}`
  try {
    const u = new URL(s)
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return null
    return u.href
  } catch {
    return null
  }
}

/** Link (http/https) trovati nel testo, senza doppioni, al massimo `max`. */
export function extractLinks(text: string, max: number = LIMITS.linksPerTask): string[] {
  const out: string[] = []
  for (const m of (text || '').matchAll(LINK_RE)) {
    const url = cleanLink(m[0])
    if (url && !out.includes(url)) out.push(url)
    if (out.length >= max) break
  }
  return out
}

/** Testo diviso in pezzi semplici e link (per mostrarli cliccabili). */
export function splitLinks(text: string): { text: string; href?: string }[] {
  const parts: { text: string; href?: string }[] = []
  let last = 0
  for (const m of (text || '').matchAll(LINK_RE)) {
    const start = m.index ?? 0
    const href = cleanLink(m[0])
    if (!href) continue
    const shown = m[0].replace(/[.,;:!?)\]}»'"]+$/, '')
    const visible = m[0].slice(shown.length).startsWith(')') && shown.includes('(') ? `${shown})` : shown
    if (start > last) parts.push({ text: text.slice(last, start) })
    parts.push({ text: visible, href })
    last = start + visible.length
  }
  if (last < (text || '').length) parts.push({ text: text.slice(last) })
  return parts
}
