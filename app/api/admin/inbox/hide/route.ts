import { NextRequest, NextResponse } from 'next/server'
import { getAdminEmail } from '@/lib/admin-request'
import { resolveKey } from '@/lib/meta/identities'
import { hideMembers, restoreHidden } from '@/lib/inbox-hidden'

export const dynamic = 'force-dynamic'

/**
 * Elimina una conversazione dalla casella: { key }.
 * Annulla: { undo: { "platform:contactId": data | null } } (i valori restituiti dall'eliminazione).
 */
export async function POST(req: NextRequest) {
  if (!(await getAdminEmail(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const body = await req.json().catch(() => ({}))

  if (body?.undo && typeof body.undo === 'object') {
    await restoreHidden(body.undo)
    return NextResponse.json({ restored: true })
  }

  const key = typeof body?.key === 'string' ? body.key : ''
  const members = key ? await resolveKey(key) : []
  if (!members.length) return NextResponse.json({ error: 'Conversazione non trovata' }, { status: 404 })
  const previous = await hideMembers(members)
  return NextResponse.json({ hidden: true, previous })
}
