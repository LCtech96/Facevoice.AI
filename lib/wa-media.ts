import { randomBytes } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSystemToken } from '@/lib/meta/graph'
import { setOrigin } from '@/lib/meta/agent'
import { WaError, graphCall, loadSettings } from '@/lib/wa-store'
import { waIdOf } from '@/lib/wa-shared'
import {
  WA_MEDIA_BUCKET,
  WA_MEDIA_LIMITS,
  WA_MEDIA_MIME_TYPES,
  kindOfMime,
  mediaBody,
  mimeFromName,
  serviceWindow,
  validateWaMedia,
  type WaMediaKind,
} from '@/lib/wa-media-shared'

// File per WhatsApp (immagini, video, PDF) nello spazio pubblico "wa-media":
// - campagne: file dell'intestazione dei modelli con immagine/video/PDF;
// - chat: foto e video mandati a mano dalla casella Messaggi (entro le 24 ore);
// - in: foto e video ricevuti, scaricati da Meta per vederli in casella.
// Il browser carica direttamente nello spazio con un indirizzo firmato (Vercel non
// accetta richieste oltre ~4,5 MB), come i video dei post. Meta scarica dal link pubblico.

export type WaMediaFolder = 'campagne' | 'chat' | 'in'
const MAX_BUCKET_BYTES = WA_MEDIA_LIMITS.document.maxBytes

let bucketReady: Promise<void> | null = null

/** Spazio pubblico creato la prima volta. */
function ensureBucket(): Promise<void> {
  bucketReady ||= (async () => {
    const storage = supabaseAdmin.storage
    const { data } = await storage.getBucket(WA_MEDIA_BUCKET)
    if (data) return
    const options = { public: true, allowedMimeTypes: WA_MEDIA_MIME_TYPES }
    let { error } = await storage.createBucket(WA_MEDIA_BUCKET, { ...options, fileSizeLimit: MAX_BUCKET_BYTES })
    // Il limite del progetto puo' essere piu' basso: si crea senza il limite dello spazio.
    if (error && /size|limit/i.test(error.message)) ({ error } = await storage.createBucket(WA_MEDIA_BUCKET, options))
    if (error && !/exist/i.test(error.message)) throw new WaError(`Spazio per i file non disponibile: ${error.message}`, 500)
  })().catch((error) => {
    bucketReady = null
    throw error
  })
  return bucketReady
}

export const waMediaPublicUrl = (path: string) => supabaseAdmin.storage.from(WA_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl

/** "Volantino Novembre.png" -> "volantino-novembre" (resta nel nome del file, per riconoscerlo). */
const slug = (name: string) =>
  name
    .replace(/\.[^.]+$/, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'file'

const stamp = () => new Date().toISOString().replace(/\D/g, '').slice(0, 14)

/** Indirizzo firmato per caricare il file dal browser (tipo e peso controllati prima). */
export async function createWaMediaUpload(input: { fileName?: unknown; type?: unknown; size?: unknown }, allowed: WaMediaKind[], folder: WaMediaFolder) {
  const check = validateWaMedia(input, allowed)
  if (!check.ok) throw new WaError(check.error)
  await ensureBucket()
  const path = `${folder}/${stamp()}-${randomBytes(4).toString('hex')}-${slug(String(input.fileName || ''))}.${check.ext}`
  const { data, error } = await supabaseAdmin.storage.from(WA_MEDIA_BUCKET).createSignedUploadUrl(path)
  if (error || !data) throw new WaError(`Caricamento non disponibile: ${error?.message || 'riprova'}`, 500)
  return { path, signedUrl: data.signedUrl, contentType: check.contentType, kind: check.kind, publicUrl: waMediaPublicUrl(path), maxBytes: WA_MEDIA_LIMITS[check.kind].maxBytes }
}

export type WaMediaItem = { name: string; url: string; kind: WaMediaKind; size: number | null; createdAt: string | null }

/** File gia' caricati per le campagne (i piu' recenti prima), per riusarli. */
export async function listWaMedia(folder: WaMediaFolder = 'campagne', limit = 60): Promise<WaMediaItem[]> {
  const { data, error } = await supabaseAdmin.storage.from(WA_MEDIA_BUCKET).list(folder, { limit, sortBy: { column: 'created_at', order: 'desc' } })
  if (error) {
    if (/not found/i.test(error.message)) return []
    throw new WaError(`File non leggibili: ${error.message}`, 500)
  }
  const out: WaMediaItem[] = []
  for (const f of data || []) {
    const meta = (f as { metadata?: { size?: number; mimetype?: string } }).metadata || {}
    const kind = kindOfMime(meta.mimetype || '') || kindOfMime(mimeFromName(f.name))
    if (!kind || !f.id) continue
    out.push({ name: f.name, url: waMediaPublicUrl(`${folder}/${f.name}`), kind, size: typeof meta.size === 'number' ? meta.size : null, createdAt: (f as { created_at?: string }).created_at || null })
  }
  return out
}

/** Link di un file del nostro spazio (non si mandano link qualsiasi dalla casella). */
export function isOwnMediaUrl(url: string): boolean {
  const base = waMediaPublicUrl('x').replace(/x$/, '')
  return url.startsWith(base) && !url.slice(base.length).includes('..')
}

/**
 * Il file c'e' davvero e rispetta i limiti di WhatsApp per quel tipo. Meta lo scarica dal link:
 * se il link non risponde, il messaggio non arriverebbe.
 */
export async function checkMediaLink(url: string, expected: WaMediaKind): Promise<void> {
  const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10_000), cache: 'no-store' }).catch(() => null)
  if (!res?.ok) throw new WaError('Il file non risponde al link: caricalo di nuovo.')
  const size = Number(res.headers.get('content-length') || 0)
  const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  const kind = kindOfMime(type) || kindOfMime(mimeFromName(url))
  const label = WA_MEDIA_LIMITS[expected].label
  if (kind && kind !== expected) throw new WaError(`Il file non è un${expected === 'image' ? "'" : ' '}${label} (${WA_MEDIA_LIMITS[expected].hint}).`)
  if (size > WA_MEDIA_LIMITS[expected].maxBytes) throw new WaError(`Il file è troppo pesante: ${WA_MEDIA_LIMITS[expected].hint}.`)
}

// ---------------------------------------------------------------------
// Casella Messaggi: foto o video mandati a mano (entro le 24 ore)
// ---------------------------------------------------------------------

const SELECT = 'id, platform, contact_id, kind, direction, body, status, error_message, contact_name, reply_to, created_at'

/** Ultimo messaggio della persona su WhatsApp (per la finestra di 24 ore). */
export async function lastWhatsAppInbound(contactId: string): Promise<{ created_at: string; channel_account_id: string | null; contact_name: string | null } | null> {
  const { data } = await supabaseAdmin
    .from('social_messages')
    .select('created_at, channel_account_id, contact_name')
    .eq('platform', 'whatsapp')
    .eq('contact_id', contactId)
    .eq('direction', 'in')
    .eq('kind', 'message')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as { created_at: string; channel_account_id: string | null; contact_name: string | null } | null) || null
}

/**
 * Manda un'immagine o un video (con didascalia facoltativa) a chi ci ha scritto su WhatsApp,
 * solo entro 24 ore dal suo ultimo messaggio, e lo salva in casella.
 */
export async function sendWhatsAppMediaReply(input: { contactId: string; url: string; caption?: string | null; now?: number }) {
  const contactId = waIdOf(String(input.contactId || ''))
  if (!contactId) throw new WaError('Conversazione WhatsApp non trovata.', 404)
  const url = String(input.url || '').trim()
  if (!isOwnMediaUrl(url)) throw new WaError('Carica il file da qui prima di inviarlo.')
  const kind = kindOfMime(mimeFromName(url))
  if (kind !== 'image' && kind !== 'video') throw new WaError(`Dalla chat si possono mandare foto (${WA_MEDIA_LIMITS.image.hint}) o video (${WA_MEDIA_LIMITS.video.hint}).`)
  const caption = String(input.caption || '').trim().slice(0, 1024)

  const last = await lastWhatsAppInbound(contactId)
  const win = serviceWindow(last?.created_at, input.now)
  if (!win.open) throw new WaError(win.reason, 409)
  await checkMediaLink(url, kind)

  const settings = await loadSettings()
  const phoneNumberId = last?.channel_account_id || settings.phoneNumberId
  const res = await graphCall('POST', `${phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: contactId,
    type: kind,
    [kind]: { link: url, ...(caption ? { caption } : {}) },
  })
  const id = res.ok ? (res.data?.messages?.[0]?.id as string | undefined) : undefined
  const error = res.ok ? (id ? null : 'Meta non ha restituito l’id del messaggio') : res.message

  const { data: row, error: dbError } = await supabaseAdmin
    .from('social_messages')
    .insert({
      platform: 'whatsapp',
      kind: 'message',
      contact_id: contactId,
      channel_account_id: phoneNumberId,
      reply_to: null,
      contact_name: last?.contact_name ?? null,
      direction: 'out',
      external_id: id ?? null,
      body: mediaBody(kind, url, caption),
      status: error ? 'failed' : 'sent',
      error_message: error,
    })
    .select(SELECT)
    .single()
  if (dbError) throw new WaError(`Messaggio non salvato: ${dbError.message}`, 500)
  if (!error) await setOrigin(row.id, 'manual')
  return { message: row, error }
}

// ---------------------------------------------------------------------
// Foto e video ricevuti: scaricati da Meta nello spazio, per vederli in casella
// ---------------------------------------------------------------------

/**
 * Scarica un file ricevuto (id del webhook) e lo salva nello spazio: link pubblico, o null
 * se non riesce (in casella resta "[immagine]" / "[video]"). Massimo 16 MB, 20 secondi.
 */
export async function storeInboundWhatsAppMedia(mediaId: string, kind: 'image' | 'video'): Promise<string | null> {
  try {
    if (!/^\d{5,40}$/.test(mediaId)) return null
    const info = await graphCall('GET', mediaId, undefined, 8000)
    if (!info.ok || typeof info.data?.url !== 'string') return null
    const type = String(info.data.mime_type || '').split(';')[0].trim().toLowerCase()
    const declared = Number(info.data.file_size || 0)
    if (kindOfMime(type) !== kind || declared > WA_MEDIA_LIMITS[kind].maxBytes) return null
    const token = getSystemToken()
    if (!token) return null
    const res = await fetch(info.data.url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000), cache: 'no-store' })
    if (!res.ok) return null
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (!bytes.length || bytes.length > WA_MEDIA_LIMITS[kind].maxBytes) return null
    await ensureBucket()
    const path = `in/${stamp()}-${randomBytes(8).toString('hex')}.${WA_MEDIA_LIMITS[kind].types[type]}`
    const { error } = await supabaseAdmin.storage.from(WA_MEDIA_BUCKET).upload(path, bytes, { contentType: type, upsert: false })
    if (error) {
      console.warn('whatsapp: file ricevuto non salvato:', error.message)
      return null
    }
    return waMediaPublicUrl(path)
  } catch (error) {
    console.warn('whatsapp: file ricevuto non scaricato:', error instanceof Error ? error.message : error)
    return null
  }
}
