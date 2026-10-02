import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAdminEmail } from '@/lib/admin-request'
import { deliver, type OutgoingTarget } from '@/lib/meta/agent'

export const dynamic = 'force-dynamic'

const SELECT =
  'id, platform, contact_id, kind, direction, body, status, error_message, contact_name, reply_to, created_at'

/**
 * Azioni su una bozza AI: { action: 'approve', text? } la invia (eventualmente
 * modificata), { action: 'reject' } la scarta. Si puo' anche ritentare un invio fallito.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getAdminEmail(req))) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }

  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const action = body?.action

  const { data: draft } = await supabaseAdmin
    .from('social_messages')
    .select('id, platform, kind, contact_id, channel_account_id, reply_to, body, status, direction')
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
  if (sent.error) return NextResponse.json({ error: `Invio non riuscito: ${sent.error}`, message: data }, { status: 502 })
  return NextResponse.json({ message: data })
}
