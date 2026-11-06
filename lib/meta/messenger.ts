import { handleIncoming } from '@/lib/meta/agent'
import { fetchContactProfile, fetchPostCaption, getPageToken } from '@/lib/meta/graph'
import { describeAttachments, type MetaAttachment, type StoryReply } from '@/lib/meta/media-context'
import { ensureEchoSubscription, recordEcho } from '@/lib/meta/echoes'

// Messenger e i Direct di Instagram arrivano con lo stesso formato ("messaging").
// I commenti arrivano come "changes": "feed" su Facebook, "comments" su Instagram.
// Alcuni invii Instagram (es. il "Test" della dashboard Meta) usano "changes" con field "messages".

type MessagingEvent = {
  sender?: { id?: string }
  recipient?: { id?: string }
  timestamp?: number
  message?: {
    mid?: string
    text?: string
    is_echo?: boolean
    // Solo nelle eco di Messenger: l'app che ha inviato il messaggio.
    app_id?: string | number
    is_deleted?: boolean
    attachments?: MetaAttachment[]
    reply_to?: { story?: StoryReply }
  }
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
    // Instagram: media commentato; Facebook: post commentato.
    media?: { id?: string; media_product_type?: string }
    post_id?: string
  }
}

export type MessagingPayload = {
  object?: string
  entry?: Array<{ id?: string; messaging?: MessagingEvent[]; changes?: CommentChange[] }>
}

type Platform = 'facebook' | 'instagram'

/**
 * is_echo = messaggio inviato dal nostro account: le nostre risposte via API (gia' salvate)
 * o un messaggio scritto a mano dall'app (es. il primo messaggio di una proposta). La persona
 * e' il destinatario. Si salva come messaggio nostro: mai risposta AI, verifica o collegamento.
 */
async function handleEcho(platform: Platform, accountId: string | undefined, event: MessagingEvent) {
  const message = event.message
  const contactId = event.recipient?.id
  if (!message?.mid || !contactId || message.is_deleted) return
  const result = await recordEcho({
    platform,
    accountId: accountId ?? event.sender?.id ?? null,
    contactId,
    mid: message.mid,
    text: message.text,
    attachments: message.attachments,
    timestamp: event.timestamp,
    appId: message.app_id,
  })
  const what = { stored: 'scritto a mano dall’app, salvato', known: 'già salvato', api: 'nostra risposta via API', ignored: 'ignorato' }[result]
  console.log(`${platform} eco: ${what}`)
}

async function handleEvent(platform: Platform, accountId: string | undefined, event: MessagingEvent) {
  const message = event.message
  if (message?.is_echo) return handleEcho(platform, accountId, event)
  const senderId = event.sender?.id
  if (!message?.mid || !senderId) return

  // Post, reel, storie e foto: didascalia e cosa si vede diventano contesto per l'AI.
  const context = await describeAttachments(message.attachments, message.reply_to?.story).catch((error) => {
    console.warn(`${platform} allegati non letti:`, error instanceof Error ? error.message : error)
    return null
  })
  const userText = message.text?.trim() || ''
  const text = [userText, context].filter(Boolean).join('\n\n') || null
  const profile = await fetchContactProfile(platform, senderId)

  await handleIncoming({
    platform,
    kind: 'message',
    contactId: senderId,
    contactName: profile.name || (profile.username ? `@${profile.username}` : null),
    // Username dato da Meta (mai il nome visualizzato): per il collegamento automatico.
    instagramUsername: platform === 'instagram' ? profile.username : null,
    externalId: message.mid,
    channelAccountId: accountId ?? null,
    text,
    fallbackLabel: '[allegato]',
    // Solo allegati, senza testo: se ne arrivano piu' di fila si risponde una volta sola.
    burstGuard: !userText && Boolean(context),
    // Ora di Meta: si confronta con quella delle eco (risposte scritte a mano dall'app).
    sentAt: event.timestamp,
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
  if (!commentId || !text || !authorId) {
    console.log(`${platform} comment: ignorato (manca ${!commentId ? 'id' : !text ? 'testo' : 'autore'})`)
    return
  }

  // Mai rispondere ai commenti scritti dall'account stesso (comprese le nostre risposte).
  const page = await getPageToken()
  if (authorId === accountId || authorId === page?.pageId) {
    console.log(`${platform} comment: ignorato (scritto dal nostro account, es. una nostra risposta)`)
    return
  }

  const postId = platform === 'instagram' ? value.media?.id : value.post_id
  const postCaption = postId ? await fetchPostCaption(platform, postId) : null
  // I commenti Instagram portano solo lo username: si prova a leggere il nome del profilo.
  const profile = platform === 'instagram' && !value.from?.name ? await fetchContactProfile(platform, authorId) : null
  const fetchedName = profile?.name && !profile.name.startsWith('@') ? profile.name : null

  await handleIncoming({
    platform,
    kind: 'comment',
    postCaption,
    contactId: authorId,
    contactName: value.from?.name || fetchedName || (value.from?.username ? `@${value.from.username}` : null),
    // Username dato da Meta nel webhook o dal profilo (mai il nome visualizzato): per il collegamento automatico.
    instagramUsername: platform === 'instagram' ? value.from?.username || profile?.username || null : null,
    externalId: commentId,
    channelAccountId: accountId ?? null,
    text,
    fallbackLabel: '[commento]',
  })
}

export async function handleMessagingWebhook(payload: MessagingPayload) {
  const platform: Platform = payload.object === 'instagram' ? 'instagram' : 'facebook'
  // Una volta al giorno: la Pagina deve mandare anche le eco dei messaggi scritti a mano (in parallelo, mai bloccante).
  const echoCheck = ensureEchoSubscription()

  for (const entry of payload.entry || []) {
    // Prima le eco: se nello stesso invio c'e' anche una risposta scritta a mano, l'AI la vede gia'.
    const events = [...(entry.messaging || [])].sort((a, b) => Number(Boolean(b.message?.is_echo)) - Number(Boolean(a.message?.is_echo)))
    for (const event of events) {
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
            await handleEvent(platform, entry.id, {
              sender: value.sender,
              recipient: value.recipient,
              timestamp: value.timestamp,
              message: value.message,
            })
          }
          continue
        }
        await handleComment(platform, entry.id, change)
      } catch (error) {
        console.error(`${platform} webhook: errore sul commento`, change.value?.comment_id || change.value?.id, error)
      }
    }
  }
  await echoCheck
}
