import { emailLayout, escapeHtml, sendEmail } from '@/lib/email'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { workspaceDb } from '@/lib/workspace-db'
import { listConnections } from './connections'
import { sendNewEmail } from './email'

// Email a chi ha creato il contratto ("Contratto aperto", "Contratto firmato"), al suo indirizzo
// dell'account. Prima l'email di sistema della piattaforma (Resend, lib/email.ts, la stessa degli
// avvisi di Facevoice); senza la chiave di Resend, o se Resend non la manda (dominio non verificato,
// servizio giu'), dalla casella collegata dello spazio verso il suo stesso indirizzo; senza nessuna
// delle due, solo la campanella (con un avviso nei log). Mai il PIN, mai il link pubblico, mai i dati
// di chi riceve il contratto (codice fiscale, indirizzo) ne' il testo: solo il titolo, il nome, l'ora
// e il pulsante per la pagina del contratto nell'app. Nei log niente indirizzi ne' nomi.

export type CreatorMail = {
  workspaceId: string
  /** Chi ha creato il contratto (l'email va al suo account). */
  userId: string
  subject: string
  /** Righe del testo (niente dati personali di chi riceve il contratto). */
  lines: string[]
  button: { label: string; url: string }
  fromName: string
}

export type MailRoute = 'system' | 'mailbox' | 'none'

/** Indirizzo dell'account di chi ha creato il contratto: "" se l'account non ha un'email valida, null se non si legge. */
async function accountEmail(userId: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId)
    // Account che non c'e' piu': nessuna email; ogni altro errore: non letto.
    if (error) return (error as { status?: number }).status === 404 || /not found/i.test(String(error.message || '')) ? '' : null
    const email = String(data?.user?.email || '').trim().toLowerCase()
    return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email) ? email : ''
  } catch {
    return null
  }
}

/**
 * Invia l'email al titolare: sistema (Resend); se manca la chiave o l'invio non riesce, la casella
 * dello spazio; altrimenti niente. Non lancia mai.
 */
export async function mailCreator(mail: CreatorMail): Promise<MailRoute> {
  try {
    const to = await accountEmail(mail.userId)
    if (to === null) {
      // Senza dettagli dell'errore: potrebbero contenere l'indirizzo.
      console.warn('contratti: avviso al titolare solo nella campanella (account non letto: riprova più tardi)')
      return 'none'
    }
    if (!to) {
      console.warn('contratti: avviso al titolare solo nella campanella (nessuna email nel suo account)')
      return 'none'
    }
    const subject = mail.subject.replace(/[\r\n]+/g, ' ').trim().slice(0, 200)
    const text = `${mail.lines.join('\n')}\n\n${mail.button.label}: ${mail.button.url}`
    const system = Boolean(process.env.RESEND_API_KEY?.trim())
    if (system) {
      const html = emailLayout(
        `${mail.lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('\n')}
<p><a href="${escapeHtml(mail.button.url)}" style="display: inline-block; background: #0b1f3a; color: #ffffff; padding: 10px 18px; border-radius: 8px; text-decoration: none;">${escapeHtml(mail.button.label)}</a></p>`
      )
      if (await sendEmail({ to, subject, text, html })) return 'system'
      console.warn('contratti: email al titolare non partita (email di sistema): provo dalla casella collegata')
    }
    const connections = (await listConnections(workspaceDb(mail.workspaceId), 'email').catch(() => [])).filter((c) => c.status !== 'disconnected')
    const mailbox = connections.find((c) => c.status === 'connected') || connections[0]
    if (!mailbox) {
      console.warn(system ? 'contratti: avviso al titolare solo nella campanella (email di sistema non partita, nessuna casella collegata)' : 'contratti: avviso al titolare solo nella campanella (niente email di sistema né casella collegata)')
      return 'none'
    }
    await sendNewEmail(mailbox, { to, subject, text, fromName: mail.fromName })
    return 'mailbox'
  } catch {
    // Senza dettagli: potrebbero contenere l'indirizzo.
    console.warn('contratti: email al titolare non partita')
    return 'none'
  }
}
