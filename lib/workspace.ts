import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { workspaceDb, type WorkspaceDb } from '@/lib/workspace-db'
import { TERMS_VERSION } from '@/lib/terms'
import { hasCurrentAcceptance } from '@/lib/terms-acceptance'

// Chi fa la richiesta e in quale spazio di lavoro sta lavorando. L'identita'
// viene sempre dal token di sessione; lo spazio scelto arriva nell'header
// x-workspace-id ed e' valido solo se l'utente ne e' membro.

export type WorkspaceRole = 'owner' | 'admin' | 'member'
export type Membership = { id: string; name: string; plan: string; role: WorkspaceRole }

export type WorkspaceAccess = {
  userId: string
  email: string
  workspace: Membership
  db: WorkspaceDb
}

/** Quanti spazi puo' creare la stessa persona (evita abusi della registrazione libera). */
export const MAX_OWNED_WORKSPACES = 3

export async function userFromRequest(req: NextRequest) {
  const header = req.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  const { data } = await supabaseAdmin.auth.getUser(header.slice(7).trim())
  return data.user ?? null
}

export async function membershipsOf(userId: string): Promise<Membership[]> {
  const { data, error } = await supabaseAdmin
    .from('workspace_members')
    .select('role, created_at, workspaces(id, name, plan)')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`spazi di lavoro non letti: ${error.message}`)
  return (data || []).flatMap((row) => {
    const ws = (Array.isArray(row.workspaces) ? row.workspaces[0] : row.workspaces) as { id: string; name: string; plan: string } | null
    return ws ? [{ id: ws.id, name: ws.name, plan: ws.plan, role: row.role as WorkspaceRole }] : []
  })
}

/** Titolare dello spazio (il primo con ruolo owner; per gli spazi vecchi chi l'ha creato), oppure null. */
export async function workspaceOwnerId(workspaceId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', workspaceId)
    .eq('role', 'owner')
    .order('created_at', { ascending: true })
    .limit(1)
  if (error) throw new Error(`titolare non letto: ${error.message}`)
  const ownerId = (data?.[0]?.user_id as string | undefined) ?? null
  if (ownerId) return ownerId
  const { data: ws } = await supabaseAdmin.from('workspaces').select('created_by').eq('id', workspaceId).maybeSingle()
  return (ws?.created_by as string | undefined) ?? null
}

/** Accesso allo spazio richiesto (o al primo dell'utente), oppure null. */
export async function getWorkspaceAccess(req: NextRequest): Promise<WorkspaceAccess | null> {
  const user = await userFromRequest(req)
  if (!user?.email) return null
  const memberships = await membershipsOf(user.id)
  const wanted = req.headers.get('x-workspace-id')?.trim()
  const workspace = wanted ? memberships.find((m) => m.id === wanted) : memberships[0]
  if (!workspace) return null
  return { userId: user.id, email: user.email.toLowerCase(), workspace, db: workspaceDb(workspace.id) }
}

/** Chi ha accettato i termini in vigore (solo i si', per 60 s in questa istanza: per persona e versione). */
const termsAccepted = new Map<string, number>()
const TERMS_CACHE_MS = 60_000

async function acceptedCurrentTerms(userId: string): Promise<boolean> {
  const key = `${userId}:${TERMS_VERSION}`
  if ((termsAccepted.get(key) ?? 0) > Date.now()) return true
  const ok = await hasCurrentAcceptance(userId)
  if (ok) {
    if (termsAccepted.size > 5000) termsAccepted.clear()
    termsAccepted.set(key, Date.now() + TERMS_CACHE_MS)
  }
  return ok
}

/**
 * Da usare all'inizio delle route dell'area clienti. Senza i termini e condizioni in vigore
 * accettati niente funziona, anche chiamando le API direttamente (403 terms_required; se non si
 * riesce a controllare: 500). /api/app/terms non passa da qui e resta raggiungibile.
 */
export async function requireWorkspace(
  req: NextRequest,
  minRole: WorkspaceRole = 'member'
): Promise<WorkspaceAccess | NextResponse> {
  const access = await getWorkspaceAccess(req).catch(() => null)
  if (!access) return NextResponse.json({ error: 'Accesso non consentito' }, { status: 401 })
  const rank: Record<WorkspaceRole, number> = { member: 0, admin: 1, owner: 2 }
  if (rank[access.workspace.role] < rank[minRole]) {
    return NextResponse.json({ error: 'Serve il ruolo di amministratore dello spazio' }, { status: 403 })
  }
  let accepted: boolean
  try {
    accepted = await acceptedCurrentTerms(access.userId)
  } catch (error) {
    console.error('termini (controllo):', error instanceof Error ? error.message : 'errore')
    return NextResponse.json({ error: 'Non riesco a controllare i termini, riprova.' }, { status: 500 })
  }
  if (!accepted) return NextResponse.json({ error: 'Prima accetta i termini e condizioni.', code: 'terms_required' }, { status: 403 })
  return access
}

/** Nuovo nome dell'attivita' (usato anche come firma nelle risposte email). */
export async function renameWorkspace(workspaceId: string, rawName: string): Promise<string> {
  const name = rawName.replace(/\s+/g, ' ').trim().slice(0, 80)
  if (!name) throw new Error('Scrivi il nome della tua attività.')
  const { error } = await supabaseAdmin.from('workspaces').update({ name }).eq('id', workspaceId)
  if (error) throw new Error(`nome non salvato: ${error.message}`)
  return name
}

/** Canali di partenza di uno spazio nuovo: tutti scollegati, risposte da approvare. */
export const STARTER_CHANNELS = ['instagram', 'facebook', 'whatsapp', 'email', 'web'] as const

export async function createWorkspace(userId: string, rawName: string): Promise<Membership> {
  const name = rawName.replace(/\s+/g, ' ').trim().slice(0, 80)
  if (!name) throw new Error('Scrivi il nome della tua attività.')

  const { count } = await supabaseAdmin
    .from('workspace_members')
    .select('workspace_id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('role', 'owner')
  if ((count || 0) >= MAX_OWNED_WORKSPACES) {
    throw new Error(`Puoi creare al massimo ${MAX_OWNED_WORKSPACES} spazi di lavoro.`)
  }

  const { data: ws, error } = await supabaseAdmin
    .from('workspaces')
    .insert({ name, created_by: userId })
    .select('id, name, plan')
    .single()
  if (error || !ws) throw new Error(`spazio non creato: ${error?.message}`)

  const { error: memberError } = await supabaseAdmin
    .from('workspace_members')
    .insert({ workspace_id: ws.id, user_id: userId, role: 'owner' })
  if (memberError) {
    await supabaseAdmin.from('workspaces').delete().eq('id', ws.id)
    throw new Error(`spazio non creato: ${memberError.message}`)
  }

  const db = workspaceDb(ws.id)
  await db.from('social_channels').insert(
    STARTER_CHANNELS.map((platform) => ({ platform, status: 'not_connected', reply_mode: 'approval', automation_enabled: false }))
  )
  return { id: ws.id, name: ws.name, plan: ws.plan, role: 'owner' }
}
