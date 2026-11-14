import { randomBytes } from 'crypto'
import { callAI, hasAIProvider } from '@/lib/ai'
import { limitHashtags } from '@/lib/hashtags'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { loadContentDirections } from '@/lib/content-directions'
import { readSetting, updateSetting } from '@/lib/settings-store'
import { createInstagramReel, instagramContainerStatus, publishInstagramContainer, publishPageVideo } from '@/lib/meta/graph'
import { sendPushToAdmins } from '@/lib/push'
import {
  TikTokError,
  getTikTokCreator,
  getTikTokPublishStatus,
  initTikTokUpload,
  putTikTokChunk,
  tiktokFailReason,
  tiktokMessage,
  type TikTokPostInfo,
} from '@/lib/tiktok'

// Video di Facevoice (Reel su Instagram, video sulla Pagina Facebook, TikTok) caricati da Luca
// nella Overview: didascalia scritta a mano o con l'AI, poi "Pubblica ora" o "Programma".
//
// Il file va dal browser direttamente nello spazio di archiviazione (Vercel non accetta
// richieste oltre ~4,5 MB) con un indirizzo di caricamento firmato dal server.
// Il post si salva in app_settings (video_post:<id>), nessuna tabella nuova.
//
// Pubblicazione (cron ogni minuto, oppure subito con "Pubblica ora"):
// - Facebook: un solo invio (Facebook scarica ed elabora il video da solo).
// - Instagram: si crea il Reel e se ne tiene l'id; Instagram lo elabora per qualche minuto.
//   Ogni giro del cron controlla una volta lo stato (nessuna attesa lunga): FINISHED → si
//   pubblica; ERROR/EXPIRED o piu' di 30 minuti → errore chiaro. Alla fine arriva la notifica.
// - TikTok: si controlla l'account (chi puo' vedere il video, durata massima), si avvia il
//   caricamento e il server manda il file a pezzi da 10 MB (qualche pezzo per giro, il punto
//   a cui si e' arrivati resta salvato); poi si controlla lo stato finche' TikTok ha finito.
//   Modalita' "direct" (pubblica con le impostazioni scelte) o "inbox" (bozza nell'app TikTok).

const PREFIX = 'video_post:'
export const VIDEO_BUCKET = 'social-videos'
export const MAX_VIDEO_MB = 200
export const MAX_VIDEO_BYTES = MAX_VIDEO_MB * 1024 * 1024
export const VIDEO_TYPES: Record<string, 'mp4' | 'mov'> = { 'video/mp4': 'mp4', 'video/quicktime': 'mov' }
export const MAX_CAPTION = 2200
/** Oltre questo tempo di elaborazione su Instagram si rinuncia con un errore. */
export const IG_TIMEOUT_MS = 30 * 60_000
/** Un giro di pubblicazione tiene il post per se' al massimo cosi' (le funzioni durano 60 secondi). */
const LOCK_MS = 90_000
/** Oltre questo tempo (caricamento o elaborazione) su TikTok si rinuncia con un errore. */
export const TT_TIMEOUT_MS = 30 * 60_000

export type VideoPlatform = 'instagram' | 'facebook' | 'tiktok'
export const TIKTOK_PRIVACY = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'] as const

/** Impostazioni del post su TikTok scelte da Luca (nessun valore preimpostato, come chiede TikTok). */
export type TikTokOptions = {
  mode: 'direct' | 'inbox'
  privacy: string | null
  allowComment: boolean
  allowDuet: boolean
  allowStitch: boolean
  /** Promuove la propria attivita' ("Contenuto promozionale"). */
  brandOrganic: boolean
  /** Promuove un terzo ("Partnership retribuita"). */
  brandContent: boolean
  aigc: boolean
}
export type VideoStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'error'

export type VideoPost = {
  id: string
  path: string
  videoUrl: string
  fileName: string
  size: number
  caption: string
  platforms: VideoPlatform[]
  /** null = bozza. */
  scheduledAt: string | null
  status: VideoStatus
  instagram?: { containerId?: string; startedAt?: string; id?: string; error?: string }
  facebook?: { id?: string; error?: string }
  tiktok?: {
    publishId?: string
    uploadUrl?: string
    uploadUrlAt?: string
    chunkSize?: number
    totalChunks?: number
    nextChunk?: number
    startedAt?: string
    uploadedAt?: string
    /** Pubblicato (id del post se pubblico, altrimenti publishId). */
    id?: string
    /** Mandato nelle bozze dell'app (modalita' inbox). */
    inbox?: boolean
    error?: string
  }
  tiktokOptions?: TikTokOptions
  /** Durata in secondi (letta dal browser al caricamento). */
  durationSec?: number
  lock?: { id: string; until: string }
  publishedAt?: string
  createdAt: string
  updatedAt: string
}

/** Errore da mostrare a Luca (status: codice HTTP della risposta). */
export class VideoError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
  }
}

const newId = () => `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`
export const validVideoId = (id: string) => /^[a-z0-9]{6,40}$/.test(id)
export const validVideoPath = (path: string) => /^\d{4}-\d{2}\/[a-z0-9]{6,40}\.(mp4|mov)$/.test(path)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const lockActive = (post: VideoPost) => Boolean(post.lock && Date.parse(post.lock.until) > Date.now())

const parse = (raw: string | null): VideoPost | null => {
  try {
    return raw ? (JSON.parse(raw) as VideoPost) : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------
// Caricamento del file
// ---------------------------------------------------------------------

/** Tipo e peso del video (dal browser, prima del caricamento). */
export function validateVideoUpload(input: { fileName?: unknown; type?: unknown; size?: unknown }): { ext: 'mp4' | 'mov'; contentType: string } {
  const name = String(input.fileName || '').toLowerCase()
  const type = String(input.type || '').toLowerCase()
  const size = Number(input.size)
  const byName = name.endsWith('.mp4') ? 'video/mp4' : name.endsWith('.mov') ? 'video/quicktime' : ''
  // Alcuni browser non danno il tipo dei .mov: allora vale l'estensione.
  const contentType = VIDEO_TYPES[type] ? type : !type || type === 'application/octet-stream' ? byName : ''
  if (!contentType) throw new VideoError('Formato non supportato: carica un video MP4 o MOV.')
  if (!Number.isFinite(size) || size <= 0) throw new VideoError('Il file è vuoto.')
  if (size > MAX_VIDEO_BYTES) throw new VideoError(`Il video pesa ${Math.round(size / 1024 / 1024)} MB: il massimo è ${MAX_VIDEO_MB} MB.`)
  return { ext: VIDEO_TYPES[contentType], contentType }
}

let bucketReady: Promise<void> | null = null

/** Spazio pubblico per i video (Meta li scarica dall'indirizzo pubblico): creato la prima volta. */
function ensureBucket(): Promise<void> {
  bucketReady ||= (async () => {
    const storage = supabaseAdmin.storage
    const { data } = await storage.getBucket(VIDEO_BUCKET)
    if (data) return
    const options = { public: true, allowedMimeTypes: Object.keys(VIDEO_TYPES) }
    let { error } = await storage.createBucket(VIDEO_BUCKET, { ...options, fileSizeLimit: MAX_VIDEO_BYTES })
    // Il limite del progetto puo' essere piu' basso: si crea senza il limite dello spazio.
    if (error && /size|limit/i.test(error.message)) ({ error } = await storage.createBucket(VIDEO_BUCKET, options))
    if (error && !/exist/i.test(error.message)) throw new VideoError(`Spazio per i video non disponibile: ${error.message}`, 500)
  })().catch((error) => {
    bucketReady = null
    throw error
  })
  return bucketReady
}

export const videoPublicUrl = (path: string) => supabaseAdmin.storage.from(VIDEO_BUCKET).getPublicUrl(path).data.publicUrl

/** Indirizzo firmato per caricare il video direttamente dal browser. */
export async function createVideoUpload(input: { fileName?: unknown; type?: unknown; size?: unknown }) {
  const { ext, contentType } = validateVideoUpload(input)
  await ensureBucket()
  const path = `${new Date().toISOString().slice(0, 7)}/${newId()}.${ext}`
  const { data, error } = await supabaseAdmin.storage.from(VIDEO_BUCKET).createSignedUploadUrl(path)
  if (error || !data) throw new VideoError(`Caricamento non disponibile: ${error?.message || 'riprova'}`, 500)
  return { path, signedUrl: data.signedUrl, token: data.token, contentType, publicUrl: videoPublicUrl(path), maxBytes: MAX_VIDEO_BYTES }
}

/** Il file c'e' davvero (indirizzo pubblico raggiungibile) e non supera il limite: restituisce il peso. */
async function checkUploaded(url: string): Promise<number> {
  const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10_000) }).catch(() => null)
  if (!res?.ok) throw new VideoError('Il video non risulta caricato: caricalo di nuovo.')
  const size = Number(res.headers.get('content-length') || 0)
  if (size > MAX_VIDEO_BYTES) throw new VideoError(`Il video supera i ${MAX_VIDEO_MB} MB.`)
  return size
}

// ---------------------------------------------------------------------
// Post: creazione, modifica, elenco, eliminazione
// ---------------------------------------------------------------------

export const cleanCaption = (value: unknown) => limitHashtags(String(value ?? '').replace(/\r/g, '').trim()).slice(0, MAX_CAPTION)

function cleanPlatforms(value: unknown): VideoPlatform[] {
  const list = (Array.isArray(value) ? value : []).filter((p): p is VideoPlatform => p === 'instagram' || p === 'facebook' || p === 'tiktok')
  const unique = [...new Set(list)]
  if (!unique.length) throw new VideoError('Scegli almeno un canale: Instagram, Facebook o TikTok.')
  return unique
}

function cleanTikTokOptions(value: unknown): TikTokOptions | undefined {
  if (value === undefined || value === null || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  const mode = v.mode === 'inbox' ? 'inbox' : 'direct'
  const privacy = typeof v.privacy === 'string' && (TIKTOK_PRIVACY as readonly string[]).includes(v.privacy) ? v.privacy : null
  const options: TikTokOptions = {
    mode,
    privacy: mode === 'direct' ? privacy : null,
    allowComment: v.allowComment === true,
    allowDuet: v.allowDuet === true,
    allowStitch: v.allowStitch === true,
    brandOrganic: v.brandOrganic === true,
    brandContent: v.brandContent === true,
    aigc: v.aigc === true,
  }
  if (mode === 'direct') {
    if (!options.privacy) throw new VideoError('Per TikTok scegli chi può vedere il video.')
    if (options.brandContent && options.privacy === 'SELF_ONLY') throw new VideoError('Su TikTok i contenuti sponsorizzati non possono avere visibilità «Solo io».')
  }
  return options
}

const cleanDuration = (value: unknown) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 && n < 36_000 ? Math.round(n * 10) / 10 : undefined
}

const needsTikTokOptions = (post: Pick<VideoPost, 'platforms' | 'tiktokOptions'>) => {
  if (post.platforms.includes('tiktok') && !post.tiktokOptions) throw new VideoError('Per TikTok scegli chi può vedere il video.')
}

/** Data di programmazione: null = bozza; deve essere futura (1 minuto di tolleranza). */
/** Data ISO; senza fuso orario ("2026-11-12T18:00") vale l'ora italiana. NaN se non si legge. */
export function parseRomeTime(value: string): number {
  const text = value.trim()
  if (/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(text) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(text)) return Date.parse(text)
  const asUtc = Date.parse(`${text}Z`)
  if (!Number.isFinite(asUtc)) return NaN
  const at = new Date(asUtc)
  const offset = Date.parse(at.toLocaleString('en-US', { timeZone: 'Europe/Rome' })) - Date.parse(at.toLocaleString('en-US', { timeZone: 'UTC' }))
  return asUtc - offset
}

function cleanWhen(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  const ms = parseRomeTime(String(value))
  if (!Number.isFinite(ms)) throw new VideoError('Data e ora non valide.')
  if (ms < Date.now() - 60_000) throw new VideoError('Questa data è già passata: scegli un orario futuro oppure premi «Pubblica ora».')
  return new Date(ms).toISOString()
}

/** Piattaforma finita (uscita o fallita). */
const resolved = (post: VideoPost, p: VideoPlatform) => Boolean(post[p]?.id || post[p]?.error)

/** Riprogrammando un video finito in errore si riprova solo dove non e' uscito. */
function clearFailures(post: VideoPost): VideoPost {
  const next = { ...post }
  if (next.instagram?.error && !next.instagram.id) delete next.instagram
  if (next.facebook?.error && !next.facebook.id) delete next.facebook
  if (next.tiktok?.error && !next.tiktok.id) delete next.tiktok
  return next
}

export async function loadVideoPost(id: string): Promise<VideoPost | null> {
  if (!validVideoId(id)) return null
  return parse((await readSetting(`${PREFIX}${id}`)).value)
}

/** Video dal piu' recente. */
export async function listVideoPosts(limit = 100): Promise<VideoPost[]> {
  const { data, error } = await supabaseAdmin.from('app_settings').select('value, updated_at').like('key', `${PREFIX}%`).order('updated_at', { ascending: false }).limit(limit)
  if (error) throw new Error(error.message)
  return (data || []).flatMap((row) => {
    const post = parse(row.value)
    return post ? [post] : []
  })
}

export async function createVideoPost(input: {
  path?: unknown
  fileName?: unknown
  caption?: unknown
  platforms?: unknown
  scheduledAt?: unknown
  tiktokOptions?: unknown
  durationSec?: unknown
}): Promise<VideoPost> {
  const path = String(input.path || '')
  if (!validVideoPath(path)) throw new VideoError('Video non valido: caricalo di nuovo.')
  const platforms = cleanPlatforms(input.platforms)
  const tiktokOptions = platforms.includes('tiktok') ? cleanTikTokOptions(input.tiktokOptions) : undefined
  needsTikTokOptions({ platforms, tiktokOptions })
  const scheduledAt = cleanWhen(input.scheduledAt)
  const videoUrl = videoPublicUrl(path)
  const size = await checkUploaded(videoUrl)
  const now = new Date().toISOString()
  const post: VideoPost = {
    id: newId(),
    path,
    videoUrl,
    fileName: String(input.fileName || '').slice(0, 200) || path.split('/').pop()!,
    size,
    caption: cleanCaption(input.caption),
    platforms,
    ...(tiktokOptions ? { tiktokOptions } : {}),
    ...(cleanDuration(input.durationSec) ? { durationSec: cleanDuration(input.durationSec) } : {}),
    scheduledAt,
    status: scheduledAt ? 'scheduled' : 'draft',
    createdAt: now,
    updatedAt: now,
  }
  await updateSetting(`${PREFIX}${post.id}`, parse, () => post)
  return post
}

/**
 * Modifica didascalia, canali o data (scheduledAt null = torna in bozza, cioe' annulla la
 * programmazione). Non si tocca un video gia' in pubblicazione o pubblicato.
 */
export async function updateVideoPost(
  id: string,
  patch: { caption?: unknown; platforms?: unknown; scheduledAt?: unknown; tiktokOptions?: unknown },
  options: { now?: boolean } = {}
): Promise<VideoPost> {
  if (!validVideoId(id)) throw new VideoError('Video non trovato.', 404)
  const caption = patch.caption === undefined ? undefined : cleanCaption(patch.caption)
  const platforms = patch.platforms === undefined ? undefined : cleanPlatforms(patch.platforms)
  const tiktokOptions = patch.tiktokOptions === undefined ? undefined : cleanTikTokOptions(patch.tiktokOptions)
  const scheduledAt = options.now ? new Date().toISOString() : patch.scheduledAt === undefined ? undefined : cleanWhen(patch.scheduledAt)
  const saved = await updateSetting(`${PREFIX}${id}`, parse, (current) => {
    if (!current) throw new VideoError('Video non trovato.', 404)
    if (current.status === 'publishing') throw new VideoError('Il video è in pubblicazione: non si può più modificare.', 409)
    if (current.status === 'published') throw new VideoError('Il video è già pubblicato.', 409)
    let next: VideoPost = { ...current }
    if (caption !== undefined) next.caption = caption
    if (platforms) next.platforms = platforms
    if (tiktokOptions) next.tiktokOptions = tiktokOptions
    needsTikTokOptions(next)
    if (scheduledAt !== undefined) {
      next.scheduledAt = scheduledAt
      if (next.status === 'error' && scheduledAt) next = clearFailures(next)
      if (next.status !== 'error' || scheduledAt) next.status = scheduledAt ? 'scheduled' : 'draft'
    }
    return { ...next, updatedAt: new Date().toISOString() }
  })
  if (!saved) throw new VideoError('Video non trovato.', 404)
  return saved
}

/** Elimina il post (e il file, se non e' mai stato mandato a Meta). */
export async function deleteVideoPost(id: string): Promise<void> {
  if (!validVideoId(id)) throw new VideoError('Video non trovato.', 404)
  const key = `${PREFIX}${id}`
  const { value, stamp } = await readSetting(key)
  const post = parse(value)
  if (!post || !stamp) throw new VideoError('Video non trovato.', 404)
  if (lockActive(post)) throw new VideoError('Pubblicazione in corso proprio ora: riprova tra un minuto.', 409)
  // Si cancella solo la versione letta: se intanto e' partita la pubblicazione, non si tocca.
  const { data, error } = await supabaseAdmin.from('app_settings').delete().eq('key', key).eq('updated_at', stamp).select('key')
  if (error) throw new Error(error.message)
  if (!data?.length) throw new VideoError('Il video è appena cambiato: ricarica e riprova.', 409)
  // Meta potrebbe scaricarlo ancora: il file resta se e' gia' partito qualcosa.
  if (!post.instagram && !post.facebook && !post.tiktok) {
    await supabaseAdmin.storage.from(VIDEO_BUCKET).remove([post.path]).catch(() => undefined)
  }
}

// ---------------------------------------------------------------------
// Pubblicazione
// ---------------------------------------------------------------------

const due = (post: VideoPost) => post.status === 'publishing' || (post.status === 'scheduled' && !!post.scheduledAt && Date.parse(post.scheduledAt) <= Date.now())

/**
 * Un passo di pubblicazione: Facebook (se manca), Reel Instagram (crea, controlla, pubblica).
 * waitMs: per quanto si puo' aspettare l'elaborazione di Instagram in questo giro (0 nel cron).
 * Se un altro giro sta gia' lavorando sullo stesso video non fa niente.
 */
export async function advanceVideoPost(id: string, options: { waitMs?: number; until?: number } = {}): Promise<VideoPost | null> {
  const key = `${PREFIX}${id}`
  const lockId = newId()
  const claimed = await updateSetting(key, parse, (current) => {
    if (!current || !due(current) || lockActive(current)) return false
    return { ...current, status: 'publishing' as const, lock: { id: lockId, until: new Date(Date.now() + LOCK_MS).toISOString() }, updatedAt: new Date().toISOString() }
  })
  if (!claimed || claimed.lock?.id !== lockId) return claimed

  const post: VideoPost = { ...claimed }
  const deadline = Date.now() + (options.waitMs || 0)
  /** Fino a quando si possono caricare pezzi del video su TikTok in questo giro. */
  const workUntil = options.until ?? Date.now() + 30_000
  /** Salva il lavoro fatto finora (senza lasciare il post): se la funzione si ferma, niente doppioni. */
  const save = async (final: boolean): Promise<VideoPost | null> => {
    let stored: VideoPost | null = null
    await updateSetting(key, parse, (current) => {
      // Eliminato o preso da un altro giro (lucchetto scaduto): non si sovrascrive.
      if (!current || current.lock?.id !== lockId) return false
      const next: VideoPost = { ...current, instagram: post.instagram, facebook: post.facebook, tiktok: post.tiktok, updatedAt: new Date().toISOString() }
      if (final) {
        delete next.lock
        if (next.platforms.every((p) => resolved(next, p))) {
          next.status = next.platforms.some((p) => next[p]?.id) ? 'published' : 'error'
          if (next.status === 'published') next.publishedAt = new Date().toISOString()
        }
      }
      stored = next
      return next
    })
    return stored
  }

  try {
    if (post.platforms.includes('facebook') && !resolved(post, 'facebook')) {
      const sent = await publishPageVideo(post.videoUrl, post.caption).catch((error) => ({ id: undefined, error: error instanceof Error ? error.message : String(error) }))
      post.facebook = sent.error ? { error: `Facebook: ${sent.error}` } : { id: sent.id || 'ok' }
      await save(false)
    }
    if (post.platforms.includes('tiktok') && !resolved(post, 'tiktok')) {
      await stepTikTok(post, deadline, workUntil, () => save(false))
    }
    if (post.platforms.includes('instagram') && !resolved(post, 'instagram')) {
      await stepInstagram(post, deadline)
    }
  } catch (error) {
    console.error('video: pubblicazione interrotta:', error instanceof Error ? error.message : error)
  }
  const saved = await save(true)
  if (saved && (saved.status === 'published' || saved.status === 'error')) await notifyOutcome(saved)
  return saved
}

async function stepInstagram(post: VideoPost, deadline: number) {
  const ig = { ...(post.instagram || {}) }
  post.instagram = ig
  if (!ig.containerId) {
    const created = await createInstagramReel(post.videoUrl, post.caption).catch((error) => ({ id: undefined, error: error instanceof Error ? error.message : String(error) }))
    if (created.error || !created.id) {
      ig.error = `Instagram: ${created.error || 'Reel non accettato'}`
      return
    }
    ig.containerId = created.id
    ig.startedAt = new Date().toISOString()
  }
  for (;;) {
    const state = await instagramContainerStatus(ig.containerId)
    if (state.status === 'FINISHED') {
      const published = await publishInstagramContainer(ig.containerId)
      if (!published.error) {
        ig.id = published.id || 'ok'
        return
      }
      // "Media ID is not available": a volte serve ancora qualche secondo, si riprova al giro dopo.
      if (!/not available|not ready|try again/i.test(published.error)) {
        ig.error = `Instagram: ${published.error}`
        return
      }
    } else if (state.status === 'PUBLISHED') {
      // Gia' pubblicato da un giro interrotto prima di salvare.
      ig.id = ig.id || 'ok'
      return
    } else if (state.status === 'ERROR' || state.status === 'EXPIRED') {
      ig.error = `Instagram non ha accettato il video (${state.status}${state.detail ? `: ${state.detail}` : ''}). Controlla formato e durata: MP4 o MOV, verticale 9:16, da 3 secondi a 15 minuti.`
      return
    }
    if (Date.now() - Date.parse(ig.startedAt || new Date().toISOString()) > IG_TIMEOUT_MS) {
      ig.error = `Instagram non ha finito di elaborare il video in ${IG_TIMEOUT_MS / 60_000} minuti (stato ${state.status || state.error || 'sconosciuto'}).`
      return
    }
    if (Date.now() + 5000 > deadline) return
    await sleep(5000)
  }
}

const contentTypeOf = (path: string) => (path.endsWith('.mov') ? 'video/quicktime' : 'video/mp4')

/** Un pezzo del file dallo spazio di archiviazione (indirizzo pubblico, richiesta Range). */
async function readRange(url: string, start: number, end: number): Promise<Uint8Array<ArrayBuffer>> {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal: AbortSignal.timeout(30_000) }).catch(() => null)
  if (!res || (res.status !== 206 && res.status !== 200)) throw new TikTokError('Video non leggibile dallo spazio di archiviazione, riprovo al prossimo giro.', 'network', 0)
  let bytes = new Uint8Array(await res.arrayBuffer())
  // Server che ignora Range (risponde 200 con tutto il file): si prende il pezzo giusto.
  if (res.status === 200 && bytes.byteLength !== end - start + 1) bytes = bytes.subarray(start, end + 1)
  if (bytes.byteLength !== end - start + 1) throw new TikTokError('Video letto solo in parte, riprovo al prossimo giro.', 'network', 0)
  return bytes
}

async function stepTikTok(post: VideoPost, deadline: number, workUntil: number, checkpoint: () => Promise<unknown>) {
  const tt = { ...(post.tiktok || {}) }
  post.tiktok = tt
  const opts = post.tiktokOptions
  const finish = (fields: Partial<NonNullable<VideoPost['tiktok']>>) => {
    Object.assign(tt, fields)
    delete tt.uploadUrl
  }
  if (!opts) return finish({ error: 'TikTok: mancano le impostazioni del post (chi può vederlo).' })
  if (!post.size) return finish({ error: 'TikTok: peso del video sconosciuto, caricalo di nuovo.' })
  tt.startedAt ||= new Date().toISOString()
  try {
    if (!tt.publishId) {
      let postInfo: TikTokPostInfo | null = null
      if (opts.mode === 'direct') {
        // Si ricontrolla l'account ogni volta: visibilita' possibili, durata massima, limiti di oggi.
        const creator = await getTikTokCreator()
        if (!opts.privacy || !creator.privacyOptions.includes(opts.privacy)) return finish({ error: tiktokMessage('privacy_level_option_mismatch') })
        if (creator.maxDurationSec && post.durationSec && post.durationSec > creator.maxDurationSec + 0.5) {
          return finish({ error: `TikTok: il video dura ${Math.round(post.durationSec)} secondi, su questo account il massimo è ${creator.maxDurationSec}.` })
        }
        postInfo = {
          title: post.caption,
          privacy_level: opts.privacy,
          disable_comment: creator.commentDisabled || !opts.allowComment,
          disable_duet: creator.duetDisabled || !opts.allowDuet,
          disable_stitch: creator.stitchDisabled || !opts.allowStitch,
          brand_content_toggle: opts.brandContent,
          brand_organic_toggle: opts.brandOrganic,
          ...(opts.aigc ? { is_aigc: true } : {}),
        }
      }
      const started = await initTikTokUpload(opts.mode, post.size, postInfo)
      Object.assign(tt, {
        publishId: started.publishId,
        uploadUrl: started.uploadUrl,
        uploadUrlAt: new Date().toISOString(),
        chunkSize: started.chunkSize,
        totalChunks: started.total,
        nextChunk: 0,
      })
      await checkpoint()
    }

    const total = tt.totalChunks || 1
    const chunk = tt.chunkSize || post.size
    while ((tt.nextChunk ?? 0) < total) {
      if (!tt.uploadUrl || Date.now() - Date.parse(tt.uploadUrlAt || '') > 55 * 60_000) {
        return finish({ error: 'TikTok: il tempo per caricare il video è scaduto. Premi «Riprova ora».' })
      }
      // Ogni pezzo richiede qualche secondo: se il giro sta finendo si continua al prossimo.
      if (Date.now() + 15_000 > workUntil) return
      const i = tt.nextChunk ?? 0
      const start = i * chunk
      const end = i === total - 1 ? post.size - 1 : start + chunk - 1
      const bytes = await readRange(post.videoUrl, start, end)
      const result = await putTikTokChunk(tt.uploadUrl, bytes, start, post.size, contentTypeOf(post.path))
      if (result === 'range') {
        // Un giro interrotto aveva gia' mandato questo pezzo: si riparte da dove e' arrivato TikTok.
        const state = await getTikTokPublishStatus(tt.publishId!)
        const sent = state.uploadedBytes ?? -1
        if (sent >= post.size) tt.nextChunk = total
        else if (sent >= 0 && sent % chunk === 0 && sent / chunk < total) tt.nextChunk = sent / chunk
        else return finish({ error: 'TikTok: caricamento non allineato. Premi «Riprova ora».' })
      } else {
        tt.nextChunk = result === 'done' ? total : i + 1
      }
      if ((tt.nextChunk ?? 0) >= total) {
        tt.uploadedAt = new Date().toISOString()
        delete tt.uploadUrl
      }
      await checkpoint()
    }

    tt.uploadedAt ||= new Date().toISOString()
    for (;;) {
      const state = await getTikTokPublishStatus(tt.publishId!)
      if (state.status === 'PUBLISH_COMPLETE') return finish({ id: state.postIds[0] || tt.publishId })
      if (state.status === 'SEND_TO_USER_INBOX') return finish({ id: tt.publishId, inbox: true })
      if (state.status === 'FAILED') return finish({ error: tiktokFailReason(state.failReason) })
      if (Date.now() - Date.parse(tt.uploadedAt) > TT_TIMEOUT_MS) {
        return finish({ error: `TikTok non ha finito di elaborare il video in ${TT_TIMEOUT_MS / 60_000} minuti (stato ${state.status || 'sconosciuto'}).` })
      }
      if (Date.now() + 5000 > deadline) return
      await sleep(5000)
    }
  } catch (error) {
    // Problemi passeggeri (rete, troppe richieste, TikTok giu'): si riprova al prossimo giro, non per sempre.
    if (error instanceof TikTokError && error.transient && Date.now() - Date.parse(tt.startedAt) < TT_TIMEOUT_MS) {
      console.warn(`video ${post.id}: TikTok, riprovo:`, error.message)
      return
    }
    const message = error instanceof Error ? error.message : String(error)
    finish({ error: message.startsWith('TikTok') ? message : `TikTok: ${message}` })
  }
}

const PLATFORM_NAME: Record<VideoPlatform, string> = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok' }

async function notifyOutcome(post: VideoPost) {
  const ok = post.platforms.filter((p) => post[p]?.id).map((p) => (p === 'tiktok' && post.tiktok?.inbox ? 'TikTok (nelle bozze dell’app)' : PLATFORM_NAME[p]))
  const errors = post.platforms.map((p) => post[p]?.error).filter(Boolean) as string[]
  const snippet = post.caption.split('\n')[0].slice(0, 60) || post.fileName
  const title = !ok.length ? 'Video non pubblicato' : errors.length ? 'Video pubblicato in parte' : 'Video pubblicato'
  const body = [ok.length ? `Uscito su ${ok.join(' e ')}: «${snippet}»` : `«${snippet}»`, ...errors].join('\n').slice(0, 300)
  console.log(`video ${post.id}: ${title}${errors.length ? ` (${errors.join(' | ')})` : ''}`)
  await sendPushToAdmins({ title, body, url: '/admin/overview', tag: `video-${post.id}` }).catch(() => undefined)
}

/** "Pubblica ora": parte subito; se Instagram e' lento, il cron finisce il lavoro. */
export async function publishVideoNow(id: string, patch: { caption?: unknown; platforms?: unknown; tiktokOptions?: unknown } = {}, waitMs = 25_000): Promise<VideoPost> {
  await updateVideoPost(id, patch, { now: true })
  const post = (await advanceVideoPost(id, { waitMs })) || (await loadVideoPost(id))
  if (!post) throw new VideoError('Video non trovato.', 404)
  return post
}

/** Cron: video programmati arrivati all'ora e Reel ancora in elaborazione (un controllo ciascuno). */
export async function videoPostsTick(): Promise<{ checked: number }> {
  const list = await listVideoPosts()
  const ready = list.filter((p) => due(p) && !lockActive(p)).slice(0, 5)
  // Il cron dura al massimo 60 secondi (insieme agli altri lavori): niente video nuovi dopo 30.
  const tickEnd = Date.now() + 40_000
  let checked = 0
  for (const post of ready) {
    if (Date.now() > tickEnd - 10_000) break
    checked++
    await advanceVideoPost(post.id, { until: Math.min(Date.now() + 30_000, tickEnd) }).catch((error) =>
      console.error(`video ${post.id}:`, error instanceof Error ? error.message : error)
    )
  }
  return { checked }
}

/** Il video come lo vede la pagina (senza lucchetto e indirizzo di caricamento di TikTok). */
export function videoForClient(post: VideoPost) {
  const { lock: _lock, ...rest } = post
  if (rest.tiktok?.uploadUrl) {
    const { uploadUrl: _url, ...tiktok } = rest.tiktok
    rest.tiktok = tiktok
  }
  return rest
}

/** Webhook di TikTok: il video con quella pubblicazione (tra gli ultimi 100). */
export async function findVideoByTikTokPublish(publishId: string): Promise<VideoPost | null> {
  if (!publishId) return null
  return (await listVideoPosts()).find((p) => p.tiktok?.publishId === publishId) || null
}

/** Il post su TikTok e' diventato pubblico: se ne salva l'id. */
export async function noteTikTokPublic(id: string, publishId: string, postId: string) {
  await updateSetting(`${PREFIX}${id}`, parse, (current) => {
    if (!current?.tiktok || current.tiktok.publishId !== publishId || current.tiktok.id === postId) return false
    return { ...current, tiktok: { ...current.tiktok, id: postId }, updatedAt: new Date().toISOString() }
  })
}

// ---------------------------------------------------------------------
// Didascalia con l'AI
// ---------------------------------------------------------------------

const CAPTION_PROMPT = `Sei il social media manager di Facevoice AI (agenzia digitale e software house a Terrasini, Palermo: siti, app, automazioni, chatbot e soluzioni di intelligenza artificiale per le aziende).
Scrivi o modifichi la didascalia di un VIDEO (Reel di Instagram, video sulla Pagina Facebook, TikTok) seguendo le indicazioni di Luca, il titolare.

Regole:
- Usa solo le informazioni di Luca: niente numeri, clienti, risultati o promesse inventate.
- Se c'è una didascalia da modificare, cambia solo quello che Luca chiede e tieni il resto.
- Apertura forte nella prima riga, paragrafi brevi, invito all'azione; massimo 1600 caratteri.
- AL MASSIMO 5 hashtag pertinenti, in fondo (Instagram non ne accetta di più). I link non sono cliccabili su Instagram.
- Tono chiaro, umano, professionale, in italiano (salvo diversa indicazione di Luca). Niente markdown, niente virgolette intorno al testo.
Rispondi SOLO con il testo della didascalia.`

/** Scrive (didascalia vuota: instruction = di cosa parla il video) o modifica la didascalia. */
export async function writeVideoCaption(input: { caption?: unknown; instruction?: unknown }): Promise<string> {
  const current = String(input.caption ?? '').trim().slice(0, MAX_CAPTION)
  const ask = String(input.instruction ?? '').trim().slice(0, 1000)
  if (!current && !ask) throw new VideoError('Scrivi in due parole di cosa parla il video.')
  if (!hasAIProvider()) throw new VideoError('Manca una chiave AI.', 503)
  const directions = (await loadContentDirections()).text
  const content = [
    current ? `Didascalia attuale:\n${current}\n\nCosa cambiare: ${ask || 'migliorala, stesso contenuto'}` : `Di cosa parla il video (scrivi la didascalia): ${ask}`,
    directions ? `Indicazioni generali di Luca per tutti i contenuti: ${directions}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  const result = await callAI([{ role: 'user', content }], CAPTION_PROMPT, { feature: 'didascalia_video', temperature: 0.6, maxOutputTokens: 1500 })
  const text = cleanCaption(
    String(result.message || '')
      .replace(/^```\w*\n?|```$/g, '')
      .trim()
      .replace(/^["«“]([\s\S]*)["»”]$/, '$1')
  )
  if (!text) throw new VideoError('L’AI non ha scritto niente: riprova.', 502)
  return text
}
