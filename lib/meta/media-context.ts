import { describeMedia, type ImageInput } from '@/lib/ai'
import { fetchPostCaption } from '@/lib/meta/graph'

// Direct con un post, un reel, una storia o una foto: invece di "posso leggere
// solo testo", si ricava cosa e' stato mandato (didascalia + cosa si vede) e lo
// si passa all'AI come contesto, cosi' la risposta parla di quel contenuto.

export type MetaAttachment = {
  type?: string
  payload?: { url?: string; title?: string; reel_video_id?: string; ig_post_media_id?: string; id?: string }
}
export type StoryReply = { url?: string; id?: string }

const LABELS: Record<string, string> = {
  image: 'una foto',
  video: 'un video',
  audio: 'un messaggio vocale',
  file: 'un file',
  share: 'un post',
  ig_post: 'un post',
  ig_reel: 'un reel',
  reel: 'un reel',
  story_mention: 'una storia in cui ha menzionato il nostro account',
  ig_story: 'una storia',
}

const MAX_IMAGE_BYTES = 6 * 1024 * 1024
const MAX_VIDEO_BYTES = 15 * 1024 * 1024

async function download(url: string): Promise<ImageInput | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return null
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
    const isImage = type.startsWith('image/')
    const isVideo = type.startsWith('video/')
    if (!isImage && !isVideo) return null
    const length = Number(res.headers.get('content-length') || 0)
    const limit = isImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES
    if (length && length > limit) return null
    const buffer = Buffer.from(await res.arrayBuffer())
    if (buffer.length > limit) return null
    return { mimeType: isImage && !/^image\/(jpeg|png|webp|gif)$/.test(type) ? 'image/jpeg' : type, data: buffer.toString('base64') }
  } catch {
    return null
  }
}

/**
 * Testo da dare all'AI per gli allegati di un Direct, es.
 * "[Ha inviato un reel. Didascalia: "...". Cosa si vede: ...]". null se non ci sono allegati.
 */
export async function describeAttachments(
  attachments: MetaAttachment[] | undefined,
  story?: StoryReply | null,
  /** Per i clienti del SaaS: spazio a cui va il consumo e nome della funzione (con il canale). */
  usage?: { workspaceId: string; feature: string }
): Promise<string | null> {
  const items = (attachments || []).slice(0, 3)
  if (!items.length && !story?.url) return null
  const see = (media: ImageInput) => describeMedia([media], undefined, usage?.feature, usage?.workspaceId).catch(() => '')

  const parts: string[] = []
  if (story?.url) {
    const media = await download(story.url)
    const seen = media ? await see(media) : ''
    parts.push(`[Sta rispondendo a una nostra storia${seen ? `. Cosa si vede nella storia: ${seen}` : ''}]`)
  }

  for (const item of items) {
    const type = item.type || 'file'
    const label = LABELS[type] || 'un allegato'
    if (type === 'audio' || type === 'file') {
      parts.push(`[Ha inviato ${label}: non posso ascoltarlo o aprirlo]`)
      continue
    }
    let caption = item.payload?.title?.trim() || ''
    const mediaId = item.payload?.ig_post_media_id || item.payload?.reel_video_id
    if (!caption && mediaId) caption = ((await fetchPostCaption('instagram', mediaId).catch(() => null)) || '').replace(/^(Reel|Post): /, '')
    const media = item.payload?.url ? await download(item.payload.url) : null
    const seen = media ? await see(media) : ''
    const details = [caption && `Didascalia: "${caption.slice(0, 1200)}"`, seen && `Cosa si vede: ${seen}`].filter(Boolean).join('. ')
    parts.push(details ? `[Ha inviato ${label}. ${details}]` : `[Ha inviato ${label}, ma non riesco a vederne il contenuto]`)
  }
  return parts.join('\n')
}
