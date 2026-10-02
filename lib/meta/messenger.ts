import { handleIncoming } from '@/lib/meta/agent'
import { fetchContactName, getPageToken } from '@/lib/meta/graph'

// Messenger e i Direct di Instagram arrivano con lo stesso formato ("messaging").
// I commenti arrivano come "changes": "feed" su Facebook, "comments" su Instagram.
// Alcuni invii Instagram (es. il "Test" della dashboard Meta) usano "changes" con field "messages".

type MessagingEvent = {
  sender?: { id?: string }
  recipient?: { id?: string }
  message?: { mid?: string; text?: string; is_echo?: boolean }
}

type CommentChange = {
  field?: string
  value?: MessagingEvent & {
    item?: string
    verb?: string
    comment_id?: string
    id?: string
    message?: string | MessagingEvent['message']
    text?: string
    from?: { id?: string; name?: string; username?: string }
  }
}

export type MessagingPayload = {
  object?: string
  entry?: Array<{ id?: string; messaging?: MessagingEvent[]; changes?: CommentChange[] }>
}

type Platform = 'facebook' | 'instagram'

async function handleEvent(platform: Platform, accountId: string | undefined, event: MessagingEvent) {
  const message = event.message
  const senderId = event.sender?.id
  // is_echo = messaggi inviati dalla Pagina stessa (anche le nostre risposte): da ignorare.
  if (!message?.mid || message.is_echo || !senderId) return

  await handleIncoming({
    platform,
    kind: 'message',
    contactId: senderId,
    contactName: await fetchContactName(platform, senderId),
    externalId: message.mid,
    channelAccountId: accountId ?? null,
    text: message.text || null,
    fallbackLabel: '[allegato]',
  })
}

async function handleComment(platform: Platform, accountId: string | undefined, change: CommentChange) {
  const value = change.value
  if (!value) return

  const isFacebookComment =
    platform === 'facebook' && change.field === 'feed' && value.item === 'comment' && value.verb === 'add'
  const isInstagramComment = platform === 'instagram' && change.field === 'comments'
  if (!isFacebookComment && !isInstagramComment) return

  const commentId = value.comment_id || value.id
  const text = (typeof value.message === 'string' ? value.message : value.text || '').trim()
  const authorId = value.from?.id
  if (!commentId || !text || !authorId) return

  // Mai rispondere ai commenti scritti dall'account stesso (comprese le nostre risposte).
  const page = await getPageToken()
  if (authorId === accountId || authorId === page?.pageId) return

  await handleIncoming({
    platform,
    kind: 'comment',
    contactId: authorId,
    contactName: value.from?.name || (value.from?.username ? `@${value.from.username}` : null),
    externalId: commentId,
    channelAccountId: accountId ?? null,
    text,
    fallbackLabel: '[commento]',
  })
}

export async function handleMessagingWebhook(payload: MessagingPayload) {
  const platform: Platform = payload.object === 'instagram' ? 'instagram' : 'facebook'

  for (const entry of payload.entry || []) {
    for (const event of entry.messaging || []) {
      try {
        await handleEvent(platform, entry.id, event)
      } catch (error) {
        console.error(`${platform} webhook: errore sul messaggio`, event.message?.mid, error)
      }
    }
    for (const change of entry.changes || []) {
      try {
        if (change.field === 'messages') {
          const value = change.value
          if (value && typeof value.message === 'object') {
            await handleEvent(platform, entry.id, { sender: value.sender, recipient: value.recipient, message: value.message })
          }
          continue
        }
        await handleComment(platform, entry.id, change)
      } catch (error) {
        console.error(`${platform} webhook: errore sul commento`, change.value?.comment_id || change.value?.id, error)
      }
    }
  }
}
