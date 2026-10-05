import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAdminEmail } from '@/lib/admin-request'
import { sendNewEmail, sendThreadReply } from '@/lib/gmail'

export const dynamic = 'force-dynamic'

// Tetto giornaliero di email commerciali (primi contatti + follow-up) dalla casella.
const DAILY_OUTREACH_LIMIT = 60

/** Follow-up a un contatto gia' scritto: risposta nello stesso thread Gmail. body: { subject, body, threadId? } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getAdminEmail(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const { data: lead } = await supabaseAdmin.from('leads').select('*').eq('id', id).maybeSingle()
  if (!lead) return NextResponse.json({ error: 'Contatto non trovato' }, { status: 404 })
  if (lead.status === 'do_not_contact') return NextResponse.json({ error: 'Ha chiesto di non essere ricontattato' }, { status: 409 })
  if (lead.status !== 'contacted') return NextResponse.json({ error: 'Il contatto ha già risposto o non è stato contattato' }, { status: 409 })

  const to = String(lead.email || '').toLowerCase()
  const subject = String(body?.subject || '').trim()
  const text = String(body?.body || '').trim()
  if (!to || !text) return NextResponse.json({ error: 'Email o testo mancanti' }, { status: 400 })

  const since = new Date()
  since.setHours(0, 0, 0, 0)
  const { count } = await supabaseAdmin
    .from('social_messages')
    .select('id', { count: 'exact', head: true })
    .eq('platform', 'email')
    .eq('direction', 'out')
    .gte('created_at', since.toISOString())
  if ((count ?? 0) >= DAILY_OUTREACH_LIMIT) {
    return NextResponse.json({ error: `Limite di ${DAILY_OUTREACH_LIMIT} email al giorno raggiunto: riprova domani.` }, { status: 429 })
  }

  const threadId = typeof body?.threadId === 'string' && body.threadId ? body.threadId : null
  const sent = threadId
    ? { ...(await sendThreadReply(threadId, to, text)), threadId }
    : await sendNewEmail(to, subject || `Re: ${lead.email_subject || lead.name}`, text)
  if (sent.error) return NextResponse.json({ error: `Invio non riuscito: ${sent.error}` }, { status: 502 })

  const { data: row } = await supabaseAdmin
    .from('social_messages')
    .insert({
      platform: 'email',
      kind: 'message',
      contact_id: to,
      contact_name: lead.name,
      direction: 'out',
      external_id: sent.id ?? null,
      channel_account_id: sent.threadId ?? threadId,
      body: text,
      status: 'sent',
    })
    .select('id')
    .single()
  if (row) await supabaseAdmin.from('social_messages').update({ origin: 'outreach' }).eq('id', row.id)

  const note = `Follow-up inviato il ${new Date().toLocaleDateString('it-IT')}`
  await supabaseAdmin
    .from('leads')
    .update({ notes: lead.notes ? `${lead.notes}\n${note}` : note })
    .eq('id', id)

  return NextResponse.json({ success: true })
}
