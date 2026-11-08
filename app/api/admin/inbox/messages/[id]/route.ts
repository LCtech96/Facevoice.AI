import { NextRequest, NextResponse, after } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { guard } from '@/lib/staff-access'
import { deliver, setOrigin, type OutgoingTarget } from '@/lib/meta/agent'
import { releaseVerificationCode } from '@/lib/identity-verify'
import { attachSentExample, correctedMessage, isSubstantialEdit, learnFromEditedDraft } from '@/lib/corrections'

export const dynamic = 'force-dynamic'

const SELECT =
  'id, platform, contact_id, kind, direction, body, status, error_message, contact_name, reply_to, created_at'

/**
 * Azioni su una bozza AI: { action: 'approve', text? } la invia (eventualmente
 * modificata), { action: 'reject' } la scarta. Si puo' anche ritentare un invio fallito.
 * Bozza dell'AI modificata in modo sostanziale e inviata: parte il testo modificato e,
 * dopo la risposta, diventa una correzione (lib/corrections.ts, "Correzioni imparate" in
 * Memoria AI). Bozza gia' corretta con "Correggi" solo a parole e inviata cosi': il testo
 * inviato diventa l'esempio di quella correzione.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await guard(req, 'inbox', 'reply')
  if (access instanceof NextResponse) return access

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const action = body?.action

  const { data: draft } = await supabaseAdmin
    .from('social_messages')
    .select('id, platform, kind, contact_id, channel_account_id, reply_to, body, status, direction, created_at')
    .eq('id', id)
    .maybeSingle()

  if (!draft || draft.direction !== 'out') {
    return NextResponse.json({ error: 'Bozza non trovata' }, { status: 404 })
  }
  if (draft.status !== 'pending' && draft.status !== 'failed') {
    return NextResponse.json({ error: 'Questa risposta è già stata gestita' }, { status: 409 })
  }

  if (action === 'reject') {
    const { data, error } = await supabaseAdmin
      .from('social_messages')
      .update({ status: 'rejected' })
      .eq('id', id)
      .select(SELECT)
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ message: data })
  }

  if (action !== 'approve') {
    return NextResponse.json({ error: 'Azione non valida' }, { status: 400 })
  }

  const text = String(body?.text ?? draft.body).trim().slice(0, draft.platform === 'email' ? 10000 : 1900)
  if (!text) return NextResponse.json({ error: 'Il messaggio è vuoto' }, { status: 400 })

  // Blocco ottimistico: solo una richiesta alla volta puo' passare da pending/failed a sending.
  const { data: locked } = await supabaseAdmin
    .from('social_messages')
    .update({ status: 'sending', body: text })
    .eq('id', id)
    .in('status', ['pending', 'failed'])
    .select('id')
    .maybeSingle()
  if (!locked) return NextResponse.json({ error: 'Invio già in corso' }, { status: 409 })

  const sent = await deliver(draft as OutgoingTarget, text)

  const { data, error } = await supabaseAdmin
    .from('social_messages')
    .update({
      status: sent.error ? 'failed' : 'sent',
      error_message: sent.error ?? null,
      external_id: sent.id ?? null,
    })
    .eq('id', id)
    .select(SELECT)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // Bozza inviata cosi' com'era o corretta da Luca: diventa un esempio per le prossime risposte.
  const original = String(draft.body ?? '').trim()
  const edited = text !== original
  // Solo le bozze (non i ritentativi: la' il testo dell'AI era gia' stato sostituito).
  const learning = !sent.error && draft.status === 'pending' && edited && isSubstantialEdit(original, text)
  if (!sent.error) {
    const viaCorrection = !edited && draft.status === 'pending' && (await correctedMessage(id))
    await setOrigin(id, edited || viaCorrection ? 'ai_edited' : 'ai_approved')
    if (learning) {
      after(() =>
        learnFromEditedDraft({
          messageId: id,
          original,
          edited: text,
          by: access.email,
          draft: { platform: draft.platform, kind: draft.kind, contact_id: draft.contact_id, reply_to: draft.reply_to, created_at: draft.created_at },
        }).then(() => undefined)
      )
    } else if (draft.status === 'pending') {
      // Corretta prima solo a parole: il testo inviato diventa l'esempio (se manca).
      after(() => attachSentExample(id, text).then(() => undefined))
    }
  }
  // Era la risposta che annuncia l'email di verifica: solo ora parte il codice, all'email registrata.
  if (!sent.error) {
    await releaseVerificationCode(draft.platform, draft.contact_id, id).catch((e) => console.error('verifica identità, codice:', e))
  }
  if (sent.error) return NextResponse.json({ error: `Invio non riuscito: ${sent.error}`, message: data }, { status: 502 })
  return NextResponse.json({ message: data, ...(learning ? { correction: 'learning' } : {}) })
}
