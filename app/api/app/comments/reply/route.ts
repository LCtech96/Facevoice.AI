import { NextRequest, NextResponse, after } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'
import { deliverComment, sendPrivateReply } from '@/lib/saas/comments'
import { learnFromEditedDraft } from '@/lib/saas/corrections'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Pagina Commenti: pubblica la risposta sotto un commento (bozza dell'AI,
// eventualmente modificata, o testo scritto a mano), oppure scrive in privato a
// chi ha commentato. Una bozza dell'AI modificata in modo sostanziale insegna
// una regola (dopo la pubblicazione).

export async function POST(req: NextRequest) {
  const access = await requireWorkspace(req)
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  const text = String(body.body || '').trim()
  if (!text) return NextResponse.json({ error: 'Scrivi la risposta.' }, { status: 400 })
  if (text.length > 2000) return NextResponse.json({ error: 'Risposta troppo lunga.' }, { status: 400 })
  const commentId = String(body.commentId || '')

  if (body.private === true) {
    const sent = await sendPrivateReply(access.db, commentId, text)
    if (!sent.ok) return NextResponse.json({ error: `Messaggio privato non inviato: ${sent.error}` }, { status: 502 })
    return NextResponse.json({ ok: true })
  }

  let draftId = typeof body.draftId === 'string' ? body.draftId : ''
  let origin = 'manual'
  /** Testo dell'AI prima della modifica (solo per le bozze dell'AI). */
  let aiText: string | null = null
  if (draftId) {
    const { data: draft } = await access.db.from('social_messages').select('id, body, kind, direction, origin').eq('id', draftId).maybeSingle()
    if (!draft || draft.kind !== 'comment' || draft.direction !== 'out') return NextResponse.json({ error: 'Bozza non trovata' }, { status: 404 })
    origin = draft.body.trim() === text ? 'ai_approved' : 'ai_edited'
    if (String(draft.origin || '').startsWith('ai')) aiText = String(draft.body)
  } else {
    const { data: comment } = await access.db
      .from('social_messages')
      .select('id, platform, kind, direction, contact_id, contact_name, external_id, channel_account_id')
      .eq('id', commentId)
      .maybeSingle()
    if (!comment || comment.kind !== 'comment' || comment.direction !== 'in') return NextResponse.json({ error: 'Commento non trovato' }, { status: 404 })
    const { data: saved, error } = await access.db
      .from('social_messages')
      .insert({
        platform: comment.platform,
        kind: 'comment',
        direction: 'out',
        contact_id: comment.contact_id,
        contact_name: comment.contact_name,
        reply_to: comment.external_id,
        channel_account_id: comment.channel_account_id,
        body: text,
        status: 'pending',
        origin: 'manual',
      })
      .select('id')
      .single()
    if (error || !saved) return NextResponse.json({ error: 'Risposta non salvata, riprova.' }, { status: 500 })
    draftId = saved.id as string
  }

  const sent = await deliverComment(access.db, draftId, text, origin)
  if (!sent.ok) return NextResponse.json({ error: `Risposta non pubblicata: ${sent.error}` }, { status: 502 })
  if (origin === 'ai_edited' && aiText !== null) {
    const original = aiText
    const id = draftId
    after(() => learnFromEditedDraft(access.db, { messageId: id, original, edited: text }).catch(() => null))
  }
  return NextResponse.json({ ok: true })
}
