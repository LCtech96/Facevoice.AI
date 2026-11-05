import { after } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { FACEVOICE_WORKSPACE_ID, workspaceDb } from '@/lib/workspace-db'
import { eurPerUsd } from '@/lib/eur'
import { updateSetting } from '@/lib/settings-store'
import { AI_BLOCKED_MESSAGE, type ShownLight, type UsageLevel, type UsageLight, type UsageStatus } from '@/lib/usage-shared'

// AI inclusa nei piani dei clienti. La spesa si conta per PERSONA (il titolare
// dello spazio di lavoro), sommando tutti gli spazi di cui e' titolare, in un
// periodo mensile che parte dal giorno in cui si e' registrata. In base agli
// euro spesi il cliente vede un gettone (verde, arancione, rosso); al limite
// l'AI si ferma per tutti i suoi spazi fino al periodo dopo. A ogni fase parte
// un avviso al sito principale (pannello di Facevoice: notifica ed email).
// Chi e' titolare dello spazio Facevoice non ha limiti e non genera avvisi.

// --- Soglie per piano (in euro, per periodo) ---------------------------------

export type Budget = { orange: number; red: number; limit: number }

/** Soglie di oggi, uguali per tutti i piani. */
export const DEFAULT_BUDGET: Budget = { orange: 5, red: 15, limit: 20 }

/**
 * Soglie per piano (workspaces.plan). Per dare piu' AI a un piano a pagamento basta
 * cambiare qui i suoi numeri; un piano che non c'e' usa DEFAULT_BUDGET.
 */
export const PLAN_BUDGETS: Record<string, Budget> = {
  free: DEFAULT_BUDGET,
  beta: DEFAULT_BUDGET,
  starter: DEFAULT_BUDGET,
  pro: DEFAULT_BUDGET,
  business: DEFAULT_BUDGET,
}

/** Con piu' spazi (e piani diversi) vale il piano che include piu' AI. */
export function budgetForPlans(plans: string[]): Budget {
  return plans.map((p) => PLAN_BUDGETS[p] || DEFAULT_BUDGET).reduce((best, b) => (b.limit > best.limit ? b : best), DEFAULT_BUDGET)
}

// --- Periodo mensile ----------------------------------------------------------

export type UsagePeriod = { start: Date; end: Date; daysLeft: number }
const DAY_MS = 86_400_000

/**
 * Periodo in corso: parte ogni mese lo stesso giorno (e alla stessa ora) della
 * registrazione; nei mesi piu' corti l'ultimo giorno del mese (es. il 31 -> 28 febbraio).
 */
export function periodFor(registeredAt: string | Date | null | undefined, now = new Date()): UsagePeriod {
  const parsed = registeredAt ? new Date(registeredAt) : null
  const anchor = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const day = anchor.getUTCDate()
  const at = (year: number, month: number) => {
    const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
    return new Date(Date.UTC(year, month, Math.min(day, last), anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds()))
  }
  const year = now.getUTCFullYear()
  let month = now.getUTCMonth()
  let start = at(year, month)
  if (start.getTime() > now.getTime()) start = at(year, --month)
  const end = at(year, month + 1)
  return { start, end, daysLeft: Math.max(0, Math.ceil((end.getTime() - now.getTime()) / DAY_MS)) }
}

// --- Livelli e gettoni ----------------------------------------------------------

export const round2 = (value: number) => Math.round(value * 100) / 100

/** Verde appena si inizia a spendere, poi arancione, rosso e bloccato alle soglie. */
export function levelFor(eur: number, budget: Budget): UsageLevel {
  if (!(eur > 0)) return 'none'
  const value = round2(eur)
  if (value >= budget.limit) return 'blocked'
  if (value >= budget.red) return 'red'
  if (value >= budget.orange) return 'orange'
  return 'green'
}

/** Gettone mostrato: la scelta di Facevoice se c'e', altrimenti quello automatico. */
export function shownLight(level: UsageLevel, override: UsageLight | null): ShownLight {
  return override ?? (level === 'blocked' ? 'red' : level)
}

const isLight = (value: unknown): value is UsageLight => value === 'green' || value === 'orange' || value === 'red'

// --- Collegamenti (da quale canale arriva la spesa) -------------------------------

export const CONNECTIONS = {
  email: 'Email',
  instagram: 'Instagram',
  facebook: 'Facebook',
  whatsapp: 'WhatsApp',
  web: 'Chat del sito',
  assistant: 'Assistente',
  content: 'Post e caroselli',
  other: 'Altro',
} as const
export type ConnectionKey = keyof typeof CONNECTIONS

const CHANNEL_KEYS = new Set<ConnectionKey>(['email', 'instagram', 'facebook', 'whatsapp', 'web'])

/**
 * Nome della funzione con il canale, per ai_usage (es. "saas_risposte:instagram").
 * Le pagine che raggruppano per funzione usano baseFeature().
 */
export function channelFeature(feature: string, platform: string | null | undefined): string {
  const key = String(platform || '').toLowerCase() as ConnectionKey
  return CHANNEL_KEYS.has(key) ? `${feature}:${key}` : feature
}

/** La funzione senza il canale ("saas_risposte:instagram" -> "saas_risposte"). */
export const baseFeature = (feature: string) => feature.split(':')[0]

/** Funzioni che non dicono il canale nel nome. */
const FEATURE_CONNECTIONS: Record<string, ConnectionKey> = {
  saas_assistente: 'assistant',
  saas_post: 'content',
  saas_slide: 'content',
  saas_didascalia: 'content',
  saas_lettura_foto: 'content',
  saas_recupero_testi: 'content',
  saas_estrai_foto: 'content',
  // Funzioni dello spazio Facevoice.
  chat_sito: 'web',
  risposte_email: 'email',
  email_clienti: 'email',
  lettura_media_direct: 'instagram',
  assistente_clienti: 'assistant',
  lettura_immagini: 'assistant',
  blog_automatico: 'content',
  blog_carosello: 'content',
  super_chat_carosello: 'content',
}

/** Collegamento di una riga di ai_usage: dal canale nel nome, altrimenti dal tipo di funzione. */
export function connectionOf(feature: string | null | undefined): ConnectionKey {
  const [base, channel] = String(feature || '').toLowerCase().split(':')
  if (channel && CHANNEL_KEYS.has(channel as ConnectionKey)) return channel as ConnectionKey
  if (FEATURE_CONNECTIONS[base]) return FEATURE_CONNECTIONS[base]
  // Righe di prima (senza canale) o funzioni nuove: si indovina dal nome.
  if (/whatsapp/.test(base)) return 'whatsapp'
  if (/instagram|direct/.test(base)) return 'instagram'
  if (/facebook|messenger/.test(base)) return 'facebook'
  if (/e?mail/.test(base)) return 'email'
  if (/chat_sito|sito|site|web/.test(base)) return 'web'
  if (/assistente|assistant/.test(base)) return 'assistant'
  if (/post|slide|carosell|didascal|caption|foto|immagin/.test(base)) return 'content'
  return 'other'
}

export type ConnectionSpend = { key: ConnectionKey; label: string; eur: number; calls: number }

// --- Titolari degli spazi -------------------------------------------------------

type Owner = {
  id: string
  email: string
  name: string
  createdAt: string
  ownedIds: string[]
  plans: string[]
  unlimited: boolean
}

const OWNER_TTL_MS = 5 * 60_000
const workspaceOwners = new Map<string, { ownerId: string | null; at: number }>()
const owners = new Map<string, { owner: Owner | null; at: number }>()

const displayName = (user: Pick<User, 'email' | 'user_metadata'>) => {
  const meta = (user.user_metadata || {}) as Record<string, unknown>
  const name = [meta.full_name, meta.name].find((v) => typeof v === 'string' && v.trim()) as string | undefined
  return (name || user.email || '').trim()
}
const avatarOf = (user: Pick<User, 'user_metadata'>) => {
  const meta = (user.user_metadata || {}) as Record<string, unknown>
  const url = [meta.avatar_url, meta.picture].find((v) => typeof v === 'string' && v.startsWith('http')) as string | undefined
  return url || null
}

async function ownerIdOf(workspaceId: string): Promise<string | null> {
  const cached = workspaceOwners.get(workspaceId)
  if (cached && Date.now() - cached.at < OWNER_TTL_MS) return cached.ownerId
  const { data, error } = await supabaseAdmin
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', workspaceId)
    .eq('role', 'owner')
    .order('created_at', { ascending: true })
    .limit(1)
  if (error) throw new Error(`titolare non letto: ${error.message}`)
  let ownerId = (data?.[0]?.user_id as string | undefined) ?? null
  if (!ownerId) {
    const { data: ws } = await supabaseAdmin.from('workspaces').select('created_by').eq('id', workspaceId).maybeSingle()
    ownerId = (ws?.created_by as string | undefined) ?? null
  }
  workspaceOwners.set(workspaceId, { ownerId, at: Date.now() })
  return ownerId
}

async function ownerProfile(userId: string): Promise<Owner | null> {
  const cached = owners.get(userId)
  if (cached && Date.now() - cached.at < OWNER_TTL_MS) return cached.owner
  const [{ data: rows, error }, { data: auth }] = await Promise.all([
    supabaseAdmin.from('workspace_members').select('workspace_id, workspaces(plan)').eq('user_id', userId).eq('role', 'owner'),
    supabaseAdmin.auth.admin.getUserById(userId),
  ])
  if (error) throw new Error(`spazi del titolare non letti: ${error.message}`)
  const user = auth?.user
  const owner: Owner | null = user
    ? {
        id: user.id,
        email: (user.email || '').toLowerCase(),
        name: displayName(user),
        createdAt: user.created_at,
        ownedIds: (rows || []).map((r) => r.workspace_id as string),
        plans: (rows || []).map((r) => {
          const ws = (Array.isArray(r.workspaces) ? r.workspaces[0] : r.workspaces) as { plan?: string } | null
          return ws?.plan || 'free'
        }),
        unlimited: (rows || []).some((r) => r.workspace_id === FACEVOICE_WORKSPACE_ID),
      }
    : null
  owners.set(userId, { owner, at: Date.now() })
  return owner
}

async function ownerOfWorkspace(workspaceId: string): Promise<Owner | null> {
  const ownerId = await ownerIdOf(workspaceId)
  return ownerId ? ownerProfile(ownerId) : null
}

// --- Spesa del periodo ------------------------------------------------------------

type UsageRow = { feature: string; cost_usd: number | string | null }

/** Righe di ai_usage riuscite dal periodo in poi, in tutti gli spazi del titolare. */
async function readUsage(workspaceIds: string[], since: Date, paidOnly: boolean): Promise<UsageRow[]> {
  const rows: UsageRow[] = []
  for (const id of workspaceIds) {
    for (let from = 0; from < 50_000; from += 1000) {
      let query = workspaceDb(id).from('ai_usage').select('feature, cost_usd').eq('outcome', 'ok').gte('created_at', since.toISOString())
      if (paidOnly) query = query.gt('cost_usd', 0)
      const { data, error } = await query.order('created_at', { ascending: false }).range(from, from + 999)
      if (error) throw new Error(`consumo non letto: ${error.message}`)
      rows.push(...((data || []) as UsageRow[]))
      if (!data || data.length < 1000) break
    }
  }
  return rows
}

function summarize(rows: UsageRow[], rate: number): { usd: number; eur: number; byConnection: ConnectionSpend[] } {
  let usd = 0
  const byKey = new Map<ConnectionKey, { usd: number; calls: number }>()
  for (const row of rows) {
    const cost = Number(row.cost_usd || 0)
    usd += cost
    const key = connectionOf(row.feature)
    const entry = byKey.get(key) || { usd: 0, calls: 0 }
    entry.usd += cost
    entry.calls++
    byKey.set(key, entry)
  }
  const byConnection = [...byKey.entries()]
    .map(([key, t]) => ({ key, label: CONNECTIONS[key], eur: round2(t.usd * rate), calls: t.calls }))
    .filter((c) => c.eur > 0)
    .sort((a, b) => b.eur - a.eur || b.calls - a.calls)
  return { usd, eur: usd * rate, byConnection }
}

// Spesa del titolare tenuta in memoria per poco: a ogni chiamata si aggiunge il
// costo appena registrato. Vicino al limite si rilegge sempre dal database.
const SPEND_TTL_MS = 60_000
const NEAR_LIMIT = 0.9
const spendCache = new Map<string, { periodStart: string; usd: number; at: number }>()

async function ownerUsd(owner: Owner, period: UsagePeriod, fresh: boolean): Promise<number> {
  const periodStart = period.start.toISOString()
  const cached = spendCache.get(owner.id)
  if (!fresh && cached && cached.periodStart === periodStart && Date.now() - cached.at < SPEND_TTL_MS) return cached.usd
  const startedAt = Date.now()
  const { usd } = summarize(await readUsage(owner.ownedIds, period.start, true), 1)
  spendCache.set(owner.id, { periodStart, usd, at: startedAt })
  return usd
}

type OwnerState = { owner: Owner; budget: Budget; period: UsagePeriod; eur: number; level: UsageLevel; blocked: boolean }

async function ownerState(owner: Owner, fresh = false): Promise<OwnerState> {
  const budget = budgetForPlans(owner.plans)
  const period = periodFor(owner.createdAt)
  const rate = await eurPerUsd()
  let eur = (await ownerUsd(owner, period, fresh)) * rate
  // Vicino al limite (ma non ancora oltre) il blocco deve essere preciso: si rifa' il conto.
  if (!fresh && round2(eur) < budget.limit && eur >= budget.limit * NEAR_LIMIT) eur = (await ownerUsd(owner, period, true)) * rate
  const level = levelFor(eur, budget)
  return { owner, budget, period, eur, level, blocked: !owner.unlimited && level === 'blocked' }
}

// --- Blocco dell'AI -------------------------------------------------------------

/** L'AI inclusa nel piano e' finita: nessuna chiamata parte per questo spazio. */
export class AIBlockedError extends Error {
  readonly blocked = true
  constructor() {
    super(AI_BLOCKED_MESSAGE)
    this.name = 'AIBlockedError'
  }
}

export const isAIBlockedError = (error: unknown): error is AIBlockedError =>
  error instanceof AIBlockedError || (error instanceof Error && error.name === 'AIBlockedError')

/**
 * true se il titolare dello spazio ha finito l'AI del periodo. Lo spazio Facevoice
 * (e chi ne e' titolare) non si blocca mai. Se il conto non si riesce a fare
 * (database irraggiungibile) non si blocca: il lavoro del cliente non si ferma per un guasto.
 */
export async function workspaceAIBlocked(workspaceId: string | null | undefined): Promise<boolean> {
  if (!workspaceId || workspaceId === FACEVOICE_WORKSPACE_ID) return false
  try {
    const owner = await ownerOfWorkspace(workspaceId)
    if (!owner || owner.unlimited) return false
    return (await ownerState(owner)).blocked
  } catch (error) {
    console.warn('limite AI non verificato:', error instanceof Error ? error.message : error)
    return false
  }
}

/** Da chiamare prima di ogni chiamata all'AI per uno spazio: lancia AIBlockedError al limite. */
export async function assertAIAllowed(workspaceId: string | null | undefined): Promise<void> {
  if (await workspaceAIBlocked(workspaceId)) throw new AIBlockedError()
}

// --- Gettone e scelta a mano ---------------------------------------------------------

const lightKey = (userId: string) => `usage_light:${userId}`

const parseJson = (raw: unknown): unknown => {
  if (typeof raw !== 'string') return raw ?? null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function readOverride(userId: string): Promise<UsageLight | null> {
  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', lightKey(userId)).maybeSingle()
  const mode = (parseJson(data?.value) as { mode?: unknown } | null)?.mode
  return isLight(mode) ? mode : null
}

/** Gettone scelto da Facevoice per un utente ('auto' = torna automatico). */
export async function setUsageLight(userId: string, mode: 'auto' | UsageLight): Promise<UsageLight | null> {
  if (mode === 'auto') {
    const { error } = await supabaseAdmin.from('app_settings').delete().eq('key', lightKey(userId))
    if (error) throw new Error(error.message)
    return null
  }
  const now = new Date().toISOString()
  const { error } = await supabaseAdmin
    .from('app_settings')
    .upsert({ key: lightKey(userId), value: JSON.stringify({ mode, at: now }), updated_at: now }, { onConflict: 'key' })
  if (error) throw new Error(error.message)
  return mode
}

/** Stato per l'area clienti: il gettone del titolare dello spazio, mai gli euro. */
export async function customerUsageStatus(workspaceId: string): Promise<UsageStatus> {
  const owner = await ownerOfWorkspace(workspaceId)
  if (!owner) {
    const period = periodFor(null)
    return { shown: 'none', blocked: false, daysLeft: period.daysLeft, periodEnd: period.end.toISOString() }
  }
  const [state, override] = await Promise.all([ownerState(owner), readOverride(owner.id)])
  return {
    shown: shownLight(state.level, override),
    blocked: state.blocked,
    daysLeft: state.period.daysLeft,
    periodEnd: state.period.end.toISOString(),
  }
}

// --- Avvisi al sito principale ---------------------------------------------------------

type AlertLevel = Exclude<UsageLevel, 'none'>
const ALERT_ORDER: AlertLevel[] = ['green', 'orange', 'red', 'blocked']
type AlertRecord = { sent: AlertLevel[]; sending: { level: AlertLevel; at: number } | null; at?: string }

const alertKey = (userId: string, periodStart: string) => `usage_alerts:${userId}:${periodStart}`
const parseAlerts = (raw: string | null): AlertRecord => {
  const value = parseJson(raw) as Partial<AlertRecord> | null
  return {
    sent: Array.isArray(value?.sent) ? value.sent.filter((l): l is AlertLevel => ALERT_ORDER.includes(l as AlertLevel)) : [],
    sending: value?.sending && ALERT_ORDER.includes(value.sending.level) ? value.sending : null,
    at: value?.at,
  }
}
/** Livelli gia' avvisati, visti da questa istanza (evita di rileggere a ogni chiamata). */
const knownSent = new Map<string, Set<AlertLevel>>()
const SENDING_LOCK_MS = 60_000

export const bridgeSecret = () => (process.env.FACEVOICE_BRIDGE_SECRET || '').trim()
export const mainSiteUrl = () => (process.env.MAIN_SITE_URL || 'https://www.facevoice.ai').trim().replace(/\/+$/, '')

let warnedNoSecret = false

async function postAlert(body: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`${mainSiteUrl()}/api/bridge/usage-alert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bridge-secret': bridgeSecret() },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) console.warn(`avviso consumo AI non consegnato: ${res.status}`)
    return res.ok
  } catch (error) {
    console.warn('avviso consumo AI non consegnato:', error instanceof Error ? error.message : error)
    return false
  }
}

/**
 * Dopo una chiamata registrata: se il titolare e' entrato in una fase nuova (verde,
 * arancione, rosso, bloccato) parte un solo avviso per fase e per periodo. Se si
 * salta una fase si avvisa solo la piu' alta e le altre si segnano come fatte.
 * Si segna come mandato solo dopo la risposta positiva del sito principale:
 * se non risponde si riprova alla chiamata successiva.
 */
async function checkAlerts(workspaceId: string, costUsd: number, loggedAt: number): Promise<void> {
  const owner = await ownerOfWorkspace(workspaceId)
  if (!owner || owner.unlimited) return
  const period = periodFor(owner.createdAt)
  const periodStart = period.start.toISOString()
  // Il costo appena registrato entra nel conto in memoria (se il conto e' di prima).
  const cached = spendCache.get(owner.id)
  if (cached && cached.periodStart === periodStart && cached.at < loggedAt) cached.usd += costUsd
  const state = await ownerState(owner)
  if (state.level === 'none') return
  const key = alertKey(owner.id, periodStart)
  if (knownSent.get(key)?.has(state.level as AlertLevel)) return
  if (!bridgeSecret()) {
    if (!warnedNoSecret) console.warn('avvisi consumo AI: FACEVOICE_BRIDGE_SECRET mancante, nessun avviso inviato')
    warnedNoSecret = true
    return
  }

  // Possibile fase nuova: conto preciso dal database, con il dettaglio per collegamento.
  const rate = await eurPerUsd()
  const fresh = summarize(await readUsage(owner.ownedIds, period.start, true), rate)
  spendCache.set(owner.id, { periodStart, usd: fresh.usd, at: Date.now() })
  const level = levelFor(fresh.eur, state.budget)
  if (level === 'none') return
  const upTo = ALERT_ORDER.slice(0, ALERT_ORDER.indexOf(level as AlertLevel) + 1)

  // Prenotazione dell'invio (un'altra funzione potrebbe essere sulla stessa soglia).
  const claim: { level: AlertLevel | null } = { level: null }
  const record = await updateSetting<AlertRecord>(key, parseAlerts, (current) => {
    claim.level = null
    if (upTo.every((l) => current.sent.includes(l))) return false
    if (current.sending && Date.now() - current.sending.at < SENDING_LOCK_MS) return false
    claim.level = level as AlertLevel
    return { ...current, sending: { level: level as AlertLevel, at: Date.now() } }
  })
  knownSent.set(key, new Set(record.sent))
  if (!claim.level) return

  const delivered = await postAlert({
    userId: owner.id,
    email: owner.email,
    name: owner.name,
    level: claim.level,
    eur: round2(fresh.eur),
    limitEur: state.budget.limit,
    periodEnd: period.end.toISOString(),
    daysLeft: period.daysLeft,
    byConnection: fresh.byConnection.map((c) => ({ label: c.label, eur: c.eur })),
  })
  const saved = await updateSetting<AlertRecord>(key, parseAlerts, (current) =>
    delivered
      ? { sent: ALERT_ORDER.filter((l) => upTo.includes(l) || current.sent.includes(l)), sending: null, at: new Date().toISOString() }
      : { ...current, sending: null }
  )
  knownSent.set(key, new Set(saved.sent))
  if (delivered) console.log(`avviso consumo AI: ${owner.email} -> ${claim.level} (${round2(fresh.eur)} €)`)
}

/**
 * Chiamata registrata (da lib/ai): il controllo delle fasi gira dopo la risposta,
 * senza far aspettare il cliente e senza mai far fallire la chiamata all'AI.
 */
export function afterAIUsage(workspaceId: string | null | undefined, costUsd: number, logged: Promise<boolean>) {
  if (!workspaceId || workspaceId === FACEVOICE_WORKSPACE_ID || !(costUsd > 0)) return
  const job = async () => {
    try {
      if (!(await logged)) return
      await checkAlerts(workspaceId, costUsd, Date.now())
    } catch (error) {
      console.warn('avvisi consumo AI:', error instanceof Error ? error.message : error)
    }
  }
  try {
    after(job)
  } catch {
    // Fuori da una richiesta (after non disponibile): si lancia e basta, al massimo 5 secondi.
    void Promise.race([job(), new Promise((resolve) => setTimeout(resolve, 5000))])
  }
}

// --- Elenco per il pannello di Facevoice (collegamento con il sito principale) -------

export type BridgeUser = {
  id: string
  email: string
  name: string
  avatarUrl: string | null
  createdAt: string
  lastSignInAt: string | null
  workspaces: { id: string; name: string; plan: string; role: 'owner' | 'admin' | 'member' }[]
  unlimited: boolean
  period: { start: string; end: string; daysLeft: number }
  eur: number
  level: UsageLevel
  override: UsageLight | null
  shown: ShownLight
  blocked: boolean
  byConnection: ConnectionSpend[]
}

async function allAuthUsers(): Promise<User[]> {
  const users: User[] = []
  const perPage = 1000
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage })
    if (error) throw new Error(`utenti non letti: ${error.message}`)
    users.push(...(data?.users || []))
    if (!data?.users || data.users.length < perPage) break
  }
  return users
}

type MemberRow = { user_id: string; role: string; workspaces: unknown }

async function allMemberships(): Promise<MemberRow[]> {
  const rows: MemberRow[] = []
  for (let from = 0; from < 100_000; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('workspace_members')
      .select('user_id, role, created_at, workspaces(id, name, plan)')
      .order('created_at', { ascending: true })
      .range(from, from + 999)
    if (error) throw new Error(`spazi non letti: ${error.message}`)
    rows.push(...((data || []) as MemberRow[]))
    if (!data || data.length < 1000) break
  }
  return rows
}

async function allOverrides(): Promise<Map<string, UsageLight>> {
  const map = new Map<string, UsageLight>()
  const { data, error } = await supabaseAdmin.from('app_settings').select('key, value').like('key', 'usage_light:%').limit(10_000)
  if (error) throw new Error(`gettoni non letti: ${error.message}`)
  for (const row of data || []) {
    const mode = (parseJson(row.value) as { mode?: unknown } | null)?.mode
    if (isLight(mode)) map.set(String(row.key).slice('usage_light:'.length), mode)
  }
  return map
}

/** Tutti gli utenti registrati con spesa, gettone e dettaglio per collegamento. */
export async function bridgeUsers(): Promise<{ updatedAt: string; thresholds: Budget; users: BridgeUser[] }> {
  const now = new Date()
  const [users, memberships, overrides, rate] = await Promise.all([allAuthUsers(), allMemberships(), allOverrides(), eurPerUsd()])

  const spacesOf = new Map<string, BridgeUser['workspaces']>()
  for (const row of memberships) {
    const ws = (Array.isArray(row.workspaces) ? row.workspaces[0] : row.workspaces) as { id: string; name: string; plan: string } | null
    if (!ws) continue
    const role = row.role === 'owner' || row.role === 'admin' ? row.role : 'member'
    const list = spacesOf.get(row.user_id) || []
    list.push({ id: ws.id, name: ws.name, plan: ws.plan, role })
    spacesOf.set(row.user_id, list)
  }

  // Conti in parallelo, pochi alla volta.
  const queue = [...users]
  const result: BridgeUser[] = []
  const worker = async () => {
    for (let user = queue.shift(); user; user = queue.shift()) {
      const spaces = spacesOf.get(user.id) || []
      const owned = spaces.filter((w) => w.role === 'owner')
      const unlimited = owned.some((w) => w.id === FACEVOICE_WORKSPACE_ID)
      const budget = budgetForPlans(owned.map((w) => w.plan))
      const period = periodFor(user.created_at, now)
      const spend = owned.length
        ? summarize(await readUsage(owned.map((w) => w.id), period.start, false), rate)
        : { usd: 0, eur: 0, byConnection: [] as ConnectionSpend[] }
      if (owned.length) spendCache.set(user.id, { periodStart: period.start.toISOString(), usd: spend.usd, at: now.getTime() })
      const level = levelFor(spend.eur, budget)
      const override = overrides.get(user.id) ?? null
      result.push({
        id: user.id,
        email: (user.email || '').toLowerCase(),
        name: displayName(user),
        avatarUrl: avatarOf(user),
        createdAt: user.created_at,
        lastSignInAt: user.last_sign_in_at ?? null,
        workspaces: spaces,
        unlimited,
        period: { start: period.start.toISOString(), end: period.end.toISOString(), daysLeft: period.daysLeft },
        eur: round2(spend.eur),
        level,
        override,
        shown: shownLight(level, override),
        blocked: !unlimited && level === 'blocked',
        byConnection: spend.byConnection,
      })
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  result.sort((a, b) => b.eur - a.eur || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  return { updatedAt: now.toISOString(), thresholds: DEFAULT_BUDGET, users: result }
}

/** L'utente esiste in questa app (per la scelta del gettone dal pannello). */
export async function userExists(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId)
  return !error && Boolean(data?.user)
}
