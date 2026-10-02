import {
  GRAPH_VERSION,
  NON_TEXT_REPLY,
  generateReply,
  getSystemToken,
  isAutoReplyEnabled,
  recordIncoming,
  recordOutgoing,
} from '@/lib/meta/agent'

// Messenger e i Direct di Instagram arrivano con lo stesso formato ("messaging")
// e si inviano entrambi con il token della Pagina Facebook collegata.

type MessagingEvent = {
  sender?: { id?: string }
  recipient?: { id?: string }
  message?: {
    mid?: string
    text?: string
    is_echo?: boolean
    attachments?: unknown[]
  }
}

export type MessagingPayload = {
  object?: string
  entry?: Array<{ id?: string; messaging?: MessagingEvent[] }>
}

let cachedPageToken: { pageId: string; token: string } | null = null

/** Il token di sistema non basta per inviare: serve quello della Pagina, che si ricava da lui. */
async function getPageToken(): Promise<{ pageId: string; token: string } | null> {
  if (cachedPageToken) return cachedPageToken

  const systemToken = getSystemToken()
  if (!systemToken) return null

  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(systemToken)}`
  )
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    console.error('Meta page token error:', data?.error?.message || response.status)
    return null
  }

  const wanted = process.env.META_PAGE_ID?.trim()
  const pages: Array<{ id: string; access_token?: string }> = data?.data || []
  const page = wanted ? pages.find((p) => p.id === wanted) : pages[0]
  if (!page?.access_token) {
    console.error('Meta: nessuna Pagina accessibile con il token di sistema')
    return null
  }

  cachedPageToken = { pageId: page.id, token: page.access_token }
  return cachedPageToken
}

async function sendText(recipientId: string, text: string) {
  const page = await getPageToken()
  if (!page) return { error: 'Token della Pagina non disponibile' }

  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/me/messages?access_token=${encodeURIComponent(page.token)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: recipientId },
        messaging_type: 'RESPONSE',
        message: { text },
      }),
    }
  )

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 401 || data?.error?.code === 190) cachedPageToken = null
    return { error: data?.error?.message || `HTTP ${response.status}` }
  }
  return { id: data?.message_id as string | undefined }
}

async function handleEvent(platform: 'facebook' | 'instagram', event: MessagingEvent) {
  const message = event.message
  const senderId = event.sender?.id
  // is_echo = messaggi inviati dalla Pagina stessa (anche le nostre risposte): da ignorare.
  if (!message?.mid || message.is_echo || !senderId) return

  const isText = !!message.text
  const body = isText ? message.text!.slice(0, 4000) : '[allegato]'

  const isNew = await recordIncoming({
    platform,
    contactId: senderId,
    contactName: null,
    externalId: message.mid,
    body,
  })
  if (!isNew || !(await isAutoReplyEnabled(platform))) return

  const reply = isText ? await generateReply(platform, senderId, null) : NON_TEXT_REPLY
  if (!reply) return

  const sent = await sendText(senderId, reply)
  await recordOutgoing({
    platform,
    contactId: senderId,
    contactName: null,
    body: reply,
    externalId: sent.id,
    error: sent.error,
  })
}

export async function handleMessagingWebhook(payload: MessagingPayload) {
  const platform = payload.object === 'instagram' ? 'instagram' : 'facebook'

  for (const entry of payload.entry || []) {
    for (const event of entry.messaging || []) {
      try {
        await handleEvent(platform, event)
      } catch (error) {
        console.error(`${platform} webhook: errore sul messaggio`, event.message?.mid, error)
      }
    }
  }
}
