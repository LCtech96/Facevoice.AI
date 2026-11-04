import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'
import { listConnections } from '@/lib/saas/connections'
import { canPublish } from '@/lib/saas/publish'

export const dynamic = 'force-dynamic'

// Canali dello spazio di lavoro: stato, account collegati e automazione.
// Automazione: off (solo raccolta messaggi) | approval (l'AI prepara bozze) | auto (l'AI invia).

export type AutomationMode = 'off' | 'approval' | 'auto'

export async function GET(req: NextRequest) {
  const access = await requireWorkspace(req)
  if (access instanceof NextResponse) return access
  const [{ data, error }, connections] = await Promise.all([
    access.db.from('social_channels').select('id, platform, display_name, handle, status, reply_mode, automation_enabled').order('platform'),
    listConnections(access.db).catch(() => []),
  ])
  if (error) return NextResponse.json({ error: 'Canali non disponibili, riprova.' }, { status: 500 })
  return NextResponse.json({
    channels: (data || []).map((c) => ({ ...c, mode: (c.automation_enabled ? (c.reply_mode === 'auto' ? 'auto' : 'approval') : 'off') as AutomationMode })),
    connections: connections.map((c) => ({
      id: c.id,
      platform: c.platform,
      account: c.external_id,
      name: c.display_name,
      status: c.status,
      error: c.last_error,
      lastSync: (c.meta as { last_sync_at?: string })?.last_sync_at || null,
      via: (c.meta as { via?: string })?.via || null,
      canPublish: c.platform === 'instagram' || c.platform === 'facebook' ? canPublish(c) : false,
    })),
  })
}

export async function PATCH(req: NextRequest) {
  const access = await requireWorkspace(req, 'admin')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  const platform = String(body.platform || '')
  const mode = String(body.mode || '') as AutomationMode
  if (!['off', 'approval', 'auto'].includes(mode)) return NextResponse.json({ error: 'Modalità non valida' }, { status: 400 })
  const { data, error } = await access.db
    .from('social_channels')
    .update({ automation_enabled: mode !== 'off', reply_mode: mode === 'auto' ? 'auto' : 'approval' })
    .eq('platform', platform)
    .select('platform')
  if (error || !data?.length) return NextResponse.json({ error: 'Canale non trovato' }, { status: 404 })
  return NextResponse.json({ ok: true, platform, mode })
}
