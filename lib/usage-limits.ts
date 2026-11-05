import { after } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { FACEVOICE_WORKSPACE_ID, workspaceDb } from '@/lib/workspace-db'
import { eurPerUsd, eurPerUsdNow } from '@/lib/eur'
import { updateSetting } from '@/lib/settings-store'
import { workspaceOwnerId } from '@/lib/workspace'
import {
  allBillingStates,
  billingConfigured,
  isLiveState,
  readBillingStates,
  refreshSubscription,
  renewalOverdue,
  subscriptionAIPlan,
  subscriptionPeriod,
  trialAvailableFor,
  type BillingState,
} from '@/lib/billing'
import {
  AI_BLOCKED_MESSAGE,
  noPlanMessage,
  type BlockReason,
  type ShownLight,
  type UsageLevel,
  type UsageLight,
  type UsageStatus,
} from '@/lib/usage-shared'

// AI inclusa nei piani dei clienti. La spesa si conta per PERSONA (il titolare
// dello spazio di lavoro), sommando tutti gli spazi di cui e' titolare, in un
// periodo mensile che parte dal giorno in cui si e' registrata. In base agli
// euro spesi il cliente vede un gettone (verde, arancione, rosso); al limite
// l'AI si ferma per tutti i suoi spazi fino al periodo dopo. A ogni fase parte
// un avviso al sito principale (pannello di Facevoice: notifica ed email).
// Lo spazio Facevoice e chi ne e' titolare non hanno limiti e non generano avvisi.
//
// Con i pagamenti online attivi (STRIPE_SECRET_KEY, vedi lib/billing.ts) il piano
// viene dall'abbonamento ('trial' durante la prova) e il periodo e' quello di
// Stripe; senza abbonamento in corso l'AI e' ferma ("nessun piano attivo").
// Senza la chiave tutto resta come prima: etichetta workspaces.plan e periodo
// dalla registrazione.

// --- Piani e soglie (in euro, per periodo) ----------------------------------------

export type Budget = { orange: number; red: number; limit: number }

/** Piani in ordine, dal piu' piccolo al piu' grande (workspaces.plan). */
export const PLAN_ORDER = ['free', 'trial', 'start', 'pro', 'business'] as const
export type PlanKey = (typeof PLAN_ORDER)[number]

/**
 * Soglie di ogni piano: l'UNICO posto dove si cambiano. free = chi non ha
 * ancora un abbonamento (tutti i clienti di oggi).
 */
export const PLAN_BUDGETS: Record<PlanKey, Budget> = {
  free: { orange: 5, red: 15, limit: 20 },
  trial: { orange: 1, red: 2, limit: 3 },
  start: { orange: 4, red: 11, limit: 15 },
  pro: { orange: 10, red: 30, limit: 40 },
  business: { orange: 25, red: 75, limit: 100 },
}

/** Piano mostrato per chi e' titolare dello spazio Facevoice (nessun limite). */
export const FACEVOICE_PLAN = 'facevoice'

/** Pagamenti online attivi e nessun abbonamento in corso: l'AI e' ferma. */
export const NO_PLAN = 'none'
const NO_PLAN_BUDGET: Budget = { orange: 0, red: 0, limit: 0 }

export const PLAN_LABELS: Record<PlanKey | typeof FACEVOICE_PLAN | typeof NO_PLAN, string> = {
  none: 'Nessun piano',
  free: 'Gratis',
  trial: 'Prova',
  start: 'Start',
  pro: 'Pro',
  business: 'Business',
  facevoice: 'Facevoice',
}

/** Etichetta del database -> piano (quelle sconosciute valgono "free"). */
export function asPlan(value: unknown): PlanKey {
  const key = String(value ?? '').trim().toLowerCase()
  return (PLAN_ORDER as readonly string[]).includes(key) ? (key as PlanKey) : 'free'
}

/** Con piu' spazi vale il piano piu' alto tra quelli di cui si e' titolari. */
export function effectivePlan(plans: unknown[]): PlanKey {
  return plans.map(asPlan).reduce<PlanKey>((best, p) => (PLAN_ORDER.indexOf(p) > PLAN_ORDER.indexOf(best) ? p : best), 'free')
}

export type PlanInfo = { plan: string; planLabel: string; budget: Budget }

/** Piano, etichetta e soglie di una persona (dai piani degli spazi di cui e' titolare). */
export function planInfo(ownedPlans: unknown[], unlimited: boolean): PlanInfo {
  const plan = effectivePlan(ownedPlans)
  // Per Facevoice le soglie servono solo a colorare il gettone: niente blocco, niente avvisi.
  return unlimited
    ? { plan: FACEVOICE_PLAN, planLabel: PLAN_LABELS.facevoice, budget: PLAN_BUDGETS[plan] }
    : { plan, planLabel: PLAN_LABELS[plan], budget: PLAN_BUDGETS[plan] }
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

/** Periodo in corso: quello dell'abbonamento se c'e', altrimenti dal giorno della registrazione. */
export function usagePeriod(
  registeredAt: string | Date | null | undefined,
  billingPeriod: { start: Date; end: Date } | null,
  now = new Date()
): UsagePeriod {
  if (!billingPeriod) return periodFor(registeredAt, now)
  // Rinnovo non ancora arrivato da Stripe: si va avanti di mese in mese dall'inizio dell'abbonamento.
  if (now.getTime() >= billingPeriod.end.getTime()) return periodFor(billingPeriod.start, now)
  const { start, end } = billingPeriod
  return { start, end, daysLeft: Math.max(0, Math.ceil((end.getTime() - now.getTime()) / DAY_MS)) }
}

// --- Piano in vigore (abbonamento o etichetta dello spazio) ----------------------------

export type ResolvedPlan = {
  info: PlanInfo
  /** Pagamenti online attivi e nessun abbonamento in corso: l'AI e' ferma. */
  noPlan: boolean
  /** Periodo dell'abbonamento che da' il piano (null = periodo dalla registrazione). */
  billingPeriod: { start: Date; end: Date } | null
  /** Abbonamento che da' il piano (o l'ultimo visto, se nessuno e' in corso). */
  billing: BillingState | null
}

/** L'ultimo abbonamento visto tra gli spazi di una persona (anche finito). */
function latestBilling(states: (BillingState | null | undefined)[]): BillingState | null {
  return states.filter((s): s is BillingState => Boolean(s?.subscriptionId)).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0] ?? null
}

/**
 * Piano di una persona dagli spazi di cui e' titolare. billing null (pagamenti
 * online non attivi): le etichette workspaces.plan, come sempre. Altrimenti
 * l'abbonamento in corso piu' alto ('trial' durante la prova); nessuno = AI ferma.
 */
export function resolvePlan(dbPlans: unknown[], unlimited: boolean, billing: (BillingState | null | undefined)[] | null): ResolvedPlan {
  if (unlimited || !billing) return { info: planInfo(dbPlans, unlimited), noPlan: false, billingPeriod: null, billing: null }
  let best: { plan: PlanKey; state: BillingState } | null = null
  for (const state of billing) {
    const plan = subscriptionAIPlan(state)
    if (plan && state && (!best || PLAN_ORDER.indexOf(plan) > PLAN_ORDER.indexOf(best.plan))) best = { plan, state }
  }
  if (!best) return { info: { plan: NO_PLAN, planLabel: PLAN_LABELS.none, budget: NO_PLAN_BUDGET }, noPlan: true, billingPeriod: null, billing: latestBilling(billing) }
  return {
    info: { plan: best.plan, planLabel: PLAN_LABELS[best.plan], budget: PLAN_BUDGETS[best.plan] },
    noPlan: false,
    billingPeriod: subscriptionPeriod(best.state),
    billing: best.state,
  }
}

// --- Livelli e gettoni ----------------------------------------------------------

export const round2 = (value: number) => Math.round(value * 100) / 100

/** Verde appena si inizia a spendere, poi arancione, rosso e bloccato alle soglie (sugli euro al centesimo). */
export function levelFor(eur: number, budget: Budget): UsageLevel {
  const value = round2(eur)
  if (!(value > 0)) return 'none'
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
export const baseFeature = (feature: string) => String(feature || '').split(':')[0]

/** Funzioni che non dicono il canale nel nome. */
const FEATURE_CONNECTIONS: Record<string, ConnectionKey> = {
  // Area clienti.
  saas_assistente: 'assistant',
  saas_post: 'content',
  saas_slide: 'content',
  saas_didascalia: 'content',
  saas_lettura_foto: 'content',
  saas_recupero_testi: 'content',
  saas_estrai_foto: 'content',
  // Funzioni dello spazio Facevoice (se compaiono in uno spazio cliente).
  chat_sito: 'web',
  risposte_email: 'email',
  email_clienti: 'email',
  lettura_media_direct: 'instagram',
  assistente_clienti: 'assistant',
  lettura_immagini: 'assistant',
  blog_automatico: 'content',
  blog_carosello: 'content',
  super_chat_carosello: 'content',
  // Senza canale nel nome non si sa da dove arrivano (righe di prima di questo cambio).
  saas_risposte: 'other',
  saas_commenti: 'other',
  saas_lettura_media: 'other',
  risposte_social: 'other',
  controrisposte_clienti: 'other',
  traduzioni_sito: 'other',
  traduzioni_messaggi: 'other',
  analisi_clienti: 'other',
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
  if (/(^|_)posts?(_|$)|slide|carosell|didascal|caption|foto|immagin/.test(base)) return 'content'
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
  const ownerId = await workspaceOwnerId(workspaceId)
  workspaceOwners.set(workspaceId, { ownerId, at: Date.now() })
  return ownerId
}

async function ownerProfile(userId: string): Promise<Owner | null> {
  const cached = owners.get(userId)
  if (cached && Date.now() - cached.at < OWNER_TTL_MS) return cached.owner
  const [{ data: rows, error }, { data: auth }] = await Promise.all([
    supabaseAdmin.from('workspace_members').select('workspace_id').eq('user_id', userId).eq('role', 'owner'),
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

// Il piano cambia con i pagamenti: si rilegge spesso (al massimo 30 secondi di
// ritardo tra le istanze) e, su questa istanza, subito dopo un evento di Stripe.
const PLAN_TTL_MS = 30_000
const ownerPlans = new Map<string, { plan: ResolvedPlan; ownedIds: string[]; at: number }>()
let planGeneration = 0

async function readWorkspacePlans(ids: string[]): Promise<string[]> {
  if (!ids.length) return []
  const { data, error } = await supabaseAdmin.from('workspaces').select('id, plan').in('id', ids)
  if (error) throw new Error(`piani non letti: ${error.message}`)
  return (data || []).map((w) => (w.plan as string) || 'free')
}

async function ownerPlan(owner: Owner): Promise<ResolvedPlan> {
  const cached = ownerPlans.get(owner.id)
  if (cached && Date.now() - cached.at < PLAN_TTL_MS) return cached.plan
  const generation = planGeneration
  const at = Date.now()
  const withBilling = billingConfigured() && !owner.unlimited
  const [plans, billing] = await Promise.all([
    withBilling ? Promise.resolve([] as string[]) : readWorkspacePlans(owner.ownedIds),
    withBilling ? readBillingStates(owner.ownedIds) : Promise.resolve(null),
  ])
  if (billing) for (const [id, state] of billing) if (renewalOverdue(state)) refreshOverdueBilling(id, state)
  const plan = resolvePlan(plans, owner.unlimited, billing ? owner.ownedIds.map((id) => billing.get(id) ?? null) : null)
  // Un cambio arrivato durante la lettura: non si tiene in memoria un piano forse vecchio.
  if (generation === planGeneration) ownerPlans.set(owner.id, { plan, ownedIds: owner.ownedIds, at })
  return plan
}

// Periodo finito e rinnovo non arrivato (webhook in ritardo o fermo): si rilegge da
// Stripe dopo la risposta, al massimo ogni 10 minuti per abbonamento su questa istanza.
// Se non arriva niente, oltre la tolleranza (lib/billing.ts) l'abbonamento non vale piu'.
const OVERDUE_REFRESH_MS = 10 * 60_000
const overdueRefreshAt = new Map<string, number>()

function refreshOverdueBilling(workspaceId: string, state: BillingState) {
  const subscriptionId = state.subscriptionId
  if (!subscriptionId) return
  const last = overdueRefreshAt.get(subscriptionId)
  if (last !== undefined && Date.now() - last < OVERDUE_REFRESH_MS) return
  overdueRefreshAt.set(subscriptionId, Date.now())
  runLater(async () => {
    const synced = await refreshSubscription(subscriptionId, workspaceId)
    if (synced?.applied) invalidateWorkspacePlan(synced.workspaceId)
  }, 'abbonamento non riletto')
}

/** Abbonamento cambiato (webhook, cambio di piano): il piano del titolare si rilegge subito su questa istanza. */
export function invalidateWorkspacePlan(workspaceId: string) {
  planGeneration++
  const ownerId = workspaceOwners.get(workspaceId)?.ownerId
  for (const [id, entry] of ownerPlans) {
    if (id === ownerId || entry.ownedIds.includes(workspaceId)) ownerPlans.delete(id)
  }
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
      // Dal piu' vecchio, con l'id a parita' di orario: le righe nuove finiscono dopo le pagine gia' lette.
      const { data, error } = await query.order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, from + 999)
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

// Spesa del titolare tenuta in memoria per poco (per non rileggere a ogni chiamata):
// ogni costo registrato da questa istanza si aggiunge subito (exact = false).
// Vicino al limite si rilegge SEMPRE dal database, cosi' il blocco e' preciso.
const SPEND_TTL_MS = 60_000
type CachedSpend = { periodStart: string; usd: number; at: number; exact: boolean }
const spendCache = new Map<string, CachedSpend>()

/** Da quanti euro prima del limite si smette di fidarsi della memoria. */
const limitMargin = (budget: Budget) => Math.max(2, budget.limit * 0.2)
/** Un conto appena preso dal database (es. dal controllo di un attimo prima) vale ancora. */
const FRESH_READ_MS = 5000

async function readOwnerUsd(owner: Owner, period: UsagePeriod): Promise<number> {
  const startedAt = Date.now()
  const { usd } = summarize(await readUsage(owner.ownedIds, period.start, true), 1)
  spendCache.set(owner.id, { periodStart: period.start.toISOString(), usd, at: startedAt, exact: true })
  return usd
}

async function ownerUsd(owner: Owner, period: UsagePeriod, budget: Budget, rate: number): Promise<number> {
  const cached = spendCache.get(owner.id)
  if (cached && cached.periodStart === period.start.toISOString() && Date.now() - cached.at < SPEND_TTL_MS) {
    const eur = cached.usd * rate
    // Lontano dal limite basta la memoria; oltre il limite basta un conto preso dal database
    // (nel periodo la spesa puo' solo crescere). In mezzo si rifa' il conto, salvo uno
    // preso dal database pochi secondi fa (il controllo prima e quello dentro callAI).
    if (eur < budget.limit - limitMargin(budget) || (cached.exact && (round2(eur) >= budget.limit || Date.now() - cached.at < FRESH_READ_MS))) return cached.usd
  }
  return readOwnerUsd(owner, period)
}

type OwnerState = {
  owner: Owner
  plan: PlanInfo
  budget: Budget
  period: UsagePeriod
  eur: number
  level: UsageLevel
  blocked: boolean
  /** Nessun abbonamento in corso (pagamenti online attivi): AI ferma, niente conti ne' avvisi. */
  noPlan: boolean
}

async function ownerState(owner: Owner): Promise<OwnerState> {
  const resolved = await ownerPlan(owner)
  const plan = resolved.info
  const budget = plan.budget
  const period = usagePeriod(owner.createdAt, resolved.billingPeriod)
  if (resolved.noPlan) return { owner, plan, budget, period, eur: 0, level: 'none', blocked: !owner.unlimited, noPlan: true }
  // Cambio senza aspettare: prima di una chiamata all'AI non si attende il servizio dei cambi.
  const rate = eurPerUsdNow()
  const eur = (await ownerUsd(owner, period, budget, rate)) * rate
  const level = levelFor(eur, budget)
  return { owner, plan, budget, period, eur, level, blocked: !owner.unlimited && level === 'blocked', noPlan: false }
}

/** Costo appena registrato da questa istanza: entra subito nel conto in memoria del titolare. */
function noteSpend(workspaceId: string, costUsd: number) {
  const ownerId = workspaceOwners.get(workspaceId)?.ownerId
  const cached = ownerId ? spendCache.get(ownerId) : undefined
  if (!cached) return
  cached.usd += costUsd
  cached.exact = false
}

// --- Blocco dell'AI -------------------------------------------------------------

/** L'AI inclusa nel piano e' finita: nessuna chiamata parte per questo spazio. */
export class AIBlockedError extends Error {
  readonly blocked = true
  constructor(message: string = AI_BLOCKED_MESSAGE) {
    super(message)
    this.name = 'AIBlockedError'
  }
}

export const isAIBlockedError = (error: unknown): error is AIBlockedError =>
  error instanceof AIBlockedError || (error instanceof Error && error.name === 'AIBlockedError')

/**
 * Perche' l'AI dello spazio e' ferma: 'limit' (il titolare ha finito l'AI del
 * periodo), 'no_plan' (pagamenti online attivi e nessun abbonamento in corso),
 * null se puo' lavorare. Lo spazio Facevoice (e chi ne e' titolare) non si blocca mai.
 * Se il conto non si riesce a fare (database irraggiungibile) non si blocca: il
 * lavoro del cliente non si ferma per un guasto.
 */
async function blockReason(workspaceId: string | null | undefined): Promise<BlockReason | null> {
  if (!workspaceId || workspaceId === FACEVOICE_WORKSPACE_ID) return null
  try {
    const owner = await ownerOfWorkspace(workspaceId)
    if (!owner || owner.unlimited) return null
    const state = await ownerState(owner)
    if (state.noPlan) return 'no_plan'
    // Avviso "bloccato" non ancora consegnato (sito principale giu'): si riprova qui,
    // perche' da bloccato non arrivano piu' consumi nuovi che lo rilancino.
    if (state.blocked) scheduleAlertCheck(workspaceId)
    return state.blocked ? 'limit' : null
  } catch (error) {
    console.warn('limite AI non verificato:', error instanceof Error ? error.message : error)
    return null
  }
}

/** true se l'AI dello spazio e' ferma (limite del piano raggiunto o nessun piano attivo). */
export async function workspaceAIBlocked(workspaceId: string | null | undefined): Promise<boolean> {
  return (await blockReason(workspaceId)) !== null
}

const messageFor = async (reason: BlockReason, workspaceId: string) =>
  reason === 'no_plan' ? noPlanMessage(await trialAvailableFor(workspaceId).catch(() => false)) : AI_BLOCKED_MESSAGE

/** Testo da mostrare quando l'AI dello spazio e' ferma (dice se e' il limite o se manca il piano). */
export async function aiBlockedMessage(workspaceId: string | null | undefined): Promise<string> {
  const reason = await blockReason(workspaceId)
  return reason && workspaceId ? messageFor(reason, workspaceId) : AI_BLOCKED_MESSAGE
}

/** Da chiamare prima di ogni chiamata all'AI per uno spazio: lancia AIBlockedError se l'AI e' ferma. */
export async function assertAIAllowed(workspaceId: string | null | undefined): Promise<void> {
  const reason = await blockReason(workspaceId)
  if (reason && workspaceId) throw new AIBlockedError(await messageFor(reason, workspaceId))
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
  const billing = billingConfigured()
  const owner = await ownerOfWorkspace(workspaceId)
  if (!owner) {
    const period = periodFor(null)
    return { shown: 'none', blocked: false, daysLeft: period.daysLeft, periodEnd: period.end.toISOString(), billing }
  }
  const [state, override] = await Promise.all([ownerState(owner), readOverride(owner.id)])
  const blocked = workspaceId !== FACEVOICE_WORKSPACE_ID && state.blocked
  const reason: BlockReason | undefined = blocked ? (state.noPlan ? 'no_plan' : 'limit') : undefined
  return {
    shown: state.noPlan ? 'none' : shownLight(state.level, override),
    blocked,
    daysLeft: state.period.daysLeft,
    periodEnd: state.period.end.toISOString(),
    billing,
    ...(reason ? { reason } : {}),
    ...(reason === 'no_plan' ? { trialAvailable: await trialAvailableFor(workspaceId).catch(() => false) } : {}),
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
/** Un invio in corso blocca gli altri per al massimo un minuto (se la funzione muore a meta'). */
const SENDING_LOCK_MS = 60_000

export const bridgeSecret = () => (process.env.FACEVOICE_BRIDGE_SECRET || '').trim()
export const mainSiteUrl = () => (process.env.MAIN_SITE_URL || 'https://www.facevoice.ai').trim().replace(/\/+$/, '')

let warnedNoSecret = false

/**
 * Il sito principale manda notifica ed email prima di rispondere: si aspetta a lungo
 * (gira dopo la risposta, nessun cliente aspetta). 'unknown' = nessuna risposta in tempo,
 * forse gia' mandato: la prenotazione resta fino alla sua scadenza.
 */
const ALERT_TIMEOUT_MS = 20_000

async function postAlert(body: Record<string, unknown>): Promise<'ok' | 'failed' | 'unknown'> {
  try {
    const res = await fetch(`${mainSiteUrl()}/api/bridge/usage-alert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bridge-secret': bridgeSecret() },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
    })
    if (!res.ok) console.warn(`avviso consumo AI non consegnato: ${res.status}`)
    return res.ok ? 'ok' : 'failed'
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    console.warn(`avviso consumo AI ${timedOut ? 'senza risposta' : 'non consegnato'}:`, error instanceof Error ? error.message : error)
    return timedOut ? 'unknown' : 'failed'
  }
}

/** Soglia della fase dopo (null se gia' bloccato). */
const nextThreshold = (level: UsageLevel, budget: Budget): number | null =>
  level === 'green' ? budget.orange : level === 'orange' ? budget.red : level === 'red' ? budget.limit : null

/**
 * Se il titolare e' entrato in una fase nuova (verde, arancione, rosso, bloccato)
 * parte un solo avviso per fase e per periodo. Se si salta una fase si avvisa solo
 * la piu' alta e le altre si segnano come fatte. Si segna come mandato solo dopo
 * la risposta positiva del sito principale: se non risponde si riprova alla
 * chiamata successiva.
 */
async function checkAlerts(workspaceId: string): Promise<void> {
  const owner = await ownerOfWorkspace(workspaceId)
  if (!owner || owner.unlimited) return
  const state = await ownerState(owner)
  // Senza piano nessun avviso di consumo: l'AI e' ferma per un altro motivo.
  if (state.noPlan || state.level === 'none') return
  const { period, budget } = state
  const key = alertKey(owner.id, period.start.toISOString())
  // La memoria vede solo la spesa di questa istanza: se non e' un conto preso dal database
  // ed e' vicina alla fase dopo, si ricontrolla (un'altra istanza potrebbe averla superata).
  const next = nextThreshold(state.level, budget)
  const unsure = spendCache.get(owner.id)?.exact === false && next !== null && state.eur >= next - Math.max(1, next * 0.1)
  if (!unsure && knownSent.get(key)?.has(state.level as AlertLevel)) return
  if (!bridgeSecret()) {
    if (!warnedNoSecret) console.warn('avvisi consumo AI: FACEVOICE_BRIDGE_SECRET mancante, nessun avviso inviato')
    warnedNoSecret = true
    return
  }

  // Possibile fase nuova: conto preciso dal database, con il dettaglio per collegamento.
  const rate = await eurPerUsd()
  const fresh = summarize(await readUsage(owner.ownedIds, period.start, true), rate)
  spendCache.set(owner.id, { periodStart: period.start.toISOString(), usd: fresh.usd, at: Date.now(), exact: true })
  const level = levelFor(fresh.eur, budget)
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

  const delivery = await postAlert({
    userId: owner.id,
    email: owner.email,
    name: owner.name,
    planLabel: state.plan.planLabel,
    level: claim.level,
    eur: round2(fresh.eur),
    limitEur: budget.limit,
    periodEnd: period.end.toISOString(),
    daysLeft: period.daysLeft,
    byConnection: fresh.byConnection.map((c) => ({ label: c.label, eur: c.eur })),
  })
  // Nessuna risposta in tempo: forse arrivato; si riprova solo quando scade la prenotazione.
  if (delivery === 'unknown') return
  const delivered = delivery === 'ok'
  const saved = await updateSetting<AlertRecord>(key, parseAlerts, (current) =>
    delivered
      ? { sent: ALERT_ORDER.filter((l) => upTo.includes(l) || current.sent.includes(l)), sending: null, at: new Date().toISOString() }
      : { ...current, sending: null }
  )
  knownSent.set(key, new Set(saved.sent))
  if (delivered) console.log(`avviso consumo AI: ${owner.email} -> ${claim.level} (${round2(fresh.eur)} €)`)
}

/** Lavoro da fare dopo la risposta (after), senza mai far fallire la chiamata all'AI. */
function runLater(job: () => Promise<void>, label = 'avvisi consumo AI') {
  const safe = async () => {
    try {
      await job()
    } catch (error) {
      console.warn(`${label}:`, error instanceof Error ? error.message : error)
    }
  }
  try {
    after(safe)
  } catch {
    // Fuori da una richiesta (after non disponibile): si lancia e basta, al massimo 5 secondi.
    void Promise.race([safe(), new Promise((resolve) => setTimeout(resolve, 5000))])
  }
}

function scheduleAlertCheck(workspaceId: string) {
  runLater(() => checkAlerts(workspaceId))
}

/**
 * Chiamata registrata (da lib/ai): il costo entra subito nel conto in memoria
 * (vale per il blocco gia' dalla chiamata dopo, anche nella stessa richiesta);
 * il controllo delle fasi e gli avvisi girano dopo la risposta.
 */
export function afterAIUsage(workspaceId: string | null | undefined, costUsd: number, logged: Promise<boolean>) {
  if (!workspaceId || workspaceId === FACEVOICE_WORKSPACE_ID) return
  if (costUsd > 0) noteSpend(workspaceId, costUsd)
  // Anche le chiamate gratuite: un avviso non consegnato si riprova al consumo dopo
  // (se non c'e' niente da mandare checkAlerts si ferma subito, dalla memoria).
  runLater(async () => {
    if (await logged) await checkAlerts(workspaceId)
  })
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
  plan: string
  planLabel: string
  limitEur: number
  thresholds: Budget
  unlimited: boolean
  period: { start: string; end: string; daysLeft: number }
  eur: number
  level: UsageLevel
  override: UsageLight | null
  shown: ShownLight
  blocked: boolean
  byConnection: ConnectionSpend[]
  /**
   * Abbonamento Stripe che da' il piano (o l'ultimo); null: titolare senza abbonamenti.
   * Assente con i pagamenti online non attivi e per chi non e' titolare di nessuno spazio
   * (il sito principale allora non mostra niente).
   */
  subscription?: BridgeSubscription | null
}

export type BridgeSubscription = {
  status: string | null
  plan: string | null
  renewsAt: string | null
  trialEndsAt: string | null
  cancelAtPeriodEnd: boolean
}

function bridgeSubscription(state: BillingState | null): BridgeSubscription | null {
  if (!state?.subscriptionId) return null
  const live = isLiveState(state)
  return {
    status: state.status,
    plan: state.plan,
    renewsAt: live ? state.currentPeriodEnd : null,
    trialEndsAt: state.status === 'trialing' ? state.trialEnd : null,
    cancelAtPeriodEnd: live && state.cancelAtPeriodEnd,
  }
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

/** Tutti gli utenti registrati con piano, spesa del periodo, gettone e dettaglio per collegamento. */
export async function bridgeUsers(): Promise<{ updatedAt: string; users: BridgeUser[] }> {
  const now = new Date()
  const withBilling = billingConfigured()
  const [users, memberships, overrides, rate, billingStates] = await Promise.all([
    allAuthUsers(),
    allMemberships(),
    allOverrides(),
    eurPerUsd(),
    withBilling ? allBillingStates() : Promise.resolve(null),
  ])

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
      const resolved = resolvePlan(
        owned.map((w) => w.plan),
        unlimited,
        billingStates && owned.length ? owned.map((w) => billingStates.get(w.id) ?? null) : null
      )
      const { plan, planLabel, budget } = resolved.info
      const period = usagePeriod(user.created_at, resolved.billingPeriod, now)
      // Solo chi e' titolare ha una spesa: i membri usano l'AI dello spazio di un altro.
      // Solo le chiamate a pagamento (quelle gratuite non spostano gli euro e sono la gran parte).
      const spend = owned.length
        ? summarize(await readUsage(owned.map((w) => w.id), period.start, true), rate)
        : { usd: 0, eur: 0, byConnection: [] as ConnectionSpend[] }
      if (owned.length) spendCache.set(user.id, { periodStart: period.start.toISOString(), usd: spend.usd, at: now.getTime(), exact: true })
      const eur = round2(spend.eur)
      // Senza piano l'AI e' ferma qualunque sia la spesa (non e' un limite raggiunto).
      const level = resolved.noPlan ? 'none' : levelFor(eur, budget)
      const override = overrides.get(user.id) ?? null
      result.push({
        id: user.id,
        email: (user.email || '').toLowerCase(),
        name: displayName(user),
        avatarUrl: avatarOf(user),
        createdAt: user.created_at,
        lastSignInAt: user.last_sign_in_at ?? null,
        workspaces: spaces,
        plan,
        planLabel,
        limitEur: budget.limit,
        thresholds: { ...budget },
        unlimited,
        period: { start: period.start.toISOString(), end: period.end.toISOString(), daysLeft: period.daysLeft },
        eur,
        level,
        override,
        shown: resolved.noPlan ? 'none' : shownLight(level, override),
        blocked: !unlimited && (resolved.noPlan || level === 'blocked'),
        byConnection: spend.byConnection,
        ...(billingStates && owned.length && !unlimited
          ? { subscription: bridgeSubscription(resolved.billing ?? latestBilling(owned.map((w) => billingStates.get(w.id) ?? null))) }
          : {}),
      })
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  result.sort((a, b) => b.eur - a.eur || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  return { updatedAt: now.toISOString(), users: result }
}

/** L'utente esiste in questa app (per la scelta del gettone dal pannello). */
export async function userExists(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId)
  return !error && Boolean(data?.user)
}
