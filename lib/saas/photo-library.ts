import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { readSetting, updateSetting } from '@/lib/settings-store'
import { LIBRARY_BATCH, LIBRARY_MAX, LIBRARY_MAX_MB } from './photo-library-shared'

// Libreria foto di uno spazio: fino a 200 foto caricate dal titolare (pagina Automazioni →
// Autopilota foto, o dall'Assistente con "aggiungi queste foto alla libreria") che l'AI usa
// per i caroselli dell'autopilota. Le foto stanno nell'archivio dello spazio (bucket
// workspace-media, cartella <spazio>/library; quelle mandate in chat restano in
// <spazio>/uploads): il browser le riduce e le carica direttamente con un indirizzo firmato
// (le funzioni di Vercel non accettano file grandi), poi le registra qui.
//
// In app_settings: "photo_library:<spazio>" = LibraryPhoto[] (descrizione letta dall'AI una
// volta sola e tenuta qui, quante volte e quando e' stata usata). Ogni modifica passa da
// updateSetting (salva solo se nessun altro ha salvato dopo la lettura).

export { LIBRARY_MAX, LIBRARY_BATCH, LIBRARY_MAX_MB }
export const MEDIA_BUCKET = 'workspace-media'
const MAX_BYTES = LIBRARY_MAX_MB * 1024 * 1024
const MAX_NOTE = 300
const TYPES: Record<string, 'jpg' | 'png' | 'webp'> = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

export type LibraryPhoto = {
  id: string
  url: string
  /** Nota o etichetta del titolare (es. "sala interna", "piatto del giorno"). */
  note: string
  /** Cosa mostra la foto, letta dall'AI una volta sola (null: non ancora letta). */
  description: string | null
  uses: number
  lastUsedAt: string | null
  /** Ultimi post in cui e' stata usata. */
  usedIn: string[]
  addedAt: string
  addedBy: string
  origin: 'page' | 'assistant'
}

export class LibraryError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
    this.name = 'LibraryError'
  }
}

export const libraryKey = (workspaceId: string) => `photo_library:${workspaceId}`

const supabaseBase = () => (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/+$/, '')

/** Percorso nell'archivio di una foto dello spazio (cartella library o uploads), o null. */
export function libraryPath(url: unknown): string | null {
  if (typeof url !== 'string') return null
  try {
    const base = new URL(supabaseBase())
    const u = new URL(url)
    const prefix = `/storage/v1/object/public/${MEDIA_BUCKET}/`
    if (u.protocol !== 'https:' || u.host !== base.host || !u.pathname.startsWith(prefix) || u.search) return null
    const path = decodeURIComponent(u.pathname.slice(prefix.length))
    return /^[0-9a-f-]{36}\/(library|uploads)\/[\w.-]+\.(jpe?g|png|webp)$/i.test(path) ? path : null
  } catch {
    return null
  }
}

/** Foto di QUESTO spazio (mai quelle di un altro: la cartella e' l'id dello spazio). */
export const isWorkspacePhoto = (workspaceId: string, url: unknown): boolean => libraryPath(url)?.startsWith(`${workspaceId}/`) === true

const parseJson = (raw: unknown): unknown => {
  if (typeof raw !== 'string') return raw ?? null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export const parseLibrary = (raw: unknown): LibraryPhoto[] => {
  const value = parseJson(raw)
  if (!Array.isArray(value)) return []
  return value
    .filter((p) => p && typeof p.id === 'string' && typeof p.url === 'string')
    .map((p) => ({
      id: p.id,
      url: p.url,
      note: typeof p.note === 'string' ? p.note : '',
      description: typeof p.description === 'string' && p.description ? p.description : null,
      uses: Number.isFinite(p.uses) && p.uses > 0 ? Math.floor(p.uses) : 0,
      lastUsedAt: typeof p.lastUsedAt === 'string' ? p.lastUsedAt : null,
      usedIn: Array.isArray(p.usedIn) ? p.usedIn.filter((x: unknown) => typeof x === 'string').slice(-5) : [],
      addedAt: typeof p.addedAt === 'string' ? p.addedAt : new Date(0).toISOString(),
      addedBy: typeof p.addedBy === 'string' ? p.addedBy : '',
      origin: p.origin === 'assistant' ? 'assistant' : 'page',
    }))
}

export async function loadLibrary(workspaceId: string): Promise<LibraryPhoto[]> {
  // Spazio sbagliato nel valore salvato (non dovrebbe succedere): quelle foto non si usano.
  return parseLibrary((await readSetting(libraryKey(workspaceId))).value).filter((p) => isWorkspacePhoto(workspaceId, p.url))
}

const cleanNote = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE) : '')

// --- Caricamento -----------------------------------------------------------------------

export type UploadRequest = { name?: unknown; type?: unknown; size?: unknown }
export type LibraryUpload = { uploadUrl: string; url: string; contentType: string }

/** Controlla le foto scelte (tipo, peso, quante ne entrano ancora): errore chiaro per il cliente. */
export function checkUploadFiles(files: unknown, current: number): { contentType: string; ext: string }[] {
  if (!Array.isArray(files) || !files.length) throw new LibraryError('Scegli almeno una foto.')
  if (files.length > LIBRARY_BATCH) throw new LibraryError(`Al massimo ${LIBRARY_BATCH} foto per volta.`)
  const room = LIBRARY_MAX - current
  if (room <= 0) throw new LibraryError(`La libreria è piena (${LIBRARY_MAX} foto): togline qualcuna prima.`)
  if (files.length > room) throw new LibraryError(`C’è posto ancora per ${room} foto (massimo ${LIBRARY_MAX}).`)
  return files.map((raw: UploadRequest) => {
    const type = typeof raw?.type === 'string' ? raw.type.trim().toLowerCase() : ''
    const size = Number(raw?.size)
    const ext = TYPES[type]
    if (!ext) throw new LibraryError('Formato non supportato: carica foto JPG, PNG o WEBP.')
    if (!Number.isFinite(size) || size <= 0) throw new LibraryError('Una delle foto è vuota o non leggibile.')
    if (size > MAX_BYTES) throw new LibraryError(`Una foto supera ${LIBRARY_MAX_MB} MB anche dopo la riduzione.`)
    return { contentType: type === 'image/jpg' ? 'image/jpeg' : type, ext }
  })
}

/** Indirizzi firmati per caricare le foto dal browser direttamente nella cartella dello spazio. */
export async function createLibraryUploads(workspaceId: string, files: unknown): Promise<LibraryUpload[]> {
  const current = (await loadLibrary(workspaceId)).length
  const checked = checkUploadFiles(files, current)
  const base = supabaseBase()
  return Promise.all(
    checked.map(async ({ contentType, ext }) => {
      const path = `${workspaceId}/library/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`
      const { data, error } = await supabaseAdmin.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path)
      if (error || !data?.signedUrl) throw new Error(`caricamento non preparato: ${error?.message || 'nessun indirizzo'}`)
      return { uploadUrl: data.signedUrl, url: `${base}/storage/v1/object/public/${MEDIA_BUCKET}/${path}`, contentType }
    })
  )
}

/** La foto c'e' davvero nell'archivio, e' un'immagine ed e' entro il limite? */
async function uploadedOk(url: string): Promise<string | null> {
  const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15_000) }).catch(() => null)
  if (!res?.ok) return 'non arrivata nell’archivio'
  const size = Number(res.headers.get('content-length') || 0)
  if (size > MAX_BYTES) return `supera ${LIBRARY_MAX_MB} MB`
  const type = (res.headers.get('content-type') || '').toLowerCase()
  if (type && !type.startsWith('image/')) return 'non è un’immagine'
  return null
}

export type AddResult = { added: LibraryPhoto[]; skipped: { url: string; reason: string }[]; total: number }

/**
 * Registra nella libreria foto gia' caricate nell'archivio dello spazio (dalla pagina o mandate
 * in chat). Solo foto di questo spazio, una volta sola, al massimo 200 in tutto.
 */
export async function addLibraryPhotos(
  workspaceId: string,
  userId: string,
  items: { url: unknown; note?: unknown }[],
  options: { origin?: 'page' | 'assistant'; verify?: boolean; now?: number } = {}
): Promise<AddResult> {
  const skipped: AddResult['skipped'] = []
  const seen = new Set<string>()
  const wanted: { url: string; note: string }[] = []
  for (const item of items.slice(0, LIBRARY_MAX)) {
    const url = typeof item?.url === 'string' ? item.url.trim() : ''
    if (!isWorkspacePhoto(workspaceId, url)) {
      skipped.push({ url: String(url).slice(0, 300), reason: 'foto non valida: caricala da qui' })
      continue
    }
    if (seen.has(url)) continue
    seen.add(url)
    wanted.push({ url, note: cleanNote(item.note) })
  }
  const verified: { url: string; note: string }[] = []
  if (options.verify === false) verified.push(...wanted)
  else {
    const checks = await Promise.all(wanted.map((w) => uploadedOk(w.url)))
    wanted.forEach((w, k) => (checks[k] ? skipped.push({ url: w.url, reason: checks[k]! }) : verified.push(w)))
  }
  const at = new Date(options.now ?? Date.now()).toISOString()
  const out: { added: LibraryPhoto[]; full: number; dup: string[]; total: number } = { added: [], full: 0, dup: [], total: 0 }
  await updateSetting<LibraryPhoto[]>(libraryKey(workspaceId), parseLibrary, (current) => {
    out.added = []
    out.full = 0
    out.dup = []
    const urls = new Set(current.map((p) => p.url))
    const next = [...current]
    for (const w of verified) {
      if (urls.has(w.url)) {
        out.dup.push(w.url)
        continue
      }
      if (next.length >= LIBRARY_MAX) {
        out.full++
        continue
      }
      const photo: LibraryPhoto = { id: randomUUID(), url: w.url, note: w.note, description: null, uses: 0, lastUsedAt: null, usedIn: [], addedAt: at, addedBy: userId, origin: options.origin || 'page' }
      next.push(photo)
      out.added.push(photo)
      urls.add(w.url)
    }
    out.total = next.length
    return out.added.length ? next : false
  })
  for (const url of out.dup) skipped.push({ url, reason: 'già nella libreria' })
  if (out.full) skipped.push({ url: '', reason: `${out.full} foto non aggiunte: la libreria è piena (${LIBRARY_MAX})` })
  if (!out.added.length) out.total = (await loadLibrary(workspaceId)).length
  return { added: out.added, skipped, total: out.total }
}

/** Nota del titolare su una foto. */
export async function updateLibraryPhoto(workspaceId: string, id: string, input: { note?: unknown }): Promise<LibraryPhoto> {
  const out: { photo: LibraryPhoto | null } = { photo: null }
  await updateSetting<LibraryPhoto[]>(libraryKey(workspaceId), parseLibrary, (current) => {
    const index = current.findIndex((p) => p.id === id)
    out.photo = null
    if (index < 0) return false
    const next = [...current]
    next[index] = { ...current[index], note: cleanNote(input.note) }
    out.photo = next[index]
    return next
  })
  if (!out.photo) throw new LibraryError('Foto non trovata.', 404)
  return out.photo
}

/**
 * Toglie foto dalla libreria. Il file si cancella dall'archivio solo se la foto non e' mai stata
 * usata ed era stata caricata nella libreria (un carosello in bozza puo' ancora servirsene).
 */
export async function removeLibraryPhotos(workspaceId: string, ids: unknown): Promise<number> {
  const wanted = new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [])
  if (!wanted.size) throw new LibraryError('Scegli le foto da togliere.')
  const out: { removed: LibraryPhoto[] } = { removed: [] }
  await updateSetting<LibraryPhoto[]>(libraryKey(workspaceId), parseLibrary, (current) => {
    out.removed = current.filter((p) => wanted.has(p.id))
    return out.removed.length ? current.filter((p) => !wanted.has(p.id)) : false
  })
  const files = out.removed
    .filter((p) => !p.uses)
    .map((p) => libraryPath(p.url))
    .filter((path): path is string => Boolean(path && path.startsWith(`${workspaceId}/library/`)))
  if (files.length) {
    await supabaseAdmin.storage
      .from(MEDIA_BUCKET)
      .remove(files)
      .catch(() => null)
  }
  return out.removed.length
}

/** Descrizioni lette dall'AI (id -> testo): si salvano una volta sola. */
export async function saveLibraryDescriptions(workspaceId: string, descriptions: Map<string, string>): Promise<void> {
  if (!descriptions.size) return
  await updateSetting<LibraryPhoto[]>(libraryKey(workspaceId), parseLibrary, (current) => {
    let changed = false
    const next = current.map((p) => {
      const text = descriptions.get(p.id)
      if (!text || p.description) return p
      changed = true
      return { ...p, description: text.slice(0, 400) }
    })
    return changed ? next : false
  })
}

/** Foto usate in un post: una volta in piu', con la data e il post. */
export async function recordLibraryUse(workspaceId: string, ids: string[], postId: string, now = Date.now()): Promise<void> {
  const used = new Set(ids)
  if (!used.size) return
  const at = new Date(now).toISOString()
  await updateSetting<LibraryPhoto[]>(libraryKey(workspaceId), parseLibrary, (current) => {
    let changed = false
    const next = current.map((p) => {
      if (!used.has(p.id) || p.usedIn.includes(postId)) return p
      changed = true
      return { ...p, uses: p.uses + 1, lastUsedAt: at, usedIn: [...p.usedIn, postId].slice(-5) }
    })
    return changed ? next : false
  })
}

/** Foto della libreria per la pagina (le piu' recenti prima). */
export const libraryView = (photos: LibraryPhoto[]) =>
  [...photos].reverse().map((p) => ({ id: p.id, url: p.url, note: p.note, described: Boolean(p.description), uses: p.uses, lastUsedAt: p.lastUsedAt, addedAt: p.addedAt }))
