import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { FACEVOICE_WORKSPACE_ID } from '@/lib/workspace-db'
import { requireWorkspace, workspaceOwnerId, type WorkspaceAccess, type WorkspaceRole } from '@/lib/workspace'
import { accessFrom, facevoiceMember, flagEnabled, type AssistantAccess } from '@/lib/assistant-access'

// "Video automazione" (video risposte nei messaggi diretti, lib/saas/video-replies.ts): si
// attiva PER PERSONA dal pannello di Facevoice (sito principale, pagina Utenti), come
// l'Assistente e le Automazioni, e non dipende da loro: chi ha solo questa vede la pagina
// Automazioni con la sola scheda "Video automazione".
// In app_settings: "video_replies_access:<userId>" = { enabled: true, at } (assente = nascosta).
// Chi e' membro dello spazio Facevoice l'ha sempre attiva (bloccata, non si spegne).
// In uno spazio vale se e' attiva per chi fa la richiesta E per il titolare; i video partono
// nei DM solo se e' attiva per il titolare (come il cron delle automazioni).

export type VideoRepliesAccess = AssistantAccess

export const VIDEO_REPLIES_DISABLED_MESSAGE = 'La video automazione non è attiva per il tuo account.'
export const OWNER_VIDEO_REPLIES_DISABLED_MESSAGE = 'La video automazione non è attiva per il titolare di questo spazio: può chiedere a Facevoice di attivarla.'
export const VIDEO_REPLIES_LOCKED_MESSAGE = 'Per questo account la video automazione è sempre attiva'

const KEY_PREFIX = 'video_replies_access:'
const accessKey = (userId: string) => `${KEY_PREFIX}${userId}`

// Come per l'Assistente: si rilegge al massimo ogni 30 secondi, su questa istanza subito dopo una scrittura.
const TTL_MS = 30_000
const cache = new Map<string, { access: VideoRepliesAccess; at: number }>()
let generation = 0

async function readFlag(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.from('app_settings').select('value').eq('key', accessKey(userId)).maybeSingle()
  if (error) throw new Error(`video automazione non letta: ${error.message}`)
  return flagEnabled(data?.value)
}

/** Accesso alla video automazione di una persona (workspaceIds: i suoi spazi, se gia' letti). */
export async function videoRepliesAccess(userId: string, workspaceIds?: readonly string[]): Promise<VideoRepliesAccess> {
  const cached = cache.get(userId)
  if (cached && Date.now() - cached.at < TTL_MS) return cached.access
  const started = generation
  const locked = workspaceIds ? workspaceIds.includes(FACEVOICE_WORKSPACE_ID) : await facevoiceMember(userId)
  const access = locked ? { enabled: true, locked: true } : { enabled: await readFlag(userId), locked: false }
  if (started === generation) cache.set(userId, { access, at: Date.now() })
  return access
}

/** Accende o nasconde la video automazione (dal pannello di Facevoice). Chi e' bloccato va controllato prima. */
export async function setVideoRepliesAccess(userId: string, enabled: boolean): Promise<void> {
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

/** Persone con la video automazione accesa a mano (per l'elenco del pannello). */
export async function enabledVideoRepliesUsers(): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin.from('app_settings').select('key, value').like('key', `${KEY_PREFIX}%`).limit(10_000)
  if (error) throw new Error(`video automazione non letta: ${error.message}`)
  const ids = new Set<string>()
  for (const row of data || []) if (flagEnabled(row.value)) ids.add(String(row.key).slice(KEY_PREFIX.length))
  return ids
}

/** Regola completa per il pannello (come l'Assistente). */
export const videoRepliesFrom = (workspaceIds: readonly string[], flag: boolean): boolean => accessFrom(workspaceIds, flag).enabled

/** Attiva per il titolare dello spazio: solo allora i video partono nei messaggi diretti. Errore = spenta. */
export async function workspaceVideoRepliesOn(workspaceId: string): Promise<boolean> {
  try {
    if (workspaceId === FACEVOICE_WORKSPACE_ID) return true
    const ownerId = await workspaceOwnerId(workspaceId)
    return Boolean(ownerId && (await videoRepliesAccess(ownerId)).enabled)
  } catch (error) {
    console.warn('video automazione (titolare):', error instanceof Error ? error.message : error)
    return false
  }
}

/** In uno spazio: attiva per chi fa la richiesta E per il titolare. blocked: per chi e' spenta. */
export async function workspaceVideoRepliesAccess(userId: string, workspaceId: string): Promise<{ enabled: boolean; blocked: 'user' | 'owner' | null }> {
  if (!(await videoRepliesAccess(userId)).enabled) return { enabled: false, blocked: 'user' }
  const ownerId = await workspaceOwnerId(workspaceId)
  if (ownerId === userId || workspaceId === FACEVOICE_WORKSPACE_ID) return { enabled: true, blocked: null }
  if (!ownerId || !(await videoRepliesAccess(ownerId)).enabled) return { enabled: false, blocked: 'owner' }
  return { enabled: true, blocked: null }
}

/** null se la persona puo' usare la video automazione in quello spazio, altrimenti la risposta da restituire. */
export async function videoRepliesDenied(userId: string, workspaceId: string): Promise<NextResponse | null> {
  let access: { enabled: boolean; blocked: 'user' | 'owner' | null }
  try {
    access = await workspaceVideoRepliesAccess(userId, workspaceId)
  } catch (error) {
    console.error('accesso video automazione:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Video automazione non disponibile, riprova.' }, { status: 503 })
  }
  if (access.enabled) return null
  if (access.blocked === 'owner') return NextResponse.json({ error: OWNER_VIDEO_REPLIES_DISABLED_MESSAGE, code: 'owner_video_replies_disabled' }, { status: 403 })
  return NextResponse.json({ error: VIDEO_REPLIES_DISABLED_MESSAGE, code: 'video_replies_disabled' }, { status: 403 })
}

/** Come requireWorkspace, in piu' la video automazione deve essere attiva (per chi chiede e per il titolare). */
export async function requireVideoReplies(req: NextRequest, minRole: WorkspaceRole = 'member'): Promise<WorkspaceAccess | NextResponse> {
  const access = await requireWorkspace(req, minRole)
  if (access instanceof NextResponse) return access
  return (await videoRepliesDenied(access.userId, access.workspace.id)) ?? access
}
