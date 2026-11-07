import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { FACEVOICE_WORKSPACE_ID } from '@/lib/workspace-db'
import { requireWorkspace, workspaceOwnerId, type WorkspaceAccess, type WorkspaceRole } from '@/lib/workspace'
import { accessFrom, facevoiceMember, flagEnabled, type AssistantAccess } from '@/lib/assistant-access'

// Pagina Automazioni dell'area clienti (email programmate): si attiva PER PERSONA dal
// pannello di Facevoice (sito principale, pagina Utenti), come l'Assistente AI.
// In app_settings: "automations_access:<userId>" = { enabled: true, at } (assente = nascosta).
// Stesse regole dell'Assistente: chi e' membro dello spazio Facevoice l'ha sempre attiva
// (bloccata, non si puo' spegnere). Qui anche il contatore delle email inviate oggi
// (letto anche dal pannello: lib/usage-limits.ts), senza dipendenze pesanti.

export type AutomationsAccess = AssistantAccess

export const AUTOMATIONS_DISABLED_MESSAGE = 'Le automazioni non sono attive per il tuo account.'
export const OWNER_AUTOMATIONS_DISABLED_MESSAGE = 'Le automazioni non sono attive per il titolare di questo spazio: può chiedere a Facevoice di attivarle.'
export const AUTOMATIONS_LOCKED_MESSAGE = 'Per questo account le automazioni sono sempre attive'

export { AUTOMATIONS_DAILY_LIMIT } from '@/lib/automations-shared'

const KEY_PREFIX = 'automations_access:'
const accessKey = (userId: string) => `${KEY_PREFIX}${userId}`
/** Contatore del giorno: "automations_count:<spazio>" = { day: "AAAA-MM-GG", used }. */
export const COUNT_PREFIX = 'automations_count:'
export const countKey = (workspaceId: string) => `${COUNT_PREFIX}${workspaceId}`

const parseJson = (raw: unknown): unknown => {
  if (typeof raw !== 'string') return raw ?? null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** Giorno di calendario italiano (AAAA-MM-GG) di un istante. */
export function romeDay(at: number | Date = Date.now()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(at))
  const get = (t: string) => parts.find((p) => p.type === t)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

export type DayCount = { day: string; used: number }

/** Valore salvato del contatore -> email contate oggi (0 se e' di un altro giorno). */
export function countFrom(raw: unknown, today = romeDay()): DayCount {
  const value = parseJson(raw) as { day?: unknown; used?: unknown } | null
  const used = Number(value?.used)
  return value?.day === today && Number.isFinite(used) && used > 0 ? { day: today, used: Math.floor(used) } : { day: today, used: 0 }
}

// Come per l'Assistente: si rilegge al massimo ogni 30 secondi, su questa istanza subito dopo una scrittura.
const TTL_MS = 30_000
const cache = new Map<string, { access: AutomationsAccess; at: number }>()
let generation = 0

async function readFlag(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.from('app_settings').select('value').eq('key', accessKey(userId)).maybeSingle()
  if (error) throw new Error(`automazioni non lette: ${error.message}`)
  return flagEnabled(data?.value)
}

/** Accesso alle automazioni di una persona (workspaceIds: i suoi spazi, se gia' letti). */
export async function automationsAccess(userId: string, workspaceIds?: readonly string[]): Promise<AutomationsAccess> {
  const cached = cache.get(userId)
  if (cached && Date.now() - cached.at < TTL_MS) return cached.access
  const started = generation
  const locked = workspaceIds ? workspaceIds.includes(FACEVOICE_WORKSPACE_ID) : await facevoiceMember(userId)
  const access = locked ? { enabled: true, locked: true } : { enabled: await readFlag(userId), locked: false }
  if (started === generation) cache.set(userId, { access, at: Date.now() })
  return access
}

/** Accende o nasconde la pagina Automazioni (dal pannello di Facevoice). Chi e' bloccato va controllato prima. */
export async function setAutomationsAccess(userId: string, enabled: boolean): Promise<void> {
  generation++
  cache.delete(userId)
  try {
    if (enabled) {
      const now = new Date().toISOString()
      const { error } = await supabaseAdmin
        .from('app_settings')
        .upsert({ key: accessKey(userId), value: JSON.stringify({ enabled: true, at: now }), updated_at: now }, { onConflict: 'key' })
      if (error) throw new Error(error.message)
    } else {
      const { error } = await supabaseAdmin.from('app_settings').delete().eq('key', accessKey(userId))
      if (error) throw new Error(error.message)
    }
  } finally {
    generation++
    cache.delete(userId)
  }
}

/** Persone con le automazioni accese a mano (per l'elenco del pannello). */
export async function enabledAutomationsUsers(): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin.from('app_settings').select('key, value').like('key', `${KEY_PREFIX}%`).limit(10_000)
  if (error) throw new Error(`automazioni non lette: ${error.message}`)
  const ids = new Set<string>()
  for (const row of data || []) if (flagEnabled(row.value)) ids.add(String(row.key).slice(KEY_PREFIX.length))
  return ids
}

/** Email inviate oggi dalle automazioni, per spazio (solo gli spazi con almeno un invio oggi). */
export async function automationsSentToday(): Promise<Map<string, number>> {
  const { data, error } = await supabaseAdmin.from('app_settings').select('key, value').like('key', `${COUNT_PREFIX}%`).limit(10_000)
  if (error) throw new Error(`contatori automazioni non letti: ${error.message}`)
  const today = romeDay()
  const map = new Map<string, number>()
  for (const row of data || []) {
    const { used } = countFrom(row.value, today)
    if (used) map.set(String(row.key).slice(COUNT_PREFIX.length), used)
  }
  return map
}

/** Regola completa per il pannello (come l'Assistente). */
export const automationsFrom = (workspaceIds: readonly string[], flag: boolean): boolean => accessFrom(workspaceIds, flag).enabled

/**
 * Automazioni in uno spazio: attive per chi fa la richiesta E per il titolare dello spazio
 * (il cron invia solo se il titolare le ha: stessa regola ovunque, cosi' pagina, API e
 * Assistente le mostrano solo quando partono davvero). blocked: per chi sono spente.
 */
export async function workspaceAutomationsAccess(userId: string, workspaceId: string): Promise<{ enabled: boolean; blocked: 'user' | 'owner' | null }> {
  if (!(await automationsAccess(userId)).enabled) return { enabled: false, blocked: 'user' }
  const ownerId = await workspaceOwnerId(workspaceId)
  if (ownerId === userId) return { enabled: true, blocked: null }
  if (!ownerId || !(await automationsAccess(ownerId)).enabled) return { enabled: false, blocked: 'owner' }
  return { enabled: true, blocked: null }
}

/** null se la persona puo' usare le automazioni (in quello spazio, se indicato), altrimenti la risposta da restituire. */
export async function automationsDenied(userId: string, workspaceId?: string): Promise<NextResponse | null> {
  let access: { enabled: boolean; blocked: 'user' | 'owner' | null }
  try {
    access = workspaceId ? await workspaceAutomationsAccess(userId, workspaceId) : { ...(await automationsAccess(userId)), blocked: 'user' }
  } catch (error) {
    console.error('accesso automazioni:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Automazioni non disponibili, riprova.' }, { status: 503 })
  }
  if (access.enabled) return null
  if (access.blocked === 'owner') return NextResponse.json({ error: OWNER_AUTOMATIONS_DISABLED_MESSAGE, code: 'owner_automations_disabled' }, { status: 403 })
  return NextResponse.json({ error: AUTOMATIONS_DISABLED_MESSAGE, code: 'automations_disabled' }, { status: 403 })
}

/** Come requireWorkspace, in piu' le automazioni devono essere attive per chi fa la richiesta e per il titolare dello spazio. */
export async function requireAutomations(req: NextRequest, minRole: WorkspaceRole = 'member'): Promise<WorkspaceAccess | NextResponse> {
  const access = await requireWorkspace(req, minRole)
  if (access instanceof NextResponse) return access
  return (await automationsDenied(access.userId, access.workspace.id)) ?? access
}
