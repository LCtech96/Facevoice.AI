import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'
import { deliverDraft } from '@/lib/saas/responder'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Omnichat: invia una risposta. Con draftId si approva (ed eventualmente si
// modifica) una bozza dell'AI; senza, e' un messaggio scritto a mano.

export async function POST(req: NextRequest) {
  const access = await requireWorkspace(req)
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  const text = String(body.body || '').trim()
  if (!text) return NextResponse.json({ error: 'Scrivi il messaggio.' }, { status: 400 })
  if (text.length > 10000) return NextResponse.json({ error: 'Messaggio troppo lungo.' }, { status: 400 })

  let draftId = typeof body.draftId === 'string' ? body.draftId : ''
  let origin = 'manual'
  if (draftId) {
    const { data: draft } = await access.db.from('social_messages').select('id, body, direction').eq('id', draftId).maybeSingle()
    if (!draft || draft.direction !== 'out') return NextResponse.json({ error: 'Bozza non trovata' }, { status: 404 })
    origin = draft.body.trim() === text ? 'ai_approved' : 'ai_edited'
  } else {
    const platform = String(body.platform || '')
    const contact = String(body.contactId || '')
    // L'ultimo messaggio ricevuto da' oggetto, filo e casella da cui rispondere.
    const { data: last } = await access.db
      .from('social_messages')
      .select('contact_name, subject, external_id, channel_account_id')
      .eq('platform', platform)
      .eq('contact_id', contact)
      .eq('direction', 'in')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!last) return NextResponse.json({ error: 'Conversazione non trovata' }, { status: 404 })
    const { data: saved, error } = await access.db
      .from('social_messages')
      .insert({
        platform,
        kind: 'message',
        direction: 'out',
        contact_id: contact,
        contact_name: last.contact_name,
        subject: last.subject,
        reply_to: last.external_id,
        channel_account_id: last.channel_account_id,
        body: text,
        status: 'pending',
        origin: 'manual',
      })
      .select('id')
      .single()
    if (error || !saved) return NextResponse.json({ error: 'Messaggio non salvato, riprova.' }, { status: 500 })
    draftId = saved.id as string
  }

  const sent = await deliverDraft(access.db, draftId, text, origin)
  if (!sent.ok) return NextResponse.json({ error: `Invio non riuscito: ${sent.error}` }, { status: 502 })
  return NextResponse.json({ ok: true })
}
