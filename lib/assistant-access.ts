import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { FACEVOICE_WORKSPACE_ID } from '@/lib/workspace-db'
import { requireWorkspace, type WorkspaceAccess, type WorkspaceRole } from '@/lib/workspace'

// Pagina Assistente dell'area clienti: si attiva PER PERSONA dal pannello di Facevoice
// (sito principale, pagina Utenti). Spenta per tutti finche' Facevoice non la accende.
// In app_settings: "assistant_access:<userId>" = { enabled: true, at } (assente = spenta).
// Chi e' membro dello spazio Facevoice l'ha sempre attiva e non si puo' spegnere.

export type AssistantAccess = { enabled: boolean; locked: boolean }

export const ASSISTANT_DISABLED_MESSAGE = 'L’assistente non è attivo per il tuo account.'
export const ASSISTANT_LOCKED_MESSAGE = 'Per questo account l’assistente è sempre attivo'

const KEY_PREFIX = 'assistant_access:'
const accessKey = (userId: string) => `${KEY_PREFIX}${userId}`

const parseJson = (raw: unknown): unknown => {
  if (typeof raw !== 'string') return raw ?? null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/** Valore salvato -> attiva si'/no (solo { enabled: true } la accende). */
export const flagEnabled = (raw: unknown): boolean => (parseJson(raw) as { enabled?: unknown } | null)?.enabled === true

/** Regola completa: chi e' nello spazio Facevoice l'ha sempre attiva (bloccata), gli altri come dice il valore. */
export function accessFrom(workspaceIds: readonly string[], flag: boolean): AssistantAccess {
  const locked = workspaceIds.includes(FACEVOICE_WORKSPACE_ID)
  return { enabled: locked || flag, locked }
}

// Si rilegge al massimo ogni 30 secondi (ritardo massimo tra le istanze dopo un cambio
// dal pannello); su questa istanza subito dopo una scrittura.
const TTL_MS = 30_000
const cache = new Map<string, { access: AssistantAccess; at: number }>()
/** Cresce a ogni scrittura: una lettura iniziata prima non rimette in memoria un valore vecchio. */
let generation = 0

async function readFlag(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.from('app_settings').select('value').eq('key', accessKey(userId)).maybeSingle()
  if (error) throw new Error(`assistente non letto: ${error.message}`)
  return flagEnabled(data?.value)
}

/** Membro dello spazio Facevoice: assistente sempre attivo, non si spegne (letto ora, senza memoria). */
export async function facevoiceMember(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .eq('workspace_id', FACEVOICE_WORKSPACE_ID)
    .limit(1)
  if (error) throw new Error(`spazi non letti: ${error.message}`)
  return Boolean(data?.length)
}

/**
 * Accesso all'assistente di una persona. workspaceIds: gli spazi di cui e' membro, se
 * gia' letti (si evita una lettura); altrimenti si controlla lo spazio Facevoice qui.
 */
export async function assistantAccess(userId: string, workspaceIds?: readonly string[]): Promise<AssistantAccess> {
  const cached = cache.get(userId)
  if (cached && Date.now() - cached.at < TTL_MS) return cached.access
  const started = generation
  const at = Date.now()
  const locked = workspaceIds ? workspaceIds.includes(FACEVOICE_WORKSPACE_ID) : await facevoiceMember(userId)
  const access = locked ? { enabled: true, locked: true } : { enabled: await readFlag(userId), locked: false }
  if (started === generation) cache.set(userId, { access, at })
  return access
}

/** Accende o spegne l'assistente (dal pannello di Facevoice). Non tocca chi e' bloccato: va controllato prima. */
export async function setAssistantAccess(userId: string, enabled: boolean): Promise<void> {
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
    // Anche se il salvataggio non e' riuscito si rilegge dal database la prossima volta.
    generation++
    cache.delete(userId)
  }
}

/** Persone con l'assistente acceso a mano (per l'elenco del pannello). */
export async function enabledAssistantUsers(): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin.from('app_settings').select('key, value').like('key', `${KEY_PREFIX}%`).limit(10_000)
  if (error) throw new Error(`assistente non letto: ${error.message}`)
  const ids = new Set<string>()
  for (const row of data || []) if (flagEnabled(row.value)) ids.add(String(row.key).slice(KEY_PREFIX.length))
  return ids
}

/** null se la persona puo' usare l'assistente, altrimenti la risposta da restituire. */
export async function assistantDenied(userId: string): Promise<NextResponse | null> {
  let access: AssistantAccess
  try {
    access = await assistantAccess(userId)
  } catch (error) {
    console.error('accesso assistente:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Assistente non disponibile, riprova.' }, { status: 503 })
  }
  if (access.enabled) return null
  return NextResponse.json({ error: ASSISTANT_DISABLED_MESSAGE, code: 'assistant_disabled' }, { status: 403 })
}

/** Come requireWorkspace, in piu' l'assistente deve essere attivo per chi fa la richiesta. */
export async function requireAssistant(req: NextRequest, minRole: WorkspaceRole = 'member'): Promise<WorkspaceAccess | NextResponse> {
  const access = await requireWorkspace(req, minRole)
  if (access instanceof NextResponse) return access
  return (await assistantDenied(access.userId)) ?? access
}
