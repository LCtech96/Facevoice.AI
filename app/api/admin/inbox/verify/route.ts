import { NextRequest, NextResponse } from 'next/server'
import { guard } from '@/lib/staff-access'
import { resolveKey } from '@/lib/meta/identities'
import { resetVerification } from '@/lib/identity-verify'

export const dynamic = 'force-dynamic'

/**
 * Azzera la verifica dell'identita' di una conversazione (?c=chiave): le risposte
 * tornano a seguire la modalita' del canale. Non collega e non separa nessun account.
 */
export async function DELETE(req: NextRequest) {
  const access = await guard(req, 'inbox', 'reply')
  if (access instanceof NextResponse) return access
  const key = req.nextUrl.searchParams.get('c') || ''
  const members = key ? await resolveKey(key) : []
  if (!members.length) return NextResponse.json({ error: 'Conversazione non trovata' }, { status: 404 })
  await resetVerification(members)
  return NextResponse.json({ success: true })
}
