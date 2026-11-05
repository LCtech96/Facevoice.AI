import { supabaseAdmin } from '@/lib/supabase-admin'
import { handleIncoming, type OutreachContext } from '@/lib/meta/agent'
import { verificationReplyKind } from '@/lib/identity-verify'
import {
  getMessage,
  header,
  listInboxIds,
  loadGmailSettings,
  messageText,
  parseAddress,
  senderAuthenticated,
  type GmailMessage,
} from '@/lib/gmail'

const CURSOR_KEY = 'gmail_poll_cursor'
// Le email possono arrivare con qualche minuto di ritardo rispetto alla loro
// data: si rilegge un margine e i doppioni li scarta external_id.
const OVERLAP_MS = 5 * 60_000
const OWN_DOMAIN = 'facevoice.ai'

const AUTOMATED_SENDER = /(^|[.\-_])(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?|notifications?|newsletter)[.\-_+@]/i

/** Newsletter, notifiche, risposte automatiche, posta interna: nessuna risposta AI. */
function skipReason(message: GmailMessage, ownEmail: string): string | null {
  const from = parseAddress(header(message, 'From')).email
  if (!from || from === ownEmail) return 'mittente proprio'
  if (from.endsWith(`@${OWN_DOMAIN}`)) return 'posta interna'
  if (AUTOMATED_SENDER.test(from)) return 'mittente automatico'
  const autoSubmitted = header(message, 'Auto-Submitted').toLowerCase()
  if (autoSubmitted && autoSubmitted !== 'no') return 'risposta automatica'
  if (header(message, 'List-Unsubscribe') || header(message, 'List-Id')) return 'mailing list'
  if (/^(bulk|list|junk)$/i.test(header(message, 'Precedence').trim())) return 'invio massivo'
  if (header(message, 'X-Autoreply') || header(message, 'X-Autorespond')) return 'risposta automatica'
  return null
}

const LEAD_FIELDS = 'id, name, analysis, notes, email_subject, email_body, status'

/**
 * Chi risponde e' un contatto della Ricerca clienti a cui abbiamo scritto noi?
 * Si riconosce dall'indirizzo o, se risponde da un altro indirizzo, dal thread della nostra email.
 */
async function findOutreachLead(email: string, threadId: string): Promise<(OutreachContext & { status: string }) | null> {
  let { data: lead } = await supabaseAdmin
    .from('leads')
    .select(LEAD_FIELDS)
    .ilike('email', email)
    .not('contacted_at', 'is', null)
    .limit(1)
    .maybeSingle()

  if (!lead && threadId) {
    const { data: sent } = await supabaseAdmin
      .from('social_messages')
      .select('contact_id')
      .eq('platform', 'email')
      .eq('direction', 'out')
      .eq('channel_account_id', threadId)
      .eq('origin', 'outreach')
      .limit(1)
      .maybeSingle()
    if (sent?.contact_id) {
      ;({ data: lead } = await supabaseAdmin
        .from('leads')
        .select(LEAD_FIELDS)
        .ilike('email', sent.contact_id)
        .limit(1)
        .maybeSingle())
    }
  }
  if (!lead) return null

  return {
    leadId: lead.id,
    name: lead.name,
    analysis: lead.analysis,
    notes: lead.notes,
    firstEmail: lead.email_body ? `Oggetto: ${lead.email_subject || ''}\n\n${lead.email_body}` : null,
    status: lead.status,
  }
}

/** Ultimo thread (diverso da quello del codice di verifica) in cui ci ha scritto questo indirizzo. */
async function previousThread(email: string, exclude: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('social_messages')
    .select('channel_account_id')
    .eq('platform', 'email')
    .eq('contact_id', email)
    .eq('direction', 'in')
    .not('channel_account_id', 'is', null)
    .neq('channel_account_id', exclude)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.channel_account_id ?? null
}

async function readCursor(fallback: number) {
  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', CURSOR_KEY).maybeSingle()
  const value = Number(data?.value)
  return Number.isFinite(value) && value > fallback ? value : fallback
}

/**
 * Legge le nuove email della casella collegata e le passa all'agente come
 * qualsiasi altro canale. Chiamata dal cron Vercel e dal pulsante "Controlla ora".
 */
export async function pollGmail(): Promise<{ processed: number; skipped: number; error?: string }> {
  const settings = await loadGmailSettings()
  if (!settings) return { processed: 0, skipped: 0, error: 'Casella non collegata' }

  const cursor = await readCursor(settings.connectedAt)
  const afterSeconds = Math.floor((cursor - OVERLAP_MS) / 1000)
  let processed = 0
  let skipped = 0
  let newest = cursor

  try {
    const ids = await listInboxIds(`in:inbox category:primary -from:me after:${afterSeconds}`, 50)
    if (!ids.length) return { processed, skipped }

    const { data: known } = await supabaseAdmin
      .from('social_messages')
      .select('external_id')
      .in('external_id', ids.map((m) => `gmail:${m.id}`))
    const seen = new Set((known || []).map((row) => row.external_id))

    // Dalla piu' vecchia alla piu' recente, cosi' lo storico resta in ordine.
    for (const { id } of ids.reverse()) {
      if (seen.has(`gmail:${id}`)) continue
      const message = await getMessage(id)
      const receivedAt = Number(message.internalDate)
      if (receivedAt < settings.connectedAt) continue
      newest = Math.max(newest, receivedAt)

      if (skipReason(message, settings.email)) {
        skipped++
        continue
      }

      const sender = parseAddress(header(message, 'Reply-To') || header(message, 'From'))
      const subject = header(message, 'Subject').trim()
      const text = messageText(message)
      // Risposta all'email con il codice di verifica. Dalla stessa conversazione che l'ha chiesta
      // (es. ha scritto da questo indirizzo): il codice si controlla come in chat. Da chiunque
      // altro resta in casella per Luca, senza risposta AI e senza controllare codici (chi ha
      // ricevuto il codice senza chiederlo potrebbe citarlo rispondendo).
      const verificationReply = await verificationReplyKind(message.threadId, sender.email).catch(() => null)
      const silent = verificationReply === 'other'
      const lead = silent ? null : await findOutreachLead(sender.email, message.threadId).catch(() => null)
      // Il thread del codice non diventa quello in cui si risponde alla conversazione.
      const threadId = verificationReply ? (await previousThread(sender.email, message.threadId)) || message.threadId : message.threadId

      await handleIncoming({
        platform: 'email',
        kind: 'message',
        contactId: sender.email,
        contactName: sender.name || parseAddress(header(message, 'From')).name,
        externalId: `gmail:${message.id}`,
        channelAccountId: threadId,
        text: [subject ? `Oggetto: ${subject}` : '', text].filter(Boolean).join('\n\n') || null,
        fallbackLabel: '[email senza testo]',
        outreach: lead,
        silent,
        // Mittente controllato da Gmail (DMARC/DKIM, nessun Reply-To diverso): solo cosi' l'indirizzo vale per il collegamento automatico.
        emailAuthenticated: senderAuthenticated(message, sender.email),
      })
      // Un contatto della Ricerca clienti ha risposto: la scheda passa a "ha risposto".
      if (lead?.status === 'contacted' || lead?.status === 'no_answer') {
        await supabaseAdmin.from('leads').update({ status: 'replied' }).eq('id', lead.leadId)
      }
      processed++
    }
  } catch (error) {
    console.error('gmail poll:', error)
    return { processed, skipped, error: error instanceof Error ? error.message : 'Errore lettura Gmail' }
  } finally {
    if (newest > cursor) {
      await supabaseAdmin
        .from('app_settings')
        .upsert({ key: CURSOR_KEY, value: String(newest), updated_at: new Date().toISOString() })
    }
  }

  return { processed, skipped }
}
