import { workspaceDb, type WorkspaceDb } from '@/lib/workspace-db'
import { channelFeature } from '@/lib/usage-limits'
import { describeAttachments, type MetaAttachment, type StoryReply } from '@/lib/meta/media-context'
import type { Connection } from './connections'
import { connectionForAccount, contactName, ensurePageSubscription } from './meta'
import { APP_ORIGIN, AUTOMATIC_REPLY_GRACE_MS, looksAutomatic, metaEventTime, wroteAfter } from './meta-history'
import { cancelQueuedReply, scheduleReply } from './reply-queue'
import { handleClientComment, type CommentValue } from './comments'

// Webhook di Meta per le Pagine e gli Instagram dei clienti del SaaS: ogni
// evento va nello spazio di lavoro dell'account che l'ha ricevuto. Gli eventi
// degli account di Facevoice (o non collegati) restano al gestore di sempre.

type Message = {
  mid?: string
  text?: string
  is_echo?: boolean
  /** Solo Messenger: app che ha inviato il messaggio (la nostra = risposta dall'API). */
  app_id?: string | number
  attachments?: MetaAttachment[]
  reply_to?: { story?: StoryReply }
}
type MessagingEvent = { sender?: { id?: string }; recipient?: { id?: string }; timestamp?: number; message?: Message }
// Il contenuto delle 'changes' dipende dal campo (messages, comments, feed): si legge caso per caso.
type Entry = { id?: string; messaging?: MessagingEvent[]; changes?: Array<{ field?: string; value?: unknown }> }
export type MetaPayload = { object?: string; entry?: Entry[] }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
/** Attesa prima di decidere che un "echo" sconosciuto e' scritto a mano (le nostre risposte si salvano subito dopo l'invio). */
export const ECHO_SETTLE_MS = 3_000

/**
 * Il messaggio dell'echo e' gia' nostro? Stesso id gia' salvato, oppure stesso
 * testo di una risposta che stiamo inviando (o appena inviata): Meta puo'
 * mandare l'echo prima che l'invio dall'API sia finito di salvare.
 */
async function alreadyStored(db: WorkspaceDb, platform: string, contactId: string, mid: string, text: string): Promise<boolean> {
  const { data: byId } = await db.from('social_messages').select('id').eq('external_id', mid).limit(1)
  if (byId?.length) return true
  if (!text) return false
  const recent = new Date(Date.now() - 10 * 60_000).toISOString()
  const { data: byText } = await db
    .from('social_messages')
    .select('id')
    .eq('platform', platform)
    .eq('contact_id', contactId)
    .eq('direction', 'out')
    .eq('body', text)
    .or(`status.eq.sending,and(status.eq.sent,created_at.gte.${recent})`)
    .limit(1)
  return Boolean(byText?.length)
}

/**
 * Bozze dell'AI ancora da approvare per questa conversazione: chi risponde a mano
 * dall'app prende in carico la chat, la bozza (ormai superata) non va piu' inviata.
 * Restano quelle per un messaggio arrivato dopo quello scritto a mano.
 */
async function rejectPendingDrafts(db: WorkspaceDb, platform: string, contactId: string, sentAt: string): Promise<number> {
  const { data: newer } = await db
    .from('social_messages')
    .select('created_at')
    .eq('platform', platform)
    .eq('contact_id', contactId)
    .eq('kind', 'message')
    .eq('direction', 'in')
    .gt('created_at', sentAt)
    .order('created_at', { ascending: true })
    .limit(1)
  let query = db
    .from('social_messages')
    .update({ status: 'rejected', error_message: 'Annullata: hai risposto tu dall’app' })
    .eq('platform', platform)
    .eq('contact_id', contactId)
    .eq('kind', 'message')
    .eq('direction', 'out')
    .eq('status', 'pending')
    .like('origin', 'ai%')
  if (newer?.[0]?.created_at) query = query.lt('created_at', newer[0].created_at as string)
  const { data, error } = await query.select('id')
  if (error) console.error(`saas ${platform} echo: bozze non annullate:`, error.message)
  return data?.length ?? 0
}

/**
 * Messaggio inviato dall'account stesso (is_echo). La persona e' il destinatario.
 * Le nostre risposte dall'API sono gia' salvate: si ignorano. Gli altri sono
 * scritti a mano dal cliente dall'app (es. il primo messaggio della chat): si
 * salvano come messaggi in uscita "dall'app", senza mai far rispondere l'AI, e
 * fermano la risposta automatica in attesa e le bozze (ha risposto una persona).
 * Le risposte automatiche di Meta (pochi secondi dopo il messaggio della persona)
 * si salvano ma non fermano niente.
 */
export async function handleClientEcho(platform: 'facebook' | 'instagram', accountId: string, connection: Connection, event: MessagingEvent) {
  const message = event.message
  const contactId = event.recipient?.id
  if (!message?.mid || !contactId || contactId === accountId) return
  const ourApps = [process.env.META_APP_ID, process.env.INSTAGRAM_APP_ID].map((v) => v?.trim()).filter(Boolean)
  if (message.app_id != null && ourApps.includes(String(message.app_id))) return
  const db = workspaceDb(connection.workspace_id)
  const text = message.text?.trim() || ''
  if (await alreadyStored(db, platform, contactId, message.mid, text)) return
  await sleep(ECHO_SETTLE_MS)
  if (await alreadyStored(db, platform, contactId, message.mid, text)) return

  const { data: known } = await db
    .from('social_messages')
    .select('contact_name')
    .eq('platform', platform)
    .eq('contact_id', contactId)
    .not('contact_name', 'is', null)
    .limit(1)
    .maybeSingle()
  const name = (known?.contact_name as string | undefined) ?? (await contactName(connection, contactId))
  // Ora di Meta: e' quella da confrontare con i messaggi della persona.
  const sentAt = metaEventTime(event.timestamp)
  const { error } = await db.from('social_messages').insert({
    platform,
    kind: 'message',
    direction: 'out',
    status: 'sent',
    origin: APP_ORIGIN,
    contact_id: contactId,
    contact_name: name,
    external_id: message.mid,
    channel_account_id: accountId,
    body: (text || '[allegato]').slice(0, 4000),
    created_at: sentAt,
  })
  if (error) {
    if (error.code !== '23505') console.error(`saas ${platform} echo insert:`, error.message)
    return
  }
  const space = connection.workspace_id.slice(0, 8)
  const sentMs = new Date(sentAt).getTime()
  const { data: incoming } = await db
    .from('social_messages')
    .select('created_at')
    .eq('platform', platform)
    .eq('contact_id', contactId)
    .eq('kind', 'message')
    .eq('direction', 'in')
    .gte('created_at', new Date(sentMs - AUTOMATIC_REPLY_GRACE_MS).toISOString())
    .order('created_at', { ascending: true })
    .limit(20)
  const times = (incoming || []).map((row) => new Date(row.created_at as string).getTime())
  if (looksAutomatic(sentMs, times)) {
    console.log(`saas ${platform}: risposta automatica di Meta salvata (spazio ${space}), l'AI risponde lo stesso`)
    return
  }
  // Se la persona ha gia' riscritto, la risposta in attesa e' per il suo messaggio nuovo: resta.
  const [cancelled, rejected] = await Promise.all([
    wroteAfter(sentMs, times) ? false : cancelQueuedReply(connection.workspace_id, platform, contactId).catch(() => false),
    rejectPendingDrafts(db, platform, contactId, sentAt).catch(() => 0),
  ])
  const stopped = [cancelled ? 'risposta automatica in attesa annullata' : '', rejected ? `${rejected} bozz${rejected === 1 ? 'a annullata' : 'e annullate'}` : ''].filter(Boolean)
  console.log(`saas ${platform}: messaggio scritto dall'app salvato (spazio ${space})${stopped.length ? `, ${stopped.join(', ')}` : ''}`)
}

async function handleClientMessage(platform: 'facebook' | 'instagram', accountId: string, event: MessagingEvent, queued: string[]) {
  const message = event.message
  if (!message?.mid) return
  const connection = await connectionForAccount(platform, accountId)
  if (!connection) return
  if (message.is_echo) return handleClientEcho(platform, accountId, connection, event)
  const senderId = event.sender?.id
  if (!senderId || senderId === accountId) return
  const db = workspaceDb(connection.workspace_id)

  // Foto e video del Direct letti dall'AI: consumo dello spazio del cliente, con il canale.
  const context = await describeAttachments(message.attachments, message.reply_to?.story, {
    workspaceId: connection.workspace_id,
    feature: channelFeature('saas_lettura_media', platform),
  }).catch(() => null)
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
      // Ora di Meta, come per i messaggi dall'app e lo storico: l'ordine della chat e' quello vero.
      created_at: metaEventTime(event.timestamp),
    })
    .select('id')
    .single()
  if (error || !data) {
    if (error?.code !== '23505') console.error(`saas ${platform} insert:`, error?.message)
    return
  }
  // Subito, o dopo il ritardo scelto dal cliente (risposta in coda).
  const scheduled = await scheduleReply(db, data.id as string)
  if (scheduled.status === 'queued') {
    queued.push(scheduled.key)
    console.log(`saas ${platform}: messaggio salvato (spazio ${connection.workspace_id.slice(0, 8)}), risposta tra ${Math.round((scheduled.dueAt - Date.now()) / 1000)}s`)
    return
  }
  const outcome = scheduled.outcome
  console.log(`saas ${platform}: messaggio salvato (spazio ${connection.workspace_id.slice(0, 8)}), risposta: ${outcome.status}${outcome.reason ? ` (${outcome.reason})` : ''}`)
}

/**
 * Gestisce le voci del webhook che appartengono ai clienti e restituisce le altre
 * (da passare al gestore di Facevoice). In queued finiscono le risposte messe in
 * coda col ritardo: chi chiama puo' aspettarle (quelle brevi) senza fermare il resto.
 */
export async function routeClientEntries(payload: MetaPayload, queued: string[] = []): Promise<MetaPayload> {
  const platform = payload.object === 'instagram' ? 'instagram' : 'facebook'
  const rest: Entry[] = []
  for (const entry of payload.entry || []) {
    const accountId = entry.id || ''
    const connection = accountId ? await connectionForAccount(platform, accountId).catch(() => null) : null
    if (!connection) {
      rest.push(entry)
      continue
    }
    // Pagine collegate prima degli echo: iscrizione aggiornata una volta sola.
    await ensurePageSubscription(connection).catch(() => {})
    for (const event of entry.messaging || []) {
      await handleClientMessage(platform, accountId, event, queued).catch((err) => console.error(`saas ${platform} webhook:`, err))
    }
    for (const change of entry.changes || []) {
      const value = change.value as (MessagingEvent & { message?: unknown }) | undefined
      if (change.field === 'messages' && value && typeof value.message === 'object') {
        await handleClientMessage(platform, accountId, value as MessagingEvent, queued).catch((err) => console.error(`saas ${platform} webhook:`, err))
      }
      // Commenti: "comments" per Instagram, "feed" per le Pagine Facebook.
      if ((change.field === 'comments' || change.field === 'feed') && change.value) {
        await handleClientComment(platform, accountId, change.value as CommentValue).catch((err) => console.error(`saas ${platform} commento:`, err))
      }
    }
  }
  return { ...payload, entry: rest }
}
