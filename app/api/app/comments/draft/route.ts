import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'
import { respondToComment } from '@/lib/saas/comments'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Pagina Commenti: scarta una bozza dell'AI, oppure chiedine una (anche con le
// risposte automatiche spente) per un commento.

export async function POST(req: NextRequest) {
  const access = await requireWorkspace(req)
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))

  if (body.action === 'reject') {
    const { data, error } = await access.db
      .from('social_messages')
      .update({ status: 'rejected' })
      .eq('id', String(body.id || ''))
      .eq('kind', 'comment')
      .eq('direction', 'out')
      .in('status', ['pending', 'failed'])
      .select('id')
    if (error || !data?.length) return NextResponse.json({ error: 'Bozza non trovata' }, { status: 404 })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'suggest') {
    const outcome = await respondToComment(access.db, String(body.commentId || ''), { force: true })
    if (outcome.status === 'failed') return NextResponse.json({ error: `Bozza non pronta: ${outcome.reason}` }, { status: 502 })
    if (outcome.status === 'skipped' && outcome.reason === 'nessuna risposta necessaria') {
      return NextResponse.json({ ok: true, outcome, notice: 'Per l’AI questo commento non ha bisogno di risposta (tag, spam o simili). Puoi comunque scriverne una tu.' })
    }
    return NextResponse.json({ ok: true, outcome })
  }

  return NextResponse.json({ error: 'Azione non valida' }, { status: 400 })
}
