import { randomBytes } from 'crypto'
import { readSetting, updateSetting } from '@/lib/settings-store'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { WorkspaceDb } from '@/lib/workspace-db'
import { workspaceVideoRepliesOn } from '@/lib/video-replies-access'
import { listConnections, type Connection } from './connections'
import { sendMetaText, sendMetaVideo } from './meta'
import { deleteVideoFile, isWorkspaceVideo, VIDEO_MAX_BYTES } from './video'
import {
  DM_VIDEO_LIMIT_BYTES,
  MAX_VIDEO_MESSAGE,
  MAX_VIDEO_REPLIES,
  MAX_VIDEO_TITLE,
  MAX_VIDEO_TRIGGER,
  VIDEO_REPLY_CHANNEL_LABELS,
  VIDEO_REPLY_CHANNELS,
  sizeWarning,
  type VideoReplyChannel,
  type VideoReplyView,
} from './video-replies-shared'

// Video risposte: il cliente carica dei video (stesso archivio e stesso caricamento firmato
// dei post video, lib/saas/video.ts) e scrive quando mandarli ("quando chiedono dei
// trattamenti"). Nei messaggi diretti (Instagram e Messenger, mai email) l'AI che scrive la
// risposta vede i video attivi per quel canale e, se la richiesta della persona corrisponde
// chiaramente, sceglie al massimo UN video con la riga [[VIDEO: id]] (controllata contro
// l'elenco: un id sbagliato non manda niente). Invio automatico: prima il testo, poi il video.
// Bozza: il video resta "proposto" sulla bozza e parte quando la bozza si invia.
// Se il file supera il limite degli allegati del canale parte un link alla pagina pubblica
// del video (/v/<codice>, solo il video e il titolo). Un errore del video non tocca il testo.
//
// Niente tabelle nuove, tutto in app_settings:
//   video_replies:<spazio>                         = { items: VideoReply[] }
//   video_reply_watch:<codice>                     = { workspaceId, id }   (pagina pubblica)
//   video_reply_thread:<spazio>:<canale>:<persona> = { sent: [...], drafts: { idBozza: { videoId, at } } }
// Il video inviato e' anche una riga di social_messages (origin 'ai_video'): l'AI la vede nella
// conversazione e l'Omnichat la mostra (anteprima, errore, Riprova).

export const VIDEO_ORIGIN = 'ai_video'

export type VideoReply = {
  id: string
  title: string
  trigger: string
  message: string
  url: string
  size: number
  channels: VideoReplyChannel[]
  active: boolean
  oncePerPerson: boolean
  /** Codice della pagina pubblica del video (non indovinabile). */
  token: string
  /** Indirizzo dell'app per il link (es. https://beta.facevoice.ai). */
  origin: string
  createdAt: string
  updatedAt: string
  createdBy: string | null
}

export class VideoReplyError extends Error {}

const libraryKey = (workspaceId: string) => `video_replies:${workspaceId}`
const watchKey = (token: string) => `video_reply_watch:${token}`
export const videoThreadKey = (workspaceId: string, platform: string, contactId: string) => `video_reply_thread:${workspaceId}:${platform}:${contactId}`

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, max) : '')
const oneLine = (v: unknown, max: number) => str(v, max * 2).replace(/\s+/g, ' ').trim().slice(0, max)
const asChannels = (v: unknown): VideoReplyChannel[] | null =>
  Array.isArray(v) ? VIDEO_REPLY_CHANNELS.filter((c) => v.includes(c)) : null
export const isVideoReplyChannel = (platform: string): platform is VideoReplyChannel => (VIDEO_REPLY_CHANNELS as string[]).includes(platform)

function parseLibrary(raw: string | null): VideoReply[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw) as { items?: unknown }
    const items = Array.isArray(v?.items) ? v.items : []
    return items.filter((x): x is VideoReply => Boolean(x) && typeof (x as VideoReply).id === 'string' && typeof (x as VideoReply).url === 'string')
  } catch {
    return []
  }
}

/** Indirizzo dell'app per i link: quello da cui e' stata creata, altrimenti quello configurato. */
function appOrigin(origin?: string | null): string {
  const pick = (value: unknown) => {
    try {
      const u = new URL(String(value || '').trim())
      if (u.protocol === 'https:' || (u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) return u.origin
    } catch {}
    return null
  }
  return pick(origin) || pick(process.env.APP_URL) || pick(process.env.NEXT_PUBLIC_APP_URL) || 'https://beta.facevoice.ai'
}

export const watchUrlOf = (v: Pick<VideoReply, 'token' | 'origin'>) => `${appOrigin(v.origin)}/v/${v.token}`

export const videoReplyView = (v: VideoReply): VideoReplyView => ({
  id: v.id,
  title: v.title,
  trigger: v.trigger,
  message: v.message,
  url: v.url,
  size: v.size,
  channels: v.channels,
  active: v.active,
  oncePerPerson: v.oncePerPerson,
  createdAt: v.createdAt,
  updatedAt: v.updatedAt,
  watchUrl: watchUrlOf(v),
})

const libraryState = (raw: string | null) => ({ items: parseLibrary(raw) })

export async function listVideoReplies(workspaceId: string): Promise<VideoReply[]> {
  return parseLibrary((await readSetting(libraryKey(workspaceId))).value)
}

export async function getVideoReply(workspaceId: string, id: string): Promise<VideoReply | null> {
  return (await listVideoReplies(workspaceId)).find((v) => v.id === id) ?? null
}

/** Peso del file caricato (HEAD sull'archivio): c'e' davvero ed e' entro il limite dell'archivio? */
async function uploadedSize(workspaceId: string, url: string): Promise<number> {
  if (!isWorkspaceVideo(workspaceId, url)) throw new VideoReplyError('video non valido: caricalo da qui (pulsante del video)')
  const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15_000) }).catch(() => null)
  if (!res?.ok) throw new VideoReplyError('il video non è arrivato nell’archivio: ricaricalo')
  const size = Number(res.headers.get('content-length') || 0)
  if (size > VIDEO_MAX_BYTES) throw new VideoReplyError('il video è troppo grande per l’archivio')
  return size
}

export type VideoReplyInput = {
  url?: unknown
  title?: unknown
  trigger?: unknown
  message?: unknown
  channels?: unknown
  active?: unknown
  oncePerPerson?: unknown
}

/** Controlla i campi di una video risposta nuova (prima della scheda di conferma e di nuovo al salvataggio). */
export function checkVideoReplyInput(workspaceId: string, input: VideoReplyInput): { url: string; title: string; trigger: string; message: string; channels: VideoReplyChannel[]; active: boolean; oncePerPerson: boolean } {
  const url = typeof input.url === 'string' ? input.url.trim() : ''
  if (!url || !isWorkspaceVideo(workspaceId, url)) throw new VideoReplyError('manca il video: allegalo con il pulsante del video (MP4 o MOV)')
  const title = oneLine(input.title, MAX_VIDEO_TITLE)
  if (!title) throw new VideoReplyError('manca il titolo del video (es. «Trattamenti»)')
  const trigger = oneLine(input.trigger, MAX_VIDEO_TRIGGER)
  if (trigger.length < 8) throw new VideoReplyError('manca quando mandarlo (es. «quando chiedono informazioni sui trattamenti»)')
  const channels = asChannels(input.channels) ?? [...VIDEO_REPLY_CHANNELS]
  if (!channels.length) throw new VideoReplyError('scegli almeno un canale: Instagram o Messenger')
  return { url, title, trigger, message: str(input.message, MAX_VIDEO_MESSAGE), channels, active: input.active !== false, oncePerPerson: input.oncePerPerson !== false }
}

export async function createVideoReply(
  workspaceId: string,
  input: VideoReplyInput,
  options: { userId?: string | null; origin?: string | null; size?: number } = {}
): Promise<{ video: VideoReply; warning: string | null }> {
  const fields = checkVideoReplyInput(workspaceId, input)
  const size = options.size ?? (await uploadedSize(workspaceId, fields.url))
  const now = new Date().toISOString()
  const video: VideoReply = {
    id: `vr_${randomBytes(5).toString('hex')}`,
    ...fields,
    size,
    token: randomBytes(18).toString('base64url'),
    origin: appOrigin(options.origin),
    createdAt: now,
    updatedAt: now,
    createdBy: options.userId ?? null,
  }
  await updateSetting(libraryKey(workspaceId), libraryState, ({ items }) => {
    const same = items.find((v) => v.url === fields.url)
    if (same) throw new VideoReplyError(`questo video è già nelle Video risposte («${same.title}»): cambia quella`)
    if (items.length >= MAX_VIDEO_REPLIES) throw new VideoReplyError(`puoi avere al massimo ${MAX_VIDEO_REPLIES} video risposte: eliminane una`)
    return { items: [...items, video] }
  })
  // Pagina pubblica: dal codice si risale allo spazio e al video (nient'altro).
  await supabaseAdmin
    .from('app_settings')
    .upsert({ key: watchKey(video.token), value: JSON.stringify({ workspaceId, id: video.id }), updated_at: now }, { onConflict: 'key' })
  return { video, warning: sizeWarning(size, video.channels) }
}

export type VideoReplyPatch = { title?: unknown; trigger?: unknown; message?: unknown; channels?: unknown; active?: unknown; oncePerPerson?: unknown }

export async function updateVideoReply(workspaceId: string, id: string, patch: VideoReplyPatch): Promise<{ video: VideoReply; warning: string | null }> {
  let updated: VideoReply | null = null
  await updateSetting(libraryKey(workspaceId), libraryState, ({ items }) => {
    const current = items.find((v) => v.id === id)
    if (!current) throw new VideoReplyError('video risposta non trovata')
    const next: VideoReply = { ...current, updatedAt: new Date().toISOString() }
    if (patch.title !== undefined) {
      const title = oneLine(patch.title, MAX_VIDEO_TITLE)
      if (!title) throw new VideoReplyError('il titolo non può essere vuoto')
      next.title = title
    }
    if (patch.trigger !== undefined) {
      const trigger = oneLine(patch.trigger, MAX_VIDEO_TRIGGER)
      if (trigger.length < 8) throw new VideoReplyError('scrivi quando mandarlo (es. «quando chiedono informazioni sui trattamenti»)')
      next.trigger = trigger
    }
    if (patch.message !== undefined) next.message = str(patch.message, MAX_VIDEO_MESSAGE)
    if (patch.channels !== undefined) {
      const channels = asChannels(patch.channels)
      if (!channels?.length) throw new VideoReplyError('scegli almeno un canale: Instagram o Messenger')
      next.channels = channels
    }
    if (typeof patch.active === 'boolean') next.active = patch.active
    if (typeof patch.oncePerPerson === 'boolean') next.oncePerPerson = patch.oncePerPerson
    updated = next
    return { items: items.map((v) => (v.id === id ? next : v)) }
  })
  const video = updated as VideoReply | null
  if (!video) throw new VideoReplyError('video risposta non trovata')
  return { video, warning: sizeWarning(video.size, video.channels) }
}

export async function deleteVideoReply(workspaceId: string, id: string): Promise<VideoReply> {
  let removed: VideoReply | null = null
  await updateSetting(libraryKey(workspaceId), libraryState, ({ items }) => {
    removed = items.find((v) => v.id === id) ?? null
    if (!removed) throw new VideoReplyError('video risposta non trovata')
    return { items: items.filter((v) => v.id !== id) }
  })
  const video = removed as VideoReply | null
  if (!video) throw new VideoReplyError('video risposta non trovata')
  await supabaseAdmin.from('app_settings').delete().eq('key', watchKey(video.token))
  // Il file si toglie solo se nessun post lo usa (nel dubbio resta).
  try {
    const { data, error } = await supabaseAdmin.from('workspace_posts').select('id').eq('workspace_id', workspaceId).contains('media', [video.url]).limit(1)
    if (!error && !data?.length) await deleteVideoFile(video.url)
  } catch {}
  return video
}

/** Pagina pubblica: solo titolo e indirizzo del video (null se il codice non c'e' o il video e' stato eliminato). */
export async function watchVideo(token: string): Promise<{ title: string; url: string } | null> {
  if (!/^[\w-]{20,40}$/.test(token)) return null
  const { value } = await readSetting(watchKey(token)).catch(() => ({ value: null }))
  if (!value) return null
  try {
    const ref = JSON.parse(value) as { workspaceId?: unknown; id?: unknown }
    if (typeof ref.workspaceId !== 'string' || typeof ref.id !== 'string') return null
    const video = await getVideoReply(ref.workspaceId, ref.id)
    return video && video.token === token ? { title: video.title, url: video.url } : null
  } catch {
    return null
  }
}

// --- Conversazioni: video proposti e inviati ---------------------------------------------

type SentEntry = { videoId: string; rowId: string; at: string; via: 'attachment' | 'link'; ok: boolean }
type DraftMark = { videoId: string; at: string }
type ThreadState = { sent: SentEntry[]; drafts: Record<string, DraftMark> }

const MAX_SENT = 100
const DRAFT_KEEP_MS = 14 * 24 * 3600_000

function parseThread(raw: string | null): ThreadState {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<ThreadState>) : null
    return { sent: Array.isArray(v?.sent) ? v.sent.filter((e) => e && typeof e.videoId === 'string') : [], drafts: v?.drafts && typeof v.drafts === 'object' ? v.drafts : {} }
  } catch {
    return { sent: [], drafts: {} }
  }
}

async function readThread(workspaceId: string, platform: string, contactId: string): Promise<ThreadState> {
  return parseThread((await readSetting(videoThreadKey(workspaceId, platform, contactId)).catch(() => ({ value: null }))).value)
}

const alreadySent = (thread: ThreadState, videoId: string) => thread.sent.some((e) => e.videoId === videoId && e.ok)

/**
 * Video che l'AI puo' scegliere per questa risposta: attivi, per questo canale, e (se "una
 * sola volta per persona") non ancora mandati a lei. Email e altri canali: mai.
 */
export async function videoChoicesFor(workspaceId: string, platform: string, contactId: string): Promise<VideoReply[]> {
  if (!isVideoReplyChannel(platform)) return []
  const list = (await listVideoReplies(workspaceId).catch(() => [])).filter((v) => v.active && v.channels.includes(platform))
  if (!list.length) return []
  // Video automazione spenta dal pannello di Facevoice per il titolare: nessun video parte.
  if (!(await workspaceVideoRepliesOn(workspaceId))) return []
  const thread = await readThread(workspaceId, platform, contactId)
  return list.filter((v) => !v.oncePerPerson || !alreadySent(thread, v.id))
}

/** Istruzioni per l'AI con i video tra cui scegliere (vuoto senza video). */
export function videoChoicesSection(choices: Pick<VideoReply, 'id' | 'title' | 'trigger'>[]): string {
  if (!choices.length) return ''
  return [
    '## Video risposte (video da mandare alla persona)',
    ...choices.map((v) => `- id ${v.id}: «${v.title}» — mandalo ${v.trigger}`),
    'Se i messaggi della PERSONA a cui stai rispondendo chiedono chiaramente quello che dice uno di questi video, aggiungi in fondo, su una riga a parte, [[VIDEO: id]] con l’id del video che corrisponde meglio (uno solo). Se nessun video corrisponde chiaramente, non scrivere la riga. Il video parte subito dopo il tuo messaggio: puoi dire con naturalezza che le mandi un breve video, ma non scrivere link e non dire che lo ha già visto.',
  ].join('\n')
}

const VIDEO_MARK_RE = /\[\[\s*VIDEO\s*:\s*([\w-]{1,40})\s*\]\]/gi

/** Toglie le righe [[VIDEO: id]] dal testo e restituisce il primo id valido tra quelli offerti. */
export function parseVideoChoice(text: string, allowed: string[]): { text: string; videoId: string | null } {
  const ids = [...text.matchAll(VIDEO_MARK_RE)].map((m) => m[1].toLowerCase())
  const clean = text.replace(VIDEO_MARK_RE, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  const set = new Map(allowed.map((id) => [id.toLowerCase(), id]))
  const videoId = ids.map((id) => set.get(id)).find(Boolean) ?? null
  return { text: clean, videoId }
}

/** Video proposto dall'AI su una bozza (o sulla risposta che sta per partire). Mai bloccante. */
export async function attachVideoToDraft(workspaceId: string, platform: string, contactId: string, draftId: string, videoId: string): Promise<void> {
  try {
    await updateSetting(videoThreadKey(workspaceId, platform, contactId), parseThread, (thread) => {
      const cutoff = Date.now() - DRAFT_KEEP_MS
      const drafts = Object.fromEntries(Object.entries(thread.drafts).filter(([, m]) => Date.parse(m.at) > cutoff))
      return { ...thread, drafts: { ...drafts, [draftId]: { videoId, at: new Date().toISOString() } } }
    })
  } catch (error) {
    console.warn('saas video risposte (bozza):', error instanceof Error ? error.message : error)
  }
}

/** "Togli il video" dalla bozza (Omnichat). */
export async function detachVideoFromDraft(workspaceId: string, platform: string, contactId: string, draftId: string): Promise<boolean> {
  let had = false
  await updateSetting(videoThreadKey(workspaceId, platform, contactId), parseThread, (thread) => {
    if (!thread.drafts[draftId]) return false
    had = true
    const drafts = { ...thread.drafts }
    delete drafts[draftId]
    return { ...thread, drafts }
  })
  return had
}

/** Prende (e toglie) il video proposto sulla bozza: chi lo prende lo invia, una volta sola. */
async function takeDraftVideo(workspaceId: string, platform: string, contactId: string, draftId: string): Promise<string | null> {
  let taken: string | null = null
  await updateSetting(videoThreadKey(workspaceId, platform, contactId), parseThread, (thread) => {
    const mark = thread.drafts[draftId]
    if (!mark) return false
    taken = mark.videoId
    const drafts = { ...thread.drafts }
    delete drafts[draftId]
    return { ...thread, drafts }
  })
  return taken
}

async function recordSent(workspaceId: string, platform: string, contactId: string, entry: SentEntry): Promise<void> {
  await updateSetting(videoThreadKey(workspaceId, platform, contactId), parseThread, (thread) => ({
    ...thread,
    sent: [...thread.sent.filter((e) => e.rowId !== entry.rowId), entry].slice(-MAX_SENT),
  })).catch((error) => console.warn('saas video risposte (registro):', error instanceof Error ? error.message : error))
}

/** Testo della riga del video nella conversazione (lo legge anche l'AI). */
export const videoRowBody = (video: Pick<VideoReply, 'title' | 'message'>, link: string | null) =>
  [video.message, `🎬 Video: «${video.title}»`, link].filter(Boolean).join('\n')

type ThreadTarget = { platform: string; contactId: string; contactName: string | null; accountId: string | null; replyTo: string | null }

async function metaAccount(db: WorkspaceDb, platform: VideoReplyChannel, accountId: string | null): Promise<Connection> {
  const accounts = await listConnections(db, platform)
  const account = accounts.find((c) => c.external_id === accountId) || accounts[0]
  if (!account) throw new Error(`${platform === 'facebook' ? 'Pagina Facebook' : 'Instagram'} non collegato`)
  return account
}

const isTimeout = (error: unknown) => error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError' || /timed? ?out|aborted/i.test(error.message))

export type VideoSendOutcome = { ok: boolean; rowId?: string; via?: 'attachment' | 'link'; error?: string; skipped?: string }

/**
 * Manda il video alla persona e lo salva nella conversazione (riga origin 'ai_video').
 * Entro il limite del canale: (messaggio di accompagnamento, poi) allegato; oltre, o se Meta
 * rifiuta l'allegato: un messaggio con il link alla pagina del video. rowId: riga gia' salvata
 * (Riprova dall'Omnichat).
 */
async function sendVideo(db: WorkspaceDb, target: ThreadTarget, video: VideoReply, rowId?: string): Promise<VideoSendOutcome> {
  if (!isVideoReplyChannel(target.platform)) return { ok: false, skipped: 'canale senza video' }
  const platform = target.platform
  const link = watchUrlOf(video)
  let id = rowId
  if (!id) {
    const { data: saved, error } = await db
      .from('social_messages')
      .insert({
        platform,
        kind: 'message',
        direction: 'out',
        contact_id: target.contactId,
        contact_name: target.contactName,
        reply_to: target.replyTo,
        channel_account_id: target.accountId,
        body: videoRowBody(video, null),
        status: 'sending',
        origin: VIDEO_ORIGIN,
      })
      .select('id')
      .single()
    if (error || !saved) return { ok: false, error: 'video non salvato nella conversazione' }
    id = saved.id as string
  }
  const done = async (via: 'attachment' | 'link', externalId: string, note: string | null) => {
    await db
      .from('social_messages')
      .update({ status: 'sent', external_id: externalId, body: videoRowBody(video, via === 'link' ? link : null), error_message: note, created_at: new Date().toISOString() })
      .eq('id', id as string)
    await recordSent(db.workspaceId, platform, target.contactId, { videoId: video.id, rowId: id as string, at: new Date().toISOString(), via, ok: true })
    return { ok: true, rowId: id, via }
  }
  try {
    const account = await metaAccount(db, platform, target.accountId)
    const fits = video.size > 0 && video.size <= DM_VIDEO_LIMIT_BYTES[platform]
    if (fits) {
      if (video.message) await sendMetaText(account, target.contactId, video.message)
      try {
        const { id: externalId } = await sendMetaVideo(account, target.contactId, video.url)
        return await done('attachment', externalId, null)
      } catch (error) {
        // Meta non ha risposto in tempo: forse il video e' arrivato, un link sarebbe un doppione.
        if (isTimeout(error)) throw new Error('Meta non ha risposto in tempo: controlla nell’app se il video è arrivato')
        const reason = error instanceof Error ? error.message : 'allegato non accettato'
        console.warn(`saas video risposte: allegato rifiutato (${reason}), mando il link`)
        const { id: externalId } = await sendMetaText(account, target.contactId, link)
        return await done('link', externalId, `Allegato non accettato da ${VIDEO_REPLY_CHANNEL_LABELS[platform]} (${reason.slice(0, 120)}): mandato il link al video.`)
      }
    }
    const { id: externalId } = await sendMetaText(account, target.contactId, [video.message, link].filter(Boolean).join('\n'))
    return await done('link', externalId, null)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invio non riuscito'
    console.error('saas video risposte:', message)
    await db
      .from('social_messages')
      .update({ status: 'failed', error_message: `Video non inviato: ${message}`.slice(0, 300) })
      .eq('id', id as string)
    await recordSent(db.workspaceId, platform, target.contactId, { videoId: video.id, rowId: id as string, at: new Date().toISOString(), via: 'attachment', ok: false })
    return { ok: false, rowId: id, error: message }
  }
}

/**
 * Dopo l'invio di una risposta (automatica, bozza approvata o corretta): se sulla bozza c'e'
 * un video proposto, parte adesso. Mai un errore verso chi chiama: il testo e' gia' partito.
 */
export async function sendDraftVideo(
  db: WorkspaceDb,
  draft: { id: string; platform: string; contact_id: string; contact_name?: string | null; channel_account_id: string | null; reply_to: string | null }
): Promise<VideoSendOutcome | null> {
  try {
    if (!isVideoReplyChannel(draft.platform)) return null
    const videoId = await takeDraftVideo(db.workspaceId, draft.platform, draft.contact_id, draft.id)
    if (!videoId) return null
    const video = await getVideoReply(db.workspaceId, videoId)
    if (!video) return { ok: false, skipped: 'video eliminato' }
    if (!video.active || !video.channels.includes(draft.platform)) return { ok: false, skipped: 'video spento' }
    if (!(await workspaceVideoRepliesOn(db.workspaceId))) return { ok: false, skipped: 'video automazione non attiva' }
    if (video.oncePerPerson && alreadySent(await readThread(db.workspaceId, draft.platform, draft.contact_id), video.id)) return { ok: false, skipped: 'già mandato a questa persona' }
    return await sendVideo(db, { platform: draft.platform, contactId: draft.contact_id, contactName: draft.contact_name ?? null, accountId: draft.channel_account_id, replyTo: draft.reply_to }, video)
  } catch (error) {
    console.error('saas video risposte (bozza):', error instanceof Error ? error.message : error)
    return { ok: false, error: 'video non inviato' }
  }
}

/** "Riprova" su un video non partito (Omnichat): stessa riga, stesso video. */
export async function retryVideoRow(db: WorkspaceDb, rowId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: row } = await db
    .from('social_messages')
    .select('id, platform, contact_id, contact_name, channel_account_id, reply_to, status, origin')
    .eq('id', rowId)
    .maybeSingle()
  if (!row || row.origin !== VIDEO_ORIGIN) return { ok: false, error: 'video non trovato' }
  if (row.status === 'sent') return { ok: true }
  const thread = await readThread(db.workspaceId, row.platform as string, row.contact_id as string)
  const entry = [...thread.sent].reverse().find((e) => e.rowId === rowId)
  const video = entry ? await getVideoReply(db.workspaceId, entry.videoId) : null
  if (!video) return { ok: false, error: 'il video non è più nelle Video risposte' }
  if (!(await workspaceVideoRepliesOn(db.workspaceId))) return { ok: false, error: 'la video automazione non è attiva per questo spazio' }
  const { data: claimed } = await db.from('social_messages').update({ status: 'sending' }).eq('id', rowId).in('status', ['failed', 'pending']).select('id')
  if (!claimed?.length) return { ok: false, error: 'invio già in corso' }
  const outcome = await sendVideo(
    db,
    { platform: row.platform as string, contactId: row.contact_id as string, contactName: (row.contact_name as string | null) ?? null, accountId: (row.channel_account_id as string | null) ?? null, replyTo: (row.reply_to as string | null) ?? null },
    video,
    rowId
  )
  return outcome.ok ? { ok: true } : { ok: false, error: outcome.error || outcome.skipped }
}

/** Per l'Omnichat: video proposti sulle bozze e video inviati, per id della riga. */
export async function threadVideos(
  workspaceId: string,
  platform: string,
  contactId: string,
  rows: { id: string; origin?: string | null; status?: string | null; direction: string }[]
): Promise<Map<string, { title: string; url: string | null; proposed: boolean; videoId: string }>> {
  const out = new Map<string, { title: string; url: string | null; proposed: boolean; videoId: string }>()
  if (!isVideoReplyChannel(platform) || !rows.length) return out
  try {
    const [thread, library] = await Promise.all([readThread(workspaceId, platform, contactId), listVideoReplies(workspaceId)])
    const byId = new Map(library.map((v) => [v.id, v]))
    const sentByRow = new Map(thread.sent.map((e) => [e.rowId, e.videoId]))
    for (const row of rows) {
      if (row.direction !== 'out') continue
      const draftMark = row.status === 'pending' || row.status === 'failed' ? thread.drafts[row.id] : undefined
      const videoId = row.origin === VIDEO_ORIGIN ? sentByRow.get(row.id) : draftMark?.videoId
      if (!videoId) continue
      const video = byId.get(videoId)
      out.set(row.id, { title: video?.title || 'video eliminato', url: video?.url ?? null, proposed: row.origin !== VIDEO_ORIGIN, videoId })
    }
  } catch {}
  return out
}
