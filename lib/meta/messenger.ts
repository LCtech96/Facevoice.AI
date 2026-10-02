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

// Commenti: Facebook li manda come change "feed", Instagram come change "comments".
type CommentChange = {
  field?: string
  value?: {
    item?: string
    verb?: string
    comment_id?: string
    id?: string
    message?: string
    text?: string
    parent_id?: string
    post_id?: string
    from?: { id?: string; name?: string; username?: string }
  }
}

export type MessagingPayload = {
  object?: string
  entry?: Array<{ id?: string; messaging?: MessagingEvent[]; changes?: CommentChange[] }>
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

async function replyToComment(platform: 'facebook' | 'instagram', commentId: string, text: string) {
  const page = await getPageToken()
  if (!page) return { error: 'Token della Pagina non disponibile' }

  const edge = platform === 'instagram' ? 'replies' : 'comments'
  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${commentId}/${edge}?access_token=${encodeURIComponent(page.token)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    }
  )

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 401 || data?.error?.code === 190) cachedPageToken = null
    return { error: data?.error?.message || `HTTP ${response.status}` }
  }
  return { id: data?.id as string | undefined }
}

async function handleComment(platform: 'facebook' | 'instagram', accountId: string | undefined, change: CommentChange) {
  const value = change.value
  if (!value) return

  const isFacebookComment =
    platform === 'facebook' && change.field === 'feed' && value.item === 'comment' && value.verb === 'add'
  const isInstagramComment = platform === 'instagram' && change.field === 'comments'
  if (!isFacebookComment && !isInstagramComment) return

  const commentId = value.comment_id || value.id
  const text = (value.message || value.text || '').trim()
  const authorId = value.from?.id
  if (!commentId || !text || !authorId) return

  // Mai rispondere ai commenti scritti dall'account stesso (comprese le nostre risposte).
  const page = await getPageToken()
  if (authorId === accountId || authorId === page?.pageId) return

  const authorName = value.from?.name || value.from?.username || null
  const isNew = await recordIncoming({
    platform,
    contactId: authorId,
    contactName: authorName,
    externalId: commentId,
    body: `[commento] ${text.slice(0, 4000)}`,
  })
  if (!isNew || !(await isAutoReplyEnabled(platform))) return

  const reply = await generateReply(platform, authorId, authorName, text)
  if (!reply) return

  const sent = await replyToComment(platform, commentId, reply)
  await recordOutgoing({
    platform,
    contactId: authorId,
    contactName: authorName,
    body: `[risposta commento] ${reply}`,
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
    for (const change of entry.changes || []) {
      try {
        await handleComment(platform, entry.id, change)
      } catch (error) {
        console.error(`${platform} webhook: errore sul commento`, change.value?.comment_id || change.value?.id, error)
      }
    }
  }
}
