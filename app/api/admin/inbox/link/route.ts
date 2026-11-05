import { NextRequest, NextResponse } from 'next/server'
import { guard } from '@/lib/staff-access'
import { linkConversations, linkedMembers, resolveKey, unlinkMember } from '@/lib/meta/identities'
import { clearSeparations, recordSeparation } from '@/lib/meta/auto-link'
import { clearVerificationOnUnlink } from '@/lib/identity-verify'

export const dynamic = 'force-dynamic'

/** Collega due conversazioni come la stessa persona. body: { a, b } (chiavi di conversazione). */
export async function POST(req: NextRequest) {
  const access = await guard(req, 'inbox', 'reply')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  if (typeof body?.a !== 'string' || typeof body?.b !== 'string' || body.a === body.b) {
    return NextResponse.json({ error: 'Conversazioni non valide' }, { status: 400 })
  }
  const [a, b] = await Promise.all([resolveKey(body.a), resolveKey(body.b)])
  const result = await linkConversations(body.a, body.b)
  if (result.error) return NextResponse.json({ error: result.error }, { status: 500 })
  // Collegate a mano da Luca: una sua separazione precedente tra queste conversazioni non vale piu'.
  await clearSeparations(a, b).catch((error) => console.error('collegamento, separazioni:', error))
  return NextResponse.json({ key: result.key })
}

/** Separa un account dalla persona. body: { platform, contactId } */
export async function DELETE(req: NextRequest) {
  const access = await guard(req, 'inbox', 'reply')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  if (typeof body?.platform !== 'string' || typeof body?.contactId !== 'string') {
    return NextResponse.json({ error: 'Parametri mancanti' }, { status: 400 })
  }
  const member = { platform: body.platform, contactId: body.contactId }
  const formerGroup = await linkedMembers(member.platform, member.contactId).catch(() => [member])
  // Separata da Luca: queste coppie non si ricollegano piu' in automatico (nemmeno passando da un altro
  // account). Si salva prima di separare, cosi' un messaggio in arrivo nel frattempo non le ricollega.
  await recordSeparation(member, formerGroup).catch((error) => console.error('separazione, collegamento automatico:', error))
  await unlinkMember(member)
  // Collegamento separato: la verifica che lo aveva creato (o che ne dipendeva) non vale piu'.
  await clearVerificationOnUnlink(member, formerGroup).catch((error) => console.error('verifica identità, separazione:', error))
  return NextResponse.json({ success: true })
}
