// Utenti della beta (beta.facevoice.ai) e i loro consumi AI, letti tramite il
// collegamento con la beta. Solo tipi e funzioni pure: si usa sia dal server
// sia dalla pagina /admin/utenti.

export type UsageLevel = 'none' | 'green' | 'orange' | 'red' | 'blocked'
export type ShownLight = 'none' | 'green' | 'orange' | 'red'
export type LightOverride = 'green' | 'orange' | 'red'
export type LightMode = 'auto' | LightOverride
export type AlertLevel = 'green' | 'orange' | 'red' | 'blocked'

export type BetaWorkspace = { id: string; name: string; plan: string; role: 'owner' | 'admin' | 'member' }

export type BetaConnection = { key: string; label: string; eur: number; calls: number }

export type BetaUser = {
  id: string
  email: string
  name: string
  avatarUrl: string | null
  createdAt: string
  lastSignInAt: string | null
  workspaces: BetaWorkspace[]
  unlimited: boolean
  period: { start: string; end: string; daysLeft: number }
  eur: number
  level: UsageLevel
  override: LightOverride | null
  shown: ShownLight
  blocked: boolean
  byConnection: BetaConnection[]
}

export type BetaThresholds = { orange: number; red: number; limit: number }

export type BetaUsersResponse = { updatedAt: string; thresholds: BetaThresholds; users: BetaUser[] }

export const DEFAULT_THRESHOLDS: BetaThresholds = { orange: 5, red: 15, limit: 20 }

export const LIGHT_MODES: LightMode[] = ['auto', 'green', 'orange', 'red']
const LEVELS: UsageLevel[] = ['none', 'green', 'orange', 'red', 'blocked']
const OVERRIDES: LightOverride[] = ['green', 'orange', 'red']
const ROLES: BetaWorkspace['role'][] = ['owner', 'admin', 'member']

export const isLightMode = (v: unknown): v is LightMode => typeof v === 'string' && (LIGHT_MODES as string[]).includes(v)
export const isAlertLevel = (v: unknown): v is AlertLevel =>
  v === 'green' || v === 'orange' || v === 'red' || v === 'blocked'

/** Cosa vede l'utente: la scelta dell'admin, altrimenti il livello (bloccato = rosso). */
export function shownFor(level: UsageLevel, override: LightOverride | null): ShownLight {
  return override ?? (level === 'blocked' ? 'red' : level)
}

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * Mette in forma la risposta della beta: campi mancanti o strani diventano
 * valori vuoti, cosi' la pagina non si rompe se la beta cambia qualcosa.
 */
export function normalizeBetaUsers(input: unknown): BetaUsersResponse {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, any>
  const t = (raw.thresholds && typeof raw.thresholds === 'object' ? raw.thresholds : {}) as Record<string, unknown>
  const thresholds: BetaThresholds = {
    orange: num(t.orange) || DEFAULT_THRESHOLDS.orange,
    red: num(t.red) || DEFAULT_THRESHOLDS.red,
    limit: num(t.limit) || DEFAULT_THRESHOLDS.limit,
  }
  const users: BetaUser[] = (Array.isArray(raw.users) ? raw.users : [])
    .filter((u: any) => u && typeof u === 'object' && typeof u.id === 'string' && u.id)
    .map((u: any): BetaUser => {
      const level: UsageLevel = (LEVELS as string[]).includes(u.level) ? u.level : 'none'
      const override: LightOverride | null = (OVERRIDES as string[]).includes(u.override) ? u.override : null
      const shown: ShownLight = ['none', 'green', 'orange', 'red'].includes(u.shown) ? u.shown : shownFor(level, override)
      const period = u.period && typeof u.period === 'object' ? u.period : {}
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
  return { updatedAt: str(raw.updatedAt) || new Date().toISOString(), thresholds, users }
}

const EUR = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** 3,10 € */
export const formatEur = (value: number) => EUR.format(Number.isFinite(value) ? value : 0)

export function daysLeftText(days: number) {
  if (days <= 0) return 'Rinnovo oggi'
  return days === 1 ? '1 giorno al rinnovo' : `${days} giorni al rinnovo`
}
