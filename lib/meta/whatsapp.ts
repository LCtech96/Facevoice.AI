import {
  GRAPH_VERSION,
  NON_TEXT_REPLY,
  generateReply,
  getSystemToken,
  isAutoReplyEnabled,
  recordIncoming,
  recordOutgoing,
} from '@/lib/meta/agent'

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

async function sendText(phoneNumberId: string, to: string, body: string) {
  const token = getSystemToken()
  if (!token) return { error: 'Token Meta non configurato' }

  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    return { error: data?.error?.message || `HTTP ${response.status}` }
  }
  return { id: data?.messages?.[0]?.id as string | undefined }
}

async function handleMessage(value: WhatsAppChangeValue, message: WhatsAppMessage) {
  const phoneNumberId = value.metadata?.phone_number_id
  const contactName = value.contacts?.find((c) => c.wa_id === message.from)?.profile?.name ?? null
  const isText = message.type === 'text' && !!message.text?.body
  const body = isText ? message.text!.body!.slice(0, 4000) : `[${message.type}]`

  const isNew = await recordIncoming({
    platform: 'whatsapp',
    contactId: message.from,
    contactName,
    externalId: message.id,
    body,
  })
  if (!isNew || !phoneNumberId || !(await isAutoReplyEnabled('whatsapp'))) return

  const reply = isText ? await generateReply('whatsapp', message.from, contactName) : NON_TEXT_REPLY
  if (!reply) return

  const sent = await sendText(phoneNumberId, message.from, reply)
  await recordOutgoing({
    platform: 'whatsapp',
    contactId: message.from,
    contactName,
    body: reply,
    externalId: sent.id,
    error: sent.error,
  })
}

export async function handleWhatsAppWebhook(payload: WhatsAppPayload) {
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages' || !change.value?.messages) continue
      for (const message of change.value.messages) {
        try {
          await handleMessage(change.value, message)
        } catch (error) {
          console.error('WhatsApp webhook: errore sul messaggio', message.id, error)
        }
      }
    }
  }
}
