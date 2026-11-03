import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'
import { deleteConnection, listConnections, readConnectionSecret, setChannelState } from '@/lib/saas/connections'
import { GRAPH, metaConfig, type MetaSecret } from '@/lib/saas/meta'

export const dynamic = 'force-dynamic'

// Scollega una Pagina Facebook (e il suo Instagram) dallo spazio di lavoro.

export async function DELETE(req: NextRequest) {
  const access = await requireWorkspace(req, 'admin')
  if (access instanceof NextResponse) return access
  const id = req.nextUrl.searchParams.get('id') || ''
  const all = [...(await listConnections(access.db, 'facebook')), ...(await listConnections(access.db, 'instagram'))]
  const target = all.find((c) => c.id === id)
  if (!target) return NextResponse.json({ error: 'Collegamento non trovato' }, { status: 404 })

  const pageId = target.platform === 'facebook' ? target.external_id : String((target.meta as { pageId?: string }).pageId || '')
  const linked = all.filter((c) => c.external_id === pageId || (c.meta as { pageId?: string }).pageId === pageId)
  // La Pagina smette di mandarci i suoi eventi.
  try {
    const secret = await readConnectionSecret<MetaSecret>(target.id)
    if (metaConfig().appId) await fetch(`${GRAPH}/${pageId}/subscribed_apps?access_token=${encodeURIComponent(secret.pageToken)}`, { method: 'DELETE' })
  } catch {}
  for (const c of linked) await deleteConnection(access.db, c.id)

  const left = all.filter((c) => !linked.includes(c))
  if (!left.some((c) => c.platform === 'facebook')) await setChannelState(access.db, 'facebook', { status: 'not_connected', handle: null })
  if (!left.some((c) => c.platform === 'instagram')) await setChannelState(access.db, 'instagram', { status: 'not_connected', handle: null })
  return NextResponse.json({ ok: true })
}
