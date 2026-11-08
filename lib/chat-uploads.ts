import { randomBytes } from 'crypto'
import sharp from 'sharp'
import type { ImageInput } from '@/lib/ai'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Foto allegate alla super chat (fino a 10 per messaggio): il browser le riduce (lato lungo
// max ~2048 px, JPEG) e le carica direttamente nello spazio delle immagini del blog con un
// indirizzo firmato, perche' Vercel non accetta richieste oltre ~4,5 MB. Alla chat arrivano
// solo il percorso e una piccola anteprima; l'assistente usa le foto originali nei caroselli.

export const CHAT_BUCKET = 'blog-images'
export const MAX_CHAT_UPLOADS = 10
const MAX_THUMB_CHARS = 80_000
const THUMB_RE = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/
export const validChatPath = (path: string) => /^chat\/u[a-z0-9]{10,40}\.jpg$/.test(path)

export const chatUploadUrl = (path: string) => supabaseAdmin.storage.from(CHAT_BUCKET).getPublicUrl(path).data.publicUrl

/** Indirizzi firmati per caricare `count` foto della chat (JPEG). */
export async function createChatUploads(count: unknown) {
  const n = Math.round(Number(count))
  if (!Number.isFinite(n) || n < 1) throw new Error('Nessuna foto da caricare')
  if (n > MAX_CHAT_UPLOADS) throw new Error(`Al massimo ${MAX_CHAT_UPLOADS} foto per messaggio`)
  return Promise.all(
    Array.from({ length: n }, async () => {
      const path = `chat/u${Date.now().toString(36)}${randomBytes(5).toString('hex')}.jpg`
      const { data, error } = await supabaseAdmin.storage.from(CHAT_BUCKET).createSignedUploadUrl(path)
      if (error || !data) throw new Error(`Caricamento non disponibile: ${error?.message || 'riprova'}`)
      return { path, signedUrl: data.signedUrl, token: data.token, contentType: 'image/jpeg' }
    })
  )
}

/** Foto gia' caricate mandate con il messaggio: { path, thumb } controllati. */
export function cleanChatUploads(input: unknown): { list: { path: string; thumb: string }[] } | { error: string } {
  if (!Array.isArray(input) || !input.length) return { list: [] }
  if (input.length > MAX_CHAT_UPLOADS) return { error: `Al massimo ${MAX_CHAT_UPLOADS} foto per messaggio` }
  const list: { path: string; thumb: string }[] = []
  for (const item of input) {
    const path = typeof item?.path === 'string' ? item.path : ''
    if (!validChatPath(path) || list.some((x) => x.path === path)) return { error: 'Foto non valida: caricala di nuovo' }
    const thumb = typeof item?.thumb === 'string' && THUMB_RE.test(item.thumb) && item.thumb.length <= MAX_THUMB_CHARS ? item.thumb : ''
    list.push({ path, thumb })
  }
  return { list }
}

/** Scarica le foto caricate per farle leggere all'AI (ridotte): indirizzi pubblici e immagini, solo quelle trovate. */
export async function loadChatUploads(paths: string[]): Promise<{ urls: string[]; images: ImageInput[] }> {
  const loaded = await Promise.all(
    paths.filter(validChatPath).map(async (path) => {
      const url = chatUploadUrl(path)
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
        if (!res.ok) return null
        const small = await sharp(Buffer.from(await res.arrayBuffer())).rotate().resize(1568, 1568, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()
        return { url, image: { mimeType: 'image/jpeg', data: small.toString('base64') } }
      } catch {
        return null
      }
    })
  )
  const ok = loaded.filter((x): x is { url: string; image: ImageInput } => Boolean(x))
  return { urls: ok.map((x) => x.url), images: ok.map((x) => x.image) }
}
