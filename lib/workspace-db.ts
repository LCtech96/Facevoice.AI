import { supabaseAdmin } from '@/lib/supabase-admin'

// Accesso alle tabelle che appartengono a uno spazio di lavoro (un cliente).
// Il server usa la service role, che salta le regole del database: e' qui che
// ogni lettura, modifica e cancellazione viene limitata allo spazio giusto, e
// ogni inserimento viene marcato con il suo spazio. Usare SEMPRE questo, mai
// supabaseAdmin.from(...) direttamente, per le tabelle elencate sotto.

/** Lo spazio di Facevoice (il pannello admin di sempre). */
export const FACEVOICE_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001'

export const WORKSPACE_TABLES = [
  'social_channels',
  'social_messages',
  'social_identities',
  'ai_knowledge',
  'ai_usage',
  'channel_connections',
] as const

export type WorkspaceTable = (typeof WORKSPACE_TABLES)[number]

type Row = Record<string, unknown>

const withWorkspace = <T extends Row | Row[]>(values: T, workspaceId: string): T =>
  (Array.isArray(values)
    ? values.map((row) => ({ ...row, workspace_id: workspaceId }))
    : { ...values, workspace_id: workspaceId }) as T

export function workspaceDb(workspaceId: string) {
  if (!workspaceId) throw new Error('workspaceDb: spazio di lavoro mancante')
  return {
    workspaceId,
    from(table: WorkspaceTable) {
      const query = supabaseAdmin.from(table)
      return {
        select: ((...args: Parameters<typeof query.select>) =>
          query.select(...args).eq('workspace_id', workspaceId)) as typeof query.select,
        insert: ((values: Row | Row[], options?: Parameters<typeof query.insert>[1]) =>
          query.insert(withWorkspace(values, workspaceId), options)) as typeof query.insert,
        upsert: ((values: Row | Row[], options?: Parameters<typeof query.upsert>[1]) =>
          query.upsert(withWorkspace(values, workspaceId), options)) as typeof query.upsert,
        update: ((values: Row, options?: Parameters<typeof query.update>[1]) =>
          query.update({ ...values, workspace_id: workspaceId }, options).eq('workspace_id', workspaceId)) as typeof query.update,
        delete: ((options?: Parameters<typeof query.delete>[0]) =>
          query.delete(options).eq('workspace_id', workspaceId)) as typeof query.delete,
      }
    },
  }
}

export type WorkspaceDb = ReturnType<typeof workspaceDb>

/** Dati dello spazio Facevoice: usato dal pannello admin e dai canali di Facevoice. */
export const facevoiceDb = workspaceDb(FACEVOICE_WORKSPACE_ID)
