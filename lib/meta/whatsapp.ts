import { handleIncoming } from '@/lib/meta/agent'
import { applyStatuses, waInbound, type InboundOutcome, type WaStatus } from '@/lib/wa-campaigns'
import { storeInboundWhatsAppMedia } from '@/lib/wa-media'
import { mediaBody } from '@/lib/wa-media-shared'

type WhatsAppMessage = {
  from: string
  id: string
  type: string
  text?: { body?: string }
  /** Bottone di risposta rapida di un modello. */
  button?: { text?: string; payload?: string }
  /** Bottoni e liste dei messaggi interattivi (es. la richiesta di consenso). */
  interactive?: { type?: string; button_reply?: { id?: string; title?: string }; list_reply?: { id?: string; title?: string } }
  /** Foto, video e documenti: id del file su Meta (da scaricare) e didascalia. */
  image?: { id?: string; mime_type?: string; caption?: string }
  video?: { id?: string; mime_type?: string; caption?: string }
  document?: { id?: string; mime_type?: string; caption?: string; filename?: string }
}

type WhatsAppChangeValue = {
  metadata?: { phone_number_id?: string }
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>
  messages?: WhatsAppMessage[]
  statuses?: WaStatus[]
}

export type WhatsAppPayload = {
  object?: string
  entry?: Array<{ changes?: Array<{ field?: string; value?: WhatsAppChangeValue }> }>
}

/** Testo leggibile del messaggio: testo, bottone di un modello o bottone di un messaggio interattivo. */
function messageText(message: WhatsAppMessage): { text: string | null; fromButton: boolean; buttonId: string | null } {
  if (message.type === 'text') return { text: message.text?.body || null, fromButton: false, buttonId: null }
  if (message.type === 'button') return { text: message.button?.text || message.button?.payload || null, fromButton: true, buttonId: message.button?.payload || null }
  if (message.type === 'interactive') {
    const reply = message.interactive?.button_reply || message.interactive?.list_reply
    return { text: reply?.title || null, fromButton: true, buttonId: reply?.id || null }
  }
  if (message.type === 'image' || message.type === 'video' || message.type === 'document') {
    return { text: message[message.type]?.caption || null, fromButton: false, buttonId: null }
  }
  return { text: null, fromButton: false, buttonId: null }
}

const PLACEHOLDER: Record<string, string> = { image: '[immagine]', video: '[video]', document: '[documento]', audio: '[audio]', sticker: '[sticker]', location: '[posizione]', contacts: '[contatto]' }

/**
 * Testo salvato in casella per foto e video: il file scaricato da Meta (si vede nella chat)
 * piu' la didascalia; se il download non riesce, "[immagine]" / "[video]" e la didascalia.
 */
async function mediaText(message: WhatsAppMessage, caption: string | null): Promise<string | null> {
  if (message.type !== 'image' && message.type !== 'video' && message.type !== 'document') return caption
  const id = message[message.type]?.id
  const url = id && message.type !== 'document' ? await storeInboundWhatsAppMedia(id, message.type) : null
  return mediaBody(message.type, url, caption)
}

/** Restituisce le chiavi delle risposte messe in coda (invio automatico), da aspettare nel webhook. */
export async function handleWhatsAppWebhook(payload: WhatsAppPayload): Promise<string[]> {
  const queued: string[] = []
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value
      if (change.field !== 'messages' || !value) continue
      // Stati dei messaggi (inviato, consegnato, letto, non riuscito): servono alle campagne.
      if (value.statuses?.length) {
        await applyStatuses(value.statuses).catch((error) => console.error('WhatsApp webhook: stati non salvati', error))
      }
      for (const message of value.messages || []) {
        try {
          const { text, fromButton, buttonId } = messageText(message)
          const contactName = value.contacts?.find((c) => c.wa_id === message.from)?.profile?.name ?? null
          // Contattabili, STOP e risposta alla richiesta di consenso: prima di salvare il messaggio.
          const outcome: InboundOutcome = await waInbound({ waId: message.from, name: contactName, text, fromButton, buttonId }).catch((error) => {
            console.error('WhatsApp webhook: contattabili non aggiornati', error)
            return { silent: false, kind: 'none' as const }
          })
          const key = await handleIncoming({
            platform: 'whatsapp',
            kind: 'message',
            contactId: message.from,
            contactName,
            externalId: message.id,
            channelAccountId: value.metadata?.phone_number_id ?? null,
            text: await mediaText(message, text),
            fallbackLabel: PLACEHOLDER[message.type] || `[${message.type}]`,
            // STOP o risposta al consenso: abbiamo gia' risposto noi, l'AI non risponde.
            silent: outcome.silent,
          })
          if (key) queued.push(key)
          if (outcome.after) await outcome.after().catch((error) => console.error('WhatsApp webhook: conferma non inviata', error))
        } catch (error) {
          console.error('WhatsApp webhook: errore sul messaggio', message.id, error)
        }
      }
    }
  }
  return queued
}
