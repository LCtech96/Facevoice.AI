import { NextRequest, NextResponse } from 'next/server'
import { guard } from '@/lib/staff-access'
import { linkConversations, unlinkMember } from '@/lib/meta/identities'

export const dynamic = 'force-dynamic'

/** Collega due conversazioni come la stessa persona. body: { a, b } (chiavi di conversazione). */
export async function POST(req: NextRequest) {
  const access = await guard(req, 'inbox', 'reply')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  if (typeof body?.a !== 'string' || typeof body?.b !== 'string' || body.a === body.b) {
    return NextResponse.json({ error: 'Conversazioni non valide' }, { status: 400 })
  }
  const result = await linkConversations(body.a, body.b)
  if (result.error) return NextResponse.json({ error: result.error }, { status: 500 })
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
  await unlinkMember({ platform: body.platform, contactId: body.contactId })
  return NextResponse.json({ success: true })
}
