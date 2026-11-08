import { randomBytes } from 'crypto'
import sharp from 'sharp'
import { callAI, describeImagesWith, hasAIProvider, type ImageInput } from '@/lib/ai'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { readSetting, updateSetting } from '@/lib/settings-store'
import { loadContentDirections } from '@/lib/content-directions'
import { createPostDraft, planFromJson, publishScheduledDraft, schedulePostDraft, scheduledDraftsTick, type PostDraft, type SocialPlatform } from '@/lib/social-posts'
import { sendPushToAdmins } from '@/lib/push'
import { internalOrigin } from '@/lib/internal-origin'

// Libreria foto di Facevoice (Overview) e autopilota dei caroselli.
//
// Luca carica tante foto insieme (fino a 300): il browser le riduce e le manda
// direttamente nello spazio di archiviazione con indirizzi firmati (Vercel non accetta
// richieste oltre ~4,5 MB). Ogni foto e' una riga di app_settings (photo_lib:<id>):
// nessuna tabella nuova e nessun grande valore riscritto da piu' funzioni insieme.
//
// Autopilota: nei giorni e alle ore scelti (ora italiana, recupero entro 2 ore come il
// blog) l'AI sceglie alcune foto (le meno usate, non usate negli ultimi 14 giorni se la
// libreria lo permette, coerenti tra loro), scrive slide, didascalia e hashtag e pubblica
// il carosello con il percorso di sempre. Ogni foto si descrive una volta sola (la
// descrizione resta salvata); per ogni carosello c'e' una sola chiamata di testo.
// Un giro alla volta (lucchetto nello stato), mai due volte la stessa uscita.

const PHOTO_PREFIX = 'photo_lib:'
const SETTINGS_KEY = 'photo_autopilot:settings'
const STATE_KEY = 'photo_autopilot:state'
export const PHOTO_BUCKET = 'photo-library'
export const MAX_LIBRARY_PHOTOS = 300
export const MAX_PHOTO_MB = 15
export const MAX_PHOTO_BYTES = MAX_PHOTO_MB * 1024 * 1024
/** Foto per richiesta di caricamento o di registrazione (il browser ne manda a gruppi). */
export const MAX_BATCH = 50
export const MAX_NOTE = 300
export const PHOTO_TYPES: Record<string, 'jpg' | 'png' | 'webp'> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
/** Una foto usata da meno di cosi' si evita, se la libreria ne ha abbastanza di altre. */
export const REUSE_DAYS = 14
/** Foto per carosello: la prima in copertina, le altre una per slide, piu' la slide finale (Instagram: 10 immagini in tutto). */
export const MIN_CAROUSEL_PHOTOS = 2
export const MAX_CAROUSEL_PHOTOS = 9
export const MAX_POSTS_PER_DAY = 3
export const CATCH_UP_MINUTES = 120
export const MAX_TOPIC = 400
/** Foto tra cui l'AI sceglie a ogni giro (le meno usate). */
const POOL_MAX = 18
/** Foto per chiamata di descrizione. */
const DESCRIBE_BATCH = 6
/** Un giro "in corso" da piu' di cosi' si considera interrotto (la funzione dura al massimo 5 minuti). */
export const RUN_LEASE_MS = 8 * 60_000
const MAX_RUNS_KEPT = 40

export type PhotoTask = { task: 'publish'; id: string } | { task: 'autopilot'; key: string }

/** Avvia un lavoro lungo (pubblicazione o giro dell'autopilota) in una funzione a parte, con 5 minuti di tempo. */
export async function requestPhotoTask(origin: string, task: PhotoTask) {
  const key = (process.env.CRON_SECRET || '').trim()
  if (!key) throw new Error('CRON_SECRET mancante')
  const res = await fetch(`${internalOrigin(origin)}/api/admin/photo-library/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': key },
    body: JSON.stringify(task),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`avvio rifiutato: ${res.status}`)
}

/** Cron (ogni minuto): caroselli programmati arrivati all'ora e uscite dell'autopilota. */
export async function photoPostsTick(origin: string) {
  await Promise.all([
    scheduledDraftsTick((id) => requestPhotoTask(origin, { task: 'publish', id })).catch((error) => console.error('caroselli programmati:', error)),
    photoAutopilotTick((key) => requestPhotoTask(origin, { task: 'autopilot', key })).catch((error) => console.error('autopilota foto:', error)),
  ])
}

export class PhotoError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
  }
}

export type LibraryPhoto = {
  id: string
  path: string
  url: string
  fileName: string
  size: number
  width?: number
  height?: number
  note: string
  /** Cosa mostra la foto, scritto dall'AI una volta sola. */
  description?: string
  describedAt?: string
  uses: number
  lastUsedAt?: string | null
  /** Ultimi caroselli in cui e' stata usata. */
  usedIn?: string[]
  createdAt: string
  updatedAt: string
}

const newId = () => `${Date.now().toString(36)}${randomBytes(4).toString('hex')}`
export const validPhotoId = (id: string) => /^[a-z0-9]{6,40}$/.test(id)
export const validPhotoPath = (path: string) => /^\d{4}-\d{2}\/[a-z0-9]{6,40}\.(jpg|png|webp)$/.test(path)
const parsePhoto = (raw: string | null): LibraryPhoto | null => {
  try {
    const p = raw ? JSON.parse(raw) : null
    return p && typeof p.id === 'string' && typeof p.url === 'string' ? (p as LibraryPhoto) : null
  } catch {
    return null
  }
}
const cleanNote = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE)

// ---------------------------------------------------------------------
// Caricamento
// ---------------------------------------------------------------------

/** Tipo e peso di una foto (dal browser, prima del caricamento). */
export function validatePhotoUpload(input: { fileName?: unknown; type?: unknown; size?: unknown }): { ext: 'jpg' | 'png' | 'webp'; contentType: string } {
  const type = String(input.type || '').toLowerCase()
  const size = Number(input.size)
  const name = String(input.fileName || 'foto')
  if (!PHOTO_TYPES[type]) throw new PhotoError(`${name}: formato non supportato (servono foto JPG, PNG o WebP).`)
  if (!Number.isFinite(size) || size <= 0) throw new PhotoError(`${name}: il file è vuoto.`)
  if (size > MAX_PHOTO_BYTES) throw new PhotoError(`${name}: pesa ${Math.round(size / 1024 / 1024)} MB, il massimo è ${MAX_PHOTO_MB} MB.`)
  return { ext: PHOTO_TYPES[type], contentType: type }
}

let bucketReady: Promise<void> | null = null

/** Spazio pubblico per le foto (i caroselli le scaricano dall'indirizzo pubblico): creato la prima volta. */
function ensureBucket(): Promise<void> {
  bucketReady ||= (async () => {
    const storage = supabaseAdmin.storage
    const { data } = await storage.getBucket(PHOTO_BUCKET)
    if (data) return
    const options = { public: true, allowedMimeTypes: Object.keys(PHOTO_TYPES) }
    let { error } = await storage.createBucket(PHOTO_BUCKET, { ...options, fileSizeLimit: MAX_PHOTO_BYTES })
    if (error && /size|limit/i.test(error.message)) ({ error } = await storage.createBucket(PHOTO_BUCKET, options))
    if (error && !/exist/i.test(error.message)) throw new PhotoError(`Spazio per le foto non disponibile: ${error.message}`, 500)
  })().catch((error) => {
    bucketReady = null
    throw error
  })
  return bucketReady
}

export const photoPublicUrl = (path: string) => supabaseAdmin.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl

/** Quante foto ci sono nella libreria (senza leggerle tutte). */
export async function countLibraryPhotos(): Promise<number> {
  const { count, error } = await supabaseAdmin.from('app_settings').select('key', { count: 'exact', head: true }).like('key', `${PHOTO_PREFIX}%`)
  if (error) throw new Error(error.message)
  return count || 0
}

/** Indirizzi firmati per caricare un gruppo di foto dal browser (al massimo MAX_BATCH, senza superare MAX_LIBRARY_PHOTOS). */
export async function createPhotoUploads(files: unknown) {
  const list = Array.isArray(files) ? files : []
  if (!list.length) throw new PhotoError('Nessuna foto da caricare.')
  if (list.length > MAX_BATCH) throw new PhotoError(`Al massimo ${MAX_BATCH} foto per volta.`)
  const checked = list.map((f) => validatePhotoUpload(f || {}))
  const room = MAX_LIBRARY_PHOTOS - (await countLibraryPhotos())
  if (room <= 0) throw new PhotoError(`La libreria è piena (${MAX_LIBRARY_PHOTOS} foto): elimina quelle che non servono più.`)
  if (checked.length > room) throw new PhotoError(`C'è posto solo per altre ${room} foto (massimo ${MAX_LIBRARY_PHOTOS}).`)
  await ensureBucket()
  const month = new Date().toISOString().slice(0, 7)
  return Promise.all(
    checked.map(async ({ ext, contentType }) => {
      const path = `${month}/${newId()}.${ext}`
      const { data, error } = await supabaseAdmin.storage.from(PHOTO_BUCKET).createSignedUploadUrl(path)
      if (error || !data) throw new PhotoError(`Caricamento non disponibile: ${error?.message || 'riprova'}`, 500)
      return { path, signedUrl: data.signedUrl, token: data.token, contentType, publicUrl: photoPublicUrl(path) }
    })
  )
}

/** Il file c'e' davvero e non supera il limite: restituisce il peso (0 = non trovato). */
async function uploadedSize(url: string): Promise<number> {
  const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10_000) }).catch(() => null)
  if (!res?.ok) return 0
  return Number(res.headers.get('content-length') || 1)
}

/** Registra nella libreria le foto appena caricate. Restituisce le foto salvate e gli errori (per foto). */
export async function addLibraryPhotos(items: unknown): Promise<{ photos: LibraryPhoto[]; errors: string[] }> {
  const list = (Array.isArray(items) ? items : []) as { path?: unknown; fileName?: unknown; note?: unknown; width?: unknown; height?: unknown }[]
  if (!list.length) throw new PhotoError('Nessuna foto da salvare.')
  if (list.length > MAX_BATCH) throw new PhotoError(`Al massimo ${MAX_BATCH} foto per volta.`)
  const room = MAX_LIBRARY_PHOTOS - (await countLibraryPhotos())
  const errors: string[] = []
  const photos: LibraryPhoto[] = []
  const seen = new Set<string>()
  const checked = await Promise.all(
    list.map(async (item) => {
      const path = String(item?.path || '')
      const name = String(item?.fileName || '').slice(0, 200) || path.split('/').pop() || 'foto'
      if (!validPhotoPath(path) || seen.has(path)) return { error: `${name}: foto non valida, caricala di nuovo.` }
      seen.add(path)
      const url = photoPublicUrl(path)
      const size = await uploadedSize(url)
      if (!size) return { error: `${name}: non risulta caricata, riprova.` }
      if (size > MAX_PHOTO_BYTES) return { error: `${name}: supera i ${MAX_PHOTO_MB} MB.` }
      const dim = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.round(Number(v)) : undefined)
      return { path, url, name, size, note: cleanNote(item?.note), width: dim(item?.width), height: dim(item?.height) }
    })
  )
  for (const c of checked) {
    if ('error' in c) {
      errors.push(c.error!)
      continue
    }
    if (photos.length >= room) {
      errors.push(`${c.name}: la libreria è piena (${MAX_LIBRARY_PHOTOS} foto).`)
      await supabaseAdmin.storage.from(PHOTO_BUCKET).remove([c.path]).catch(() => undefined)
      continue
    }
    const now = new Date().toISOString()
    const id = c.path.split('/').pop()!.split('.')[0]
    const photo: LibraryPhoto = { id, path: c.path, url: c.url, fileName: c.name, size: c.size, ...(c.width ? { width: c.width, height: c.height } : {}), note: c.note, uses: 0, lastUsedAt: null, createdAt: now, updatedAt: now }
    const saved = await updateSetting(`${PHOTO_PREFIX}${id}`, parsePhoto, (current) => (current ? false : photo))
    photos.push(saved || photo)
  }
  return { photos, errors }
}

/** Copia nella libreria foto gia' salvate dal sito (es. allegate alla super chat). */
export async function addPhotosFromUrls(urls: string[], note = ''): Promise<{ photos: LibraryPhoto[]; errors: string[] }> {
  const own = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '')
  const list = [...new Set(urls)].filter((u) => /^https:\/\//.test(u) && (!own || u.startsWith(own) || /\/storage\/v1\/object\/public\//.test(u))).slice(0, 10)
  if (!list.length) throw new PhotoError('Nessuna foto da aggiungere.')
  const room = MAX_LIBRARY_PHOTOS - (await countLibraryPhotos())
  if (room <= 0) throw new PhotoError(`La libreria è piena (${MAX_LIBRARY_PHOTOS} foto).`)
  await ensureBucket()
  const photos: LibraryPhoto[] = []
  const errors: string[] = []
  for (const url of list.slice(0, room)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
      if (!res.ok) throw new Error(`download ${res.status}`)
      const input = Buffer.from(await res.arrayBuffer())
      const jpeg = await sharp(input).rotate().resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer()
      const meta = await sharp(jpeg).metadata()
      const id = newId()
      const path = `${new Date().toISOString().slice(0, 7)}/${id}.jpg`
      const { error } = await supabaseAdmin.storage.from(PHOTO_BUCKET).upload(path, jpeg, { contentType: 'image/jpeg', upsert: false })
      if (error) throw new Error(error.message)
      const now = new Date().toISOString()
      const photo: LibraryPhoto = { id, path, url: photoPublicUrl(path), fileName: `chat-${id}.jpg`, size: jpeg.length, width: meta.width, height: meta.height, note: cleanNote(note), uses: 0, lastUsedAt: null, createdAt: now, updatedAt: now }
      await updateSetting(`${PHOTO_PREFIX}${id}`, parsePhoto, () => photo)
      photos.push(photo)
    } catch (error) {
      errors.push(`foto non aggiunta: ${error instanceof Error ? error.message : error}`)
    }
  }
  return { photos, errors }
}

/** Tutte le foto della libreria, dalla piu' recente. */
export async function listLibraryPhotos(): Promise<LibraryPhoto[]> {
  const { data, error } = await supabaseAdmin.from('app_settings').select('value').like('key', `${PHOTO_PREFIX}%`).limit(MAX_LIBRARY_PHOTOS + 50)
  if (error) throw new Error(error.message)
  return (data || [])
    .map((row: { value: string }) => parsePhoto(row.value))
    .filter((p): p is LibraryPhoto => Boolean(p))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function updatePhotoNote(id: string, note: unknown): Promise<LibraryPhoto> {
  if (!validPhotoId(id)) throw new PhotoError('Foto non trovata.', 404)
  const text = cleanNote(note)
  const saved = await updateSetting(`${PHOTO_PREFIX}${id}`, parsePhoto, (current) => {
    if (!current) throw new PhotoError('Foto non trovata.', 404)
    return { ...current, note: text, updatedAt: new Date().toISOString() }
  })
  if (!saved) throw new PhotoError('Foto non trovata.', 404)
  return saved
}

/** Elimina la foto. Il file resta se la foto e' gia' stata usata (le slide salvate la citano per poterle rifare). */
export async function deleteLibraryPhotos(ids: unknown): Promise<number> {
  const list = (Array.isArray(ids) ? ids : [ids]).map(String).filter(validPhotoId).slice(0, MAX_LIBRARY_PHOTOS)
  if (!list.length) throw new PhotoError('Foto non trovata.', 404)
  const keys = list.map((id) => `${PHOTO_PREFIX}${id}`)
  const { data, error } = await supabaseAdmin.from('app_settings').delete().in('key', keys).select('value')
  if (error) throw new Error(error.message)
  const gone = (data || []).map((row: { value: string }) => parsePhoto(row.value)).filter((p): p is LibraryPhoto => Boolean(p))
  const unused = gone.filter((p) => !p.uses).map((p) => p.path)
  if (unused.length) await supabaseAdmin.storage.from(PHOTO_BUCKET).remove(unused).catch(() => undefined)
  return gone.length
}

/** Segna le foto come usate in un carosello (una riga per foto: niente scritture in conflitto). */
export async function markPhotosUsed(ids: string[], draftId: string) {
  const at = new Date().toISOString()
  await Promise.all(
    ids.map((id) =>
      updateSetting(`${PHOTO_PREFIX}${id}`, parsePhoto, (current) => {
        if (!current) return false
        return { ...current, uses: (current.uses || 0) + 1, lastUsedAt: at, usedIn: [draftId, ...(current.usedIn || [])].slice(0, 5), updatedAt: at }
      }).catch((error) => console.warn(`libreria foto: uso di ${id} non salvato:`, error instanceof Error ? error.message : error))
    )
  )
}

// ---------------------------------------------------------------------
// Descrizione delle foto (una volta sola per foto)
// ---------------------------------------------------------------------

const DESCRIBE_PROMPT = (count: number) => `Queste sono ${count} foto della libreria di Facevoice AI (agenzia digitale e software house a Terrasini, Palermo), da usare nei caroselli di Instagram e Facebook.
Per OGNI foto, nell'ordine, scrivi in italiano 1-2 frasi asciutte: soggetto, luogo o ambiente, persone (senza nomi), oggetti, colori e atmosfera, eventuale testo visibile, e per che tipo di post potrebbe servire.
Rispondi SOLO con un array JSON di ${count} stringhe, nello stesso ordine: ["…", "…"]`

async function photoForVision(url: string): Promise<ImageInput | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return null
    const small = await sharp(Buffer.from(await res.arrayBuffer())).rotate().resize(768, 768, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer()
    return { mimeType: 'image/jpeg', data: small.toString('base64') }
  } catch {
    return null
  }
}

/** Descrive le foto che non hanno ancora una descrizione e la salva. Restituisce le foto aggiornate (stesso ordine). */
export async function describePhotos(photos: LibraryPhoto[]): Promise<LibraryPhoto[]> {
  const out = new Map(photos.map((p) => [p.id, p]))
  const missing = photos.filter((p) => !p.description)
  for (let i = 0; i < missing.length; i += DESCRIBE_BATCH) {
    const group = missing.slice(i, i + DESCRIBE_BATCH)
    const loaded = await Promise.all(group.map((p) => photoForVision(p.url)))
    const ready = group.filter((_, k) => loaded[k])
    const images = loaded.filter((x): x is ImageInput => Boolean(x))
    if (!images.length) continue
    let texts: string[] = []
    try {
      const raw = await describeImagesWith(images, DESCRIBE_PROMPT(images.length), 'libreria_foto_descrizione', 300 * images.length + 200)
      const parsed = JSON.parse(raw.match(/\[[\s\S]*\]/)?.[0] || '[]')
      texts = Array.isArray(parsed) ? parsed.map((t) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, 400)) : []
    } catch (error) {
      console.warn('libreria foto: descrizione non riuscita:', error instanceof Error ? error.message : error)
      continue
    }
    await Promise.all(
      ready.map(async (photo, k) => {
        const description = texts[k]
        if (!description) return
        const at = new Date().toISOString()
        const saved = await updateSetting(`${PHOTO_PREFIX}${photo.id}`, parsePhoto, (current) => (current ? { ...current, description, describedAt: at } : false)).catch(() => null)
        out.set(photo.id, { ...(saved || photo), description, describedAt: at })
      })
    )
  }
  return photos.map((p) => out.get(p.id) || p)
}

// ---------------------------------------------------------------------
// Scelta delle foto
// ---------------------------------------------------------------------

const usedRecently = (p: LibraryPhoto, now: number) => Boolean(p.lastUsedAt && now - Date.parse(p.lastUsedAt) < REUSE_DAYS * 86_400_000)

/** Foto tra cui scegliere: le meno usate (e da piu' tempo), evitando quelle usate negli ultimi 14 giorni se ne restano abbastanza. */
export function candidatePhotos(photos: LibraryPhoto[], minPhotos: number, maxPhotos: number, now = Date.now()): LibraryPhoto[] {
  const fresh = photos.filter((p) => !usedRecently(p, now))
  const base = fresh.length >= minPhotos ? fresh : photos
  const sorted = [...base].sort(
    (a, b) => (a.uses || 0) - (b.uses || 0) || String(a.lastUsedAt || '').localeCompare(String(b.lastUsedAt || '')) || a.createdAt.localeCompare(b.createdAt)
  )
  return sorted.slice(0, Math.min(POOL_MAX, Math.max(maxPhotos * 2, 8)))
}

// ---------------------------------------------------------------------
// Autopilota: impostazioni
// ---------------------------------------------------------------------

export type PhotoAutopilotSettings = {
  enabled: boolean
  /** 0 = domenica … 6 = sabato. */
  days: number[]
  /** Ore di uscita (ora italiana "HH:MM"): una per post, da 1 a 3 al giorno. */
  times: string[]
  minPhotos: number
  maxPhotos: number
  /** Argomento e tono dei testi. */
  topic: string
  platforms: SocialPlatform[]
  /** true = il carosello resta da approvare (notifica); false = esce da solo. */
  confirm: boolean
  /** Da quando valgono giorni e ore (le uscite gia' passate prima non si recuperano). */
  since: string | null
  updatedAt: string | null
}

export const AUTOPILOT_DEFAULTS: PhotoAutopilotSettings = {
  enabled: false,
  days: [1, 3, 5],
  times: ['18:00'],
  minPhotos: 3,
  maxPhotos: 6,
  topic: '',
  platforms: ['instagram', 'facebook'],
  confirm: false,
  since: null,
  updatedAt: null,
}

const TIME_RE = /^([01]?\d|2[0-3])[:.]([0-5]\d)$/
const normTime = (raw: unknown): string | null => {
  const m = String(raw ?? '').trim().match(TIME_RE)
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null
}

function parseSettings(raw: string | null): PhotoAutopilotSettings {
  try {
    const data = raw ? JSON.parse(raw) : {}
    return { ...AUTOPILOT_DEFAULTS, ...data }
  } catch {
    return { ...AUTOPILOT_DEFAULTS }
  }
}

export type AutopilotPatch = Partial<Pick<PhotoAutopilotSettings, 'enabled' | 'days' | 'times' | 'minPhotos' | 'maxPhotos' | 'topic' | 'platforms' | 'confirm'>>

/** Applica una modifica controllando ogni valore (PhotoError con un messaggio chiaro se qualcosa non va). */
export function applyAutopilotPatch(current: PhotoAutopilotSettings, input: unknown, now = new Date()): PhotoAutopilotSettings {
  const patch = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const next: PhotoAutopilotSettings = { ...current }
  if (patch.enabled !== undefined) next.enabled = patch.enabled === true
  if (patch.days !== undefined) {
    const days = (Array.isArray(patch.days) ? patch.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    if (!days.length) throw new PhotoError('Scegli almeno un giorno.')
    next.days = [...new Set(days)].sort()
  }
  if (patch.times !== undefined) {
    const raw = Array.isArray(patch.times) ? patch.times : [patch.times]
    const times = raw.map(normTime)
    if (!times.length || times.some((t) => !t)) throw new PhotoError('Ora non valida: scrivila come 18:00.')
    const unique = [...new Set(times as string[])].sort()
    if (unique.length > MAX_POSTS_PER_DAY) throw new PhotoError(`Al massimo ${MAX_POSTS_PER_DAY} post al giorno.`)
    const minutes = unique.map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3)))
    if (minutes.some((m, i) => i > 0 && m - minutes[i - 1] < 60)) throw new PhotoError('Tra due uscite servono almeno 60 minuti.')
    next.times = unique
  }
  const count = (v: unknown, label: string) => {
    const n = Math.round(Number(v))
    if (!Number.isFinite(n) || n < MIN_CAROUSEL_PHOTOS || n > MAX_CAROUSEL_PHOTOS) throw new PhotoError(`${label}: da ${MIN_CAROUSEL_PHOTOS} a ${MAX_CAROUSEL_PHOTOS} foto.`)
    return n
  }
  if (patch.minPhotos !== undefined) next.minPhotos = count(patch.minPhotos, 'Foto minime')
  if (patch.maxPhotos !== undefined) next.maxPhotos = count(patch.maxPhotos, 'Foto massime')
  if (next.minPhotos > next.maxPhotos) {
    if (patch.maxPhotos === undefined) next.maxPhotos = next.minPhotos
    else if (patch.minPhotos === undefined) next.minPhotos = next.maxPhotos
    else throw new PhotoError('Il minimo di foto non può superare il massimo.')
  }
  if (patch.topic !== undefined) next.topic = String(patch.topic ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TOPIC)
  if (patch.platforms !== undefined) {
    const list = (Array.isArray(patch.platforms) ? patch.platforms : []).filter((p): p is SocialPlatform => p === 'instagram' || p === 'facebook')
    if (!list.length) throw new PhotoError('Scegli Instagram, Facebook o entrambi.')
    next.platforms = [...new Set(list)]
  }
  if (patch.confirm !== undefined) next.confirm = patch.confirm === true
  const at = now.toISOString()
  // Acceso, giorni o ore cambiati: le uscite di oggi gia' passate non si recuperano.
  if (next.enabled !== current.enabled || String(next.days) !== String(current.days) || String(next.times) !== String(current.times) || !current.since) next.since = at
  next.updatedAt = at
  return next
}

export const loadAutopilotSettings = async () => parseSettings((await readSetting(SETTINGS_KEY)).value)
export const saveAutopilotSettings = (patch: unknown) => updateSetting(SETTINGS_KEY, parseSettings, (current) => applyAutopilotPatch(current, patch))

const DAY_SHORT = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab']
export function describeAutopilot(s: PhotoAutopilotSettings): string[] {
  return [
    s.enabled ? 'Autopilota ACCESO' : 'Autopilota spento',
    `Giorni: ${s.days.map((d) => DAY_SHORT[d]).join(', ')} · ore ${s.times.join(', ')} (${s.times.length} ${s.times.length === 1 ? 'post' : 'post'} al giorno)`,
    `Foto per carosello: da ${s.minPhotos} a ${s.maxPhotos}`,
    `Argomento e tono: ${s.topic || 'decide l’AI guardando le foto'}`,
    `Su ${s.platforms.map((p) => (p === 'instagram' ? 'Instagram' : 'Facebook')).join(' e ')}`,
    s.confirm ? 'Chiede conferma prima di pubblicare' : 'Pubblica da solo, senza chiedere conferma',
  ]
}

// ---------------------------------------------------------------------
// Autopilota: stato dei giri
// ---------------------------------------------------------------------

export type AutopilotRun = {
  key: string
  status: 'running' | 'published' | 'awaiting' | 'skipped' | 'error'
  startedAt: string
  finishedAt?: string
  note?: string
  draftId?: string
  title?: string
  photos?: string[]
}
export type AutopilotState = { runs: AutopilotRun[] }

const parseState = (raw: string | null): AutopilotState => {
  try {
    const data = raw ? JSON.parse(raw) : {}
    return { runs: Array.isArray(data.runs) ? data.runs : [] }
  } catch {
    return { runs: [] }
  }
}
export const loadAutopilotState = async () => parseState((await readSetting(STATE_KEY)).value)

const runActive = (r: AutopilotRun, now = Date.now()) => r.status === 'running' && now - Date.parse(r.startedAt) < RUN_LEASE_MS

/**
 * Prende il turno per un giro (confronto sul timbro: due cron insieme non partono mai
 * due volte). false = c'e' gia' un giro in corso o questa uscita e' gia' stata fatta.
 */
export async function claimAutopilotRun(key: string): Promise<boolean> {
  let won = false
  await updateSetting(STATE_KEY, parseState, (state) => {
    won = false
    const now = Date.now()
    if (state.runs.some((r) => r.key === key) || state.runs.some((r) => runActive(r, now))) return false
    // Giri rimasti "in corso" oltre il tempo massimo: interrotti (non si rifanno: potrebbero essere usciti).
    const runs = state.runs.map((r) =>
      r.status === 'running' ? { ...r, status: 'error' as const, note: 'Giro interrotto: controlla su Instagram e Facebook se è uscito.', finishedAt: new Date(now).toISOString() } : r
    )
    won = true
    return { runs: [...runs, { key, status: 'running' as const, startedAt: new Date(now).toISOString() }].slice(-MAX_RUNS_KEPT) }
  })
  return won
}

const recordRun = (key: string, patch: Partial<AutopilotRun>) =>
  updateSetting(STATE_KEY, parseState, (state) => ({
    runs: state.runs.map((r) => (r.key === key ? { ...r, ...patch, finishedAt: new Date().toISOString() } : r)),
  }))

// Ora italiana, con l'ora sempre 00-23.
const ROME = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export function romeNow(now = new Date()) {
  const parts = ROME.formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value || ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}`, weekday: WEEKDAYS.indexOf(get('weekday')) }
}
const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

/** Uscite da fare adesso: giorno scelto, ora passata da al massimo 2 ore, valida gia' a quell'ora. */
export function dueSlots(settings: PhotoAutopilotSettings, now = new Date()): string[] {
  if (!settings.enabled) return []
  const r = romeNow(now)
  if (!settings.days.includes(r.weekday)) return []
  const since = settings.since ? romeNow(new Date(settings.since)) : null
  return settings.times
    .filter((t) => {
      const late = minutesOf(r.time) - minutesOf(t)
      if (late < 0 || late > CATCH_UP_MINUTES) return false
      return !since || `${r.date} ${t}` >= `${since.date} ${since.time}`
    })
    .map((t) => `${r.date} ${t}`)
}

/**
 * Cron: avvia l'uscita dell'autopilota arrivata all'ora (una alla volta). launch fa partire
 * il giro in una funzione a parte (con piu' tempo); se non parte, l'uscita resta in errore.
 */
export async function photoAutopilotTick(launch: (key: string) => Promise<unknown>): Promise<string | null> {
  const settings = await loadAutopilotSettings()
  const due = dueSlots(settings)
  if (!due.length) return null
  const state = await loadAutopilotState()
  const key = due.find((k) => !state.runs.some((r) => r.key === k))
  if (!key || state.runs.some((r) => runActive(r))) return null
  if (!(await claimAutopilotRun(key))) return null
  try {
    await launch(key)
  } catch (error) {
    await recordRun(key, { status: 'error', note: `avvio non riuscito: ${error instanceof Error ? error.message : error}` })
    return null
  }
  return key
}

/** "Prova ora" dalla Overview: un giro subito (stesse regole, anche ad autopilota spento). */
export async function startAutopilotNow(launch: (key: string) => Promise<unknown>): Promise<string> {
  const key = `manuale ${new Date().toISOString()}`
  if (!(await claimAutopilotRun(key))) throw new PhotoError('C’è già un carosello in preparazione: aspetta qualche minuto.', 409)
  try {
    await launch(key)
  } catch (error) {
    await recordRun(key, { status: 'error', note: `avvio non riuscito: ${error instanceof Error ? error.message : error}` })
    throw new PhotoError('Avvio non riuscito, riprova.', 500)
  }
  return key
}

// ---------------------------------------------------------------------
// Autopilota: un giro (scelta delle foto, testi, carosello, pubblicazione)
// ---------------------------------------------------------------------

const PICK_PROMPT = (min: number, max: number) => `Sei il social media manager di Facevoice AI (agenzia digitale e software house a Terrasini, Palermo: siti, app, automazioni, chatbot e soluzioni di intelligenza artificiale per le aziende).
Ogni giorno pubblichi da solo un CAROSELLO su Instagram e Facebook usando le foto della libreria di Luca (il titolare). Ti do le foto disponibili, numerate, con la descrizione, l'eventuale nota di Luca e quante volte sono già state usate.

Compiti:
1. Scegli da ${min} a ${max} foto COERENTI tra loro (stesso tema, evento, luogo o messaggio), preferendo quelle usate meno volte. La prima scelta va in copertina: deve essere la più forte. Metti le altre in un ordine che racconti qualcosa.
2. Scrivi i testi, seguendo l'argomento e il tono indicati da Luca (se ci sono) e quello che si vede nelle foto.

Regole:
- Usa solo quello che si vede nelle foto, le note di Luca e le sue indicazioni: niente numeri, clienti, risultati o promesse inventate, niente nomi di persone.
- "hook": gancio della copertina, fortissimo e concreto, massimo 42 caratteri, niente emoji, niente punto finale.
- "label": etichetta breve sopra il gancio (max 34 caratteri) oppure "".
- "slides": UNA slide per ogni foto scelta DOPO la prima, nello stesso ordine. Ogni slide: "title" massimo 55 caratteri e "text" massimo 190 caratteri, legati alla sua foto.
- "cta": ultima slide: "title" (max 50), "text" (max 150), "button" (max 26, es. "Scrivici su WhatsApp", "facevoice.ai").
- "caption": didascalia Instagram (max 1600 caratteri): apertura forte, 2-4 paragrafi brevi, invito all'azione, poi AL MASSIMO 5 hashtag pertinenti.
- "facebook": testo Facebook (max 1200), simile ma senza hashtag in fondo; puoi mettere https://www.facevoice.ai.
- "title": titolo interno breve.
- Italiano chiaro, umano, professionale. Niente markdown.
Rispondi SOLO con JSON: {"photos": [numeri delle foto scelte, nell'ordine], "title": "", "hook": "", "label": "", "slides": [{"title": "", "text": ""}], "cta": {"title": "", "text": "", "button": ""}, "caption": "", "facebook": ""}`

/** Numeri scelti dall'AI → foto (validi, senza doppioni, completati con le meno usate, entro min e max). */
export function resolvePicks(raw: unknown, pool: LibraryPhoto[], min: number, max: number): LibraryPhoto[] {
  const picked: LibraryPhoto[] = []
  for (const n of Array.isArray(raw) ? raw : []) {
    const photo = pool[Math.round(Number(n)) - 1]
    if (photo && !picked.includes(photo)) picked.push(photo)
  }
  for (const photo of pool) {
    if (picked.length >= min) break
    if (!picked.includes(photo)) picked.push(photo)
  }
  return picked.slice(0, max)
}

const notify = (title: string, body: string, tag: string) => sendPushToAdmins({ title, body: body.slice(0, 300), url: '/admin/overview', tag }).catch(() => undefined)

/** Esegue il giro gia' preso con claimAutopilotRun (chiamato dalla funzione a parte). */
export async function runPhotoAutopilot(key: string): Promise<AutopilotRun | null> {
  const state = await loadAutopilotState()
  const run = state.runs.find((r) => r.key === key)
  if (!run || run.status !== 'running') return null
  const settings = await loadAutopilotSettings()
  const finish = async (patch: Partial<AutopilotRun>) => {
    await recordRun(key, patch).catch((error) => console.error('autopilota foto: esito non salvato:', error instanceof Error ? error.message : error))
    return { ...run, ...patch }
  }
  try {
    const photos = await listLibraryPhotos()
    if (photos.length < settings.minPhotos) {
      const note = `Nella libreria ci sono ${photos.length} foto: ne servono almeno ${settings.minPhotos}. Caricane altre nella Overview.`
      await notify('Autopilota foto: carosello saltato', note, `autopilota-${key}`)
      return finish({ status: 'skipped', note })
    }
    if (!hasAIProvider()) throw new Error('manca una chiave AI')
    const pool = await describePhotos(candidatePhotos(photos, settings.minPhotos, settings.maxPhotos))
    const directions = (await loadContentDirections()).text
    const list = pool
      .map((p, i) => `${i + 1}. ${p.description || '(descrizione non disponibile)'}${p.note ? ` — nota di Luca: ${p.note}` : ''} — usata ${p.uses || 0} volte`)
      .join('\n')
    const result = await callAI(
      [
        {
          role: 'user',
          content: [
            `Argomento e tono scelti da Luca: ${settings.topic || '(nessuno: decidi tu guardando le foto, sempre in linea con Facevoice AI)'}`,
            directions ? `Indicazioni generali di Luca per tutti i contenuti: ${directions}` : '',
            `Foto disponibili:\n${list}`,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
      PICK_PROMPT(settings.minPhotos, settings.maxPhotos),
      { feature: 'autopilota_foto', temperature: 0.6, maxOutputTokens: 3000 }
    )
    const json = (result.message || '').match(/\{[\s\S]*\}/)?.[0]
    if (!json) throw new Error('l’AI non ha preparato il carosello')
    const data = JSON.parse(json) as Record<string, unknown>
    const chosen = resolvePicks(data.photos, pool, settings.minPhotos, settings.maxPhotos)
    const plan = planFromJson(data, chosen.length - 1)
    const draft: PostDraft = await createPostDraft({
      brief: settings.topic || plan.title,
      photos: chosen.map((p) => p.url),
      onlyMyImages: true,
      total: chosen.length + 1,
      plan,
      extra: { origin: 'autopilot', platforms: settings.platforms, needsApproval: settings.confirm },
    })
    await markPhotosUsed(
      chosen.map((p) => p.id),
      draft.id
    )
    const base = { draftId: draft.id, title: draft.title, photos: chosen.map((p) => p.id) }
    if (settings.confirm) {
      await notify('Carosello pronto da approvare', `«${draft.title}» (${chosen.length} foto): approvalo nella Overview o chiedilo alla super chat.`, `autopilota-${key}`)
      return finish({ ...base, status: 'awaiting', note: 'In attesa della tua approvazione' })
    }
    await schedulePostDraft(draft.id, { scheduledAt: new Date().toISOString(), platforms: settings.platforms, approve: true })
    const sent = await publishScheduledDraft(draft.id)
    if (!sent) return finish({ ...base, status: 'published', note: 'Pubblicazione avviata' })
    const errors = sent.results?.errors || []
    return finish({ ...base, status: sent.status === 'published' ? 'published' : 'error', ...(errors.length ? { note: errors.join(' · ').slice(0, 400) } : {}) })
  } catch (error) {
    const note = error instanceof Error ? error.message : String(error)
    console.error('autopilota foto:', note)
    await notify('Autopilota foto: carosello non creato', note, `autopilota-${key}`)
    return finish({ status: 'error', note: note.slice(0, 400) })
  }
}

/** Approva un carosello dell'autopilota (o qualsiasi bozza): esce al prossimo giro del cron. */
export async function approveCarousel(id: string, base?: string[]): Promise<PostDraft> {
  return schedulePostDraft(id, { scheduledAt: new Date().toISOString(), base, approve: true })
}

/** Riepilogo per la super chat. */
export async function libraryOverview() {
  const [photos, settings, state] = await Promise.all([listLibraryPhotos(), loadAutopilotSettings(), loadAutopilotState()])
  const now = Date.now()
  return {
    foto: photos.length,
    mai_usate: photos.filter((p) => !p.uses).length,
    usate_ultimi_14_giorni: photos.filter((p) => usedRecently(p, now)).length,
    limite: MAX_LIBRARY_PHOTOS,
    autopilota: describeAutopilot(settings),
    ultimi_giri: state.runs.slice(-5).map((r) => ({ uscita: r.key, stato: r.status, titolo: r.title, nota: r.note, draftId: r.draftId })),
  }
}
