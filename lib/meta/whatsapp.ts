import { handleIncoming } from '@/lib/meta/agent'

type WhatsAppMessage = {
  from: string
  id: string
  type: string
  text?: { body?: string }
}

type WhatsAppChangeValue = {
  metadata?: { phone_number_id?: string }
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>
  messages?: WhatsAppMessage[]
}

export type WhatsAppPayload = {
  object?: string
  entry?: Array<{ changes?: Array<{ field?: string; value?: WhatsAppChangeValue }> }>
}

/** Restituisce le chiavi delle risposte messe in coda (invio automatico), da aspettare nel webhook. */
export async function handleWhatsAppWebhook(payload: WhatsAppPayload): Promise<string[]> {
  const queued: string[] = []
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value
      if (change.field !== 'messages' || !value?.messages) continue
      for (const message of value.messages) {
        try {
          const key = await handleIncoming({
            platform: 'whatsapp',
            kind: 'message',
            contactId: message.from,
            contactName: value.contacts?.find((c) => c.wa_id === message.from)?.profile?.name ?? null,
            externalId: message.id,
            channelAccountId: value.metadata?.phone_number_id ?? null,
            text: message.type === 'text' ? message.text?.body || null : null,
            fallbackLabel: `[${message.type}]`,
          })
          if (key) queued.push(key)
        } catch (error) {
          console.error('WhatsApp webhook: errore sul messaggio', message.id, error)
        }
      }
    }
  }
  return queued
}
