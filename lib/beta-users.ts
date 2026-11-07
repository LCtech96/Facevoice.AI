// Utenti della beta (beta.facevoice.ai) e i loro consumi AI, letti tramite il
// collegamento con la beta. Solo tipi e funzioni pure: si usa sia dal server
// sia dalla pagina /admin/utenti. Le soglie di ogni piano le decide la beta
// (lib/usage-limits.ts sulla beta): qui si mostrano quelle che manda.

export type UsageLevel = 'none' | 'green' | 'orange' | 'red' | 'blocked'
export type ShownLight = 'none' | 'green' | 'orange' | 'red'
export type LightOverride = 'green' | 'orange' | 'red'
export type LightMode = 'auto' | LightOverride
export type AlertLevel = 'green' | 'orange' | 'red' | 'blocked'

export type BetaWorkspace = { id: string; name: string; plan: string; role: 'owner' | 'admin' | 'member' }

export type BetaConnection = { key: string; label: string; eur: number; calls: number }

export type BetaThresholds = { orange: number; red: number; limit: number }

/** Abbonamento a pagamento (Stripe) come lo manda la beta. */
export type BetaSubscription = {
  /** Stato di Stripe: trialing, active, past_due, canceled, unpaid, incomplete... */
  status: string
  plan: string
  renewsAt: string | null
  trialEndsAt: string | null
  cancelAtPeriodEnd: boolean
}

/** Accesso alla chat Assistente dell'area clienti della beta (lo decide l'admin, utente per utente). */
export type BetaAssistant = {
  enabled: boolean
  /** Membro dello spazio Facevoice: sempre attivo, non si puo' spegnere. */
  locked: boolean
}

/** Email al giorno che le automazioni di uno spazio possono mandare (lo stesso limite della beta). */
export const AUTOMATIONS_DAILY_LIMIT = 20

/** Pagina Automazioni dell'area clienti della beta (la decide l'admin, utente per utente). */
export type BetaAutomations = {
  enabled: boolean
  /** Email mandate oggi dalle automazioni dei suoi spazi. */
  sentToday: number
}

export type BetaUser = {
  id: string
  email: string
  name: string
  avatarUrl: string | null
  createdAt: string
  lastSignInAt: string | null
  workspaces: BetaWorkspace[]
  /** Piano effettivo (il piu' alto tra gli spazi di cui e' proprietario) e nome in italiano. */
  plan: string
  planLabel: string
  /** Limite di spesa del suo piano (0 se la beta non l'ha mandato). */
  limitEur: number
  /** Soglie del suo piano; null se la beta non le ha mandate. */
  thresholds: BetaThresholds | null
  unlimited: boolean
  period: { start: string; end: string; daysLeft: number }
  eur: number
  level: UsageLevel
  override: LightOverride | null
  shown: ShownLight
  blocked: boolean
  byConnection: BetaConnection[]
  /** null: nessun abbonamento. Assente: la beta (versione vecchia) non lo manda. */
  subscription?: BetaSubscription | null
  /** Assente: la beta (versione vecchia) non lo manda e la pagina non mostra l'interruttore. */
  assistant?: BetaAssistant
  /** Assente: la beta (versione vecchia) non lo manda e la pagina non mostra l'interruttore. */
  automations?: BetaAutomations
}

export type BetaUsersResponse = { updatedAt: string; users: BetaUser[] }

export const LIGHT_MODES: LightMode[] = ['auto', 'green', 'orange', 'red']
const LEVELS: UsageLevel[] = ['none', 'green', 'orange', 'red', 'blocked']
const SHOWN: ShownLight[] = ['none', 'green', 'orange', 'red']
const OVERRIDES: LightOverride[] = ['green', 'orange', 'red']
const ROLES: BetaWorkspace['role'][] = ['owner', 'admin', 'member']

/** Nomi dei piani in italiano (per gli spazi di lavoro; un piano sconosciuto vale come Gratis). */
const PLAN_LABELS: Record<string, string> = {
  free: 'Gratis',
  trial: 'Prova',
  start: 'Start',
  pro: 'Pro',
  business: 'Business',
  facevoice: 'Facevoice',
}

export const planLabelFor = (plan: string) => PLAN_LABELS[plan.trim().toLowerCase()] ?? PLAN_LABELS.free

/** Piani a pagamento e prezzo al mese, IVA esclusa. */
export const PAID_PLANS = ['start', 'pro', 'business'] as const
const PLAN_PRICES_EUR: Record<string, number> = { start: 49, pro: 99, business: 199 }

/** Prezzo al mese del piano (0 se non e' un piano a pagamento noto). */
export const planPriceEur = (plan: string) => PLAN_PRICES_EUR[plan.trim().toLowerCase()] ?? 0

/** Nome del piano di un abbonamento (un piano sconosciuto resta com'e'). */
export const subscriptionPlanLabel = (plan: string) => PLAN_LABELS[plan.trim().toLowerCase()] ?? (plan.trim() || 'Abbonamento')

const SUBSCRIPTION_STATUS: Record<string, string> = {
  trialing: 'in prova',
  active: 'attivo',
  past_due: 'pagamento non riuscito',
  unpaid: 'non pagato',
  incomplete: 'pagamento da completare',
  incomplete_expired: 'mai partito',
  canceled: 'chiuso',
  paused: 'in pausa',
}

export const subscriptionStatusLabel = (status: string) => SUBSCRIPTION_STATUS[status] ?? status.replace(/_/g, ' ')

export type SubscriptionTone = 'green' | 'blue' | 'orange' | 'red' | 'grey'

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })

/** Etichetta breve per la lista: "Prova fino al 12/11", "Pro · attivo", "Pagamento non riuscito"... */
export function subscriptionBadge(sub: BetaSubscription | null): { text: string; tone: SubscriptionTone } {
  if (!sub) return { text: 'Senza abbonamento', tone: 'grey' }
  const plan = subscriptionPlanLabel(sub.plan)
  switch (sub.status) {
    case 'trialing':
      return { text: sub.trialEndsAt ? `Prova fino al ${shortDate(sub.trialEndsAt)}` : 'In prova', tone: 'blue' }
    case 'active':
      return sub.cancelAtPeriodEnd
        ? { text: `${plan} · si chiude${sub.renewsAt ? ` il ${shortDate(sub.renewsAt)}` : ''}`, tone: 'orange' }
        : { text: `${plan} · attivo`, tone: 'green' }
    case 'past_due':
    case 'unpaid':
      return { text: 'Pagamento non riuscito', tone: 'red' }
    case 'incomplete':
      return { text: 'Pagamento da completare', tone: 'orange' }
    case 'canceled':
      return { text: 'Abbonamento chiuso', tone: 'grey' }
    case 'incomplete_expired':
      return { text: 'Senza abbonamento', tone: 'grey' }
    default:
      return { text: `${plan} · ${subscriptionStatusLabel(sub.status)}`, tone: 'grey' }
  }
}

export type SubscriptionSummary = {
  /** Abbonamenti attivi per piano (sempre Start, Pro, Business; altri piani se ci sono). */
  active: { plan: string; label: string; count: number }[]
  trialing: number
  failed: number
  /** Somma dei prezzi dei piani attivi, IVA esclusa (le prove non contano). */
  monthlyEur: number
}

/** Riepilogo degli abbonamenti; null se la beta non manda ancora il campo. */
export function subscriptionSummary(users: BetaUser[]): SubscriptionSummary | null {
  if (!users.some((u) => u.subscription !== undefined)) return null
  const counts = new Map<string, number>(PAID_PLANS.map((p) => [p, 0]))
  let trialing = 0
  let failed = 0
  let monthlyEur = 0
  for (const { subscription: sub } of users) {
    if (!sub) continue
    if (sub.status === 'active') {
      counts.set(sub.plan, (counts.get(sub.plan) ?? 0) + 1)
      monthlyEur += planPriceEur(sub.plan)
    } else if (sub.status === 'trialing') trialing++
    else if (sub.status === 'past_due' || sub.status === 'unpaid') failed++
  }
  return {
    active: [...counts].map(([plan, count]) => ({ plan, label: subscriptionPlanLabel(plan), count })),
    trialing,
    failed,
    monthlyEur,
  }
}

export const isLightMode = (v: unknown): v is LightMode => typeof v === 'string' && (LIGHT_MODES as string[]).includes(v)
export const isAlertLevel = (v: unknown): v is AlertLevel =>
  v === 'green' || v === 'orange' || v === 'red' || v === 'blocked'

/** Cosa vede l'utente: la scelta dell'admin, altrimenti il livello (bloccato = rosso). */
export function shownFor(level: UsageLevel, override: LightOverride | null): ShownLight {
  return override ?? (level === 'blocked' ? 'red' : level)
}

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

const isoOrNull = (v: unknown) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null)

function subscriptionFrom(v: unknown): BetaSubscription | null {
  if (!v || typeof v !== 'object') return null
  const s = v as Record<string, unknown>
  const status = str(s.status).trim().toLowerCase()
  if (!status) return null
  return {
    status,
    plan: str(s.plan).trim().toLowerCase(),
    renewsAt: isoOrNull(s.renewsAt),
    trialEndsAt: isoOrNull(s.trialEndsAt),
    cancelAtPeriodEnd: s.cancelAtPeriodEnd === true,
  }
}

/** Stato dell'assistente come lo manda la beta; null se manca o non e' valido. */
export function assistantFrom(v: unknown): BetaAssistant | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const a = v as Record<string, unknown>
  if (typeof a.enabled !== 'boolean' && typeof a.locked !== 'boolean') return null
  const locked = a.locked === true
  return { enabled: locked || a.enabled === true, locked }
}

/**
 * Stato delle automazioni come lo manda la beta ("automations": true/false e
 * "automationsSentToday": numero); null se manca o non e' valido.
 */
export function automationsFrom(enabled: unknown, sentToday?: unknown): BetaAutomations | null {
  if (typeof enabled !== 'boolean') return null
  return { enabled, sentToday: Math.max(0, Math.round(num(sentToday))) }
}

/**
 * Chi e' nello spazio Facevoice ha le automazioni sempre visibili (stessa regola
 * dell'assistente: la beta rifiuta di spegnerle). Lo si sa dal blocco dell'assistente.
 */
export const automationsLocked = (user: Pick<BetaUser, 'assistant' | 'automations'>) =>
  Boolean(user.assistant?.locked && user.automations?.enabled)

/**
 * Spazi le cui email la beta somma in "automationsSentToday" (stessa regola della beta:
 * quelli di cui e' titolare; se non ne ha, tutti i suoi). Almeno 1.
 */
export function automationsSpaces(workspaces: readonly Pick<BetaWorkspace, 'role'>[]): number {
  const owned = workspaces.filter((w) => w.role === 'owner').length
  return Math.max(1, owned || workspaces.length)
}

/** Il limite e' per spazio: "oggi 3/20" con uno spazio, "oggi 22 in 2 spazi" con piu' spazi (la beta manda la somma). */
export const automationsTodayText = (sentToday: number, spaces = 1) =>
  spaces > 1 ? `oggi ${sentToday} in ${spaces} spazi` : `oggi ${sentToday}/${AUTOMATIONS_DAILY_LIMIT}`

/** Limite di oggi finito in tutti gli spazi contati (la beta ne ferma ognuno a 20, quindi la somma basta). */
export const automationsFull = (sentToday: number, spaces = 1) => sentToday >= AUTOMATIONS_DAILY_LIMIT * Math.max(1, spaces)

function thresholdsFrom(v: unknown): BetaThresholds | null {
  if (!v || typeof v !== 'object') return null
  const t = v as Record<string, unknown>
  const out = { orange: num(t.orange), red: num(t.red), limit: num(t.limit) }
  return out.orange > 0 && out.red > 0 && out.limit > 0 ? out : null
}

/**
 * Mette in forma la risposta della beta: campi mancanti o strani diventano
 * valori vuoti, cosi' la pagina non si rompe se la beta cambia qualcosa.
 */
export function normalizeBetaUsers(input: unknown): BetaUsersResponse {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, any>
  const users: BetaUser[] = (Array.isArray(raw.users) ? raw.users : [])
    .filter((u: any) => u && typeof u === 'object' && typeof u.id === 'string' && u.id)
    .map((u: any): BetaUser => {
      const level: UsageLevel = (LEVELS as string[]).includes(u.level) ? u.level : 'none'
      const override: LightOverride | null = (OVERRIDES as string[]).includes(u.override) ? u.override : null
      const shown: ShownLight = (SHOWN as string[]).includes(u.shown) ? u.shown : shownFor(level, override)
      const period = u.period && typeof u.period === 'object' ? u.period : {}
      const thresholds = thresholdsFrom(u.thresholds)
      const plan = str(u.plan) || 'free'
      const assistant = assistantFrom(u.assistant)
      const automations = automationsFrom(u.automations, u.automationsSentToday)
      return {
        id: u.id,
        email: str(u.email),
        name: str(u.name) || str(u.email) || 'Utente',
        avatarUrl: typeof u.avatarUrl === 'string' && /^https?:\/\//.test(u.avatarUrl) ? u.avatarUrl : null,
        createdAt: str(u.createdAt),
        lastSignInAt: typeof u.lastSignInAt === 'string' ? u.lastSignInAt : null,
        workspaces: (Array.isArray(u.workspaces) ? u.workspaces : [])
          .filter((w: any) => w && typeof w === 'object')
          .map((w: any) => ({
            id: str(w.id),
            name: str(w.name) || 'Senza nome',
            plan: str(w.plan),
            role: (ROLES as string[]).includes(w.role) ? w.role : 'member',
          })),
        plan,
        planLabel: str(u.planLabel) || planLabelFor(plan),
        limitEur: num(u.limitEur) > 0 ? num(u.limitEur) : thresholds?.limit ?? 0,
        thresholds,
        unlimited: u.unlimited === true,
        period: { start: str(period.start), end: str(period.end), daysLeft: Math.max(0, Math.round(num(period.daysLeft))) },
        eur: num(u.eur),
        level,
        override,
        shown,
        blocked: u.blocked === true,
        byConnection: (Array.isArray(u.byConnection) ? u.byConnection : [])
          .filter((c: any) => c && typeof c === 'object')
          .map((c: any) => ({ key: str(c.key, 'other'), label: str(c.label) || 'Altro', eur: num(c.eur), calls: num(c.calls) }))
          .filter((c: BetaConnection) => c.eur > 0 || c.calls > 0)
          .sort((a: BetaConnection, b: BetaConnection) => b.eur - a.eur),
        // Solo se la beta lo manda: senza il campo la pagina non mostra gli abbonamenti.
        ...(u.subscription !== undefined ? { subscription: subscriptionFrom(u.subscription) } : {}),
        // Idem per l'assistente: senza il campo l'interruttore resta nascosto.
        ...(assistant ? { assistant } : {}),
        // Idem per le automazioni.
        ...(automations ? { automations } : {}),
      }
    })
  return { updatedAt: str(raw.updatedAt) || new Date().toISOString(), users }
}

const EUR = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** 3,10 € */
export const formatEur = (value: number) => EUR.format(Number.isFinite(value) ? value : 0)

const EUR_ROUND = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 })

/** 99 € (per i prezzi dei piani) */
export const formatEurRound = (value: number) => EUR_ROUND.format(Number.isFinite(value) ? value : 0)

export function daysLeftText(days: number) {
  if (days <= 0) return 'Rinnovo oggi'
  return days === 1 ? '1 giorno al rinnovo' : `${days} giorni al rinnovo`
}
