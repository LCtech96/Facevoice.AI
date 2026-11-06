import { NextRequest, NextResponse, after } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'
import { deliverDraft, saveTeamMessage } from '@/lib/saas/responder'
import { learnFromEditedDraft } from '@/lib/saas/corrections'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Omnichat: invia una risposta. Con draftId si approva (ed eventualmente si
// modifica) una bozza dell'AI; senza, e' un messaggio scritto a mano. Una bozza
// dell'AI modificata in modo sostanziale insegna una regola (dopo l'invio).

export async function POST(req: NextRequest) {
  const access = await requireWorkspace(req)
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  const text = String(body.body || '').trim()
  if (!text) return NextResponse.json({ error: 'Scrivi il messaggio.' }, { status: 400 })
  if (text.length > 10000) return NextResponse.json({ error: 'Messaggio troppo lungo.' }, { status: 400 })

  let draftId = typeof body.draftId === 'string' ? body.draftId : ''
  let origin = 'manual'
  /** Testo dell'AI prima della modifica (solo per le bozze dell'AI). */
  let aiText: string | null = null
  if (draftId) {
    const { data: draft } = await access.db.from('social_messages').select('id, body, direction, origin').eq('id', draftId).maybeSingle()
    if (!draft || draft.direction !== 'out') return NextResponse.json({ error: 'Bozza non trovata' }, { status: 404 })
    origin = draft.body.trim() === text ? 'ai_approved' : 'ai_edited'
    if (String(draft.origin || '').startsWith('ai')) aiText = String(draft.body)
  } else {
    const saved = await saveTeamMessage(access.db, String(body.platform || ''), String(body.contactId || ''), text)
    if ('error' in saved) {
      return saved.error === 'not_found'
        ? NextResponse.json({ error: 'Conversazione non trovata' }, { status: 404 })
        : NextResponse.json({ error: 'Messaggio non salvato, riprova.' }, { status: 500 })
    }
    draftId = saved.id
  }

  const sent = await deliverDraft(access.db, draftId, text, origin)
  if (!sent.ok) return NextResponse.json({ error: `Invio non riuscito: ${sent.error}` }, { status: 502 })
  if (origin === 'ai_edited' && aiText !== null) {
    const original = aiText
    const id = draftId
    after(() => learnFromEditedDraft(access.db, { messageId: id, original, edited: text }).catch(() => null))
  }
  return NextResponse.json({ ok: true })
}
