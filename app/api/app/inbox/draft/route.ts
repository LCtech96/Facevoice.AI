import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'
import { respondToMessage } from '@/lib/saas/responder'
import { aiBlockedMessage } from '@/lib/usage-limits'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Omnichat: scarta una bozza dell'AI, oppure chiedine una (anche ad automazione
// spenta, su richiesta) per l'ultimo messaggio ricevuto.

export async function POST(req: NextRequest) {
  const access = await requireWorkspace(req)
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))

  if (body.action === 'reject') {
    const { data, error } = await access.db
      .from('social_messages')
      .update({ status: 'rejected' })
      .eq('id', String(body.id || ''))
      .eq('direction', 'out')
      .in('status', ['pending', 'failed'])
      .select('id')
    if (error || !data?.length) return NextResponse.json({ error: 'Bozza non trovata' }, { status: 404 })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'suggest') {
    const { data: last } = await access.db
      .from('social_messages')
      .select('id')
      .eq('platform', String(body.platform || ''))
      .eq('contact_id', String(body.contactId || ''))
      .eq('kind', 'message')
      .eq('direction', 'in')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!last) return NextResponse.json({ error: 'Nessun messaggio a cui rispondere' }, { status: 404 })
    // Bozza su richiesta: mai invio automatico.
    const outcome = await respondToMessage(access.db, last.id as string, { force: true })
    if (outcome.blocked) return NextResponse.json({ error: await aiBlockedMessage(access.workspace.id), blocked: true }, { status: 402 })
    if (outcome.status === 'failed') return NextResponse.json({ error: `Bozza non pronta: ${outcome.reason}` }, { status: 502 })
    return NextResponse.json({ ok: true, outcome })
  }

  return NextResponse.json({ error: 'Azione non valida' }, { status: 400 })
}
