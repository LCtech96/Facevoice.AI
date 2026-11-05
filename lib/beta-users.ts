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

export const isLightMode = (v: unknown): v is LightMode => typeof v === 'string' && (LIGHT_MODES as string[]).includes(v)
export const isAlertLevel = (v: unknown): v is AlertLevel =>
  v === 'green' || v === 'orange' || v === 'red' || v === 'blocked'

/** Cosa vede l'utente: la scelta dell'admin, altrimenti il livello (bloccato = rosso). */
export function shownFor(level: UsageLevel, override: LightOverride | null): ShownLight {
  return override ?? (level === 'blocked' ? 'red' : level)
}

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

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
      }
    })
  return { updatedAt: str(raw.updatedAt) || new Date().toISOString(), users }
}

const EUR = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** 3,10 € */
export const formatEur = (value: number) => EUR.format(Number.isFinite(value) ? value : 0)

export function daysLeftText(days: number) {
  if (days <= 0) return 'Rinnovo oggi'
  return days === 1 ? '1 giorno al rinnovo' : `${days} giorni al rinnovo`
}
