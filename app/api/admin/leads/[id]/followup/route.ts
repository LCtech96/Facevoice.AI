import { NextRequest, NextResponse } from 'next/server'
import { guard } from '@/lib/staff-access'
import { sendFollowupEmail } from '@/lib/lead-send'

export const dynamic = 'force-dynamic'

/** Follow-up a un contatto gia' scritto: risposta nello stesso thread Gmail. body: { subject, body, threadId? } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await guard(req, 'leads', 'email')
  if (access instanceof NextResponse) return access
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const result = await sendFollowupEmail(id, { subject: body?.subject, body: body?.body, threadId: body?.threadId })
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ success: true })
}
