import { workspaceDb } from '@/lib/workspace-db'
import { describeAttachments, type MetaAttachment, type StoryReply } from '@/lib/meta/media-context'
import { connectionForAccount, contactName } from './meta'
import { respondToMessage } from './responder'
import { handleClientComment, type CommentValue } from './comments'

// Webhook di Meta per le Pagine e gli Instagram dei clienti del SaaS: ogni
// evento va nello spazio di lavoro dell'account che l'ha ricevuto. Gli eventi
// degli account di Facevoice (o non collegati) restano al gestore di sempre.

type Message = { mid?: string; text?: string; is_echo?: boolean; attachments?: MetaAttachment[]; reply_to?: { story?: StoryReply } }
type MessagingEvent = { sender?: { id?: string }; recipient?: { id?: string }; message?: Message }
// Il contenuto delle 'changes' dipende dal campo (messages, comments, feed): si legge caso per caso.
type Entry = { id?: string; messaging?: MessagingEvent[]; changes?: Array<{ field?: string; value?: unknown }> }
export type MetaPayload = { object?: string; entry?: Entry[] }

async function handleClientMessage(platform: 'facebook' | 'instagram', accountId: string, event: MessagingEvent) {
  const message = event.message
  const senderId = event.sender?.id
  if (!message?.mid || message.is_echo || !senderId || senderId === accountId) return
  const connection = await connectionForAccount(platform, accountId)
  if (!connection) return
  const db = workspaceDb(connection.workspace_id)

  const context = await describeAttachments(message.attachments, message.reply_to?.story).catch(() => null)
  const body = [message.text?.trim(), context].filter(Boolean).join('\n\n') || '[allegato]'
  const { data, error } = await db
    .from('social_messages')
    .insert({
      platform,
      kind: 'message',
      direction: 'in',
      contact_id: senderId,
      contact_name: await contactName(connection, senderId),
      external_id: message.mid,
      channel_account_id: accountId,
      body: body.slice(0, 4000),
    })
    .select('id')
    .single()
  if (error || !data) {
    if (error?.code !== '23505') console.error(`saas ${platform} insert:`, error?.message)
    return
  }
  const outcome = await respondToMessage(db, data.id as string)
  console.log(`saas ${platform}: messaggio salvato (spazio ${connection.workspace_id.slice(0, 8)}), risposta: ${outcome.status}${outcome.reason ? ` (${outcome.reason})` : ''}`)
}

/**
 * Gestisce le voci del webhook che appartengono ai clienti e restituisce le altre
 * (da passare al gestore di Facevoice).
 */
export async function routeClientEntries(payload: MetaPayload): Promise<MetaPayload> {
  const platform = payload.object === 'instagram' ? 'instagram' : 'facebook'
  const rest: Entry[] = []
  for (const entry of payload.entry || []) {
    const accountId = entry.id || ''
    const connection = accountId ? await connectionForAccount(platform, accountId).catch(() => null) : null
    if (!connection) {
      rest.push(entry)
      continue
    }
    for (const event of entry.messaging || []) {
      await handleClientMessage(platform, accountId, event).catch((err) => console.error(`saas ${platform} webhook:`, err))
    }
    for (const change of entry.changes || []) {
      const value = change.value as (MessagingEvent & { message?: unknown }) | undefined
      if (change.field === 'messages' && value && typeof value.message === 'object') {
        await handleClientMessage(platform, accountId, value as MessagingEvent).catch((err) => console.error(`saas ${platform} webhook:`, err))
      }
      // Commenti: "comments" per Instagram, "feed" per le Pagine Facebook.
      if ((change.field === 'comments' || change.field === 'feed') && change.value) {
        await handleClientComment(platform, accountId, change.value as CommentValue).catch((err) => console.error(`saas ${platform} commento:`, err))
      }
    }
  }
  return { ...payload, entry: rest }
}
