import { randomUUID } from 'crypto'
import { callAI } from '@/lib/ai'
import { stripMarkdown } from '@/lib/tool-step'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { readSetting, updateSetting } from '@/lib/settings-store'
import { workspaceDb, type WorkspaceDb } from '@/lib/workspace-db'
import { workspaceOwnerId } from '@/lib/workspace'
import { channelFeature, isAIBlockedError, workspaceAIBlocked } from '@/lib/usage-limits'
import { automationsAccess, countFrom, countKey, romeDay, type DayCount } from '@/lib/automations-access'
import { AUTOMATIONS_DAILY_LIMIT, MAX_RECIPIENTS, isEmail, parseRecipients } from '@/lib/automations-shared'
import { listConnections, type Connection } from './connections'
import { explainMailError, sendNewEmail } from './email'
import { readInstructions, workspaceName } from './responder'

// Automazioni dell'area clienti: email programmate (un orario ogni giorno, nei giorni
// scelti, oppure una volta sola) inviate dalla casella email collegata dal cliente, una
// email per destinatario. Al massimo 20 email al giorno per spazio (giorno italiano).
// Le gestiscono la pagina Automazioni e l'Assistente AI; le invia il cron della
// piattaforma (app/api/cron/saas, ogni minuto) con processDueAutomations().
//
// In app_settings, per spazio:
// - "automations:<spazio>"       = elenco delle automazioni (Automation[])
// - "automations_log:<spazio>"   = ultimi invii (AutomationLogEntry[], al massimo 200)
// - "automations_count:<spazio>" = { day: "AAAA-MM-GG", used } email del giorno (lib/automations-access.ts)
// Ogni modifica passa da updateSetting (salva solo se nessun altro ha salvato dopo la
// lettura): due passaggi del cron insieme non mandano mai due volte la stessa email e
// non superano il limite del giorno.

export const TIMEZONE = 'Europe/Rome'
export { MAX_RECIPIENTS, isEmail, parseRecipients }
export const MAX_AUTOMATIONS = 50
export const MAX_LOG = 200
export const MAX_BODY = 10_000
export const MAX_BRIEF = 2_000
export const MAX_SUBJECT = 200
/** Un orario saltato (cron fermo) parte solo se e' passato da meno di questo tempo, altrimenti si salta. */
export const CATCH_UP_MS = 10 * 60_000
/** Un passaggio del cron che sta inviando tiene l'invio per questo tempo (rinnovato a ogni email). */
const LEASE_MS = 90_000
/** Tempo massimo per il testo scritto dall'AI (la presa si rinnova prima, per piu' di questo tempo). */
const AI_TIMEOUT_MS = 60_000
const AI_LEASE_MS = AI_TIMEOUT_MS + 60_000
export const LIMIT_REACHED = `limite di ${AUTOMATIONS_DAILY_LIMIT} al giorno raggiunto`
const FEATURE = channelFeature('saas_automazioni', 'email')

export type AutomationContent = { mode: 'fixed'; body: string } | { mode: 'ai'; brief: string }
/** days: 0 = domenica … 6 = sabato; vuoto = ogni giorno. time: "HH:MM" ora italiana. */
export type AutomationSchedule = { kind: 'daily'; time: string; days: number[] } | { kind: 'once'; at: string }

/** Invio in corso di un orario: destinatari ancora da fare e testo (scritto una volta sola). */
export type AutomationRun = {
  slot: string
  slotAt: string
  pending: string[]
  subject: string | null
  body: string | null
  lockUntil: number
  sent: number
  failed: number
  skipped: number
  startedAt: string
}

export type AutomationLastRun = { slot: string; at: string; sent: number; failed: number; skipped: number; note?: string }

export type Automation = {
  id: string
  name: string
  active: boolean
  recipients: string[]
  subject: string
  content: AutomationContent
  schedule: AutomationSchedule
  timezone: typeof TIMEZONE
  createdAt: string
  updatedAt: string
  createdBy: string
  /** Da quando valgono gli orari ogni giorno (creazione, riattivazione, cambio di orario): quelli prima non partono. */
  since: string
  /** Ultimo orario preso (inviato o saltato): mai due volte lo stesso. */
  lastSlot: string | null
  lastRun: AutomationLastRun | null
  nextRun: string | null
  run: AutomationRun | null
  /** Una volta sola: gia' fatta. */
  done?: boolean
  origin?: 'page' | 'assistant'
}

export type AutomationLogEntry = {
  id: string
  automationId: string
  name: string
  to: string
  subject: string
  at: string
  status: 'sent' | 'failed' | 'skipped'
  error?: string
  slot?: string
  test?: boolean
}

/** Quello che vede la pagina (senza il testo in lavorazione). */
export type AutomationView = Omit<Automation, 'run'> & { running: boolean }

export class AutomationError extends Error {
  constructor(message: string, readonly status = 400, readonly code?: string) {
    super(message)
    this.name = 'AutomationError'
  }
}

const listKey = (workspaceId: string) => `automations:${workspaceId}`
const logKey = (workspaceId: string) => `automations_log:${workspaceId}`
const LIST_PREFIX = 'automations:'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))

// --- Ora italiana ------------------------------------------------------------------------

type RomeParts = { y: number; mo: number; d: number; h: number; mi: number }

function romeParts(at: number): RomeParts {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(at))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour'), mi: get('minute') }
}

/**
 * Istante (UTC, ms) di un giorno e un'ora italiani. Anche nei giorni del cambio d'ora:
 * un'ora che non esiste (02:30 l'ultima domenica di marzo) diventa quella dopo (03:30),
 * un'ora che c'e' due volte (02:30 l'ultima domenica di ottobre) e' una sola.
 */
export function romeToUtc(y: number, mo: number, d: number, h: number, mi: number): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  const offset = (at: number) => {
    const p = romeParts(at)
    return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - at
  }
  let utc = guess - offset(guess)
  utc = guess - offset(utc)
  return utc
}

/** "AAAA-MM-GGTHH:MM" ora italiana, o una data ISO con il fuso -> istante; NaN se non valida. */
export function parseWhen(value: string): number {
  const text = String(value || '').trim()
  const local = text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/)
  if (local) {
    const [y, mo, d, h, mi] = local.slice(1).map(Number)
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return NaN
    return romeToUtc(y, mo, d, h, mi)
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(text)) return Date.parse(text)
  return NaN
}

const pad = (n: number) => String(n).padStart(2, '0')
const dayKey = (y: number, mo: number, d: number) => `${y}-${pad(mo)}-${pad(d)}`

/** Giorno di calendario spostato di k giorni (senza fusi: solo la data). */
function shiftDay(y: number, mo: number, d: number, k: number): { y: number; mo: number; d: number; wd: number } {
  const date = new Date(Date.UTC(y, mo - 1, d + k))
  return { y: date.getUTCFullYear(), mo: date.getUTCMonth() + 1, d: date.getUTCDate(), wd: date.getUTCDay() }
}

const parseTime = (time: string): { h: number; mi: number } | null => {
  const m = String(time || '').trim().match(/^(\d{1,2})[:.](\d{2})$/)
  if (!m) return null
  const h = Number(m[1])
  const mi = Number(m[2])
  return h <= 23 && mi <= 59 ? { h, mi } : null
}

type Slot = { key: string; at: number }

const runsOn = (days: number[], wd: number) => !days.length || days.includes(wd)

/** Ultimo orario di una automazione ogni giorno arrivato entro "until" (al massimo 8 giorni prima). */
function lastDailySlot(schedule: Extract<AutomationSchedule, { kind: 'daily' }>, until: number): Slot | null {
  const time = parseTime(schedule.time)
  if (!time) return null
  const today = romeParts(until)
  for (let k = 0; k >= -8; k--) {
    const day = shiftDay(today.y, today.mo, today.d, k)
    if (!runsOn(schedule.days, day.wd)) continue
    const at = romeToUtc(day.y, day.mo, day.d, time.h, time.mi)
    if (at <= until) return { key: `d:${dayKey(day.y, day.mo, day.d)}@${pad(time.h)}:${pad(time.mi)}`, at }
  }
  return null
}

/** Prossimo orario dopo "after" (incluso "from" se ancora da fare). */
function nextDailySlot(schedule: Extract<AutomationSchedule, { kind: 'daily' }>, after: number): Slot | null {
  const time = parseTime(schedule.time)
  if (!time) return null
  const today = romeParts(after)
  for (let k = 0; k <= 8; k++) {
    const day = shiftDay(today.y, today.mo, today.d, k)
    if (!runsOn(schedule.days, day.wd)) continue
    const at = romeToUtc(day.y, day.mo, day.d, time.h, time.mi)
    if (at > after) return { key: `d:${dayKey(day.y, day.mo, day.d)}@${pad(time.h)}:${pad(time.mi)}`, at }
  }
  return null
}

const onceSlot = (schedule: Extract<AutomationSchedule, { kind: 'once' }>): Slot | null => {
  const at = Date.parse(schedule.at)
  return Number.isFinite(at) ? { key: `o:${new Date(at).toISOString()}`, at } : null
}

/**
 * Orario da fare adesso (o entro horizonMs: il cron passa ogni minuto, cosi' parte puntuale),
 * se non e' gia' stato preso. late: passato da piu' di CATCH_UP_MS (si salta, non si invia).
 */
export function dueSlot(a: Pick<Automation, 'active' | 'done' | 'schedule' | 'since' | 'lastSlot'>, now: number, horizonMs = 0): (Slot & { late: boolean }) | null {
  if (!a.active || a.done) return null
  const slot = a.schedule.kind === 'daily' ? lastDailySlot(a.schedule, now + horizonMs) : onceSlot(a.schedule)
  if (!slot || slot.at > now + horizonMs || slot.key === a.lastSlot) return null
  // Ogni giorno: gli orari di prima della creazione (o della riattivazione) non contano.
  if (a.schedule.kind === 'daily' && slot.at < Date.parse(a.since)) return null
  return { ...slot, late: now - slot.at > CATCH_UP_MS }
}

/** Prossimo invio previsto (null: in pausa o gia' fatta). */
export function nextRunAt(a: Pick<Automation, 'active' | 'done' | 'schedule' | 'since' | 'lastSlot'>, now: number): string | null {
  if (!a.active || a.done) return null
  if (a.schedule.kind === 'once') {
    const slot = onceSlot(a.schedule)
    return slot && slot.key !== a.lastSlot ? new Date(slot.at).toISOString() : null
  }
  // Orario appena arrivato e non ancora preso dal cron: e' il prossimo.
  const due = dueSlot(a, now)
  if (due && !due.late) return new Date(due.at).toISOString()
  let slot = nextDailySlot(a.schedule, Math.max(now, Date.parse(a.since) || 0) - 1)
  if (slot && slot.key === a.lastSlot) slot = nextDailySlot(a.schedule, slot.at)
  return slot ? new Date(slot.at).toISOString() : null
}

const WEEKDAYS_SHORT = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab']
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

/** "giovedì 6 novembre alle 22:12" (ora italiana). */
export function romeLabel(iso: string | number): string {
  const date = new Date(iso)
  const day = date.toLocaleDateString('it-IT', { timeZone: TIMEZONE, weekday: 'long', day: 'numeric', month: 'long' })
  const time = date.toLocaleTimeString('it-IT', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit' })
  return `${day} alle ${time}`
}

/** "ogni giorno alle 09:00", "lun, mer, ven alle 09:00", "una volta, giovedì 6 novembre alle 22:12". */
export function describeSchedule(schedule: AutomationSchedule): string {
  if (schedule.kind === 'once') return `una volta, ${romeLabel(schedule.at)}`
  const days = WEEKDAY_ORDER.filter((d) => schedule.days.includes(d))
  const which = !days.length || days.length === 7 ? 'ogni giorno' : days.map((d) => WEEKDAYS_SHORT[d]).join(', ')
  return `${which} alle ${schedule.time}`
}

// --- Validazione (pagina, API e Assistente usano le stesse regole) ------------------------

export type AutomationInput = {
  name?: unknown
  recipients?: unknown
  subject?: unknown
  content?: unknown
  /** Scorciatoie (Assistente): mode + body o brief. */
  mode?: unknown
  body?: unknown
  brief?: unknown
  schedule?: unknown
  active?: unknown
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim().slice(0, max) : '')
const oneLine = (v: unknown, max: number) => text(v, max * 2).replace(/\s+/g, ' ').trim().slice(0, max)

function contentFrom(input: AutomationInput): AutomationContent | null {
  const raw = (input.content && typeof input.content === 'object' ? input.content : {}) as { mode?: unknown; body?: unknown; brief?: unknown }
  const mode = raw.mode ?? input.mode
  if (mode === undefined && raw.body === undefined && raw.brief === undefined && input.body === undefined && input.brief === undefined) return null
  if (mode === 'ai') return { mode: 'ai', brief: text(raw.brief ?? input.brief ?? raw.body ?? input.body, MAX_BRIEF + 1) }
  return { mode: 'fixed', body: text(raw.body ?? input.body, MAX_BODY + 1) }
}

/** Orario dalla pagina o dall'Assistente ("in_minutes": 2 = una volta, tra 2 minuti). */
function scheduleFrom(raw: unknown, now: number): AutomationSchedule {
  const s = (raw && typeof raw === 'object' ? raw : {}) as { kind?: unknown; time?: unknown; days?: unknown; at?: unknown; in_minutes?: unknown; inMinutes?: unknown }
  if (s.kind === 'once') {
    const minutes = Number(s.in_minutes ?? s.inMinutes)
    let at = Number.isFinite(minutes) && s.at == null ? now + minutes * 60_000 : parseWhen(String(s.at ?? ''))
    if (!Number.isFinite(at)) throw new AutomationError('Scegli giorno e ora dell’invio.')
    at = Math.ceil(at / 1000) * 1000
    if (at <= now) throw new AutomationError('L’orario scelto è già passato: scegline uno più avanti.')
    if (at > now + 366 * 86_400_000) throw new AutomationError('Scegli un giorno entro un anno.')
    return { kind: 'once', at: new Date(at).toISOString() }
  }
  if (s.kind === 'daily' || s.kind === 'weekly' || s.kind === undefined) {
    const time = parseTime(String(s.time ?? ''))
    if (!time) throw new AutomationError('Scegli l’ora dell’invio (es. 09:30).')
    const days = Array.isArray(s.days) ? [...new Set(s.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b) : []
    if (Array.isArray(s.days) && s.days.length && !days.length) throw new AutomationError('Giorni non validi.')
    return { kind: 'daily', time: `${pad(time.h)}:${pad(time.mi)}`, days: days.length === 7 ? [] : days }
  }
  throw new AutomationError('Orario non valido.')
}

function checkRecipients(input: unknown): string[] {
  const { emails, invalid } = parseRecipients(input)
  if (invalid.length) throw new AutomationError(`Indirizzi non validi: ${invalid.slice(0, 5).join(', ')}`)
  if (!emails.length) throw new AutomationError('Scrivi almeno un indirizzo email.')
  if (emails.length > MAX_RECIPIENTS) throw new AutomationError(`Al massimo ${MAX_RECIPIENTS} destinatari per automazione.`)
  return emails
}

function checkContent(content: AutomationContent | null, subject: string): AutomationContent {
  if (!content) throw new AutomationError('Scrivi il testo dell’email.')
  if (content.mode === 'fixed') {
    if (!content.body) throw new AutomationError('Scrivi il testo dell’email.')
    if (content.body.length > MAX_BODY) throw new AutomationError(`Testo troppo lungo (massimo ${MAX_BODY} caratteri).`)
    if (!subject) throw new AutomationError('Scrivi l’oggetto dell’email.')
    return { mode: 'fixed', body: content.body }
  }
  if (!content.brief) throw new AutomationError('Scrivi all’AI di cosa deve parlare l’email.')
  if (content.brief.length > MAX_BRIEF) throw new AutomationError(`Indicazioni troppo lunghe (massimo ${MAX_BRIEF} caratteri).`)
  return { mode: 'ai', brief: content.brief }
}

// --- Lettura e salvataggio ---------------------------------------------------------------

const parseJson = (raw: unknown): unknown => {
  if (typeof raw !== 'string') return raw ?? null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

const isAutomation = (v: unknown): v is Automation => {
  const a = v as Automation | null
  return Boolean(a && typeof a.id === 'string' && Array.isArray(a.recipients) && a.schedule && a.content && typeof a.since === 'string')
}

export const parseList = (raw: unknown): Automation[] => {
  const value = parseJson(raw)
  return Array.isArray(value) ? value.filter(isAutomation).map((a) => ({ ...a, run: a.run ?? null, lastRun: a.lastRun ?? null, lastSlot: a.lastSlot ?? null })) : []
}

const parseLog = (raw: unknown): AutomationLogEntry[] => {
  const value = parseJson(raw)
  return Array.isArray(value) ? value.filter((e) => e && typeof e.automationId === 'string' && typeof e.at === 'string') : []
}

export async function loadAutomations(workspaceId: string): Promise<Automation[]> {
  return parseList((await readSetting(listKey(workspaceId))).value)
}

export async function loadAutomationLog(workspaceId: string): Promise<AutomationLogEntry[]> {
  return parseLog((await readSetting(logKey(workspaceId))).value)
}

export async function readDayCount(workspaceId: string, now = Date.now()): Promise<DayCount> {
  return countFrom((await readSetting(countKey(workspaceId))).value, romeDay(now))
}

/** Aggiunge invii al registro (anche quelli di Trova clienti, lib/saas/prospects.ts). */
export async function appendLog(workspaceId: string, entries: Omit<AutomationLogEntry, 'id'>[]): Promise<void> {
  if (!entries.length) return
  const withIds = entries.map((e) => ({ id: randomUUID(), ...e }))
  await updateSetting<AutomationLogEntry[]>(logKey(workspaceId), parseLog, (log) => [...log, ...withIds].slice(-MAX_LOG)).catch((error) =>
    console.error('automazioni: registro non salvato:', error instanceof Error ? error.message : error)
  )
}

/** Prende un'email del limite del giorno (false: limite raggiunto). Sicuro anche con piu' invii insieme. */
export async function reserveDaily(workspaceId: string, now = Date.now()): Promise<boolean> {
  const today = romeDay(now)
  const out = { taken: false }
  await updateSetting<DayCount>(
    countKey(workspaceId),
    (raw) => countFrom(raw, today),
    (current) => {
      out.taken = false
      if (current.used >= AUTOMATIONS_DAILY_LIMIT) return false
      out.taken = true
      return { day: today, used: current.used + 1 }
    }
  )
  return out.taken
}

/** Restituisce un'email del limite (invio non riuscito: non conta). */
export async function releaseDaily(workspaceId: string, now = Date.now()): Promise<void> {
  const today = romeDay(now)
  await updateSetting<DayCount>(countKey(workspaceId), (raw) => countFrom(raw, today), (current) =>
    current.used > 0 ? { day: today, used: current.used - 1 } : false
  ).catch((error) => console.warn('automazioni: limite non aggiornato:', error instanceof Error ? error.message : error))
}

/** Casella email collegata dello spazio (la prima non scollegata), o null. */
export async function mailboxOf(db: WorkspaceDb): Promise<Connection | null> {
  const list = await listConnections(db, 'email')
  return list.find((c) => c.status === 'connected') || list.find((c) => c.status !== 'disconnected') || null
}

export const viewOf = (a: Automation, now = Date.now()): AutomationView => {
  const { run, ...rest } = a
  return { ...rest, nextRun: nextRunAt(a, now), running: Boolean(run) }
}

export type AutomationsOverview = {
  automations: AutomationView[]
  log: AutomationLogEntry[]
  today: { used: number; limit: number }
  mailbox: { email: string; status: Connection['status'] } | null
}

export async function automationsOverview(db: WorkspaceDb, now = Date.now()): Promise<AutomationsOverview> {
  const [list, log, count, mailbox] = await Promise.all([
    loadAutomations(db.workspaceId),
    loadAutomationLog(db.workspaceId),
    readDayCount(db.workspaceId, now),
    mailboxOf(db).catch(() => null),
  ])
  return {
    automations: list.map((a) => viewOf(a, now)),
    log: log.slice(-100).reverse(),
    today: { used: count.used, limit: AUTOMATIONS_DAILY_LIMIT },
    mailbox: mailbox ? { email: mailbox.external_id, status: mailbox.status } : null,
  }
}

/**
 * Email previste in un giorno dalle automazioni attive (per avvisare oltre il limite).
 * extra: email di Trova clienti nei giorni scelti (lib/saas/prospects.ts), nello stesso limite.
 */
export function capacityWarning(list: Automation[], now: number, used: number, extra?: { perDay: number; days: number[] }): string | null {
  const active = list.filter((a) => a.active && !a.done)
  let peak = 0
  let peakLabel = ''
  // Prossimi 7 giorni: ogni giorno con i suoi orari, piu' gli invii di una volta di quel giorno.
  const today = romeParts(now)
  for (let k = 0; k < 7; k++) {
    const day = shiftDay(today.y, today.mo, today.d, k)
    const key = dayKey(day.y, day.mo, day.d)
    let total = 0
    for (const a of active) {
      if (a.schedule.kind === 'daily') {
        if (runsOn(a.schedule.days, day.wd)) total += a.recipients.length
      } else if (romeDay(Date.parse(a.schedule.at)) === key) total += a.recipients.length
    }
    if (k === 0) total += used
    if (extra && runsOn(extra.days, day.wd)) total += extra.perDay
    if (total > peak) {
      peak = total
      peakLabel = k === 0 ? 'oggi' : new Date(Date.UTC(day.y, day.mo - 1, day.d, 12)).toLocaleDateString('it-IT', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' })
    }
  }
  return peak > AUTOMATIONS_DAILY_LIMIT
    ? `Attenzione: ${peakLabel} sono previste ${peak} email${extra ? ' (programmate e Trova clienti)' : ''}, il limite è ${AUTOMATIONS_DAILY_LIMIT} al giorno. Quelle in più non partono.`
    : null
}

async function requireMailbox(db: WorkspaceDb): Promise<Connection> {
  const mailbox = await mailboxOf(db).catch(() => null)
  if (!mailbox) throw new AutomationError('Collega prima la tua email (Canali → Email): le automazioni partono dalla tua casella.', 400, 'no_mailbox')
  return mailbox
}

export type SavedAutomation = { automation: AutomationView; warning: string | null; mailbox: string }

/** Nuova automazione (pagina o Assistente). */
export async function createAutomation(
  db: WorkspaceDb,
  userId: string,
  input: AutomationInput,
  options: { origin?: 'page' | 'assistant'; now?: number } = {}
): Promise<SavedAutomation> {
  const now = options.now ?? Date.now()
  const { automation, mailbox } = await buildAutomation(db, userId, input, options.origin || 'page', now)
  const out = { full: false }
  const list = await updateSetting<Automation[]>(listKey(db.workspaceId), parseList, (current) => {
    out.full = current.length >= MAX_AUTOMATIONS
    return out.full ? false : [...current, automation]
  })
  if (out.full) throw new AutomationError(`Hai già ${MAX_AUTOMATIONS} automazioni: cancellane qualcuna prima.`)
  const used = (await readDayCount(db.workspaceId, now).catch(() => ({ used: 0 }))).used
  return { automation: viewOf(automation, now), warning: capacityWarning(list, now, used), mailbox: mailbox.external_id }
}

/**
 * Stessi controlli di createAutomation, senza salvare niente: la scheda "Conferma"
 * dell'Assistente mostra cosa verra' programmato (si salva solo dopo il clic).
 */
export async function previewAutomation(db: WorkspaceDb, userId: string, input: AutomationInput, options: { now?: number } = {}): Promise<SavedAutomation> {
  const now = options.now ?? Date.now()
  const { automation, mailbox } = await buildAutomation(db, userId, input, 'assistant', now)
  const list = await loadAutomations(db.workspaceId)
  if (list.length >= MAX_AUTOMATIONS) throw new AutomationError(`Hai già ${MAX_AUTOMATIONS} automazioni: cancellane qualcuna prima.`)
  const used = (await readDayCount(db.workspaceId, now).catch(() => ({ used: 0 }))).used
  return { automation: viewOf(automation, now), warning: capacityWarning([...list, automation], now, used), mailbox: mailbox.external_id }
}

/** Automazione nuova controllata (destinatari, testo, orario, casella), non ancora salvata. */
async function buildAutomation(db: WorkspaceDb, userId: string, input: AutomationInput, origin: 'page' | 'assistant', now: number): Promise<{ automation: Automation; mailbox: Connection }> {
  const recipients = checkRecipients(input.recipients)
  const subject = oneLine(input.subject, MAX_SUBJECT)
  const content = checkContent(contentFrom(input), subject)
  const schedule = scheduleFrom(input.schedule, now)
  const active = input.active !== false
  const mailbox = await requireMailbox(db)
  const iso = new Date(now).toISOString()
  const name = oneLine(input.name, 80) || subject || (content.mode === 'ai' ? oneLine(content.brief, 60) : 'Automazione')
  const automation: Automation = {
    id: randomUUID(),
    name,
    active,
    recipients,
    subject,
    content,
    schedule,
    timezone: TIMEZONE,
    createdAt: iso,
    updatedAt: iso,
    createdBy: userId,
    since: iso,
    lastSlot: null,
    lastRun: null,
    nextRun: null,
    run: null,
    origin,
  }
  automation.nextRun = nextRunAt(automation, now)
  return { automation, mailbox }
}

/** Modifica, pausa o ripresa (solo i campi passati). */
export async function updateAutomation(db: WorkspaceDb, id: string, input: AutomationInput, options: { now?: number } = {}): Promise<SavedAutomation> {
  const now = options.now ?? Date.now()
  const has = (k: keyof AutomationInput) => input[k] !== undefined
  // Prima si controlla tutto quello che arriva (fuori dal salvataggio, che si puo' ripetere).
  const recipients = has('recipients') ? checkRecipients(input.recipients) : null
  const schedule = has('schedule') ? scheduleFrom(input.schedule, now) : null
  const contentPatch = contentFrom(input)
  const turningOn = input.active === true
  const mailbox = turningOn || recipients || schedule || contentPatch ? await requireMailbox(db) : await mailboxOf(db).catch(() => null)
  // Esito del salvataggio (oggetto: la funzione si puo' ripetere se un altro ha salvato prima).
  const out: { found: boolean; error: AutomationError | null; saved: Automation | null } = { found: false, error: null, saved: null }
  const list = await updateSetting<Automation[]>(listKey(db.workspaceId), parseList, (current) => {
    out.found = false
    out.error = null
    out.saved = null
    const index = current.findIndex((a) => a.id === id)
    if (index < 0) return false
    out.found = true
    const a = current[index]
    const subject = has('subject') ? oneLine(input.subject, MAX_SUBJECT) : a.subject
    let content = a.content
    try {
      content = contentPatch ? checkContent(contentPatch, subject) : has('subject') ? checkContent(a.content, subject) : a.content
    } catch (e) {
      out.error = e as AutomationError
      return false
    }
    const next: Automation = { ...a, subject, content, updatedAt: new Date(now).toISOString() }
    if (has('name')) next.name = oneLine(input.name, 80) || next.name
    if (recipients) next.recipients = recipients
    const reschedule = schedule && JSON.stringify(schedule) !== JSON.stringify(a.schedule)
    if (schedule) next.schedule = schedule
    if (reschedule) {
      next.since = next.updatedAt
      next.done = false
    }
    if (typeof input.active === 'boolean') {
      if (input.active && !a.active) next.since = next.updatedAt
      next.active = input.active
    }
    // Una volta sola, gia' fatta o con l'orario passato: per riattivarla serve un orario nuovo.
    if (next.active && next.schedule.kind === 'once' && (next.done || Date.parse(next.schedule.at) <= now)) {
      out.error = new AutomationError('Questo invio è già passato: scegli un nuovo giorno e una nuova ora.')
      return false
    }
    next.nextRun = nextRunAt(next, now)
    out.saved = next
    const copy = [...current]
    copy[index] = next
    return copy
  })
  if (out.error) throw out.error
  if (!out.found || !out.saved) throw new AutomationError('Automazione non trovata.', 404)
  const used = (await readDayCount(db.workspaceId, now).catch(() => ({ used: 0 }))).used
  return { automation: viewOf(out.saved, now), warning: capacityWarning(list, now, used), mailbox: mailbox?.external_id || '' }
}

export async function deleteAutomation(db: WorkspaceDb, id: string): Promise<Automation> {
  const out: { removed: Automation | null } = { removed: null }
  await updateSetting<Automation[]>(listKey(db.workspaceId), parseList, (current) => {
    out.removed = current.find((a) => a.id === id) || null
    return out.removed ? current.filter((a) => a.id !== id) : false
  })
  if (!out.removed) throw new AutomationError('Automazione non trovata.', 404)
  return out.removed
}

// --- Testo scritto dall'AI -----------------------------------------------------------------

/**
 * Email scritta dall'AI dalle indicazioni del titolare (una nuova a ogni invio), con
 * l'identita' dello spazio (nome e Istruzioni), nella lingua delle indicazioni. Conta
 * nei consumi AI del cliente (funzione "saas_automazioni:email").
 */
export async function writeAutomationEmail(workspaceId: string, input: { brief: string; subject: string; now?: number }): Promise<{ subject: string; body: string }> {
  const [name, instructions] = await Promise.all([workspaceName(workspaceId), readInstructions(workspaceId).catch(() => null)])
  const context = [instructions?.general, instructions?.email].map((t) => t?.trim()).filter(Boolean).join('\n\n').slice(0, 8000)
  const system = `Scrivi UNA email che "${name}" manda dalla sua casella ai suoi contatti.
${context ? `Informazioni sull'attività (dalla pagina Istruzioni del titolare), l'unica fonte per i fatti:\n${context}\n` : ''}
Regole:
- Segui le indicazioni del titolare. Scrivi nella stessa lingua delle indicazioni.
- Non inventare prezzi, date, orari, sconti, nomi, numeri o promesse che non sono nelle indicazioni o nelle informazioni sull'attività.
- Non conosci il nome di chi la riceve: saluto generico. Chiudi in modo cordiale e firma con il nome dell'attività.
- Solo testo semplice: niente markdown, niente asterischi, niente segnaposto tra parentesi (es. [Nome]).
Rispondi SOLO con JSON: {"subject": "oggetto breve", "body": "testo dell'email"}`
  const today = new Date(input.now ?? Date.now()).toLocaleDateString('it-IT', { timeZone: TIMEZONE, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const request = `Indicazioni del titolare: ${input.brief}${input.subject ? `\nOggetto scelto dal titolare (usalo così): ${input.subject}` : ''}\nOggi è ${today}.`
  const result = await callAI([{ role: 'user', content: request }], system, { feature: FEATURE, temperature: 0.7, maxOutputTokens: 1800, workspaceId })
  const raw = String(result.message || '').trim()
  let subject = ''
  let body = ''
  const json = raw.match(/\{[\s\S]*\}/)
  if (json) {
    try {
      const parsed = JSON.parse(json[0]) as { subject?: unknown; body?: unknown }
      subject = typeof parsed.subject === 'string' ? parsed.subject : ''
      body = typeof parsed.body === 'string' ? parsed.body : ''
    } catch {}
  }
  if (!body && !json) body = raw
  body = stripMarkdown(body).replace(/\r\n/g, '\n').trim().slice(0, MAX_BODY)
  if (!body) throw new Error('testo non scritto dall’AI')
  return { subject: oneLine(input.subject || subject, MAX_SUBJECT) || 'Messaggio', body }
}

// --- Invio ---------------------------------------------------------------------------------

/** Motivo di un invio non riuscito, comprensibile per il cliente (mai credenziali). */
export function sendError(error: unknown): string {
  const raw = error instanceof Error ? `${error.message} ${(error as { response?: string }).response || ''}` : String(error)
  if (/\b55[0-4]\b|5\.1\.[0-9]|recipient|user unknown|mailbox unavailable|no such user|does not exist/i.test(raw)) return 'indirizzo rifiutato dal server di posta'
  if (/credenziali del collegamento/i.test(raw)) return 'casella email da ricollegare'
  return explainMailError(error).replace(/^Collegamento non riuscito: controlla i dati e riprova\.$/, 'invio non riuscito, riprova più tardi')
}

type MailErrorFields = { code?: unknown; originalCode?: unknown; command?: unknown; responseCode?: unknown; timeoutType?: unknown; message?: unknown }
const mailFields = (error: unknown) => {
  const e = (error && typeof error === 'object' ? error : {}) as MailErrorFields
  return {
    code: String(e.code || ''),
    original: String(e.originalCode || ''),
    command: String(e.command || ''),
    responseCode: Number(e.responseCode) || 0,
    timeout: String(e.timeoutType || ''),
    text: `${String(e.message || error || '')}`,
  }
}
// Comandi SMTP prima del testo dell'email: un errore qui vuol dire che non e' partita.
const BEFORE_DATA = /^(EHLO|HELO|LHLO|STARTTLS|AUTH\b|MAIL FROM|RCPT TO)/i
const UNREACHABLE = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH/

/**
 * L'email di sicuro NON e' stata consegnata al server (si puo' riprovare senza mandarla due
 * volte): casella da ricollegare, accesso rifiutato, server irraggiungibile, rifiuto del server,
 * errore prima del testo. false se non si sa (tempo scaduto o collegamento caduto durante l'invio).
 */
export function surelyNotSent(error: unknown): boolean {
  const e = mailFields(error)
  if (/credenziali del collegamento/i.test(e.text)) return true
  // Il server ha risposto con un rifiuto (4xx/5xx): non l'ha presa.
  if (e.responseCode >= 400) return true
  if (['EAUTH', 'ENOAUTH', 'EDNS', 'ETLS', 'EENVELOPE', 'EREQUIRETLS'].includes(e.code)) return true
  if (e.code === 'ETIMEDOUT' && /CONNECTION|GREETING|DNS/i.test(e.timeout)) return true
  if (UNREACHABLE.test(`${e.code} ${e.original} ${e.text}`)) return true
  if (BEFORE_DATA.test(e.command)) return true
  // Senza codice di rete: errore del nostro lato prima dell'invio (dati della casella, composizione).
  if (!e.code && !/time ?out|timed out|socket|reset|EPIPE|closed|hang ?up/i.test(e.text)) return true
  return false
}

/**
 * Problema della casella (non di un destinatario): password non accettata, server che non
 * esiste o non risponde. Inutile provare gli altri destinatari dello stesso invio.
 */
export function mailboxDown(error: unknown): boolean {
  const e = mailFields(error)
  if (/credenziali del collegamento/i.test(e.text)) return true
  // Accesso rifiutato (530/534/535, 454 temporaneo) o servizio chiuso (421): vale per tutti i destinatari.
  if ([421, 454, 530, 534, 535].includes(e.responseCode) || /Invalid login|authentication failed|Username and Password not accepted/i.test(e.text)) return true
  // Altre risposte del server (es. 550 su un destinatario): riguardano quell'email sola.
  if (e.responseCode >= 400 && !/^(AUTH|CONN|EHLO|HELO|STARTTLS)/i.test(e.command)) return false
  if (['EAUTH', 'ENOAUTH', 'ECONNECTION', 'EDNS', 'ETLS', 'ETIMEDOUT', 'ESOCKET'].includes(e.code)) return true
  return /\b53[45]\b|Invalid login|authentication failed|Username and Password not accepted|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|timeout/i.test(`${e.code} ${e.original} ${e.text}`)
}

export type SendDeps = {
  /** Invio vero (dalla casella collegata): sostituibile nelle prove. */
  send?: typeof sendNewEmail
}

/** "Invia una prova a me": un'email alla persona collegata, con il testo dell'automazione (conta nel limite). */
export async function sendAutomationTest(db: WorkspaceDb, to: string, input: AutomationInput, now = Date.now()): Promise<{ to: string; subject: string; from: string }> {
  if (!isEmail(to)) throw new AutomationError('Il tuo indirizzo email non è valido.')
  const subject = oneLine(input.subject, MAX_SUBJECT)
  const content = checkContent(contentFrom(input), subject)
  const mailbox = await requireMailbox(db)
  let mail: { subject: string; body: string }
  try {
    mail = content.mode === 'ai' ? await writeAutomationEmail(db.workspaceId, { brief: content.brief, subject, now }) : { subject, body: content.body }
  } catch (error) {
    if (isAIBlockedError(error)) throw new AutomationError(error.message, 402)
    throw new AutomationError('L’AI non è riuscita a scrivere l’email, riprova.')
  }
  if (!(await reserveDaily(db.workspaceId, now))) throw new AutomationError(`Oggi hai già inviato ${AUTOMATIONS_DAILY_LIMIT} email dalle automazioni: riprova domani.`, 429)
  const name = oneLine(input.name, 80) || 'Prova'
  const base = { automationId: 'test', name, to, subject: mail.subject, at: new Date().toISOString(), test: true }
  try {
    await sendNewEmail(mailbox, { to, subject: mail.subject, text: mail.body, fromName: await workspaceName(db.workspaceId) })
  } catch (error) {
    await releaseDaily(db.workspaceId, now)
    const reason = sendError(error)
    console.error('automazioni prova:', error instanceof Error ? error.message : error)
    await appendLog(db.workspaceId, [{ ...base, status: 'failed', error: reason }])
    throw new AutomationError(`Prova non inviata: ${reason}.`, 502)
  }
  await appendLog(db.workspaceId, [{ ...base, status: 'sent' }])
  return { to, subject: mail.subject, from: mailbox.external_id }
}

type ProcessOptions = {
  now?: () => number
  /** Orari in arrivo entro questo tempo: si aspetta e partono puntuali (il cron passa ogni minuto). */
  horizonMs?: number
  /** Tempo massimo di lavoro di questo passaggio (il cron ha 300 s per tutto). */
  budgetMs?: number
  /** Pausa tra un'email e l'altra (default 3-5 s). */
  spacingMs?: number
  workspaceId?: string
} & SendDeps

type Context = { workspaceId: string; db: WorkspaceDb; deadline: number; now: () => number; spacingMs: number | null; send: typeof sendNewEmail }

const spacing = (ctx: Context) => (ctx.spacingMs ?? 3000 + Math.random() * 2000)

/**
 * Dal cron, ogni minuto: invia le automazioni arrivate all'orario (anche quelle entro
 * horizonMs, aspettando l'ora giusta). Restituisce quante email sono partite.
 */
export async function processDueAutomations(options: ProcessOptions = {}): Promise<number> {
  const now = options.now ?? Date.now
  const started = now()
  const deadline = started + (options.budgetMs ?? 200_000)
  let query = supabaseAdmin.from('app_settings').select('key, value').like('key', `${LIST_PREFIX}%`).limit(1000)
  if (options.workspaceId) query = query.eq('key', listKey(options.workspaceId))
  const { data, error } = await query
  if (error) throw new Error(`automazioni non lette: ${error.message}`)
  const horizon = options.horizonMs ?? 0
  const work = (data || [])
    .map((row) => ({ workspaceId: String(row.key).slice(LIST_PREFIX.length), list: parseList(row.value) }))
    .filter(({ workspaceId, list }) => /^[0-9a-f-]{36}$/i.test(workspaceId) && list.some((a) => (a.run && a.run.lockUntil <= now()) || dueSlot(a, now(), horizon)))
  let sent = 0
  const queue = [...work]
  await Promise.all(
    Array.from({ length: Math.min(4, queue.length) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const ctx: Context = { workspaceId: next.workspaceId, db: workspaceDb(next.workspaceId), deadline, now, spacingMs: options.spacingMs ?? null, send: options.send ?? sendNewEmail }
        sent += await processWorkspace(ctx, horizon).catch((error) => {
          console.error('automazioni:', next!.workspaceId, error instanceof Error ? error.message : error)
          return 0
        })
      }
    })
  )
  return sent
}

type Claim = { automation: Automation; slot: Slot; late: boolean; resumed: boolean }

/** Prende l'orario (o riprende un invio lasciato a meta'): un solo passaggio del cron ci riesce. */
async function claimNext(ctx: Context, horizon: number): Promise<Claim | null> {
  const out: { claim: Claim | null } = { claim: null }
  await updateSetting<Automation[]>(listKey(ctx.workspaceId), parseList, (current) => {
    out.claim = null
    const now = ctx.now()
    const candidates: { index: number; slot: Slot; late: boolean; resumed: boolean }[] = []
    current.forEach((a, index) => {
      if (a.run) {
        if (a.run.lockUntil <= now) candidates.push({ index, slot: { key: a.run.slot, at: Date.parse(a.run.slotAt) }, late: false, resumed: true })
        return
      }
      const due = dueSlot(a, now, horizon)
      if (due) candidates.push({ index, slot: due, late: due.late, resumed: false })
    })
    if (!candidates.length) return false
    candidates.sort((x, y) => x.slot.at - y.slot.at)
    const pick = candidates[0]
    const a = current[pick.index]
    const iso = new Date(now).toISOString()
    let next: Automation
    if (pick.resumed) {
      // Invio lasciato a meta' (passaggio di prima fermato): si riprende, se non e' troppo tardi.
      next = { ...a, run: { ...a.run!, lockUntil: now + LEASE_MS } }
    } else if (pick.late) {
      next = {
        ...a,
        lastSlot: pick.slot.key,
        lastRun: { slot: pick.slot.key, at: iso, sent: 0, failed: 0, skipped: a.recipients.length, note: 'orario saltato: più di 10 minuti di ritardo' },
        ...(sameOnce(a, pick.slot.key) ? { active: false, done: true } : {}),
      }
    } else {
      next = {
        ...a,
        lastSlot: pick.slot.key,
        run: {
          slot: pick.slot.key,
          slotAt: new Date(pick.slot.at).toISOString(),
          pending: [...a.recipients],
          subject: a.content.mode === 'fixed' ? a.subject : null,
          body: a.content.mode === 'fixed' ? a.content.body : null,
          lockUntil: now + LEASE_MS + Math.max(0, pick.slot.at - now),
          sent: 0,
          failed: 0,
          skipped: 0,
          startedAt: iso,
        },
      }
    }
    next.nextRun = nextRunAt(next, now)
    out.claim = { automation: next, slot: pick.slot, late: pick.late, resumed: pick.resumed }
    const copy = [...current]
    copy[pick.index] = next
    return copy
  })
  return out.claim
}

type StepResult = { status: 'sent' | 'failed' | 'skipped' }
type StepOut = { to: string; run: AutomationRun } | { paused: string[] } | null

/**
 * Registra l'esito dell'email di prima e prende il prossimo destinatario (rinnovando la presa).
 * null: invio finito, automazione cancellata o cambiata; paused: messa in pausa durante l'invio.
 * Con release: registra soltanto e lascia l'invio al prossimo passaggio del cron.
 */
async function step(
  ctx: Context,
  id: string,
  slot: string,
  done: StepResult | null,
  fields: Partial<Pick<AutomationRun, 'subject' | 'body'>> = {},
  release = false
): Promise<StepOut> {
  const out: { value: StepOut } = { value: null }
  await updateSetting<Automation[]>(listKey(ctx.workspaceId), parseList, (current) => {
    out.value = null
    const index = current.findIndex((a) => a.id === id)
    const a = current[index]
    if (!a?.run || a.run.slot !== slot) return false
    const now = ctx.now()
    // Testo scritto dall'AI: si salva solo se nessun altro passaggio l'ha gia' salvato (allora vale il suo).
    const run: AutomationRun = { ...a.run, ...(a.run.body ? {} : fields) }
    if (done) run[done.status]++
    const copy = [...current]
    if (release) {
      copy[index] = { ...a, run: { ...run, lockUntil: 0 } }
      return copy
    }
    if (!a.active) {
      out.value = { paused: run.pending }
      copy[index] = finished({ ...a, run }, now, run.pending.length, 'messa in pausa durante l’invio')
      return copy
    }
    const to = run.pending[0]
    if (!to) {
      copy[index] = finished({ ...a, run }, now, 0)
      return copy
    }
    run.pending = run.pending.slice(1)
    run.lockUntil = now + LEASE_MS
    out.value = { to, run }
    copy[index] = { ...a, run }
    return copy
  })
  return out.value
}

/** Una volta sola, con lo stesso orario dell'invio (se intanto e' stato cambiato, l'automazione resta attiva per il nuovo). */
const sameOnce = (a: Automation, slot: string) => a.schedule.kind === 'once' && onceSlot(a.schedule)?.key === slot

/** Invio finito: niente piu' presa, riepilogo e (una volta sola) automazione fatta. */
function finished(a: Automation, now: number, extraSkipped: number, note?: string, extraFailed = 0): Automation {
  const run = a.run!
  const next: Automation = {
    ...a,
    run: null,
    lastRun: { slot: run.slot, at: new Date(now).toISOString(), sent: run.sent, failed: run.failed + extraFailed, skipped: run.skipped + extraSkipped, ...(note ? { note } : {}) },
    ...(sameOnce(a, run.slot) ? { active: false, done: true } : {}),
  }
  next.nextRun = nextRunAt(next, now)
  return next
}

/** Chiude l'invio saltando tutti i destinatari rimasti, con il motivo (un solo salvataggio del registro). failed: l'ultimo invio non riuscito, da contare. */
async function skipRest(ctx: Context, a: Automation, slot: string, reason: string, failed = 0): Promise<void> {
  const out: { rest: string[]; subject: string } = { rest: [], subject: a.subject }
  await updateSetting<Automation[]>(listKey(ctx.workspaceId), parseList, (current) => {
    out.rest = []
    const index = current.findIndex((x) => x.id === a.id)
    const x = current[index]
    if (!x?.run || x.run.slot !== slot) return false
    out.rest = x.run.pending
    out.subject = x.run.subject || x.subject || x.name
    const copy = [...current]
    copy[index] = finished({ ...x, run: { ...x.run, pending: [] } }, ctx.now(), out.rest.length, reason, failed)
    return copy
  })
  const at = new Date(ctx.now()).toISOString()
  await appendLog(ctx.workspaceId, out.rest.map((to) => ({ automationId: a.id, name: a.name, to, subject: out.subject, at, status: 'skipped' as const, error: reason, slot })))
}

type Checks = { hidden: boolean; mailbox: Connection | null; fromName: string }

const MAILBOX_RECONNECT = 'casella email da ricollegare'

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('tempo scaduto')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })

/** Allunga la presa dell'invio (false: l'invio non c'e' piu' o e' di un altro orario). */
async function renewLease(ctx: Context, id: string, slot: string, ms: number): Promise<boolean> {
  const out = { ok: false }
  await updateSetting<Automation[]>(listKey(ctx.workspaceId), parseList, (current) => {
    out.ok = false
    const index = current.findIndex((a) => a.id === id)
    const a = current[index]
    if (!a?.run || a.run.slot !== slot) return false
    out.ok = true
    const copy = [...current]
    copy[index] = { ...a, run: { ...a.run, lockUntil: Math.max(a.run.lockUntil, ctx.now() + ms) } }
    return copy
  })
  return out.ok
}

async function processWorkspace(ctx: Context, horizon: number): Promise<number> {
  let sent = 0
  // Controlli dello spazio, letti una volta sola, prima di prendere un orario: se non si
  // riescono a leggere (database) non si prende niente e si riprova al passaggio dopo.
  const ownerId = await workspaceOwnerId(ctx.workspaceId)
  const hidden = !ownerId || !(await automationsAccess(ownerId)).enabled
  const [mailbox, fromName] = await Promise.all([mailboxOf(ctx.db).catch(() => null), workspaceName(ctx.workspaceId)])
  const checks: Checks = { hidden, mailbox, fromName }
  for (let guard = 0; guard < MAX_AUTOMATIONS * 2; guard++) {
    if (ctx.now() > ctx.deadline - 30_000) break
    const claim = await claimNext(ctx, horizon)
    if (!claim) break
    const a = claim.automation
    if (claim.late) {
      const at = new Date(ctx.now()).toISOString()
      await appendLog(
        ctx.workspaceId,
        a.recipients.map((to) => ({ automationId: a.id, name: a.name, to, subject: a.subject, at, status: 'skipped' as const, error: 'orario saltato: più di 10 minuti di ritardo', slot: claim.slot.key }))
      )
      continue
    }
    // Ripreso da un passaggio di prima che si e' fermato: solo se non e' troppo tardi.
    if (claim.resumed && ctx.now() - claim.slot.at > CATCH_UP_MS) {
      await skipRest(ctx, a, claim.slot.key, 'orario saltato: più di 10 minuti di ritardo')
      continue
    }
    sent += await executeRun(ctx, a, claim.slot, checks)
  }
  return sent
}

async function executeRun(ctx: Context, a: Automation, slot: Slot, checks: Checks): Promise<number> {
  // Orario entro il prossimo minuto: si aspetta l'ora giusta.
  const wait = slot.at - ctx.now()
  if (wait > 0) await sleep(wait)
  if (checks.hidden) {
    await skipRest(ctx, a, slot.key, 'automazioni non attive per questo account')
    return 0
  }
  const mailbox = checks.mailbox
  if (!mailbox) {
    await skipRest(ctx, a, slot.key, 'nessuna email collegata')
    return 0
  }
  // Password non accettata (vista dalla lettura della casella): inutile provare, e tanti accessi sbagliati bloccano la casella.
  if (mailbox.status === 'expired') {
    await skipRest(ctx, a, slot.key, MAILBOX_RECONNECT)
    return 0
  }
  const fields: Partial<Pick<AutomationRun, 'subject' | 'body'>> = {}
  if (a.content.mode === 'ai' && !a.run?.body) {
    if (await workspaceAIBlocked(ctx.workspaceId)) {
      await skipRest(ctx, a, slot.key, 'AI del piano finita')
      return 0
    }
    try {
      // La presa dura piu' del tempo massimo dell'AI: un altro passaggio non riscrive il testo nel frattempo.
      if (!(await renewLease(ctx, a.id, slot.key, AI_LEASE_MS))) return 0
      const mail = await withTimeout(writeAutomationEmail(ctx.workspaceId, { brief: a.content.brief, subject: a.subject, now: ctx.now() }), AI_TIMEOUT_MS)
      fields.subject = mail.subject
      fields.body = mail.body
    } catch (error) {
      if (isAIBlockedError(error)) {
        await skipRest(ctx, a, slot.key, 'AI del piano finita')
        return 0
      }
      console.error('automazioni AI:', error instanceof Error ? error.message : error)
      await skipRest(ctx, a, slot.key, 'testo non scritto dall’AI')
      return 0
    }
  }
  let sent = 0
  let previous: StepResult | null = null
  for (let guard = 0; guard <= MAX_RECIPIENTS + 1; guard++) {
    if (ctx.now() > ctx.deadline - 20_000) {
      // Tempo di questo passaggio finito: i destinatari rimasti li fa il prossimo (entro 10 minuti).
      await step(ctx, a.id, slot.key, previous, fields, true)
      break
    }
    const next = await step(ctx, a.id, slot.key, previous, fields)
    previous = null
    if (!next) break
    if ('paused' in next) {
      const at = new Date(ctx.now()).toISOString()
      await appendLog(ctx.workspaceId, next.paused.map((to) => ({ automationId: a.id, name: a.name, to, subject: fields.subject || a.run?.subject || a.subject, at, status: 'skipped' as const, error: 'messa in pausa durante l’invio', slot: slot.key })))
      break
    }
    const run = next.run
    const subject = run.subject || a.subject || a.name
    const at = () => new Date(ctx.now()).toISOString()
    const entry = { automationId: a.id, name: a.name, to: next.to, subject, slot: slot.key }
    const reserved = await reserveDaily(ctx.workspaceId, ctx.now()).catch((error) => {
      console.error('automazioni limite:', error instanceof Error ? error.message : error)
      return null
    })
    if (reserved === null) {
      previous = { status: 'failed' }
      await appendLog(ctx.workspaceId, [{ ...entry, at: at(), status: 'failed', error: 'errore temporaneo, non inviata' }])
      continue
    }
    if (!reserved) {
      previous = { status: 'skipped' }
      await appendLog(ctx.workspaceId, [{ ...entry, at: at(), status: 'skipped', error: LIMIT_REACHED }])
      continue
    }
    try {
      // Una email per destinatario: nessuno vede gli altri indirizzi.
      await ctx.send(mailbox, { to: next.to, subject, text: run.body || '', fromName: checks.fromName })
      sent++
      previous = { status: 'sent' }
      await appendLog(ctx.workspaceId, [{ ...entry, at: at(), status: 'sent' }])
    } catch (error) {
      await releaseDaily(ctx.workspaceId, ctx.now())
      console.error('automazioni invio:', error instanceof Error ? error.message : error)
      previous = { status: 'failed' }
      const reason = sendError(error)
      await appendLog(ctx.workspaceId, [{ ...entry, at: at(), status: 'failed', error: reason }])
      // Problema della casella (password, server che non risponde), non del destinatario: ci si ferma
      // qui, senza un accesso per ogni destinatario rimasto.
      if (mailboxDown(error)) {
        await skipRest(ctx, a, slot.key, /password|ricollegare/i.test(reason) ? MAILBOX_RECONNECT : reason, 1)
        break
      }
    }
    // Un po' di pausa tra un'email e l'altra (solo se ne restano).
    if (run.pending.length) await sleep(spacing(ctx))
  }
  return sent
}

/** Automazioni dello spazio in breve (per l'Assistente). */
export function automationSummary(a: AutomationView | Automation, now = Date.now()): Record<string, unknown> {
  const next = 'running' in a ? a.nextRun : nextRunAt(a, now)
  return {
    id: a.id,
    nome: a.name,
    attiva: a.active,
    // Una volta sola: "fatta" solo se e' partita almeno un'email, altrimenti "non inviata" con il motivo.
    ...(a.done ? (a.lastRun?.sent ? { fatta: true } : { non_inviata: true, ...(a.lastRun?.note ? { motivo: a.lastRun.note } : {}) }) : {}),
    destinatari: a.recipients,
    oggetto: a.subject || (a.content.mode === 'ai' ? '(lo scrive l’AI)' : ''),
    testo: a.content.mode === 'fixed' ? { tipo: 'fisso', testo: a.content.body.slice(0, 600) } : { tipo: 'scritto dall’AI ogni volta', indicazioni: a.content.brief.slice(0, 600) },
    quando: describeSchedule(a.schedule),
    prossimo_invio: next ? romeLabel(next) : null,
    ultimo_invio: a.lastRun ? { quando: romeLabel(a.lastRun.at), inviate: a.lastRun.sent, non_riuscite: a.lastRun.failed, saltate: a.lastRun.skipped, ...(a.lastRun.note ? { nota: a.lastRun.note } : {}) } : null,
  }
}
