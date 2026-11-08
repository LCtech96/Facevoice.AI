import { supabaseAdmin } from '@/lib/supabase-admin'
import type { Connection } from './connections'
import { limitHashtags } from './hashtags'
import { finishInstagramReel, instagramReelStatus, publishFacebookVideo, startInstagramReel } from './publish'
import type { PostPlatform, PostRow } from './posts'
import { VIDEO_BUCKET, VIDEO_MAX_MB } from './video-shared'

// Post video: il cliente carica un MP4 o MOV direttamente dal browser nell'archivio
// (indirizzo firmato dato dal server: le funzioni di Vercel non accettano file grandi),
// poi il post (tabella workspace_posts, media = [indirizzo del video]) si pubblica
// subito o si programma come i post con le foto: Reel su Instagram, video sulla Pagina.
// Instagram elabora il video per qualche minuto: il contenuto creato si tiene in
// results.video e il cron lo riprende al giro dopo, finche' e' pronto (max 30 minuti).

export { VIDEO_BUCKET, VIDEO_MAX_MB }
export const VIDEO_MAX_BYTES = VIDEO_MAX_MB * 1024 * 1024
/** Oltre questo tempo di elaborazione su Instagram si rinuncia con un errore chiaro. */
export const REEL_PROCESSING_LIMIT_MS = 30 * 60_000

const VIDEO_TYPES: Record<string, 'mp4' | 'mov'> = { 'video/mp4': 'mp4', 'video/quicktime': 'mov' }
const EXT_TYPES: Record<string, string> = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime' }

/** Reel in elaborazione su Instagram: id del contenuto e da quando. */
export type VideoState = { container?: string; since?: string }

const supabaseBase = () => (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/+$/, '')

function videoPath(url: string): string | null {
  try {
    const base = new URL(supabaseBase())
    const u = new URL(url)
    const prefix = `/storage/v1/object/public/${VIDEO_BUCKET}/`
    if (u.protocol !== 'https:' || u.host !== base.host || !u.pathname.startsWith(prefix)) return null
    const path = decodeURIComponent(u.pathname.slice(prefix.length))
    return /^[0-9a-f-]{36}\/videos\/[\w.-]+\.(mp4|mov)$/i.test(path) ? path : null
  } catch {
    return null
  }
}

/** Indirizzo di un video del nostro archivio. */
export const isVideoUrl = (url: unknown): boolean => typeof url === 'string' && videoPath(url) !== null

/** Video caricato da questo spazio (la cartella e' l'id dello spazio). */
export const isWorkspaceVideo = (workspaceId: string, url: string): boolean => videoPath(url)?.startsWith(`${workspaceId}/videos/`) === true

/** Post con un video (invece delle foto). */
export const isVideoPost = (post: Pick<PostRow, 'media'>): boolean => post.media.length === 1 && isVideoUrl(post.media[0])

// Archivio dei video: si crea da solo la prima volta (pubblico in lettura, solo video).
let bucketReady: Promise<void> | null = null

async function ensureVideoBucket(): Promise<void> {
  bucketReady ||= (async () => {
    const { data } = await supabaseAdmin.storage.getBucket(VIDEO_BUCKET)
    if (data) return
    const allowedMimeTypes = Object.keys(VIDEO_TYPES)
    const first = await supabaseAdmin.storage.createBucket(VIDEO_BUCKET, { public: true, fileSizeLimit: VIDEO_MAX_BYTES, allowedMimeTypes })
    if (!first.error || /exist|duplicate/i.test(first.error.message)) return
    // Il limite del progetto puo' essere piu' basso di 200 MB: allora vale quello.
    const second = await supabaseAdmin.storage.createBucket(VIDEO_BUCKET, { public: true, allowedMimeTypes })
    if (second.error && !/exist|duplicate/i.test(second.error.message)) throw new Error(`archivio video non pronto: ${second.error.message}`)
  })().catch((error) => {
    bucketReady = null
    throw error
  })
  return bucketReady
}

export type VideoUploadRequest = { name?: unknown; type?: unknown; size?: unknown }
export type VideoUpload = { uploadUrl: string; url: string; contentType: string; maxBytes: number }

/** Controlla il file scelto (tipo e peso): restituisce il tipo da usare o un errore per il cliente. */
export function checkVideoFile(input: VideoUploadRequest): { contentType: string; ext: 'mp4' | 'mov' } {
  const type = typeof input.type === 'string' ? input.type.trim().toLowerCase() : ''
  const name = typeof input.name === 'string' ? input.name.trim().toLowerCase() : ''
  const size = Number(input.size)
  const fromName = EXT_TYPES[name.split('.').pop() || '']
  const contentType = VIDEO_TYPES[type] ? type : !type || type === 'application/octet-stream' ? fromName : undefined
  if (!contentType) throw new Error('Formato non supportato: carica un video MP4 o MOV.')
  if (!Number.isFinite(size) || size <= 0) throw new Error('Il file è vuoto o non leggibile.')
  if (size > VIDEO_MAX_BYTES) throw new Error(`Il video supera ${VIDEO_MAX_MB} MB: accorcialo o esportalo in qualità più bassa.`)
  return { contentType, ext: VIDEO_TYPES[contentType] }
}

/** Indirizzo firmato per caricare il video dal browser direttamente nell'archivio (cartella dello spazio). */
export async function createVideoUpload(workspaceId: string, input: VideoUploadRequest): Promise<VideoUpload> {
  const { contentType, ext } = checkVideoFile(input)
  await ensureVideoBucket()
  const path = `${workspaceId}/videos/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`
  const { data, error } = await supabaseAdmin.storage.from(VIDEO_BUCKET).createSignedUploadUrl(path)
  if (error || !data?.signedUrl) throw new Error(`caricamento non preparato: ${error?.message || 'nessun indirizzo'}`)
  return { uploadUrl: data.signedUrl, url: `${supabaseBase()}/storage/v1/object/public/${VIDEO_BUCKET}/${path}`, contentType, maxBytes: VIDEO_MAX_BYTES }
}

/** Il video caricato c'e' davvero ed e' entro il limite? (prima di creare il post) */
export async function checkUploadedVideo(workspaceId: string, url: string): Promise<void> {
  if (!isWorkspaceVideo(workspaceId, url)) throw new Error('video non valido: caricalo da qui')
  const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15_000) }).catch(() => null)
  if (!res?.ok) throw new Error('il video non è arrivato nell’archivio: ricaricalo')
  const size = Number(res.headers.get('content-length') || 0)
  if (size > VIDEO_MAX_BYTES) throw new Error(`il video supera ${VIDEO_MAX_MB} MB`)
}

/** Toglie il file del video dall'archivio (post eliminato prima di uscire). Non blocca mai. */
export async function deleteVideoFile(url: string): Promise<void> {
  const path = videoPath(url)
  if (!path) return
  await supabaseAdmin.storage
    .from(VIDEO_BUCKET)
    .remove([path])
    .catch(() => null)
}

// --- Pubblicazione -------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Aspetta al massimo `seconds` che Instagram finisca di elaborare: true se pronto, false se ancora in corso. */
async function reelReady(connection: Connection, id: string, seconds: number): Promise<boolean> {
  const until = Date.now() + seconds * 1000
  for (;;) {
    // Un controllo non riuscito (rete) non e' un errore del video: si riprova dopo.
    const state = await instagramReelStatus(connection, id).catch(() => ({ code: '', detail: '' }))
    if (state.code === 'FINISHED' || state.code === 'PUBLISHED') return true
    if (state.code === 'ERROR' || state.code === 'EXPIRED') {
      throw new ReelError(`Instagram non ha accettato il video (${state.code}${state.detail ? `: ${state.detail}` : ''}). Controlla che sia MP4 o MOV, tra 3 secondi e 15 minuti, meglio in verticale 9:16.`)
    }
    if (Date.now() + 5000 > until) return false
    await sleep(5000)
  }
}

class ReelError extends Error {}

export type VideoPublishOutcome = {
  results: PostRow['results']
  /** Reel ancora in elaborazione: il post torna "programmato" e il cron lo riprende. */
  pending: boolean
  ok: boolean
  errors: string[]
}

/**
 * Un passo della pubblicazione di un post video (gia' "in pubblicazione"). Facebook esce
 * subito; su Instagram si crea il Reel e si aspetta al massimo `waitSeconds`: se non e'
 * pronto si tiene l'id del contenuto e si finisce al giro dopo. Si pubblica solo dove non
 * e' gia' uscito. Chi chiama salva il risultato.
 */
export async function publishVideoStep(
  post: PostRow,
  options: { waitSeconds: number; account: (platform: PostPlatform) => Promise<Connection | null>; now?: number }
): Promise<VideoPublishOutcome> {
  const now = options.now ?? Date.now()
  const url = post.media[0]
  const results: PostRow['results'] = { instagram: post.results?.instagram, facebook: post.results?.facebook, errors: [], video: { ...(post.results?.video || {}) } }
  const errors: string[] = []
  let pending = false
  for (const platform of post.platforms) {
    if (results[platform]) continue
    const label = platform === 'instagram' ? 'Instagram' : 'Facebook'
    try {
      const account = await options.account(platform)
      if (!account) throw new Error('account non collegato')
      if (platform === 'facebook') {
        results.facebook = await publishFacebookVideo(account, url, post.facebook_text || post.caption)
        continue
      }
      let container = results.video?.container
      if (container && now - Date.parse(results.video?.since || '') > REEL_PROCESSING_LIMIT_MS) {
        results.video = {}
        throw new Error('Instagram non ha finito di elaborare il video in 30 minuti. Riprova, o carica un video più corto o più leggero.')
      }
      if (!container) {
        container = await startInstagramReel(account, url, limitHashtags(post.caption))
        results.video = { container, since: new Date(now).toISOString() }
      }
      if (!(await reelReady(account, container, options.waitSeconds))) {
        pending = true
        continue
      }
      try {
        results.instagram = await finishInstagramReel(account, container)
        results.video = {}
      } catch (error) {
        // "Non ancora pronto" subito dopo FINISHED capita: si riprova al giro dopo.
        if (/not available|not ready|try again/i.test(error instanceof Error ? error.message : '')) pending = true
        else {
          results.video = {}
          throw error
        }
      }
    } catch (error) {
      if (error instanceof ReelError) results.video = {}
      errors.push(`${label}: ${error instanceof Error ? error.message : 'non riuscito'}`)
    }
  }
  results.errors = errors
  return { results, pending, ok: !pending && post.platforms.every((p) => results[p]), errors }
}
