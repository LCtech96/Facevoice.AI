import { supabaseAdmin } from '@/lib/supabase-admin'
import { openSecret, sealSecret } from '@/lib/secret-box'
import type { WorkspaceDb } from '@/lib/workspace-db'

// Account collegati dai clienti (casella email, Pagina Facebook, profilo
// Instagram). I dati non segreti stanno in channel_connections, le credenziali
// cifrate in channel_secrets (leggibile solo dal server).

export type ConnectionPlatform = 'email' | 'instagram' | 'facebook' | 'whatsapp'

export type Connection = {
  id: string
  workspace_id: string
  platform: ConnectionPlatform
  external_id: string
  display_name: string | null
  status: 'connected' | 'expired' | 'error' | 'disconnected'
  last_error: string | null
  meta: Record<string, unknown>
  created_at: string
  updated_at: string
}

const COLUMNS = 'id, workspace_id, platform, external_id, display_name, status, last_error, meta, created_at, updated_at'

export async function listConnections(db: WorkspaceDb, platform?: ConnectionPlatform): Promise<Connection[]> {
  let query = db.from('channel_connections').select(COLUMNS).order('created_at')
  if (platform) query = query.eq('platform', platform)
  const { data, error } = await query
  if (error) throw new Error(`account collegati non letti: ${error.message}`)
  return (data || []) as Connection[]
}

/** Chi ha gia' collegato questo account? (un account appartiene a un solo spazio) */
export async function connectionOwner(platform: ConnectionPlatform, externalId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('channel_connections')
    .select('workspace_id')
    .eq('platform', platform)
    .eq('external_id', externalId)
    .maybeSingle()
  return (data?.workspace_id as string | undefined) ?? null
}

export async function saveConnection(
  db: WorkspaceDb,
  input: { platform: ConnectionPlatform; externalId: string; displayName: string | null; meta: Record<string, unknown>; secret: unknown; userId: string }
): Promise<Connection> {
  const { data, error } = await db
    .from('channel_connections')
    .upsert(
      {
        platform: input.platform,
        external_id: input.externalId,
        display_name: input.displayName,
        status: 'connected',
        last_error: null,
        meta: input.meta,
        connected_by: input.userId,
      },
      { onConflict: 'platform,external_id' }
    )
    .select(COLUMNS)
    .single()
  if (error || !data) throw new Error(`collegamento non salvato: ${error?.message}`)
  const { error: secretError } = await supabaseAdmin
    .from('channel_secrets')
    .upsert({ connection_id: data.id, ciphertext: sealSecret(input.secret), updated_at: new Date().toISOString() })
  if (secretError) throw new Error(`credenziali non salvate: ${secretError.message}`)
  return data as Connection
}

export async function readConnectionSecret<T>(connectionId: string): Promise<T> {
  const { data, error } = await supabaseAdmin.from('channel_secrets').select('ciphertext').eq('connection_id', connectionId).maybeSingle()
  if (error || !data) throw new Error('credenziali del collegamento non trovate')
  return openSecret<T>(data.ciphertext as string)
}

export async function updateConnection(db: WorkspaceDb, id: string, patch: Partial<Pick<Connection, 'status' | 'last_error' | 'meta' | 'display_name'>>) {
  const { error } = await db.from('channel_connections').update(patch).eq('id', id)
  if (error) console.error('connection update:', error.message)
}

export async function deleteConnection(db: WorkspaceDb, id: string) {
  // channel_secrets si cancella a cascata.
  const { error } = await db.from('channel_connections').delete().eq('id', id)
  if (error) throw new Error(`collegamento non rimosso: ${error.message}`)
}

/** Aggiorna la riga del canale (stato mostrato in Panoramica e Omnichat). */
export async function setChannelState(db: WorkspaceDb, platform: string, patch: { status: string; handle?: string | null; display_name?: string | null }) {
  const { data } = await db.from('social_channels').select('id').eq('platform', platform).maybeSingle()
  if (data) await db.from('social_channels').update(patch).eq('id', data.id)
  else await db.from('social_channels').insert({ platform, reply_mode: 'approval', automation_enabled: false, ...patch })
}
