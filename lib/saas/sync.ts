import { supabaseAdmin } from '@/lib/supabase-admin'
import { FACEVOICE_WORKSPACE_ID, workspaceDb } from '@/lib/workspace-db'
import { listConnections, type Connection } from './connections'
import { syncMailbox, type EmailMeta } from './email'
import { scheduleReply } from './reply-queue'
import { noteProspectReplies } from './prospects'

// Lettura periodica delle caselle email dei clienti: dal cron ogni minuto in
// produzione e dall'omnichat quando e' aperta (le anteprime non hanno il cron).

const MIN_INTERVAL_MS = 45_000
const MAX_REPLIES_PER_RUN = 3

const due = (connection: Connection) => {
  const last = (connection.meta as EmailMeta)?.last_sync_at
  return !last || Date.now() - new Date(last).getTime() >= MIN_INTERVAL_MS
}

export type SyncResult = { checked: number; inserted: number; replies: number; errors: string[] }

/** Legge le caselle di uno spazio e prepara le risposte ai messaggi nuovi. */
export async function syncWorkspace(workspaceId: string, options: { force?: boolean } = {}): Promise<SyncResult> {
  const db = workspaceDb(workspaceId)
  const result: SyncResult = { checked: 0, inserted: 0, replies: 0, errors: [] }
  const connections = (await listConnections(db, 'email')).filter((c) => c.status !== 'disconnected' && (options.force || due(c)))
  for (const connection of connections) {
    result.checked++
    const { inserted, error } = await syncMailbox(db, connection)
    if (error) result.errors.push(`${connection.external_id}: ${error}`)
    result.inserted += inserted.length
    // Risposte delle aziende contattate con Trova clienti: chi chiede di non essere piu' contattato
    // va nella lista Non contattare e non riceve una risposta automatica.
    const optOuts = await noteProspectReplies(db, inserted).catch((err) => {
      console.warn('trova clienti risposte:', err instanceof Error ? err.message : err)
      return new Set<string>()
    })
    for (const id of inserted.filter((m) => !optOuts.has(m)).slice(-MAX_REPLIES_PER_RUN)) {
      // Subito, o in coda con il ritardo scelto dal cliente (la manda il cron).
      const scheduled = await scheduleReply(db, id)
      if (scheduled.status === 'queued' || scheduled.outcome.status === 'sent' || scheduled.outcome.status === 'pending') result.replies++
    }
  }
  return result
}

/** Dal cron: tutte le caselle dei clienti che non vengono lette da un po'. */
export async function syncAllWorkspaces(maxWorkspaces = 8): Promise<SyncResult & { workspaces: number }> {
  const total = { checked: 0, inserted: 0, replies: 0, errors: [] as string[], workspaces: 0 }
  const { data, error } = await supabaseAdmin
    .from('channel_connections')
    .select('workspace_id, meta')
    .eq('platform', 'email')
    .neq('status', 'disconnected')
    .neq('workspace_id', FACEVOICE_WORKSPACE_ID)
  if (error) {
    // Database senza le tabelle SaaS (es. prima del lancio): niente da fare.
    if (!/channel_connections|does not exist/i.test(error.message)) console.error('saas sync:', error.message)
    return total
  }
  const workspaces = [...new Set((data || []).filter((row) => due(row as Connection)).map((row) => row.workspace_id as string))].slice(0, maxWorkspaces)
  for (const id of workspaces) {
    const r = await syncWorkspace(id).catch((err) => ({ checked: 0, inserted: 0, replies: 0, errors: [String(err)] }))
    total.workspaces++
    total.checked += r.checked
    total.inserted += r.inserted
    total.replies += r.replies
    total.errors.push(...r.errors)
  }
  return total
}
