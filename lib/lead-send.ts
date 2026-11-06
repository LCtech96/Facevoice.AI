import { cleanEmail } from '@/lib/email-address'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendNewEmail } from '@/lib/gmail'
import { DAILY_EMAIL_LIMIT, draftProblem, type Lead } from '@/lib/leads'

// Invio del primo contatto via email: lo usano il pulsante "Invia" della pagina
// Clienti e l'automazione giornaliera, con gli stessi controlli.

export type SendResult = { lead: Lead } | { error: string; status: number }

/** Mezzanotte di oggi in Italia (il limite giornaliero si conta sul giorno italiano). */
export function romeMidnight(now = new Date()): Date {
  const day = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
  const offset = romeOffsetMinutes(now)
  return new Date(new Date(`${day}T00:00:00Z`).getTime() - offset * 60_000)
}

/** Minuti di differenza tra l'ora italiana e UTC (60 d'inverno, 120 d'estate). */
export function romeOffsetMinutes(now = new Date()) {
  const rome = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Rome' }))
  const utc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }))
  return Math.round((rome.getTime() - utc.getTime()) / 60_000)
}

/** Primi contatti gia' inviati oggi. */
export async function sentToday(): Promise<number> {
  const { count } = await supabaseAdmin
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .gte('contacted_at', romeMidnight().toISOString())
  return count ?? 0
}

export async function sendFirstEmail(id: string, override?: { subject?: string; body?: string }): Promise<SendResult> {
  const { data: lead } = await supabaseAdmin.from('leads').select('*').eq('id', id).maybeSingle()
  if (!lead) return { error: 'Contatto non trovato', status: 404 }

  const subject = String(override?.subject ?? lead.email_subject ?? '').trim()
  const text = String(override?.body ?? lead.email_body ?? '').trim()
  // Indirizzi letti male dai siti (entita' HTML, "\\" finali, segnaposto di codice):
  // si ripara quello che si puo', il resto si toglie dalla scheda cosi' non blocca la coda.
  const raw = String(lead.email || '').trim()
  const to = cleanEmail(raw)
  if (!raw) return { error: 'Email del contatto mancante', status: 400 }
  if (!to) {
    await supabaseAdmin.from('leads').update({ email: null }).eq('id', id)
    return { error: `Email non valida, tolta dalla scheda: ${raw.slice(0, 80)}`, status: 400 }
  }
  if (to !== raw) await supabaseAdmin.from('leads').update({ email: to }).eq('id', id)
  if (!subject || !text) return { error: 'Oggetto e testo sono obbligatori', status: 400 }
  // Note dell'AI al posto dell'email ("Non applicabile…") o testi di poche parole: non si inviano mai.
  const problem = draftProblem(subject, text)
  if (problem) return { error: problem, status: 422 }
  if (lead.status === 'do_not_contact') return { error: 'Ha chiesto di non essere ricontattato', status: 409 }
  if (lead.contacted_at) return { error: 'Già contattato: rispondi dalla casella Messaggi', status: 409 }

  // Stesso indirizzo gia' contattato o in lista "non contattare" con un'altra scheda.
  const { data: twins } = await supabaseAdmin.from('leads').select('id, status, contacted_at').ilike('email', to).neq('id', id)
  if (twins?.some((t) => t.status === 'do_not_contact')) return { error: 'Questo indirizzo ha chiesto di non essere ricontattato', status: 409 }
  if (twins?.some((t) => t.contacted_at)) return { error: "Questo indirizzo è già stato contattato da un'altra scheda", status: 409 }

  if ((await sentToday()) >= DAILY_EMAIL_LIMIT) {
    return {
      error: `Limite di ${DAILY_EMAIL_LIMIT} primi contatti al giorno raggiunto: protegge la reputazione di facevoice.ai. Riprova domani.`,
      status: 429,
    }
  }

  const sent = await sendNewEmail(to, subject, text)
  if (sent.error) {
    // Gmail rifiuta l'indirizzo (non Gmail che non funziona): problema della scheda, non dell'invio.
    if (/invalid to header|invalid (recipient|address|email)|recipient address rejected/i.test(sent.error)) {
      await supabaseAdmin.from('leads').update({ email: null }).eq('id', id)
      return { error: `Indirizzo rifiutato da Gmail, tolto dalla scheda: ${to}`, status: 400 }
    }
    return { error: `Invio non riuscito: ${sent.error}`, status: 502 }
  }

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

  return { lead: (updated || lead) as Lead }
}
