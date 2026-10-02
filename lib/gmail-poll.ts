import { supabaseAdmin } from '@/lib/supabase-admin'
import { handleIncoming } from '@/lib/meta/agent'
import {
  getMessage,
  header,
  listInboxIds,
  loadGmailSettings,
  messageText,
  parseAddress,
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

      await handleIncoming({
        platform: 'email',
        kind: 'message',
        contactId: sender.email,
        contactName: sender.name || parseAddress(header(message, 'From')).name,
        externalId: `gmail:${message.id}`,
        channelAccountId: message.threadId,
        text: [subject ? `Oggetto: ${subject}` : '', text].filter(Boolean).join('\n\n') || null,
        fallbackLabel: '[email senza testo]',
      })
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
