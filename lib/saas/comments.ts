import { callAI, hasAIProvider } from '@/lib/ai'
import { parseSuspicious } from '@/lib/clarity-rules'
import { buildRealtimeDateTimeInstructionsItalian } from '@/lib/current-datetime'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { workspaceDb, type WorkspaceDb } from '@/lib/workspace-db'
import { listConnections, readConnectionSecret, type Connection } from './connections'
import { GRAPH, connectionForAccount, type MetaSecret } from './meta'
import { IG_GRAPH, igFetch, instagramLoginToken } from './instagram'
import { channelFeature, isAIBlockedError, workspaceAIBlocked } from '@/lib/usage-limits'
import { BLOCKED_OUTCOME, RULES, languageFor, readInstructions, workspaceName, type InstructionChannel, type ReplyOutcome } from './responder'

// Commenti sotto i post dei clienti (Instagram e Pagine Facebook): arrivano dal
// webhook, finiscono nella pagina Commenti dello spazio e l'AI prepara (o invia)
// la risposta pubblica secondo la modalita' scelta per i commenti, separata da
// quella dei messaggi. Dal sito si puo' anche rispondere in privato (Direct o
// Messenger) a chi ha commentato.
//
// Righe in social_messages con kind = 'comment':
// - ricevuto (direction 'in'): external_id = id del commento, reply_to = id del
//   post, subject = inizio della didascalia del post, status 'skipped' quando
//   l'AI decide che non serve rispondere (tag di amici, spam);
// - risposta (direction 'out'): reply_to = id del commento a cui risponde.

export type CommentPlatform = 'instagram' | 'facebook'
export type CommentMode = 'off' | 'approval' | 'auto'
export const NO_REPLY = 'NESSUNA_RISPOSTA'

const modeKey = (workspaceId: string, platform: CommentPlatform) => `comments_mode:${workspaceId}:${platform}`

export async function commentModes(workspaceId: string): Promise<Record<CommentPlatform, CommentMode>> {
  const { data } = await supabaseAdmin
    .from('app_settings')
    .select('key, value')
    .in('key', [modeKey(workspaceId, 'instagram'), modeKey(workspaceId, 'facebook')])
  const read = (platform: CommentPlatform): CommentMode => {
    const value = (data || []).find((row) => row.key === modeKey(workspaceId, platform))?.value
    return value === 'approval' || value === 'auto' ? value : 'off'
  }
  return { instagram: read('instagram'), facebook: read('facebook') }
}

export async function setCommentMode(workspaceId: string, platform: CommentPlatform, mode: CommentMode) {
  const { error } = await supabaseAdmin
    .from('app_settings')
    .upsert({ key: modeKey(workspaceId, platform), value: mode, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw new Error(`modalità non salvata: ${error.message}`)
}

// --- Chiamate a Meta con il token giusto per ogni tipo di collegamento ---------

type Access = { base: string; token: string }

async function accessFor(connection: Connection): Promise<Access> {
  const igToken = await instagramLoginToken(connection)
  if (igToken) return { base: IG_GRAPH, token: igToken }
  const secret = await readConnectionSecret<MetaSecret>(connection.id)
  return { base: GRAPH, token: secret.pageToken }
}

async function post<T>(access: Access, path: string, body: Record<string, unknown>, step: string): Promise<T> {
  return igFetch<T>(
    `${access.base}${path}`,
    { method: 'POST', headers: { Authorization: `Bearer ${access.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    step
  )
}

/** Risposta pubblica sotto il commento. */
export async function replyPublic(connection: Connection, commentId: string, text: string): Promise<string> {
  const access = await accessFor(connection)
  // Instagram: risposta nel filo del commento; Facebook: commento al commento.
  const edge = connection.platform === 'instagram' ? 'replies' : 'comments'
  const data = await post<{ id?: string }>(access, `/${commentId}/${edge}`, { message: text }, 'risposta al commento')
  return data.id || `reply:${Date.now()}`
}

/** Messaggio privato a chi ha commentato (uno per commento, entro 7 giorni). */
export async function replyPrivate(connection: Connection, commentId: string, text: string): Promise<string> {
  const access = await accessFor(connection)
  try {
    const data = await post<{ message_id?: string }>(access, '/me/messages', { recipient: { comment_id: commentId }, message: { text } }, 'risposta privata')
    return data.message_id || `private:${Date.now()}`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // 2534066: permesso dei messaggi non ancora approvato da Meta per tutti (l'app e' in
    // revisione) o commento non valido: si spiega in italiano cosa fare.
    if (/2534066|granular scopes|private reply/i.test(message)) {
      throw new Error(
        'Instagram non permette ancora il messaggio privato a questa persona. Finché Meta non approva il permesso dei messaggi, funziona solo con gli account "Tester di Instagram" dell’app; dopo l’approvazione funzionerà con tutti. Il commento deve avere meno di 7 giorni e si può mandare un solo messaggio per commento.'
      )
    }
    throw error
  }
}

/** Inizio della didascalia del post commentato (contesto per l'AI e per la pagina). */
async function postCaption(connection: Connection, postId: string): Promise<string | null> {
  try {
    const access = await accessFor(connection)
    const fields = connection.platform === 'instagram' ? 'caption' : 'message'
    const data = await igFetch<{ caption?: string; message?: string }>(
      `${access.base}/${postId}?fields=${fields}&access_token=${encodeURIComponent(access.token)}`,
      undefined,
      'didascalia del post'
    )
    const text = (data.caption || data.message || '').replace(/\s+/g, ' ').trim()
    return text ? text.slice(0, 300) : null
  } catch {
    return null
  }
}

// --- Commento ricevuto dal webhook --------------------------------------------

export type CommentValue = {
  id?: string
  comment_id?: string
  text?: string
  message?: string
  item?: string
  verb?: string
  post_id?: string
  parent_id?: string
  media?: { id?: string }
  from?: { id?: string; username?: string; name?: string }
}

/** Salva un commento di un post del cliente e prepara la risposta. */
export async function handleClientComment(platform: CommentPlatform, accountId: string, value: CommentValue): Promise<void> {
  // Facebook manda anche post, like e modifiche nello stesso campo "feed".
  if (platform === 'facebook' && (value.item !== 'comment' || value.verb !== 'add')) return
  const commentId = platform === 'instagram' ? value.id : value.comment_id
  const text = (platform === 'instagram' ? value.text : value.message)?.trim()
  const postId = platform === 'instagram' ? value.media?.id : value.post_id
  const from = value.from
  if (!commentId || !text || !from?.id) return

  const connection = await connectionForAccount(platform, accountId)
  if (!connection) return
  // Le risposte del cliente (anche quelle inviate da qui) tornano dal webhook: si ignorano.
  const ownUsername = String((connection.meta as { username?: string })?.username || '').toLowerCase()
  if (from.id === accountId || (ownUsername && from.username?.toLowerCase() === ownUsername)) return

  const db = workspaceDb(connection.workspace_id)
  const { data, error } = await db
    .from('social_messages')
    .insert({
      platform,
      kind: 'comment',
      direction: 'in',
      contact_id: from.id,
      contact_name: from.username ? `@${from.username}` : from.name || null,
      external_id: commentId,
      reply_to: postId || null,
      subject: postId ? await postCaption(connection, postId) : null,
      channel_account_id: accountId,
      body: text.slice(0, 4000),
    })
    .select('id')
    .single()
  if (error || !data) {
    // 23505: commento gia' salvato (Meta a volte manda lo stesso evento due volte).
    if (error?.code !== '23505') console.error(`saas ${platform} commento:`, error?.message)
    return
  }
  const outcome = await respondToComment(db, data.id as string)
  console.log(`saas ${platform}: commento salvato (spazio ${connection.workspace_id.slice(0, 8)}), risposta: ${outcome.status}${outcome.reason ? ` (${outcome.reason})` : ''}`)
}

// --- Risposta dell'AI -----------------------------------------------------------

const COMMENT_STYLE = `## Stai rispondendo a un COMMENTO PUBBLICO sotto un post dell'attività
- Tutti possono leggere la risposta: massimo 1-2 frasi, tono cordiale e umano, un'emoji va bene se il commento ne ha.
- Complimento o reazione positiva: ringrazia in modo caloroso e breve.
- Domanda: rispondi in breve con le informazioni delle istruzioni e del post; per prezzi personalizzati, disponibilità o dati personali invita a scrivere in privato (Direct o Messenger).
- Non chiedere né citare dati personali in pubblico.
- Commento offensivo, spam, pubblicità di altri o un semplice tag di amici: rispondi solo con ${NO_REPLY}`

/** Prepara (ed eventualmente pubblica) la risposta a un commento ricevuto. */
export async function respondToComment(db: WorkspaceDb, commentRowId: string, options: { force?: boolean } = {}): Promise<ReplyOutcome> {
  const { data: comment } = await db
    .from('social_messages')
    .select('id, platform, kind, direction, contact_id, contact_name, body, subject, external_id, channel_account_id, created_at')
    .eq('id', commentRowId)
    .maybeSingle()
  if (!comment || comment.kind !== 'comment' || comment.direction !== 'in') return { status: 'skipped', reason: 'commento non trovato' }
  const platform = comment.platform as CommentPlatform

  const mode = (await commentModes(db.workspaceId))[platform]
  if (mode === 'off' && !options.force) return { status: 'skipped', reason: 'automazione spenta' }
  if (!options.force && Date.now() - new Date(comment.created_at).getTime() > 48 * 3600_000) return { status: 'skipped', reason: 'commento vecchio' }
  if (!hasAIProvider()) return { status: 'skipped', reason: 'AI non configurata' }
  if (await workspaceAIBlocked(db.workspaceId)) return BLOCKED_OUTCOME

  const { count } = await db
    .from('social_messages')
    .select('id', { count: 'exact', head: true })
    .eq('kind', 'comment')
    .eq('direction', 'out')
    .eq('reply_to', comment.external_id)
    .in('status', ['pending', 'sent', 'sending'])
  if (count) return { status: 'skipped', reason: 'risposta già presente' }

  const [instructions, name, lang] = await Promise.all([
    readInstructions(db.workspaceId),
    workspaceName(db.workspaceId),
    languageFor(db.workspaceId, comment.body, []),
  ])
  const general = instructions.general.trim()
  const specific = (instructions[platform as InstructionChannel] || '').trim()
  const hasInstructions = Boolean(general || specific)
  const system = [
    lang.source === 'dashboard'
      ? `LINGUA DELLA RISPOSTA (regola principale): scrivi la risposta in ${lang.language}.`
      : `LINGUA DELLA RISPOSTA (regola principale): il commento è in ${lang.language}. Scrivi TUTTA la risposta in ${lang.language}, anche se le istruzioni sono in un'altra lingua.`,
    `Rispondi ai commenti dei post di "${name}" su ${platform === 'instagram' ? 'Instagram' : 'Facebook'}, come farebbe una persona dello staff.`,
    COMMENT_STYLE,
    comment.subject ? `## Il post commentato\nDidascalia: "${comment.subject}"` : '',
    comment.contact_name ? `Ha commentato "${comment.contact_name}".` : '',
    `## Istruzioni dell'attività\n${general || '(nessuna istruzione generale)'}`,
    specific ? `## Istruzioni per questo canale\n${specific}` : '',
    hasInstructions ? '' : 'Non hai istruzioni: resta generico e cordiale, senza dare informazioni che non conosci.',
    buildRealtimeDateTimeInstructionsItalian(),
    RULES,
  ]
    .filter(Boolean)
    .join('\n\n')

  let draft: string
  try {
    const result = await callAI([{ role: 'user', content: comment.body }], system, {
      temperature: 0.4,
      maxOutputTokens: 300,
      feature: channelFeature('saas_commenti', platform),
      workspaceId: db.workspaceId,
    })
    draft = result.message.trim()
  } catch (error) {
    if (isAIBlockedError(error)) return BLOCKED_OUTCOME
    console.error('saas commenti AI:', error instanceof Error ? error.message : error)
    return { status: 'failed', reason: 'AI non disponibile' }
  }
  if (draft.includes(NO_REPLY)) {
    await db.from('social_messages').update({ status: 'skipped' }).eq('id', comment.id)
    return { status: 'skipped', reason: 'nessuna risposta necessaria' }
  }
  const { text, reason } = parseSuspicious(draft)
  if (!text) return { status: 'failed', reason: 'risposta vuota' }

  const autoSend = !options.force && mode === 'auto' && !reason && hasInstructions
  const { data: saved, error } = await db
    .from('social_messages')
    .insert({
      platform,
      kind: 'comment',
      direction: 'out',
      contact_id: comment.contact_id,
      contact_name: comment.contact_name,
      body: text,
      reply_to: comment.external_id,
      channel_account_id: comment.channel_account_id,
      status: 'pending',
      origin: 'ai_auto',
      error_message: reason
        ? `Resta in bozza perché l’AI ha un dubbio: ${reason}`
        : options.force
          ? 'Bozza chiesta con ✨: non parte da sola.'
          : mode === 'auto' && !hasInstructions
            ? 'Resta in bozza perché le Istruzioni sono vuote: scrivile per attivare la risposta automatica.'
            : null,
    })
    .select('id')
    .single()
  if (error || !saved) {
    console.error('saas commenti bozza:', error?.message)
    return { status: 'failed', reason: 'bozza non salvata' }
  }
  if (!autoSend) return { status: 'pending', messageId: saved.id as string, reason: reason || undefined }
  const sent = await deliverComment(db, saved.id as string, text, 'ai_auto')
  return sent.ok ? { status: 'sent', messageId: saved.id as string } : { status: 'failed', reason: sent.error, messageId: saved.id as string }
}

async function connectionOf(db: WorkspaceDb, platform: CommentPlatform, accountId: string | null): Promise<Connection> {
  const accounts = (await listConnections(db, platform)).filter((c) => c.status !== 'disconnected')
  const account = accounts.find((c) => c.external_id === accountId) || accounts[0]
  if (!account) throw new Error(`${platform === 'facebook' ? 'Pagina Facebook' : 'Instagram'} non collegato`)
  return account
}

/** Pubblica una risposta a un commento gia' salvata come 'pending'. */
export async function deliverComment(db: WorkspaceDb, draftId: string, body: string, origin: string): Promise<{ ok: boolean; error?: string }> {
  const { data: draft } = await db
    .from('social_messages')
    .select('id, platform, kind, reply_to, channel_account_id, status')
    .eq('id', draftId)
    .maybeSingle()
  if (!draft || draft.kind !== 'comment') return { ok: false, error: 'risposta non trovata' }
  if (draft.status === 'sent') return { ok: true }
  const { data: claimed } = await db
    .from('social_messages')
    .update({ status: 'sending', body })
    .eq('id', draftId)
    .in('status', ['pending', 'failed'])
    .select('id')
  if (!claimed?.length) return { ok: false, error: 'invio già in corso' }
  try {
    const connection = await connectionOf(db, draft.platform as CommentPlatform, draft.channel_account_id as string | null)
    const id = await replyPublic(connection, draft.reply_to as string, body)
    await db.from('social_messages').update({ status: 'sent', external_id: id, origin, error_message: null, created_at: new Date().toISOString() }).eq('id', draftId)
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invio non riuscito'
    console.error('saas commenti invio:', message)
    await db.from('social_messages').update({ status: 'failed', error_message: message.slice(0, 300) }).eq('id', draftId)
    return { ok: false, error: message }
  }
}

/**
 * Risposta privata a chi ha commentato: parte come messaggio Direct/Messenger
 * collegato al commento e resta nella conversazione dell'Omnichat.
 */
export async function sendPrivateReply(db: WorkspaceDb, commentRowId: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const { data: comment } = await db
    .from('social_messages')
    .select('id, platform, kind, direction, contact_id, contact_name, external_id, channel_account_id')
    .eq('id', commentRowId)
    .maybeSingle()
  if (!comment || comment.kind !== 'comment' || comment.direction !== 'in') return { ok: false, error: 'commento non trovato' }
  try {
    const connection = await connectionOf(db, comment.platform as CommentPlatform, comment.channel_account_id as string | null)
    const id = await replyPrivate(connection, comment.external_id as string, body)
    // upsert: se l'"echo" di Meta e' arrivato prima, la riga diventa questa (risposta privata, non "dall'app").
    await db.from('social_messages').upsert({
      platform: comment.platform,
      kind: 'message',
      direction: 'out',
      contact_id: comment.contact_id,
      contact_name: comment.contact_name,
      body,
      reply_to: comment.external_id,
      channel_account_id: comment.channel_account_id,
      external_id: id,
      status: 'sent',
      origin: 'manual',
    }, { onConflict: 'workspace_id,external_id' })
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invio non riuscito'
    console.error('saas risposta privata:', message)
    return { ok: false, error: message }
  }
}
