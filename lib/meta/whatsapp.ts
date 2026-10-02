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

export async function handleWhatsAppWebhook(payload: WhatsAppPayload) {
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value
      if (change.field !== 'messages' || !value?.messages) continue
      for (const message of value.messages) {
        try {
          await handleIncoming({
            platform: 'whatsapp',
            kind: 'message',
            contactId: message.from,
            contactName: value.contacts?.find((c) => c.wa_id === message.from)?.profile?.name ?? null,
            externalId: message.id,
            channelAccountId: value.metadata?.phone_number_id ?? null,
            text: message.type === 'text' ? message.text?.body || null : null,
            fallbackLabel: `[${message.type}]`,
          })
        } catch (error) {
          console.error('WhatsApp webhook: errore sul messaggio', message.id, error)
        }
      }
    }
  }
}
