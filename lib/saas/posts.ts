import sharp from 'sharp'
import { callAI, describeMedia, hasAIProvider } from '@/lib/ai'
import { createCarousel, createPhotoCarousel, fitPostPhoto, PALETTE_MIXES, type Cta, type Palette, type Slide } from '@/lib/blog-image'
import { generateGeminiImage, getGeminiApiKey } from '@/lib/gemini'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { workspaceDb, type WorkspaceDb } from '@/lib/workspace-db'
import { listConnections, type Connection } from './connections'
import { canPublish, publishFacebook, publishInstagram } from './publish'
import { readInstructions, workspaceName } from './responder'

// Post dei clienti: foto caricate (anche modificate con l'AI) o caroselli
// grafici con i loro colori, testi scritti dall'AI con il tono delle loro
// istruzioni, pubblicazione subito o programmata (giorno e ora) su Instagram e
// Facebook. Tabella workspace_posts, immagini nel bucket workspace-media.

export const MEDIA_BUCKET = 'workspace-media'
export type PostPlatform = 'instagram' | 'facebook'
export type PostStatus = 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled'

export type PostRow = {
  id: string
  workspace_id: string
  status: PostStatus
  kind: 'photos' | 'carousel'
  title: string | null
  caption: string
  facebook_text: string | null
  media: string[]
  platforms: PostPlatform[]
  publish_at: string | null
  results: { instagram?: string; facebook?: string; errors?: string[] }
  error_message: string | null
  created_at: string
  updated_at: string
}

export const POST_COLUMNS = 'id, workspace_id, status, kind, title, caption, facebook_text, media, platforms, publish_at, results, error_message, created_at, updated_at'

// --- Immagini --------------------------------------------------------------------

/** Solo immagini del nostro archivio (niente indirizzi arbitrari da scaricare). */
function isOurMedia(url: string): boolean {
  try {
    const base = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '')
    const u = new URL(url)
    return u.protocol === 'https:' && u.host === base.host && u.pathname.includes('/storage/v1/object/public/')
  } catch {
    return false
  }
}

async function download(url: string): Promise<Buffer> {
  if (!isOurMedia(url)) throw new Error('immagine non valida: usa le foto caricate qui')
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`immagine non scaricata (${res.status})`)
  return Buffer.from(await res.arrayBuffer())
}

/**
 * Salvataggio nell'archivio (bucket workspace-media) con una chiamata diretta:
 * cosi' si vede il codice e il testo della risposta se l'archivio rifiuta (prima
 * arrivava solo "Unexpected token '<'"). Se la prima prova fallisce si riprova
 * con la sola chiave nell'intestazione apikey (chiavi nuove sb_secret_).
 */
async function store(workspaceId: string, folder: string, jpeg: Buffer): Promise<string> {
  const path = `${workspaceId}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/+$/, '')
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  const url = `${base}/storage/v1/object/${MEDIA_BUCKET}/${path}`
  const attempt = async (headers: Record<string, string>) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'image/jpeg', 'x-upsert': 'false', 'cache-control': 'max-age=31536000' },
      body: new Uint8Array(jpeg),
      signal: AbortSignal.timeout(30_000),
    })
    if (res.ok) return null
    const text = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 220)
    return `HTTP ${res.status}: ${text}`
  }
  const first = await attempt({ apikey: key, Authorization: `Bearer ${key}` })
  if (first) {
    const second = await attempt({ apikey: key })
    if (second) {
      console.error(`archivio foto: caricamento rifiutato (${jpeg.length} byte) · ${first} · senza Authorization: ${second}`)
      throw new Error(`immagine non salvata (${first.slice(0, 80)})`)
    }
  }
  return `${base}/storage/v1/object/public/${MEDIA_BUCKET}/${path}`
}

/** Foto caricata dal cliente (data URL o file): JPEG orientato, lato lungo max 2000 px. */
export async function uploadWorkspaceImage(workspaceId: string, input: Buffer): Promise<string> {
  const jpeg = await sharp(input).rotate().resize(2000, 2000, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 88 }).toBuffer()
  return store(workspaceId, 'uploads', jpeg)
}

/** Modifica una foto con l'AI (es. "togli lo sfondo", "luce piu' calda", "aggiungi una scritta"). */
export async function editImage(workspaceId: string, url: string, instruction: string): Promise<string> {
  if (!getGeminiApiKey()) throw new Error('modifica delle immagini non disponibile (manca la chiave Gemini)')
  const original = await sharp(await download(url)).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer()
  const prompt = `Edit the attached photo following this instruction from a small business owner (in Italian): "${instruction.slice(0, 600)}".
Keep the same subject, people, products and composition unless the instruction asks otherwise. Photorealistic, high quality, suitable for an Instagram post.
If the instruction asks for text in the image, write it exactly as requested and spell it correctly; otherwise add no text, no logos and no watermarks.`
  const { imageUrl } = await generateGeminiImage(prompt, { mimeType: 'image/jpeg', data: original.toString('base64') })
  const base64 = imageUrl.replace(/^data:[^;]+;base64,/, '')
  if (!base64) throw new Error('l’AI non ha restituito l’immagine')
  const jpeg = await sharp(Buffer.from(base64, 'base64')).rotate().jpeg({ quality: 88 }).toBuffer()
  return store(workspaceId, 'edited', jpeg)
}

/** Immagine creata da zero dall'AI (es. "una foto di un piatto di pasta su un tavolo in terrazza"). */
export async function generateImage(workspaceId: string, description: string): Promise<string> {
  if (!getGeminiApiKey()) throw new Error('creazione delle immagini non disponibile (manca la chiave Gemini)')
  const { imageUrl } = await generateGeminiImage(
    `Photorealistic image for an Instagram post of a small business. ${description.slice(0, 800)}
Portrait 4:5. No text, no logos, no watermarks unless explicitly requested.`
  )
  const base64 = imageUrl.replace(/^data:[^;]+;base64,/, '')
  if (!base64) throw new Error('l’AI non ha restituito l’immagine')
  return store(workspaceId, 'generated', await sharp(Buffer.from(base64, 'base64')).jpeg({ quality: 88 }).toBuffer())
}

// --- Marchio del cliente ---------------------------------------------------------

export type WorkspaceBrand = { palette: Palette; handle: string; logo?: string | null }

const DEFAULT_PALETTE: Palette = { night: '#0f1218', navy: '#141922', deep: '#222a38', blue: '#3b82f6', blueLight: '#bfd4ff', ink: '#f7f7f2' }

const HEX = /^#?[0-9a-f]{6}$/i
const hex = (value: string) => (value.startsWith('#') ? value : `#${value}`).toLowerCase()
function mixHex(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16))
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('')}`
}

/** Palette completa da due colori: uno scuro (sfondi) e uno d'accento. */
export function paletteFrom(dark: string, accent: string, light?: string): Palette {
  const d = hex(dark)
  const a = hex(accent)
  return {
    night: mixHex(d, '#000000', 0.35),
    navy: mixHex(d, '#000000', 0.2),
    deep: d,
    blue: a,
    blueLight: light && HEX.test(light) ? hex(light) : mixHex(a, '#ffffff', 0.65),
    ink: '#f8f8f2',
  }
}

const brandKey = (workspaceId: string) => `ws_brand:${workspaceId}`

export async function workspaceBrand(workspaceId: string): Promise<WorkspaceBrand> {
  const [{ data }, connections] = await Promise.all([
    supabaseAdmin.from('app_settings').select('value').eq('key', brandKey(workspaceId)).maybeSingle(),
    listConnections(workspaceDb(workspaceId), 'instagram').catch(() => [] as Connection[]),
  ])
  let saved: Partial<WorkspaceBrand> = {}
  try {
    saved = data?.value ? JSON.parse(data.value) : {}
  } catch {}
  const username = (connections[0]?.meta as { username?: string } | undefined)?.username
  return {
    palette: { ...DEFAULT_PALETTE, ...(saved.palette || {}) },
    handle: saved.handle ?? (username ? `@${username}` : await workspaceName(workspaceId)),
    logo: saved.logo || null,
  }
}

export async function setWorkspaceBrand(workspaceId: string, input: { dark?: string; accent?: string; light?: string; handle?: string; logo?: string | null }) {
  const current = await workspaceBrand(workspaceId)
  const next: WorkspaceBrand = { ...current }
  if (input.dark && input.accent) {
    if (!HEX.test(input.dark) || !HEX.test(input.accent)) throw new Error('colori non validi: usa codici come #1a2b3c')
    next.palette = paletteFrom(input.dark, input.accent, input.light)
  }
  if (typeof input.handle === 'string') next.handle = input.handle.trim().slice(0, 40)
  if (input.logo === null || input.logo === '') next.logo = null
  else if (typeof input.logo === 'string') {
    if (!isOurMedia(input.logo)) throw new Error('logo non valido: caricalo qui in chat come immagine')
    next.logo = input.logo
  }
  const { error } = await supabaseAdmin
    .from('app_settings')
    .upsert({ key: brandKey(workspaceId), value: JSON.stringify(next), updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw new Error(`marchio non salvato: ${error.message}`)
  return next
}

// --- Lettura delle foto ---------------------------------------------------------

const PHOTO_PROMPT = `Descrivi questa foto in italiano, in una o due frasi asciutte, per chi deve scrivere un post social: cosa mostra (ambiente, stanza, oggetti, persone, prodotto, luogo), dettagli utili (es. "camera matrimoniale con armadio bianco", "bagno con doccia e mobile in legno", "giardino con palme", "terrazza con tavolo e vista mare") e il testo leggibile se c'e'. Niente commenti.`

/** Descrizione di ogni foto, una per una e nello stesso ordine (null se non riesce). */
export async function describePhotos(urls: string[]): Promise<(string | null)[]> {
  const out: (string | null)[] = new Array(urls.length).fill(null)
  let next = 0
  const worker = async () => {
    while (next < urls.length) {
      const k = next++
      try {
        const small = await sharp(await download(urls[k])).rotate().resize(768, 768, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer()
        out[k] = (await describeMedia([{ mimeType: 'image/jpeg', data: small.toString('base64') }], PHOTO_PROMPT, 'saas_lettura_foto')).replace(/\s+/g, ' ').trim().slice(0, 400) || null
      } catch {
        out[k] = null
      }
    }
  }
  await Promise.all([worker(), worker(), worker()])
  return out
}

const numbered = (notes: (string | null)[]) => notes.map((n, k) => `Foto ${k + 1}: ${n || '(descrizione non disponibile)'}`).join('\n')

// --- Testi dei post --------------------------------------------------------------

type Texts = { title: string; caption: string; facebook: string; hook: string; label: string; slides: Slide[]; cta: Cta }

const trim = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

async function writeTexts(workspaceId: string, brief: string, kind: 'photos' | 'carousel' | 'photo_carousel', photoNotes: string, photoCount: number): Promise<Texts> {
  const [name, instructions] = await Promise.all([workspaceName(workspaceId), readInstructions(workspaceId).catch(() => null)])
  const voice = [instructions?.general, instructions?.instagram].map((t) => t?.trim()).filter(Boolean).join('\n\n').slice(0, 4000)
  const system = `Sei il social media manager di "${name}". Prepari un post per Instagram e Facebook dalle indicazioni del titolare${photoCount ? ' e dalle sue foto (te ne do la descrizione)' : ''}.
${voice ? `Informazioni e tono dell'attività (dalle sue istruzioni):\n${voice}\n` : ''}
Regole:
- Usa solo le informazioni del titolare, delle sue istruzioni e di quello che si vede nelle foto: niente prezzi, date, offerte o promesse inventate.
- Scrivi nella lingua delle indicazioni del titolare (di solito italiano). Niente markdown.
- "caption": didascalia Instagram (max 1500 caratteri): prima riga che aggancia, 1-3 paragrafi brevi, invito all'azione, poi 4-8 hashtag pertinenti.
- "facebook": testo per Facebook (max 1000 caratteri), come la didascalia ma senza la fila di hashtag.
- "title": titolo interno breve.
${
  kind === 'photo_carousel'
    ? `- È un CAROSELLO FATTO CON LE SUE FOTO, una slide per foto, NELL'ORDINE ESATTO delle foto: "slides" deve avere ESATTAMENTE ${photoCount} elementi e l'elemento numero k parla della Foto k (guarda la sua descrizione). Se il titolare dice a cosa serve ogni foto ("la prima…", "la seconda…"), segui alla lettera le sue indicazioni per quella foto.
- La slide 1 è la copertina: "hook" è il gancio scritto in grande sopra la Foto 1 (max 40 caratteri, fortissimo, niente emoji) e slides[0].title è la riga piccola sotto il gancio (max 70 caratteri, slides[0].text vuoto).
- Le altre slide: "title" max 45 caratteri e "text" max 140 caratteri, testo che va SOPRA la foto: breve e leggibile.
- "label": etichetta sopra il gancio (max 26 caratteri, es. "NUOVO HOST") o "". "cta": lascialo vuoto salvo che il titolare chieda una slide finale.`
    : kind === 'carousel'
    ? `- È un CAROSELLO GRAFICO: "hook" (gancio della prima slide, max 42 caratteri, fortissimo, niente emoji), "label" (etichetta sopra il gancio, max 30 caratteri, o ""), "slides" da 2 a 6 (${photoCount ? `una per foto, nello stesso ordine, ${photoCount} in tutto, poi eventuali altre` : '3-4'}; "title" max 55 caratteri, "text" max 180), "cta" per l'ultima slide ("title" max 45, "text" max 140, "button" max 26).`
    : '- Post con le foto del titolare: lascia "hook", "label", "slides" e "cta" vuoti.'
}
Rispondi SOLO con JSON: {"title": "", "caption": "", "facebook": "", "hook": "", "label": "", "slides": [{"title": "", "text": ""}], "cta": {"title": "", "text": "", "button": ""}}`
  const result = await callAI(
    [{ role: 'user', content: [`Indicazioni del titolare: ${brief}`, photoCount ? `Le sue foto (${photoCount}, in quest'ordine):\n${photoNotes || '(descrizione non disponibile)'}` : ''].filter(Boolean).join('\n\n') }],
    system,
    { feature: 'saas_post', temperature: 0.6, maxOutputTokens: 2500, workspaceId }
  )
  const json = (result.message || '').match(/\{[\s\S]*\}/)?.[0]
  if (!json) throw new Error('l’AI non ha preparato i testi, riprova')
  const data = JSON.parse(json)
  const slides = (Array.isArray(data.slides) ? data.slides : [])
    .map((s: { title?: unknown; text?: unknown }) => ({ title: trim(s.title, 70), text: trim(s.text, 220) }))
    .filter((s: Slide) => kind === 'photo_carousel' || s.title)
    .slice(0, kind === 'photo_carousel' ? 10 : 8)
  const cta = data.cta || {}
  const caption = String(data.caption || '').trim().slice(0, 2200)
  if (!caption) throw new Error('l’AI non ha scritto la didascalia, riprova')
  return {
    title: trim(data.title, 120) || brief.slice(0, 80),
    caption,
    facebook: String(data.facebook || caption).trim().slice(0, 5000),
    hook: trim(data.hook, 60),
    label: trim(data.label, 34),
    slides,
    cta: { title: trim(cta.title, 60) || 'Ti aspettiamo', text: trim(cta.text, 160) || 'Scrivici in Direct per informazioni.', button: trim(cta.button, 30) || 'Scrivici' },
  }
}

// --- Creazione, modifica, programmazione -----------------------------------------

export type PhotoSlideInput = { title?: string; text?: string }

/** Come e' fatto un carosello con le foto: serve per rifarlo quando il cliente chiede modifiche. */
export type CarouselSource = {
  photos: string[]
  slides: { title: string; text: string }[]
  hook: string
  label: string
  closing: { title: string; text: string; button: string } | null
  mix: number
}

const sourceKey = (postId: string) => `ws_post_src:${postId}`

async function saveSource(postId: string, source: CarouselSource) {
  await supabaseAdmin
    .from('app_settings')
    .upsert({ key: sourceKey(postId), value: JSON.stringify(source), updated_at: new Date().toISOString() }, { onConflict: 'key' })
}

export async function loadSource(postId: string): Promise<CarouselSource | null> {
  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', sourceKey(postId)).maybeSingle()
  try {
    return data?.value ? (JSON.parse(data.value) as CarouselSource) : null
  } catch {
    return null
  }
}

async function renderPhotoCarousel(workspaceId: string, source: CarouselSource): Promise<string[]> {
  const brand = await workspaceBrand(workspaceId)
  return createPhotoCarousel({
    photos: source.photos,
    slides: source.slides,
    hook: source.hook,
    label: source.label,
    cta: source.closing,
    palette: brand.palette,
    handle: brand.handle,
    logo: brand.logo,
    mix: source.mix,
    storage: { bucket: MEDIA_BUCKET, folder: `${workspaceId}/posts` },
  })
}

/**
 * Crea un post in bozza.
 * - photos: le foto del cliente cosi' come sono (ritagliate 4:5, o intere su sfondo sfocato);
 * - carousel con foto: UNA SLIDE PER FOTO, nell'ordine in cui le ha caricate, testo sopra
 *   la foto e logo; slides (dall'assistente) = i testi esatti, uno per foto;
 * - carousel senza foto: slide grafiche con i suoi colori e immagini create dall'AI.
 */
export async function createPost(
  db: WorkspaceDb,
  input: {
    brief: string
    kind?: 'photos' | 'carousel'
    images?: string[]
    platforms?: PostPlatform[]
    aiImages?: boolean
    userId?: string | null
    /** Descrizioni gia' lette delle foto (stesso ordine): si evita di rileggerle. */
    photoNotes?: (string | null)[]
    /** Testi esatti delle slide, uno per foto e nello stesso ordine. */
    slides?: PhotoSlideInput[]
    hook?: string
    label?: string
    /** Slide finale di invito (solo se chiesta). */
    closing?: boolean
  }
): Promise<PostRow> {
  if (!hasAIProvider()) throw new Error('AI non configurata')
  const images = (input.images || []).filter(isOurMedia).slice(0, 10)
  const kind = input.kind || (images.length ? 'photos' : 'carousel')
  if (kind === 'photos' && !images.length) throw new Error('per un post con foto carica almeno una foto (o chiedi un carosello grafico)')

  const notes = images.length
    ? input.photoNotes?.length === images.length && input.photoNotes.every(Boolean)
      ? input.photoNotes
      : await describePhotos(images)
    : []
  const mode = kind === 'carousel' && images.length ? 'photo_carousel' : kind
  const texts = await writeTexts(db.workspaceId, input.brief, mode, numbered(notes), images.length)

  let media: string[]
  let source: CarouselSource | null = null
  if (mode === 'photos') {
    const fitted = await Promise.all(images.map(async (url) => fitPostPhoto(await download(url))))
    media = await Promise.all(fitted.map((jpeg) => store(db.workspaceId, 'posts', jpeg)))
  } else if (mode === 'photo_carousel') {
    // I testi dati dall'assistente (seguendo le indicazioni del cliente) vincono su quelli scritti qui.
    const given = input.slides || []
    const closing = input.closing && images.length < 10 ? texts.cta : null
    const photos = images.slice(0, closing ? 9 : 10)
    source = {
      photos,
      slides: photos.map((_, k) => ({
        title: trim(given[k]?.title ?? texts.slides[k]?.title ?? '', 90),
        text: trim(given[k]?.text ?? texts.slides[k]?.text ?? '', 220),
      })),
      hook: trim(input.hook || texts.hook || texts.title, 60),
      label: trim(input.label ?? texts.label, 30),
      closing,
      mix: Math.floor(Math.random() * PALETTE_MIXES),
    }
    media = await renderPhotoCarousel(db.workspaceId, source)
  } else {
    const brand = await workspaceBrand(db.workspaceId)
    const slides = texts.slides.length ? texts.slides : [{ title: texts.title, text: '' }]
    const carousel = await createCarousel(texts.title, slides, input.brief, null, {
      hook: texts.hook || texts.title,
      label: texts.label,
      cta: texts.cta,
      mix: Math.floor(Math.random() * PALETTE_MIXES),
      onlyMyImages: input.aiImages === false,
      palette: brand.palette,
      handle: brand.handle,
      subject: `a social media post of a small business ("${(await workspaceName(db.workspaceId)).slice(0, 60)}")`,
      storage: { bucket: MEDIA_BUCKET, folder: `${db.workspaceId}/posts` },
      imageSeconds: 90,
      maxSlides: 8,
    })
    media = carousel.urls
  }

  const { data, error } = await db
    .from('workspace_posts')
    .insert({
      status: 'draft',
      kind: mode === 'photos' ? 'photos' : 'carousel',
      title: texts.title,
      caption: texts.caption,
      facebook_text: texts.facebook,
      media,
      platforms: input.platforms?.length ? input.platforms : await defaultPlatforms(db),
      created_by: input.userId || null,
    })
    .select(POST_COLUMNS)
    .single()
  if (error || !data) throw new Error(`post non salvato: ${error?.message}`)
  if (source) await saveSource(data.id as string, source)
  return data as PostRow
}

/**
 * Modifica un carosello fatto con le foto e lo rifa': testi di singole slide
 * (numerate da 1), ordine delle foto, gancio, slide finale.
 */
export async function editCarousel(
  db: WorkspaceDb,
  id: string,
  changes: { slides?: { n: number; title?: string; text?: string }[]; order?: number[]; hook?: string; label?: string; closing?: boolean; remove?: number[] }
): Promise<PostRow> {
  const post = await getPost(db, id)
  if (!post) throw new Error('post non trovato')
  if (['publishing', 'published'].includes(post.status)) throw new Error('il post è già pubblicato')
  const source = await loadSource(id)
  if (!source) throw new Error('questo post non è un carosello con le foto: creane uno nuovo')
  let photos = [...source.photos]
  let slides = [...source.slides]
  for (const change of changes.slides || []) {
    const k = Math.round(change.n) - 1
    if (k < 0 || k >= slides.length) continue
    slides[k] = { title: typeof change.title === 'string' ? trim(change.title, 90) : slides[k].title, text: typeof change.text === 'string' ? trim(change.text, 220) : slides[k].text }
  }
  if (changes.remove?.length) {
    const drop = new Set(changes.remove.map((n) => Math.round(n) - 1))
    photos = photos.filter((_, k) => !drop.has(k))
    slides = slides.filter((_, k) => !drop.has(k))
  }
  if (changes.order?.length) {
    const order = changes.order.map((n) => Math.round(n) - 1)
    if (order.length !== photos.length || new Set(order).size !== photos.length || order.some((k) => k < 0 || k >= photos.length)) {
      throw new Error(`l'ordine deve contenere una volta ciascuno i numeri da 1 a ${photos.length}`)
    }
    photos = order.map((k) => photos[k])
    slides = order.map((k) => slides[k])
  }
  if (!photos.length) throw new Error('serve almeno una foto')
  const next: CarouselSource = {
    ...source,
    photos,
    slides,
    hook: typeof changes.hook === 'string' ? trim(changes.hook, 60) : source.hook,
    label: typeof changes.label === 'string' ? trim(changes.label, 30) : source.label,
    closing: changes.closing === false ? null : changes.closing === true && !source.closing ? { title: 'Ti aspettiamo', text: 'Scrivici in Direct per informazioni.', button: 'Scrivici' } : source.closing,
  }
  const media = await renderPhotoCarousel(db.workspaceId, next)
  await saveSource(id, next)
  return updatePost(db, id, { media })
}

/**
 * Si possono spostare o togliere le slide dall'anteprima?
 * - 'free': si' (foto senza scritte, o carosello con le foto senza slide finale);
 * - 'closing': si', ma l'ultima e' la slide finale e resta in fondo;
 * - null: no (carosello grafico: i numeri sono disegnati nelle immagini e non si rifa').
 */
export type ArrangeMode = 'free' | 'closing' | null

export async function arrangeModes(posts: { id: string; kind: string }[]): Promise<Map<string, ArrangeMode>> {
  const keys = posts.filter((p) => p.kind === 'carousel').map((p) => sourceKey(p.id))
  const { data } = keys.length ? await supabaseAdmin.from('app_settings').select('key, value').in('key', keys) : { data: [] }
  const sources = new Map<string, CarouselSource>()
  for (const row of data || []) {
    try {
      sources.set(row.key as string, JSON.parse(row.value as string) as CarouselSource)
    } catch {}
  }
  return new Map(
    posts.map((p) => {
      if (p.kind === 'photos') return [p.id, 'free']
      const source = sources.get(sourceKey(p.id))
      return [p.id, source ? (source.closing ? 'closing' : 'free') : null]
    })
  )
}

/**
 * Nuovo ordine delle slide dall'anteprima: sequence = numeri delle slide attuali
 * (da 1) nell'ordine voluto; quelle che mancano si tolgono. Nei caroselli con le
 * foto si rifanno le slide (numeri "02 / 05" giusti, la nuova prima diventa la
 * copertina con il gancio); la slide finale resta in fondo.
 */
export async function arrangeSlides(db: WorkspaceDb, id: string, sequence: number[]): Promise<PostRow> {
  const post = await getPost(db, id)
  if (!post) throw new Error('post non trovato')
  if (['publishing', 'published'].includes(post.status)) throw new Error('il post è già pubblicato')
  const total = post.media.length
  const seq = sequence.map((n) => Math.round(n) - 1)
  if (!seq.length || new Set(seq).size !== seq.length || seq.some((k) => !(k >= 0 && k < total))) {
    throw new Error(`ordine non valido: usa i numeri da 1 a ${total}, una volta ciascuno`)
  }
  if (seq.length === total && seq.every((k, j) => k === j)) return post
  const source = await loadSource(id)
  if (source) {
    const count = source.photos.length
    const kept = seq.filter((k) => k < count)
    if (!kept.length) throw new Error('serve almeno una foto')
    const remaining = source.photos.map((_, k) => k).filter((k) => kept.includes(k))
    return editCarousel(db, id, {
      remove: source.photos.map((_, k) => k).filter((k) => !kept.includes(k)).map((k) => k + 1),
      order: kept.map((k) => remaining.indexOf(k) + 1),
      closing: source.closing && !seq.includes(count) ? false : undefined,
    })
  }
  if (post.kind === 'photos') return updatePost(db, id, { media: seq.map((k) => post.media[k]) })
  throw new Error('in questo carosello grafico i numeri sono disegnati nelle immagini: per cambiare le slide chiedi all’assistente di rifarlo')
}

/**
 * Corregge con l'AI l'immagine di UNA slide (n da 1) e rifa' il post:
 * - carosello con le foto: si modifica la foto originale e si rifa' la slide con il suo testo;
 * - post con foto o carosello grafico: si modifica l'immagine della slide cosi' com'e'.
 */
export async function editSlidePhoto(db: WorkspaceDb, id: string, n: number, instruction: string): Promise<PostRow> {
  const post = await getPost(db, id)
  if (!post) throw new Error('post non trovato')
  if (['publishing', 'published'].includes(post.status)) throw new Error('il post è già pubblicato')
  const k = Math.round(n) - 1
  const source = await loadSource(id)
  if (source && k >= 0 && k < source.photos.length) {
    const edited = await editImage(db.workspaceId, source.photos[k], instruction)
    const next = { ...source, photos: source.photos.map((url, j) => (j === k ? edited : url)) }
    const media = await renderPhotoCarousel(db.workspaceId, next)
    await saveSource(id, next)
    return updatePost(db, id, { media })
  }
  if (k < 0 || k >= post.media.length) throw new Error(`il post ha ${post.media.length} immagini: scegli un numero da 1 a ${post.media.length}`)
  const edited = await editImage(db.workspaceId, post.media[k], instruction)
  const fitted = await store(db.workspaceId, 'posts', await fitPostPhoto(await download(edited)))
  return updatePost(db, id, { media: post.media.map((url, j) => (j === k ? fitted : url)) })
}

/** Testi attuali delle slide di un carosello con le foto (per l'assistente). */
export async function carouselOutline(id: string) {
  const source = await loadSource(id)
  if (!source) return null
  return {
    gancio: source.hook,
    etichetta: source.label,
    slide: source.slides.map((s, k) => ({ n: k + 1, titolo: k === 0 ? `(copertina) ${s.title}` : s.title, testo: s.text })),
    slide_finale: Boolean(source.closing),
  }
}

/** Social collegati dove il post puo' uscire (Instagram per primo). */
export async function defaultPlatforms(db: WorkspaceDb): Promise<PostPlatform[]> {
  const connections = (await listConnections(db).catch(() => [] as Connection[])).filter((c) => c.status === 'connected')
  const list = (['instagram', 'facebook'] as PostPlatform[]).filter((p) => connections.some((c) => c.platform === p))
  return list.length ? list : ['instagram']
}

export async function getPost(db: WorkspaceDb, id: string): Promise<PostRow | null> {
  const { data } = await db.from('workspace_posts').select(POST_COLUMNS).eq('id', id).maybeSingle()
  return (data as PostRow | null) ?? null
}

export async function listPosts(db: WorkspaceDb, options: { status?: PostStatus[]; limit?: number } = {}): Promise<PostRow[]> {
  let query = db.from('workspace_posts').select(POST_COLUMNS).order('created_at', { ascending: false }).limit(options.limit || 30)
  if (options.status?.length) query = query.in('status', options.status)
  const { data } = await query
  return (data || []) as PostRow[]
}

/** Modifica testi, social o immagini (prima della pubblicazione). */
export async function updatePost(db: WorkspaceDb, id: string, patch: { caption?: string; facebook?: string; platforms?: PostPlatform[]; media?: string[] }): Promise<PostRow> {
  const post = await getPost(db, id)
  if (!post) throw new Error('post non trovato')
  if (['publishing', 'published'].includes(post.status)) throw new Error('il post è già pubblicato o in pubblicazione')
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof patch.caption === 'string') update.caption = patch.caption.trim().slice(0, 2200)
  if (typeof patch.facebook === 'string') update.facebook_text = patch.facebook.trim().slice(0, 5000)
  if (patch.platforms) {
    const list = patch.platforms.filter((p) => p === 'instagram' || p === 'facebook')
    if (!list.length) throw new Error('scegli almeno Instagram o Facebook')
    update.platforms = list
  }
  if (patch.media) {
    const list = patch.media.filter(isOurMedia).slice(0, 10)
    if (!list.length) throw new Error('serve almeno un’immagine')
    update.media = list
  }
  const { data, error } = await db.from('workspace_posts').update(update).eq('id', id).select(POST_COLUMNS).single()
  if (error || !data) throw new Error(`post non aggiornato: ${error?.message}`)
  return data as PostRow
}

/** Programma il post (publishAt in UTC). */
export async function schedulePost(db: WorkspaceDb, id: string, publishAt: Date, platforms?: PostPlatform[]): Promise<PostRow> {
  if (Number.isNaN(publishAt.getTime())) throw new Error('data o ora non valida')
  if (publishAt.getTime() < Date.now() - 60_000) throw new Error('la data scelta è già passata')
  if (publishAt.getTime() > Date.now() + 75 * 86_400_000) throw new Error('si può programmare al massimo 75 giorni avanti')
  const post = await getPost(db, id)
  if (!post) throw new Error('post non trovato')
  if (['publishing', 'published'].includes(post.status)) throw new Error('il post è già pubblicato o in pubblicazione')
  await assertPublishable(db, platforms?.length ? platforms : post.platforms)
  const { data, error } = await db
    .from('workspace_posts')
    .update({ status: 'scheduled', publish_at: publishAt.toISOString(), error_message: null, ...(platforms?.length ? { platforms } : {}), updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(POST_COLUMNS)
    .single()
  if (error || !data) throw new Error(`post non programmato: ${error?.message}`)
  return data as PostRow
}

export async function cancelPost(db: WorkspaceDb, id: string): Promise<PostRow> {
  const { data, error } = await db
    .from('workspace_posts')
    .update({ status: 'draft', publish_at: null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .in('status', ['scheduled', 'failed'])
    .select(POST_COLUMNS)
    .maybeSingle()
  if (error || !data) throw new Error('post non trovato o non programmato')
  return data as PostRow
}

export async function deletePost(db: WorkspaceDb, id: string) {
  const { error } = await db.from('workspace_posts').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', id).neq('status', 'publishing')
  if (error) throw new Error(`post non eliminato: ${error.message}`)
}

async function accountFor(db: WorkspaceDb, platform: PostPlatform): Promise<Connection | null> {
  const list = (await listConnections(db, platform).catch(() => [] as Connection[])).filter((c) => c.status === 'connected')
  return list.find((c) => (platform === 'instagram' ? canPublish(c) : true)) || list[0] || null
}

async function assertPublishable(db: WorkspaceDb, platforms: PostPlatform[]) {
  for (const platform of platforms) {
    const account = await accountFor(db, platform)
    if (!account) throw new Error(`${platform === 'instagram' ? 'Instagram' : 'Facebook'} non è collegato`)
    if (platform === 'instagram' && !canPublish(account)) {
      throw new Error('per pubblicare su Instagram ricollega l’account dalla pagina Instagram e consenti la pubblicazione dei contenuti')
    }
  }
}

/** Pubblica adesso (o quando arriva l'ora, dal cron). Si pubblica solo dove non e' gia' uscito. */
export async function publishPost(db: WorkspaceDb, id: string): Promise<PostRow> {
  const { data: claimed } = await db
    .from('workspace_posts')
    .update({ status: 'publishing', updated_at: new Date().toISOString() })
    .eq('id', id)
    .in('status', ['draft', 'scheduled', 'failed'])
    .select(POST_COLUMNS)
    .maybeSingle()
  const post = claimed as PostRow | null
  if (!post) {
    const current = await getPost(db, id)
    if (!current) throw new Error('post non trovato')
    if (current.status === 'published') return current
    throw new Error('il post è già in pubblicazione')
  }
  const results: PostRow['results'] = { instagram: post.results?.instagram, facebook: post.results?.facebook, errors: [] }
  for (const platform of post.platforms) {
    if (results[platform]) continue
    try {
      const account = await accountFor(db, platform)
      if (!account) throw new Error('account non collegato')
      results[platform] =
        platform === 'instagram' ? await publishInstagram(account, post.media, post.caption) : await publishFacebook(account, post.media, post.facebook_text || post.caption)
    } catch (error) {
      results.errors!.push(`${platform === 'instagram' ? 'Instagram' : 'Facebook'}: ${error instanceof Error ? error.message : 'non riuscito'}`)
    }
  }
  const ok = post.platforms.every((p) => results[p])
  const { data } = await db
    .from('workspace_posts')
    .update({ status: ok ? 'published' : 'failed', results, error_message: results.errors?.length ? results.errors.join(' · ').slice(0, 1000) : null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(POST_COLUMNS)
    .single()
  console.log(`saas post ${id.slice(0, 8)} (spazio ${db.workspaceId.slice(0, 8)}): ${ok ? 'pubblicato' : `non riuscito: ${results.errors?.join(' | ')}`}`)
  return (data as PostRow) || { ...post, status: ok ? 'published' : 'failed', results }
}

/** Dal cron (ogni minuto): post programmati arrivati all'ora, pochi per volta. */
export async function publishDuePosts(max = 4): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('workspace_posts')
    .select('id, workspace_id')
    .eq('status', 'scheduled')
    .lte('publish_at', new Date().toISOString())
    .order('publish_at', { ascending: true })
    .limit(max)
  if (error) {
    if (!/workspace_posts|does not exist/i.test(error.message)) console.error('saas post programmati:', error.message)
    return 0
  }
  let done = 0
  for (const row of data || []) {
    await publishPost(workspaceDb(row.workspace_id as string), row.id as string).catch((e) => console.error('saas post programmato:', e instanceof Error ? e.message : e))
    done++
  }
  return done
}

// --- Ora italiana -----------------------------------------------------------------

/** "2026-11-07T18:30" (ora italiana) -> Date in UTC. */
export function romeLocalToDate(local: string): Date {
  const m = local.trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/)
  if (!m) return new Date(NaN)
  const [y, mo, d, h, mi] = m.slice(1).map(Number)
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  const offset = (at: number) => {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(at))
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute')) - at
  }
  let utc = guess - offset(guess)
  utc = guess - offset(utc)
  return new Date(utc)
}

export const romeLabel = (iso: string) =>
  new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
