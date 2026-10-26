import { NextRequest, NextResponse } from 'next/server'
import { guard } from '@/lib/staff-access'
import { sendFirstEmail } from '@/lib/lead-send'

export const dynamic = 'force-dynamic'

/**
 * Invia il primo contatto via email, uno alla volta e solo su conferma dell'admin.
 * La conversazione finisce in Messaggi: le risposte arrivano li' come ogni email.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await guard(req, 'leads', 'email')
  if (access instanceof NextResponse) return access
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const result = await sendFirstEmail(id, { subject: body?.subject, body: body?.body })
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ lead: result.lead })
}
