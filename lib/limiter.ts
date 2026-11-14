import { randomBytes } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { updateSetting } from '@/lib/settings-store'

// Limiti di tentativi salvati in app_settings (accesso dei collaboratori, recupero password).
// Per ogni chiave: l'elenco dei tentativi recenti. Si prenota PRIMA di fare il lavoro; un
// errore del database e' un'eccezione (chi chiama si chiude: nessun lavoro senza limite).
// Le righe vuote si tolgono subito, quelle vecchie le toglie il cron (cleanupLimiterRows).

export type SlotRule = { windowMs: number; max: number }
export type Slot = { at: number; id: string }

const parseSlots = (raw: string | null): Slot[] => {
  try {
    const v = raw ? JSON.parse(raw) : []
    return Array.isArray(v) ? v.filter((s) => s && Number.isFinite(s.at) && typeof s.id === 'string') : []
  } catch {
    return []
  }
}

export const newSlotId = () => randomBytes(8).toString('hex')

/** Elenco dopo un nuovo tentativo, oppure false se una regola e' gia' al massimo. */
export function nextSlots(list: Slot[], rules: SlotRule[], id: string, now: number): Slot[] | false {
  const keepMs = Math.max(...rules.map((r) => r.windowMs))
  // Si tengono almeno tanti tentativi quanti ne conta la regola piu' larga (altrimenti il suo massimo non scatterebbe mai).
  const keep = Math.max(...rules.map((r) => r.max))
  const live = list.filter((s) => s.at > now - keepMs)
  const ok = rules.every((r) => live.filter((s) => s.at > now - r.windowMs).length < r.max)
  return ok ? [...live, { at: now, id }].slice(-keep) : false
}

/** Prenota un tentativo: false se una delle regole e' gia' al massimo (e allora non si salva niente). */
export async function reserveSlot(key: string, rules: SlotRule[], id = newSlotId(), now = Date.now()): Promise<boolean> {
  if (!rules.length) return true
  let ok = false
  await updateSetting<Slot[]>(key, parseSlots, (list) => {
    const next = nextSlots(list, rules, id, now)
    ok = next !== false
    return next
  })
  return ok
}

/** Il tentativo non conta piu' (es. password giusta, o errore del server). Non lancia mai. */
export async function releaseSlot(key: string, id: string): Promise<void> {
  try {
    const left = await updateSetting<Slot[]>(key, parseSlots, (list) => (list.some((s) => s.id === id) ? list.filter((s) => s.id !== id) : false))
    // Nessun tentativo rimasto: la riga si toglie (solo se nel frattempo nessuno ne ha aggiunti).
    if (!left.length) await supabaseAdmin.from('app_settings').delete().eq('key', key).eq('value', '[]')
  } catch {}
}

/** Contatore per ora (tetto generale): true se c'e' ancora posto in quest'ora, e lo occupa. */
export async function takeHourly(prefix: string, max: number, now = Date.now()): Promise<boolean> {
  const key = `${prefix}:${new Date(now).toISOString().slice(0, 13)}`
  let ok = false
  await updateSetting<number>(
    key,
    (raw) => {
      const n = Number(raw)
      return Number.isInteger(n) && n > 0 ? n : 0
    },
    (n) => {
      ok = n < max
      return ok ? n + 1 : false
    }
  )
  return ok
}

/** Prefissi delle righe dei limiti (finestre di al massimo 15 minuti: dopo un giorno non servono piu'). */
const SLOT_PREFIXES = ['shared_login_fails:', 'shared_login_ip:', 'pw_reset_ip:', 'pw_reset_email:', 'pw_reset_check:']
/** Contatori per ora. */
const HOURLY_PREFIXES = ['pw_reset_global:']

/** Prefisso per LIKE: «_» e «%» presi alla lettera. */
const likePrefix = (prefix: string) => `${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

/** Toglie le righe dei limiti non toccate da tempo (le chiama il cron). Restituisce quante. */
export async function cleanupLimiterRows(now = Date.now()): Promise<number> {
  const jobs: [string, string][] = [
    ...SLOT_PREFIXES.map((p): [string, string] => [p, new Date(now - 24 * 3600_000).toISOString()]),
    ...HOURLY_PREFIXES.map((p): [string, string] => [p, new Date(now - 2 * 3600_000).toISOString()]),
  ]
  let removed = 0
  for (const [prefix, before] of jobs) {
    const { data, error } = await supabaseAdmin.from('app_settings').delete().like('key', likePrefix(prefix)).lt('updated_at', before).select('key')
    if (error) throw new Error(`pulizia limiti (${prefix}): ${error.message}`)
    removed += data?.length || 0
  }
  return removed
}
