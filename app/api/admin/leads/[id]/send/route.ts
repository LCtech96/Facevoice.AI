import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAdminEmail } from '@/lib/admin-request'
import { sendNewEmail } from '@/lib/gmail'
import { DAILY_EMAIL_LIMIT } from '@/lib/leads'

export const dynamic = 'force-dynamic'

/**
 * Invia il primo contatto via email, uno alla volta e solo su conferma dell'admin.
 * La conversazione finisce in Messaggi: le risposte arrivano li' come ogni email.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getAdminEmail(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const { data: lead } = await supabaseAdmin.from('leads').select('*').eq('id', id).maybeSingle()
  if (!lead) return NextResponse.json({ error: 'Contatto non trovato' }, { status: 404 })

  const to = String(lead.email || '').trim().toLowerCase()
  const subject = String(body?.subject ?? lead.email_subject ?? '').trim()
  const text = String(body?.body ?? lead.email_body ?? '').trim()
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return NextResponse.json({ error: 'Email del contatto mancante' }, { status: 400 })
  if (!subject || !text) return NextResponse.json({ error: 'Oggetto e testo sono obbligatori' }, { status: 400 })
  if (lead.status === 'do_not_contact') return NextResponse.json({ error: 'Ha chiesto di non essere ricontattato' }, { status: 409 })
  if (lead.contacted_at) return NextResponse.json({ error: 'Già contattato: rispondi dalla casella Messaggi' }, { status: 409 })

  // Stesso indirizzo gia' contattato o in lista "non contattare" con un'altra scheda.
  const { data: twins } = await supabaseAdmin
    .from('leads')
    .select('id, status, contacted_at')
    .ilike('email', to)
    .neq('id', id)
  if (twins?.some((t) => t.status === 'do_not_contact')) {
    return NextResponse.json({ error: 'Questo indirizzo ha chiesto di non essere ricontattato' }, { status: 409 })
  }
  if (twins?.some((t) => t.contacted_at)) {
    return NextResponse.json({ error: 'Questo indirizzo è già stato contattato da un\'altra scheda' }, { status: 409 })
  }

  const since = new Date()
  since.setHours(0, 0, 0, 0)
  const { count } = await supabaseAdmin
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .gte('contacted_at', since.toISOString())
  if ((count ?? 0) >= DAILY_EMAIL_LIMIT) {
    return NextResponse.json(
      { error: `Limite di ${DAILY_EMAIL_LIMIT} primi contatti al giorno raggiunto: protegge la reputazione di facevoice.ai. Riprova domani.` },
      { status: 429 }
    )
  }

  const sent = await sendNewEmail(to, subject, text)
  if (sent.error) return NextResponse.json({ error: `Invio non riuscito: ${sent.error}` }, { status: 502 })

  const now = new Date().toISOString()
  const { data: updated } = await supabaseAdmin
    .from('leads')
    .update({ status: 'contacted', contacted_at: now, email_subject: subject, email_body: text })
    .eq('id', id)
    .select('*')
    .single()

  // Storico in Messaggi: la risposta del contatto si aggancia a questa conversazione.
  const { data: row } = await supabaseAdmin
    .from('social_messages')
    .insert({
      platform: 'email',
      kind: 'message',
      contact_id: to,
      contact_name: lead.name,
      direction: 'out',
      external_id: sent.id ?? null,
      channel_account_id: sent.threadId ?? null,
      body: `Oggetto: ${subject}\n\n${text}`,
      status: 'sent',
    })
    .select('id')
    .single()
  if (row) {
    // Primo contatto a freddo: non va usato come esempio di stile per le risposte.
    await supabaseAdmin.from('social_messages').update({ origin: 'outreach' }).eq('id', row.id)
  }

  return NextResponse.json({ lead: updated })
}
