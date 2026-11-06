import sharp from 'sharp'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { fontPreset } from '@/lib/font-presets'
import { callAI, describeMedia, hasAIProvider } from '@/lib/ai'
import { assertAIAllowed } from '@/lib/usage-limits'
import { asPhotoLayout, asTextLayout, checkFont, createPhotoCarousel, fitPostPhoto, PALETTE_MIXES, PHOTO_LAYOUTS, TEXT_LAYOUTS, type Cta, type Palette, type PhotoLayout, type Slide, type TextLayout } from '@/lib/blog-image'
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
async function store(workspaceId: string, folder: string, jpeg: Buffer, kind: 'jpg' | 'png' = 'jpg'): Promise<string> {
  const path = `${workspaceId}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${kind}`
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/+$/, '')
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  const url = `${base}/storage/v1/object/${MEDIA_BUCKET}/${path}`
  const attempt = async (headers: Record<string, string>) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': kind === 'png' ? 'image/png' : 'image/jpeg', 'x-upsert': 'false', 'cache-control': 'max-age=31536000' },
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

/**
 * Immagine presa dal web (locandina di un evento o foto libera di Wikimedia Commons):
 * rifatta come JPEG pulito (niente metadati), lato lungo max 2000 px, nello stesso
 * archivio delle foto caricate (cartella "web" dello spazio).
 */
export async function storeWebImage(workspaceId: string, input: Buffer): Promise<string> {
  const jpeg = await sharp(input, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 88 })
    .toBuffer()
  return store(workspaceId, 'web', jpeg)
}

/**
 * Immagine dall'AI di Gemini (l'unica che crea e modifica le foto): sul piano gratuito
 * a volte risponde "limite di richieste al minuto". Si aspetta e si riprova da soli
 * (fino a due volte, circa un minuto) invece di far fallire la correzione.
 */
async function geminiImage(prompt: string, reference?: { mimeType: string; data: string }) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await generateGeminiImage(prompt, reference)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!/rate limit|429|limiti di richieste|resource.?exhausted/i.test(message)) throw error
      if (attempt >= 2) throw new Error('il servizio che modifica le foto è al limite di richieste per adesso: riprova tra qualche minuto')
      console.warn(`saas immagine: limite di Gemini, riprovo tra ${attempt ? 40 : 20} secondi`)
      await new Promise((r) => setTimeout(r, attempt ? 40_000 : 20_000))
    }
  }
}

/** Modifica una foto con l'AI (es. "togli lo sfondo", "luce piu' calda", "aggiungi una scritta"). */
export async function editImage(workspaceId: string, url: string, instruction: string): Promise<string> {
  if (!getGeminiApiKey()) throw new Error('modifica delle immagini non disponibile (manca la chiave Gemini)')
  await assertAIAllowed(workspaceId)
  const original = await sharp(await download(url)).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer()
  const prompt = `Edit the attached photo following this instruction from a small business owner (in Italian): "${instruction.slice(0, 600)}".
Keep the same subject, people, products and composition unless the instruction asks otherwise. Photorealistic, high quality, suitable for an Instagram post.
If the instruction asks for text in the image, write it exactly as requested and spell it correctly; otherwise add no text, no logos and no watermarks.`
  const { imageUrl } = await geminiImage(prompt, { mimeType: 'image/jpeg', data: original.toString('base64') })
  const base64 = imageUrl.replace(/^data:[^;]+;base64,/, '')
  if (!base64) throw new Error('l’AI non ha restituito l’immagine')
  const jpeg = await sharp(Buffer.from(base64, 'base64')).rotate().jpeg({ quality: 88 }).toBuffer()
  return store(workspaceId, 'edited', jpeg)
}

/** Immagine creata da zero dall'AI (es. "una foto di un piatto di pasta su un tavolo in terrazza"). */
export async function generateImage(workspaceId: string, description: string): Promise<string> {
  if (!getGeminiApiKey()) throw new Error('creazione delle immagini non disponibile (manca la chiave Gemini)')
  await assertAIAllowed(workspaceId)
  const { imageUrl } = await geminiImage(
    `Photorealistic image for an Instagram post of a small business. ${description.slice(0, 800)}
Portrait 4:5. No text, no logos, no watermarks unless explicitly requested.`
  )
  const base64 = imageUrl.replace(/^data:[^;]+;base64,/, '')
  if (!base64) throw new Error('l’AI non ha restituito l’immagine')
  return store(workspaceId, 'generated', await sharp(Buffer.from(base64, 'base64')).jpeg({ quality: 88 }).toBuffer())
}

// --- Marchio del cliente ---------------------------------------------------------

/**
 * Font del marchio: nome mostrato e, per un font caricato, la chiave in app_settings dove
 * sta il file (base64); per un font della lista, il suo id (file in lib/fonts/presets).
 */
export type BrandFont = { name: string; key?: string; preset?: string }
export type WorkspaceBrand = { palette: Palette; handle: string; logo?: string | null; fonts?: { heading?: BrandFont | null; body?: BrandFont | null } }

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
    fonts: saved.fonts || {},
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

const fontId = (f?: BrandFont | null) => f?.key || (f?.preset ? `preset:${f.preset}` : '')
const brandSignature = (b: WorkspaceBrand) => JSON.stringify([b.palette, b.handle, b.logo || '', fontId(b.fonts?.heading), fontId(b.fonts?.body)])

const fontCache = new Map<string, Buffer>()
/** File del font: per quelli della lista il grassetto (titoli) o il normale (testi). */
async function loadFont(font: BrandFont | null | undefined, role: 'heading' | 'body'): Promise<Buffer | null> {
  if (font?.preset && fontPreset(font.preset)) {
    const id = `preset:${font.preset}:${role}`
    if (!fontCache.has(id)) fontCache.set(id, await readFile(join(process.cwd(), 'lib', 'fonts', 'presets', `${font.preset}-${role === 'heading' ? 'bold' : 'regular'}.woff`)))
    return fontCache.get(id)!
  }
  if (!font?.key) return null
  if (fontCache.has(font.key)) return fontCache.get(font.key)!
  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', font.key).maybeSingle()
  if (!data?.value) return null
  const buffer = Buffer.from(data.value, 'base64')
  fontCache.set(font.key, buffer)
  return buffer
}

/** Font della lista (o null = predefinito) per i titoli o per i testi. */
export async function setBrandPresetFont(workspaceId: string, role: 'heading' | 'body', presetId: string | null) {
  const preset = presetId ? fontPreset(presetId) : null
  if (presetId && !preset) throw new Error('font non trovato nella lista')
  const current = await workspaceBrand(workspaceId)
  return saveBrand(workspaceId, { ...current, fonts: { ...(current.fonts || {}), [role]: preset ? { name: preset.label, preset: preset.id } : null } })
}

/** Logo del marchio: PNG con la trasparenza (niente riquadro bianco), lato lungo max 800 px. */
export async function setBrandLogo(workspaceId: string, input: Buffer) {
  const png = await sharp(input, { density: 300 }).rotate().resize(800, 800, { fit: 'inside', withoutEnlargement: true }).png().toBuffer()
  const url = await store(workspaceId, 'brand', png, 'png')
  return setWorkspaceBrand(workspaceId, { logo: url })
}

/**
 * Font del marchio (.ttf, .otf o .woff) per i titoli, i testi o tutti e due. Il file sta
 * in app_settings (base64): l'archivio delle foto potrebbe accettare solo immagini.
 */
export async function setBrandFont(workspaceId: string, role: 'heading' | 'body' | 'both', name: string, data: Buffer) {
  if (data.length > 3_000_000) throw new Error('il font è troppo pesante (massimo 3 MB)')
  const magic = data.subarray(0, 4).toString('latin1')
  if (magic === 'wOF2') throw new Error('i font .woff2 non si possono usare: carica la versione .ttf, .otf o .woff')
  if (!['\x00\x01\x00\x00', 'true', 'OTTO', 'wOFF'].includes(magic)) throw new Error('file non riconosciuto: carica un font .ttf, .otf o .woff')
  await checkFont(data).catch(() => {
    throw new Error('questo font non si riesce a usare: prova la versione .ttf o .otf')
  })
  const key = `ws_font:${workspaceId}:${Date.now().toString(36)}`
  const { error } = await supabaseAdmin.from('app_settings').upsert({ key, value: data.toString('base64'), updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw new Error(`font non salvato: ${error.message}`)
  const font: BrandFont = { name: name.replace(/\.(ttf|otf|woff)$/i, '').slice(0, 60) || 'Font', key }
  const current = await workspaceBrand(workspaceId)
  const fonts = { ...(current.fonts || {}), ...(role === 'heading' || role === 'both' ? { heading: font } : {}), ...(role === 'body' || role === 'both' ? { body: font } : {}) }
  return saveBrand(workspaceId, { ...current, fonts })
}

export async function removeBrandFont(workspaceId: string, role: 'heading' | 'body') {
  const current = await workspaceBrand(workspaceId)
  return saveBrand(workspaceId, { ...current, fonts: { ...(current.fonts || {}), [role]: null } })
}

async function saveBrand(workspaceId: string, brand: WorkspaceBrand) {
  const { error } = await supabaseAdmin
    .from('app_settings')
    .upsert({ key: brandKey(workspaceId), value: JSON.stringify(brand), updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw new Error(`marchio non salvato: ${error.message}`)
  return brand
}

// --- Lettura delle foto ---------------------------------------------------------

const PHOTO_PROMPT = `Descrivi questa foto in italiano, in una o due frasi asciutte, per chi deve scrivere un post social: cosa mostra (ambiente, stanza, oggetti, persone, prodotto, luogo), dettagli utili (es. "camera matrimoniale con armadio bianco", "bagno con doccia e mobile in legno", "giardino con palme", "terrazza con tavolo e vista mare") e il testo leggibile se c'e'. Niente commenti.`

/** Descrizione di ogni foto, una per una e nello stesso ordine (null se non riesce). */
export async function describePhotos(urls: string[], workspaceId?: string): Promise<(string | null)[]> {
  const out: (string | null)[] = new Array(urls.length).fill(null)
  let next = 0
  const worker = async () => {
    while (next < urls.length) {
      const k = next++
      try {
        const small = await sharp(await download(urls[k])).rotate().resize(768, 768, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer()
        out[k] = (await describeMedia([{ mimeType: 'image/jpeg', data: small.toString('base64') }], PHOTO_PROMPT, 'saas_lettura_foto', workspaceId)).replace(/\s+/g, ' ').trim().slice(0, 400) || null
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

/**
 * Le istruzioni del cliente (pagina Istruzioni: per tutti i canali + Instagram) come
 * unica fonte per i testi dei post e delle slide, in ogni chiamata che scrive testi.
 */
export async function businessContext(workspaceId: string, max = 12000): Promise<string> {
  const instructions = await readInstructions(workspaceId).catch(() => null)
  const text = [instructions?.general, instructions?.instagram].map((t) => t?.trim()).filter(Boolean).join('\n\n').slice(0, max)
  return text
    ? `Informazioni sull'attività (dalla pagina Istruzioni del titolare): sono l'UNICA fonte per i contenuti. Usa i termini come li definisce lui (es. ruoli, servizi, nomi di funzioni) e non inventare servizi, funzioni, pagine, numeri o promesse che qui non ci sono.\n${text}\n`
    : ''
}

/** Instagram accetta al massimo 5 hashtag per post: si tengono i primi 5, gli altri si tolgono. */
export function limitHashtags(text: string, max = 5): string {
  let seen = 0
  const out = text.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, (match) => (++seen <= max ? match : ''))
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim()
}

/**
 * Didascalia cambiata con l'AI dall'anteprima (es. "traduci in inglese", "piu' corta"):
 * una sola chiamata breve che vede solo la didascalia, niente chat e niente slide.
 */
export async function editCaption(db: WorkspaceDb, id: string, instruction: string): Promise<{ post: PostRow; done: string[] }> {
  const request = instruction.trim().slice(0, 600)
  if (!request) throw new Error('scrivi cosa cambiare nella didascalia')
  const post = await getPost(db, id)
  if (!post) throw new Error('post non trovato')
  if (['publishing', 'published'].includes(post.status)) throw new Error('il post è già pubblicato')
  const result = await callAI(
    [{ role: 'user', content: `Didascalia Instagram attuale:\n${post.caption}\n\nTesto Facebook attuale:\n${post.facebook_text || post.caption}\n\nRichiesta: ${request}` }],
    `${await businessContext(db.workspaceId)}Cambi SOLO la didascalia di un post seguendo la richiesta (es. traduzione, piu' corta, altro tono). Mantieni il senso, gli emoji e i link come sono, salvo che la richiesta dica altro; niente informazioni inventate. Al massimo 5 hashtag (adattati se traduci). "facebook" e' lo stesso testo senza la fila di hashtag. Niente markdown.
Rispondi SOLO con JSON: {"didascalia": "", "facebook": ""}`,
    { feature: 'saas_didascalia', temperature: 0.3, maxOutputTokens: 1800, workspaceId: db.workspaceId }
  )
  let data: { didascalia?: unknown; facebook?: unknown } = {}
  try {
    data = JSON.parse((result.message || '').match(/\{[\s\S]*\}/)?.[0] || '{}')
  } catch {}
  const caption = typeof data.didascalia === 'string' ? data.didascalia.trim() : ''
  if (!caption) throw new Error('l’AI non ha riscritto la didascalia, riprova')
  const facebook = typeof data.facebook === 'string' && data.facebook.trim() ? data.facebook.trim() : caption
  return { post: await updatePost(db, id, { caption, facebook }), done: ['didascalia cambiata (Instagram e Facebook)'] }
}

type Texts = { title: string; caption: string; facebook: string; hook: string; label: string; slides: Slide[]; cta: Cta }

const trim = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

async function writeTexts(
  workspaceId: string,
  brief: string,
  kind: 'photos' | 'carousel' | 'photo_carousel',
  photoNotes: string,
  photoCount: number,
  /** Carosello di solo testo: slide di contenuto chieste (senza copertina e slide finale). */
  contentCount?: number
): Promise<Texts> {
  const [name, context] = await Promise.all([workspaceName(workspaceId), businessContext(workspaceId)])
  const system = `Sei il social media manager di "${name}". Prepari un post per Instagram e Facebook dalle indicazioni del titolare${photoCount ? ' e dalle sue foto (te ne do la descrizione)' : ''}.
${context}
Regole:
- Usa solo le informazioni del titolare, delle sue istruzioni e di quello che si vede nelle foto: niente prezzi, date, offerte o promesse inventate.
- Scrivi nella lingua delle indicazioni del titolare (di solito italiano). Niente markdown.
- "caption": didascalia Instagram (max 1500 caratteri): prima riga che aggancia, 1-3 paragrafi brevi, invito all'azione, poi AL MASSIMO 5 hashtag pertinenti (Instagram non ne accetta di piu').
- "facebook": testo per Facebook (max 1000 caratteri), come la didascalia ma senza la fila di hashtag.
- "title": titolo interno breve.
${
  kind === 'photo_carousel'
    ? `- È un CAROSELLO FATTO CON LE SUE FOTO, una slide per foto, NELL'ORDINE ESATTO delle foto: "slides" deve avere ESATTAMENTE ${photoCount} elementi e l'elemento numero k parla della Foto k (guarda la sua descrizione). Se il titolare dice a cosa serve ogni foto ("la prima…", "la seconda…"), segui alla lettera le sue indicazioni per quella foto.
- La slide 1 è la copertina: "hook" è il gancio scritto in grande sopra la Foto 1 (max 40 caratteri, fortissimo, niente emoji) e slides[0].title è la riga piccola sotto il gancio (max 70 caratteri, slides[0].text vuoto).
- Le altre slide: "title" max 45 caratteri e "text" max 140 caratteri, testo che va SOPRA la foto: breve e leggibile.
- "label": etichetta sopra il gancio (max 26 caratteri, es. "NUOVO HOST") o "". "cta": lascialo vuoto salvo che il titolare chieda una slide finale.`
    : kind === 'carousel'
    ? `- È un CAROSELLO GRAFICO: "hook" (gancio della prima slide, max 42 caratteri, fortissimo, niente emoji), "label" (etichetta sopra il gancio, max 30 caratteri, o ""), ${
        contentCount !== undefined
          ? `"slides" ESATTAMENTE ${contentCount} slide di contenuto (la copertina con il gancio e la slide finale "cta" sono a parte: in tutto ${contentCount + 2} slide)`
          : `"slides" da 2 a 6 (${photoCount ? `una per foto, nello stesso ordine, ${photoCount} in tutto, poi eventuali altre` : '3-4'})`
      } ("title" max 55 caratteri, "text" max 180), "cta" per l'ultima slide ("title" max 45, "text" max 140, "button" max 26).`
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
  const caption = limitHashtags(String(data.caption || '').trim()).slice(0, 2200)
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

export type PhotoSlideInput = {
  title?: string
  text?: string
  /** Credito della foto scritto piccolo in fondo alla slide (es. "Foto: comune.palermo.it"). */
  credit?: string
  /** Pagina da cui viene la foto (immagini prese dal web): mostrata come fonte sotto l'anteprima. */
  source?: string
}

/** Slide di un carosello salvato: testi, credito della foto e pagina da cui viene (se presa dal web). */
export type SourceSlide = { title: string; text: string; credit?: string; source?: string }

const MIN_SLIDES = 2
const MAX_SLIDES = 10

/** Numero di slide chiesto (copertina e slide finale comprese), da 2 a 10, o undefined. */
export function slideTotal(value: unknown): number | undefined {
  const n = typeof value === 'string' && value.trim() ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.min(MAX_SLIDES, Math.max(MIN_SLIDES, Math.round(n))) : undefined
}

/** Credito e fonte di una slide (solo se ci sono), puliti. */
function creditOf(x: PhotoSlideInput | SourceSlide | undefined): Pick<SourceSlide, 'credit' | 'source'> {
  const credit = trim(x?.credit, 90)
  let source = ''
  try {
    const url = x?.source ? new URL(x.source) : null
    if (url && (url.protocol === 'https:' || url.protocol === 'http:')) source = url.href.slice(0, 500)
  } catch {}
  return { ...(credit ? { credit } : {}), ...(source ? { source } : {}) }
}

/** Nome del sito senza "www." (per le fonti). */
const siteOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

/**
 * Didascalia con la riga "Fonti: sito1, sito2" (immagini e notizie prese dal web): prima
 * della fila di hashtag finale; se c'e' gia' una riga "Fonti:" si completa quella.
 */
export function withSourcesLine(text: string, sites: string[]): string {
  const list = [...new Set(sites.map((d) => d.trim().toLowerCase()).filter(Boolean))].slice(0, 8)
  if (!list.length || list.every((d) => text.toLowerCase().includes(d))) return text
  const line = `Fonti: ${list.join(', ')}`
  if (/^[ \t]*fonti[ \t]*:.*$/im.test(text)) return text.replace(/^[ \t]*fonti[ \t]*:.*$/im, line)
  const tags = text.match(/\n\s*((?:#[\p{L}\p{N}_]+[ \t]*)+)\s*$/u)
  return tags && tags.index !== undefined ? `${text.slice(0, tags.index).trimEnd()}\n\n${line}\n\n${tags[1].trim()}` : `${text.trimEnd()}\n\n${line}`
}

/** Come e' fatto un carosello con le foto: serve per rifarlo quando il cliente chiede modifiche. */
export type CarouselSource = {
  photos: string[]
  slides: SourceSlide[]
  hook: string
  label: string
  closing: { title: string; text: string; button: string } | null
  mix: number
  /** Versione della grafica con cui sono state fatte le slide (vedi SLIDE_STYLE). */
  style?: number
  /** Numero della slide in alto a destra ("03 / 08"): false se il cliente l'ha tolto. */
  counter?: boolean
  /** Stile delle slide (Classico, Fascia, Cornice, Minimal, Diviso). */
  layout?: PhotoLayout
  /** Stile delle slide senza foto (Grande titolo, Lista, Citazione). */
  textLayout?: TextLayout
  /** Marchio con cui sono state fatte le slide (vedi brandSignature). */
  brand?: string
}

/**
 * Versione della grafica delle slide con le foto. 2 = ombra sempre scura sotto il testo
 * (con il tema chiaro veniva bianca e il testo non si leggeva). Un carosello fatto con una
 * grafica vecchia, alla prima modifica, si rifa' tutto: mai slide con grafiche diverse.
 */
export const SLIDE_STYLE = 2

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

/** keep: file delle slide da tenere identiche (stesso indice), null = da rifare. */
async function renderPhotoCarousel(workspaceId: string, source: CarouselSource, keep?: (string | null)[]): Promise<string[]> {
  const brand = await workspaceBrand(workspaceId)
  // Grafica vecchia o marchio cambiato (logo, colori, font, firma): si rifanno tutte le
  // slide, cosi' non ci sono mai slide diverse nello stesso carosello.
  const sig = brandSignature(brand)
  const outdated = (source.style ?? 1) < SLIDE_STYLE || Boolean(source.brand && source.brand !== sig)
  source.style = SLIDE_STYLE
  source.brand = sig
  // Testi senza un font loro: quello dei titoli (per un font della lista, nel peso normale).
  const bodyFont = brand.fonts?.body || (brand.fonts?.heading?.preset ? brand.fonts.heading : null)
  const [heading, body] = await Promise.all([loadFont(brand.fonts?.heading, 'heading'), loadFont(bodyFont, 'body')])
  return createPhotoCarousel({
    fonts: { heading, body },
    keep: outdated ? undefined : keep,
    counter: source.counter !== false,
    layout: asPhotoLayout(source.layout),
    textLayout: asTextLayout(source.textLayout),
    photos: source.photos,
    slides: source.slides,
    hook: source.hook,
    label: source.label,
    cta: source.closing,
    palette: brand.palette,
    handle: brand.handle,
    logo: brand.logo,
    mix: source.mix,
    // Stesso salvataggio delle foto: tempo massimo e motivo nei log se l'archivio rifiuta.
    save: (jpeg) => store(workspaceId, 'posts', jpeg),
  })
}

/**
 * Crea un post in bozza.
 * - photos: le foto del cliente cosi' come sono (ritagliate 4:5, o intere su sfondo sfocato);
 * - carousel con foto: UNA SLIDE PER FOTO, nell'ordine in cui le ha caricate, testo sopra
 *   la foto e logo; slides (dall'assistente) = i testi esatti, uno per foto;
 * - carousel senza foto: slide grafiche con i suoi colori e immagini create dall'AI.
 * total: slide chieste IN TUTTO (copertina e slide finale comprese, come nel sito principale):
 * il carosello ne ha esattamente tante, se ci sono foto e testi per farle (vedi sotto).
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
    /** Slide chieste in tutto (copertina e slide finale comprese), da 2 a 10. */
    total?: number
    /** Pagine delle notizie prese dal web (es. eventi): i siti finiscono nella riga "Fonti:" della didascalia. */
    webSources?: string[]
  }
): Promise<PostRow> {
  if (!hasAIProvider()) throw new Error('AI non configurata')
  const total = slideTotal(input.total)
  const allImages = (input.images || []).filter(isOurMedia).slice(0, 10)
  const kind = input.kind || (allImages.length ? 'photos' : 'carousel')
  if (kind === 'photos' && !allImages.length) throw new Error('per un post con foto carica almeno una foto (o chiedi un carosello grafico)')
  const mode = kind === 'carousel' && allImages.length ? 'photo_carousel' : kind
  const given = input.slides || []

  // Carosello con le foto e numero di slide chiesto: prima le foto (una slide per foto), poi
  // le slide di solo testo date oltre le foto, poi la slide finale; al massimo 10.
  let withClosing = Boolean(input.closing)
  let photoCount = allImages.length
  let textOnly = 0
  if (mode === 'photo_carousel' && !total) {
    // Nessun numero chiesto: tutte le sue foto (nessuna si toglie), la slide finale solo se c'e' posto.
    withClosing = withClosing && allImages.length < MAX_SLIDES
  } else if (mode === 'photo_carousel' && total) {
    photoCount = Math.min(allImages.length, total - (withClosing ? 1 : 0))
    let missing = total - photoCount - (withClosing ? 1 : 0)
    if (missing > 0 && photoCount === allImages.length) {
      const extra = given.slice(allImages.length).filter((x) => trim(x?.title, 90) || trim(x?.text, 220)).length
      textOnly = Math.min(missing, extra)
      missing -= textOnly
    }
    // Manca ancora una slide: la slide finale fa parte del conto (copertina e finale comprese).
    if (missing > 0 && !withClosing) withClosing = true
  }
  const images = mode === 'photo_carousel' ? allImages.slice(0, photoCount) : allImages
  const givenNotes = input.photoNotes?.slice(0, images.length)
  const notes = images.length ? (givenNotes?.length === images.length && givenNotes.every(Boolean) ? givenNotes : await describePhotos(images, db.workspaceId)) : []
  // Carosello di solo testo: copertina + slide di contenuto + slide finale = total.
  const contentWanted = mode === 'carousel' && total !== undefined ? total - 2 : undefined
  const texts = await writeTexts(db.workspaceId, input.brief, mode, numbered(notes), images.length, contentWanted)

  let media: string[]
  let source: CarouselSource | null = null
  if (mode === 'photos') {
    const fitted = await Promise.all(images.map(async (url) => fitPostPhoto(await download(url))))
    media = await Promise.all(fitted.map((jpeg) => store(db.workspaceId, 'posts', jpeg)))
  } else if (mode === 'photo_carousel') {
    // I testi dati dall'assistente (seguendo le indicazioni del cliente) vincono su quelli scritti qui.
    // La "foto" vuota '' e' una slide di solo testo (testi dati oltre le foto).
    const photos = [...images, ...new Array<string>(textOnly).fill('')]
    const closing = withClosing && photos.length < MAX_SLIDES ? texts.cta : null
    source = {
      photos,
      slides: photos.map((_, k) => ({
        title: trim(given[k]?.title ?? texts.slides[k]?.title ?? '', 90),
        text: trim(given[k]?.text ?? texts.slides[k]?.text ?? '', 220),
        ...creditOf(given[k]),
      })),
      hook: trim(input.hook || texts.hook || texts.title, 60),
      label: trim(input.label ?? texts.label, 30),
      closing,
      // Stile e colori scelti l'ultima volta dal cliente (altrimenti Classico e colori a caso).
      ...(await workspaceDesign(db.workspaceId)),
    }
    media = await renderPhotoCarousel(db.workspaceId, source)
  } else {
    // Carosello di solo testo: copertina con il gancio, una slide per testo e la slide
    // finale. Niente immagini AI; i testi si salvano (si correggono, spostano, cambiano
    // stile e colori come nei caroselli con le foto: la "foto" vuota '' vuol dire testo).
    // I testi dati dall'assistente (solo le slide di contenuto) vincono su quelli scritti qui,
    // se bastano per il numero chiesto.
    const mine = given.map((x) => ({ title: trim(x?.title, 90), text: trim(x?.text, 220), ...creditOf(x) })).filter((x) => x.title || x.text)
    const written: SourceSlide[] = texts.slides.map((x) => ({ title: trim(x.title, 90), text: trim(x.text, 220) }))
    let content: SourceSlide[] =
      contentWanted === undefined ? (mine.length ? mine : written) : mine.length >= contentWanted || mine.length >= written.length ? mine : written
    if (contentWanted !== undefined) content = content.slice(0, contentWanted)
    if (!content.length && contentWanted !== 0) content = [{ title: trim(texts.title, 90), text: '' }]
    content = content.slice(0, MAX_SLIDES - 2)
    source = {
      photos: ['', ...content.map(() => '')],
      slides: [{ title: '', text: '' }, ...content],
      hook: trim(input.hook || texts.hook || texts.title, 60),
      label: trim(input.label ?? texts.label, 30),
      closing: texts.cta,
      ...(await workspaceDesign(db.workspaceId)),
    }
    media = await renderPhotoCarousel(db.workspaceId, source)
  }

  // Immagini o notizie prese dal web: i siti di provenienza nella riga "Fonti:" della didascalia.
  const sites = [...(source?.slides || []).map((x) => x.source || ''), ...(input.webSources || [])].map(siteOf).filter(Boolean)
  const { data, error } = await db
    .from('workspace_posts')
    .insert({
      status: 'draft',
      kind: mode === 'photos' ? 'photos' : 'carousel',
      title: texts.title,
      caption: withSourcesLine(texts.caption, sites).slice(0, 2200),
      facebook_text: withSourcesLine(texts.facebook, sites).slice(0, 5000),
      media,
      platforms: input.platforms?.length ? input.platforms : await defaultPlatforms(db),
      created_by: input.userId || null,
    })
    .select(POST_COLUMNS)
    .single()
  if (error || !data) throw new Error(`post non salvato: ${error?.message}`)
  if (source) await saveSource(data.id as string, source)
  await recordVersion(data as PostRow, source)
  return data as PostRow
}

/**
 * Modifica un carosello fatto con le foto e lo rifa': testi di singole slide
 * (numerate da 1), ordine delle foto, gancio, slide finale.
 */
export async function editCarousel(
  db: WorkspaceDb,
  id: string,
  changes: { slides?: { n: number; title?: string; text?: string; button?: string }[]; order?: number[]; hook?: string; label?: string; closing?: boolean; remove?: number[] }
): Promise<PostRow> {
  const post = await getPost(db, id)
  if (!post) throw new Error('post non trovato')
  if (['publishing', 'published'].includes(post.status)) throw new Error('il post è già pubblicato')
  const source = await loadSource(id)
  if (!source) throw new Error('questo post non è un carosello con le foto: creane uno nuovo')
  await keepBaseline(post, source)
  let photos = [...source.photos]
  let slides = [...source.slides]
  let closing = source.closing ? { ...source.closing } : null
  for (const change of changes.slides || []) {
    const k = Math.round(change.n) - 1
    // Slide finale (l'ultima, dopo le foto): titolo, testo e pulsante.
    if (closing && k === slides.length) {
      closing = {
        title: typeof change.title === 'string' ? trim(change.title, 60) : closing.title,
        text: typeof change.text === 'string' ? trim(change.text, 160) : closing.text,
        button: typeof change.button === 'string' ? trim(change.button, 30) : closing.button,
      }
      continue
    }
    if (k < 0 || k >= slides.length) continue
    // Credito e fonte della foto restano con la slide.
    slides[k] = { ...slides[k], title: typeof change.title === 'string' ? trim(change.title, 90) : slides[k].title, text: typeof change.text === 'string' ? trim(change.text, 220) : slides[k].text }
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
    closing: changes.closing === false ? null : changes.closing === true && !closing ? { title: 'Ti aspettiamo', text: 'Scrivici in Direct per informazioni.', button: 'Scrivici' } : closing,
  }
  const media = await renderPhotoCarousel(db.workspaceId, next)
  await saveSource(id, next)
  return updatePost(db, id, { media })
}

// --- Versioni ----------------------------------------------------------------------

/** Una versione del post: le slide di quel momento, la didascalia e i testi per rifarle. */
type PostVersion = { at: string; media: string[]; caption: string; facebook: string | null; source: CarouselSource | null }

const versionsKey = (postId: string) => `ws_post_ver:${postId}`

/** Versioni salvate di un post (slide, didascalia e ora), dalla piu' vecchia. */
export async function postVersions(postId: string): Promise<{ at: string; media: string[]; caption: string }[]> {
  return (await loadVersions(postId)).map((v) => ({ at: v.at, media: v.media, caption: v.caption }))
}

async function loadVersions(postId: string): Promise<PostVersion[]> {
  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', versionsKey(postId)).maybeSingle()
  try {
    const list = data?.value ? JSON.parse(data.value) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

async function recordVersion(post: PostRow, source: CarouselSource | null) {
  try {
    const sig = post.media.join('|')
    const list = (await loadVersions(post.id)).filter((v) => v.media.join('|') !== sig)
    list.push({ at: new Date().toISOString(), media: post.media, caption: post.caption, facebook: post.facebook_text, source })
    await supabaseAdmin
      .from('app_settings')
      .upsert({ key: versionsKey(post.id), value: JSON.stringify(list.slice(-30)), updated_at: new Date().toISOString() }, { onConflict: 'key' })
  } catch (error) {
    console.error('saas versioni post:', error instanceof Error ? error.message : error)
  }
}

// --- Recupero di una versione salvata senza testi ----------------------------------

const SLIDE_W = 1080
const SLIDE_H = 1350

/**
 * Fascia centrale (y 290-510) di una slide o di una foto ritagliata come nelle slide:
 * li' non ci sono ombre, logo, numero ne' testi, quindi e' uguale alla foto di partenza.
 */
async function middleBand(input: Buffer, isPhoto: boolean): Promise<Buffer> {
  const full = isPhoto
    ? await sharp(input).rotate().resize(SLIDE_W, SLIDE_H, { fit: 'cover', position: 'attention' }).toBuffer()
    : await sharp(input).resize(SLIDE_W, SLIDE_H, { fit: 'fill' }).toBuffer()
  return sharp(full).extract({ left: 0, top: 290, width: SLIDE_W, height: 220 }).resize(72, 16, { fit: 'fill' }).greyscale().raw().toBuffer()
}

function bandDistance(a: Buffer, b: Buffer) {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
  return sum / a.length
}

/** Per ogni slide la foto da cui e' fatta (indice in photos), o null se nessuna combacia (es. slide finale). */
export async function matchSlidePhotos(slides: Buffer[], photos: Buffer[]): Promise<{ index: number | null; distance: number }[]> {
  const bands = await Promise.all(photos.map((p) => middleBand(p, true).catch(() => null)))
  const out: { index: number | null; distance: number }[] = []
  for (const slide of slides) {
    const band = await middleBand(slide, false)
    let best = -1
    let distance = Infinity
    bands.forEach((b, j) => {
      if (!b) return
      const d = bandDistance(band, b)
      if (d < distance) {
        distance = d
        best = j
      }
    })
    out.push({ index: best >= 0 && distance < 8 ? best : null, distance: Math.round(distance * 10) / 10 })
  }
  return out
}

const READ_PROMPTS = {
  cover: `Questa e' la copertina di un carosello Instagram. Trascrivi ESATTAMENTE i testi che vedi, senza correggerli ne' tradurli: "etichetta" = la riga piccola in maiuscolo sopra il titolo (o ""), "titolo" = il titolo grande, "sotto" = la riga piccola sotto il titolo (o ""). Ignora il pulsante SCORRI, il numero tipo "01 / 10", il nome @account e il logo. Rispondi SOLO con JSON: {"etichetta": "", "titolo": "", "sotto": ""}`,
  slide: `Questa e' una slide di un carosello Instagram. Trascrivi ESATTAMENTE i testi che vedi, senza correggerli ne' tradurli: "titolo" = il titolo in grassetto, "testo" = il testo piu' piccolo sotto il titolo (o ""). Ignora il numero tipo "03 / 10", il nome @account e il logo. Rispondi SOLO con JSON: {"titolo": "", "testo": ""}`,
  closing: `Questa e' l'ultima slide di un carosello Instagram. Trascrivi ESATTAMENTE i testi che vedi: "titolo" = il titolo grande, "testo" = il testo sotto, "pulsante" = il testo dentro il pulsante. Ignora il numero, il nome @account e il logo. Rispondi SOLO con JSON: {"titolo": "", "testo": "", "pulsante": ""}`,
}

/** Testi scritti su una slide, letti dall'AI (per le versioni salvate senza testi). */
async function readSlideTexts(slide: Buffer, kind: keyof typeof READ_PROMPTS, workspaceId: string): Promise<Record<string, string> | null> {
  const small = await sharp(slide).resize(720, 900, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer()
  const raw = await describeMedia([{ mimeType: 'image/jpeg', data: small.toString('base64') }], READ_PROMPTS[kind], 'saas_recupero_testi', workspaceId)
  try {
    const data = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || '')
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(data)) if (typeof v === 'string') out[k] = v.replace(/\s+/g, ' ').trim()
    return (kind === 'cover' ? out.titolo : out.titolo || out.testo) ? out : null
  } catch {
    return null
  }
}

/**
 * Ricostruisce i testi e le foto di una versione salvata senza testi (prima delle
 * versioni): per ogni slide si trova la foto di partenza tra quelle del post e quelle
 * mandate in chat (confronto della fascia centrale, senza AI) e si leggono i testi.
 * Se qualcosa non torna con certezza non si inventa niente: null.
 */
async function rebuildSource(db: WorkspaceDb, original: PostRow, media: string[], candidates: string[]): Promise<CarouselSource | null> {
  const current = await loadSource(original.id)
  const pool = [...new Set([...(current?.photos || []), ...candidates])].filter(isOurMedia).slice(0, 30)
  if (!pool.length) return null
  const [slides, photos] = await Promise.all([Promise.all(media.map((u) => download(u))), Promise.all(pool.map((u) => download(u).catch(() => null)))])
  const usable = photos.map((b, i) => (b ? i : -1)).filter((i) => i >= 0)
  const matches = await matchSlidePhotos(slides, usable.map((i) => photos[i]!))
  const chosen: string[] = []
  let closing = false
  for (const [k, m] of matches.entries()) {
    if (m.index !== null) chosen.push(pool[usable[m.index]])
    else if (k === media.length - 1 && k > 0) closing = true
    else {
      console.log(`saas versione: slide ${k + 1} senza foto corrispondente (distanza ${m.distance})`)
      return null
    }
  }
  const kinds = media.map((_, k): keyof typeof READ_PROMPTS => (k === 0 ? 'cover' : closing && k === media.length - 1 ? 'closing' : 'slide'))
  const texts: (Record<string, string> | null)[] = new Array(media.length).fill(null)
  let next = 0
  const worker = async () => {
    while (next < media.length) {
      const k = next++
      texts[k] = await readSlideTexts(slides[k], kinds[k], db.workspaceId).catch(() => null)
    }
  }
  await Promise.all([worker(), worker(), worker()])
  if (texts.some((t) => !t)) {
    console.log(`saas versione: testi non letti per le slide ${texts.map((t, k) => (t ? null : k + 1)).filter(Boolean).join(',')}`)
    return null
  }
  const cover = texts[0]!
  const end = closing ? texts[media.length - 1]! : null
  return {
    photos: chosen,
    slides: chosen.map((_, k) => (k === 0 ? { title: trim(cover.sotto, 90), text: '' } : { title: trim(texts[k]!.titolo, 90), text: trim(texts[k]!.testo, 220) })),
    hook: trim(cover.titolo, 60) || current?.hook || '',
    label: trim(cover.etichetta, 30),
    closing: end ? { title: trim(end.titolo, 60), text: trim(end.testo, 160), button: trim(end.pulsante, 30) || 'Scrivici' } : null,
    mix: current?.mix ?? 0,
  }
}

/** Prima di cambiare un post nato prima delle versioni: si conserva com'e' adesso. */
async function keepBaseline(post: PostRow, source: CarouselSource | null) {
  if (!(await loadVersions(post.id)).length) await recordVersion(post, source)
}

/**
 * Riprende una versione precedente (le slide di quel momento, dalla chat) come NUOVA
 * bozza: il post di partenza e la cronologia restano come sono. Se la versione e'
 * stata salvata con i testi, la bozza si puo' correggere, spostare e togliere come prima.
 */
export async function restoreVersion(
  db: WorkspaceDb,
  id: string,
  media: string[],
  caption: string | undefined,
  userId?: string | null,
  /** Foto mandate in chat: servono per ricostruire i testi delle versioni salvate senza. */
  candidates: string[] = []
): Promise<{ post: PostRow; editable: boolean; rebuilt: boolean }> {
  const post = await getPost(db, id)
  if (!post) throw new Error('post non trovato')
  const own = `/storage/v1/object/public/${MEDIA_BUCKET}/${db.workspaceId}/`
  const slides = media.filter((u) => isOurMedia(u) && u.includes(own)).slice(0, 10)
  if (!slides.length || slides.length !== media.length) throw new Error('versione non valida')
  const version = (await loadVersions(id)).find((v) => v.media.join('|') === slides.join('|')) || null
  const fits = (src: CarouselSource | null | undefined) => Boolean(src && src.photos.length + (src.closing ? 1 : 0) === slides.length)
  let source = fits(version?.source) ? version!.source : null
  let rebuilt = false
  if (!source && post.kind === 'carousel') {
    const found = await rebuildSource(db, post, slides, candidates).catch((error) => {
      console.error('saas versione: ricostruzione non riuscita:', error instanceof Error ? error.message : error)
      return null
    })
    if (fits(found)) {
      source = found
      rebuilt = true
    }
  }
  const { data, error } = await db
    .from('workspace_posts')
    .insert({
      status: 'draft',
      kind: post.kind,
      title: post.title,
      caption: (version?.caption ?? caption ?? post.caption).slice(0, 2200),
      facebook_text: version?.facebook ?? post.facebook_text,
      media: slides,
      platforms: post.platforms,
      created_by: userId || null,
    })
    .select(POST_COLUMNS)
    .single()
  if (error || !data) throw new Error(`versione non ripresa: ${error?.message}`)
  if (source) await saveSource(data.id as string, source)
  await recordVersion(data as PostRow, source)
  return { post: data as PostRow, editable: Boolean(source) || post.kind === 'photos', rebuilt }
}

/** "Togli/rimuovi i numeri" -> false, "rimetti/mostra i numeri" -> true, altrimenti null. */
function wantsCounter(request: string): boolean | null {
  // Solo i numeri delle slide (non "il numero di telefono"): il resto lo capisce l'AI.
  if (!/numer(etti|ini|azione)|numeri (in alto|delle slide|di pagina|a destra|sulle slide)|numero (della|delle|sulle) slide|numero di pagina|contator|\d{1,2}\s?\/\s?\d{1,2}/i.test(request)) return null
  if (/(togli|rimuov|elimin|nascond|cancell|senza|leva|via)/i.test(request)) return false
  if (/(rimett|mostr|aggiung|metti|ripristin)/i.test(request)) return true
  return null
}

/** Numero delle slide tolto o rimesso: vale per tutto il carosello (si rifanno tutte, senza AI). */
async function setCounter(db: WorkspaceDb, id: string, post: PostRow, source: CarouselSource, show: boolean): Promise<{ post: PostRow; done: string[] }> {
  if ((source.counter !== false) === show && (source.style ?? 1) >= SLIDE_STYLE) {
    return { post, done: [show ? 'i numeri delle slide ci sono già' : 'i numeri delle slide sono già tolti'] }
  }
  const next: CarouselSource = { ...source, counter: show }
  const media = await renderPhotoCarousel(db.workspaceId, next)
  await saveSource(id, next)
  return {
    post: await updatePost(db, id, { media }),
    done: [show ? 'numeri rimessi su tutte le slide (es. «03 / 08»)' : 'numeri in alto a destra tolti da tutte le slide (testi e foto sono gli stessi)'],
  }
}

/**
 * Correzione delle SOLE slide scelte dal cliente (n da 1), con una sola chiamata
 * all'AI che vede solo quelle slide. Si cambiano testo e/o foto di quelle e basta:
 * le altre restano gli stessi identici file (non si rifanno), niente riordino,
 * niente slide tolte o aggiunte.
 */
export async function editSlides(db: WorkspaceDb, id: string, numbers: number[], instruction: string): Promise<{ post: PostRow; done: string[] }> {
  const request = instruction.trim().slice(0, 1500)
  if (!request) throw new Error('scrivi cosa cambiare nella slide')
  const post = await getPost(db, id)
  if (!post) throw new Error('post non trovato')
  if (['publishing', 'published'].includes(post.status)) throw new Error('il post è già pubblicato')
  const total = post.media.length
  const picked = [...new Set(numbers.map((n) => Math.round(n)))].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b)
  if (!picked.length) throw new Error(`scegli le slide da correggere (da 1 a ${total})`)
  const source = await loadSource(id)
  await keepBaseline(post, source)
  const done: string[] = []

  // "Estrai le foto, e' uno screenshot": ogni foto dentro l'immagine diventa una slide.
  if (WANTS_EXTRACT.test(request)) return extractPhotos(db, id, picked)

  // "Togli i numeri in alto a destra" / "rimetti i numeri": grafica di tutto il carosello, senza AI.
  const counterWish = source ? wantsCounter(request) : null
  if (source && counterWish !== null) return setCounter(db, id, post, source, counterWish)

  // Post senza testi nelle slide (foto o carosello grafico): si modifica solo l'immagine scelta.
  if (!source || total !== source.photos.length + (source.closing ? 1 : 0)) {
    if (picked.length > 4) throw new Error('per modificare le immagini scegli al massimo 4 slide per volta')
    const media = [...post.media]
    for (const n of picked) {
      const edited = await editImage(db.workspaceId, media[n - 1], request)
      media[n - 1] = await store(db.workspaceId, 'posts', await fitPostPhoto(await download(edited)))
      done.push(`slide ${n}: immagine modificata`)
    }
    return { post: await updatePost(db, id, { media }), done }
  }

  const count = source.photos.length
  // La didascalia si tocca solo se la richiesta la nomina (es. "traduci tutto, anche la didascalia").
  const wantsCaption = /didascali|caption|descrizion|testo del post|testo sotto il post/i.test(request)
  const current = picked.map((n) => {
    const k = n - 1
    if (k >= count && source.closing) return { n, slide_finale: true, titolo: source.closing.title, testo: source.closing.text, pulsante: source.closing.button }
    const s = source.slides[k] || { title: '', text: '' }
    return k === 0
      ? { n, copertina: true, gancio: source.hook, etichetta: source.label, sottotitolo: s.title }
      : { n, titolo: s.title, testo: s.text }
  })
  const context = await businessContext(db.workspaceId)
  const system = `${context}Correggi SOLO le slide di un carosello Instagram indicate qui sotto, seguendo la richiesta del titolare. Le altre slide non esistono per te: non nominarle e non cambiarle. Se la richiesta dice di prendere le informazioni dalle istruzioni, usa quelle qui sopra.
Per ogni slide indicata restituisci SOLO i campi da cambiare (ometti quelli che restano uguali):
- slide normale: "titolo" (max 45 caratteri), "testo" (max 140 caratteri);
- copertina: "gancio" (titolo grande, max 40 caratteri, niente emoji), "etichetta" (max 26 caratteri), "sottotitolo" (max 70 caratteri);
- slide finale: "titolo", "testo", "pulsante" (max 26 caratteri);
- "foto": SOLO se la richiesta chiede di cambiare la foto o l'immagine (luce, colori, sfondo, togliere o aggiungere qualcosa), l'istruzione precisa per modificarla con l'AI; altrimenti ometti;
- "estrai": true SOLO se chiede di tirare fuori, separare o estrarre le foto contenute nell'immagine (es. uno screenshot o un collage con piu' foto): ogni foto diventera' una slide. In quel caso non mettere altri campi;
- "grafica": true se il problema riguarda la grafica della slide e non la foto (sfumatura, ombra o fondo sotto il testo, contrasto, scritte poco leggibili): in quel caso NON mettere "foto";
- "numeri": false se chiede di togliere il numero della slide in alto a destra (es. "03 / 08"), true se chiede di rimetterlo. Non e' una modifica della foto.
Se la richiesta riguarda solo il testo non toccare la foto, e viceversa. Scrivi nella lingua della richiesta. Niente markdown.
${wantsCaption ? `Se la richiesta chiede di cambiare anche la didascalia (descrizione) del post, aggiungi "didascalia" (la nuova didascalia Instagram completa, hashtag adattati) e "facebook" (lo stesso testo per Facebook, senza la fila di hashtag).\n` : ''}Rispondi SOLO con JSON: {"slide": [{"n": 2, "titolo": "…"}]${wantsCaption ? ', "didascalia": "", "facebook": ""' : ''}}`
  const result = await callAI(
    [
      {
        role: 'user',
        content: `Slide da correggere (stato attuale):\n${JSON.stringify(current)}${wantsCaption ? `\n\nDidascalia attuale:\n${post.caption}\n\nTesto Facebook attuale:\n${post.facebook_text || post.caption}` : ''}\n\nRichiesta del titolare: ${request}`,
      },
    ],
    system,
    { feature: 'saas_slide', temperature: 0.3, maxOutputTokens: Math.min(4000, 600 + 180 * picked.length + (wantsCaption ? 1600 : 0)), workspaceId: db.workspaceId }
  )
  let answer: { slide?: Record<string, unknown>[]; didascalia?: unknown; facebook?: unknown } = {}
  try {
    answer = JSON.parse((result.message || '').match(/\{[\s\S]*\}/)?.[0] || '{}')
  } catch {}
  const allowed = new Set(picked)
  const changes = (Array.isArray(answer.slide) ? answer.slide : []).filter((c) => allowed.has(Math.round(Number(c?.n))))
  if (changes.some((c) => c.numeri === false || c.numeri === true)) {
    return setCounter(db, id, post, source, changes.find((c) => typeof c.numeri === 'boolean')!.numeri as boolean)
  }
  const toExtract = changes.filter((c) => c.estrai === true).map((c) => Math.round(Number(c.n)))
  if (toExtract.length) return extractPhotos(db, id, toExtract)
  // Problema di grafica (es. ombra chiara sotto il testo): si rifanno le slide, la foto non si tocca.
  if (changes.some((c) => c.grafica === true)) {
    const restyled = await restyleSlides(db, id)
    if (restyled.done.length) return restyled
    for (const c of changes) delete c.foto
  }
  const str = (v: unknown, max: number) => (typeof v === 'string' ? trim(v, max) : undefined)

  const next: CarouselSource = { ...source, photos: [...source.photos], slides: source.slides.map((x) => ({ ...x })), closing: source.closing ? { ...source.closing } : null }
  const redo = new Set<number>()
  const photoEdits: { k: number; instruction: string }[] = []
  for (const c of changes) {
    const n = Math.round(Number(c.n))
    const k = n - 1
    if (k >= count && next.closing) {
      const title = str(c.titolo, 60), text = str(c.testo, 160), button = str(c.pulsante, 30)
      if (title !== undefined || text !== undefined || button !== undefined) {
        next.closing = { title: title ?? next.closing.title, text: text ?? next.closing.text, button: button ?? next.closing.button }
        redo.add(k)
        done.push(`slide ${n}: testo cambiato`)
      }
      continue
    }
    if (k >= count) continue
    const before = JSON.stringify([next.slides[k], k === 0 ? [next.hook, next.label] : null])
    if (k === 0) {
      next.hook = str(c.gancio, 60) ?? next.hook
      next.label = str(c.etichetta, 30) ?? next.label
      const sub = str(c.sottotitolo, 90) ?? str(c.titolo, 90)
      if (sub !== undefined) next.slides[0] = { ...next.slides[0], title: sub }
    } else {
      next.slides[k] = { ...next.slides[k], title: str(c.titolo, 90) ?? next.slides[k].title, text: str(c.testo, 220) ?? next.slides[k].text }
    }
    if (JSON.stringify([next.slides[k], k === 0 ? [next.hook, next.label] : null]) !== before) {
      redo.add(k)
      done.push(`slide ${n}: testo cambiato`)
    }
    const photo = str(c.foto, 600)
    if (photo) photoEdits.push({ k, instruction: photo })
  }
  if (photoEdits.length > 4) throw new Error('per modificare le foto scegli al massimo 4 slide per volta')
  for (const edit of photoEdits) {
    if (!next.photos[edit.k]) {
      done.push(`slide ${edit.k + 1}: non ha una foto da modificare`)
      continue
    }
    next.photos[edit.k] = await editImage(db.workspaceId, next.photos[edit.k], edit.instruction)
    redo.add(edit.k)
    done.push(`slide ${edit.k + 1}: foto modificata`)
  }
  const caption = wantsCaption && typeof answer.didascalia === 'string' && answer.didascalia.trim() ? answer.didascalia.trim() : null
  const facebook = caption && typeof answer.facebook === 'string' && answer.facebook.trim() ? answer.facebook.trim() : caption
  if (!redo.size && !caption) return { post, done: [] }
  let updated = post
  if (redo.size) {
    // Si rifanno solo le slide cambiate: le altre restano gli stessi file.
    const media = await renderPhotoCarousel(db.workspaceId, next, post.media.map((url, k) => (redo.has(k) ? null : url)))
    await saveSource(id, next)
    console.log(`saas slide: post ${id.slice(0, 8)} corrette solo le slide ${[...redo].map((k) => k + 1).join(',')} (scelte ${picked.join(',')})`)
    updated = await updatePost(db, id, { media })
  }
  if (caption) {
    updated = await updatePost(db, id, { caption, facebook: facebook || caption })
    done.push('didascalia cambiata')
  }
  return { post: updated, done: [...new Set(done)] }
}

// --- Foto dentro uno screenshot: una slide per ogni foto ------------------------------

const WANTS_EXTRACT = /estra(i|rre|tte|gg)|scre+n?\s?sh?ot|screen\b|tira(re)? fuori|separa(re)? le (foto|immagini)|una slide per (ogni|ciascuna) (foto|immagine)/i

type Box = { x: number; y: number; w: number; h: number }

/**
 * Bordi veri di una foto vicino al riquadro dato dall'AI: tra la grafica dello screenshot
 * (righe/colonne piatte, tutte dello stesso colore) e la foto (piena di dettagli). Si cerca
 * al massimo il 3% piu' in la' o piu' in qua; se il passaggio non si vede si tiene il bordo.
 */
export function refineBox(gray: Uint8Array, W: number, H: number, box: Box): Box {
  const std = (values: number[]) => {
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length)
  }
  const row = (y: number, x0: number, x1: number) => {
    const v: number[] = []
    for (let x = Math.max(0, x0); x < Math.min(W, x1); x += 2) v.push(gray[y * W + x])
    return v.length ? std(v) : 0
  }
  const col = (x: number, y0: number, y1: number) => {
    const v: number[] = []
    for (let y = Math.max(0, y0); y < Math.min(H, y1); y += 2) v.push(gray[y * W + x])
    return v.length ? std(v) : 0
  }
  const FLAT = 2.5
  const DETAIL = 4.5
  // Da fuori verso dentro: serve prima un tratto piatto (la grafica), poi il primo con dettagli.
  const edge = (from: number, to: number, measure: (i: number) => number) => {
    const step = from < to ? 1 : -1
    let seenFlat = false
    for (let i = from; step > 0 ? i <= to : i >= to; i += step) {
      const m = measure(i)
      if (m <= FLAT) seenFlat = true
      else if (seenFlat && m >= DETAIL && measure(i + step) >= DETAIL) return i
    }
    return null
  }
  const mY = Math.max(3, Math.round(H * 0.03))
  const mX = Math.max(3, Math.round(W * 0.03))
  let { x, y, w, h } = box
  const x1 = x + w
  const y1 = y + h
  const inner = (a: number, b: number) => [a + Math.round((b - a) * 0.1), b - Math.round((b - a) * 0.1)] as const
  const [cx0, cx1] = inner(x, x1)
  const top = edge(Math.max(0, y - mY), Math.min(H - 2, y + mY), (i) => row(i, cx0, cx1))
  const bottom = edge(Math.min(H - 1, y1 + mY), Math.max(1, y1 - mY), (i) => row(i, cx0, cx1))
  const ny0 = top ?? y
  const ny1 = bottom !== null ? bottom + 1 : y1
  const [cy0, cy1] = inner(ny0, ny1)
  const left = edge(Math.max(0, x - mX), Math.min(W - 2, x + mX), (i) => col(i, cy0, cy1))
  const right = edge(Math.min(W - 1, x1 + mX), Math.max(1, x1 - mX), (i) => col(i, cy0, cy1))
  const nx0 = left ?? x
  const nx1 = right !== null ? right + 1 : x1
  x = nx0
  y = ny0
  w = Math.max(1, nx1 - nx0)
  h = Math.max(1, ny1 - ny0)
  return { x, y, w, h }
}

/** Foto dentro uno screenshot: riquadri dall'AI (0-1000), rifiniti sui bordi veri, in ordine di lettura. */
async function findPhotos(image: Buffer, workspaceId: string): Promise<{ boxes: Box[]; notes: string[]; width: number; height: number }> {
  const base = await sharp(image).rotate().toBuffer()
  const meta = await sharp(base).metadata()
  const width = meta.width || 0
  const height = meta.height || 0
  if (!width || !height) throw new Error('immagine non leggibile')
  const preview = await sharp(base).resize(1600, 1600, { fit: 'inside' }).jpeg({ quality: 88 }).toBuffer()
  const raw = await describeMedia(
    [{ mimeType: 'image/jpeg', data: preview.toString('base64') }],
    `Questa immagine e' uno screenshot (di un'app, di un sito o di una galleria) o un collage che contiene delle fotografie. Trova OGNI fotografia vera (stanze, esterni, persone, prodotti, paesaggi) e ignora icone, loghi, pulsanti, testi, mappe e avatar piccoli. Per ciascuna dai il riquadro piu' preciso possibile, bordo per bordo, in coordinate da 0 a 1000 nel formato [ymin, xmin, ymax, xmax], e in "cosa" una breve descrizione in italiano di quello che mostra. Rispondi SOLO con JSON: {"foto": [{"box_2d": [ymin, xmin, ymax, xmax], "cosa": ""}]}`,
    'saas_estrai_foto',
    workspaceId
  )
  let list: { box_2d?: unknown; cosa?: unknown }[] = []
  try {
    const json = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/)?.[0] || ''
    const data = JSON.parse(json)
    list = Array.isArray(data) ? data : Array.isArray(data?.foto) ? data.foto : []
  } catch {}
  // Analisi dei bordi su una copia piu' piccola (lato lungo 1200 px).
  const scale = Math.min(1, 1200 / Math.max(width, height))
  const gw = Math.max(1, Math.round(width * scale))
  const gh = Math.max(1, Math.round(height * scale))
  const gray = new Uint8Array(await sharp(base).resize(gw, gh, { fit: 'fill' }).greyscale().raw().toBuffer())
  const found: { box: Box; note: string }[] = []
  for (const item of list) {
    const b = Array.isArray(item?.box_2d) ? (item.box_2d as unknown[]).map(Number) : []
    if (b.length !== 4 || b.some((v) => !Number.isFinite(v))) continue
    const [ymin, xmin, ymax, xmax] = b.map((v) => Math.min(1000, Math.max(0, v)))
    if (xmax - xmin < 80 || ymax - ymin < 50) continue // troppo piccola: icona o miniatura
    const rough: Box = { x: Math.round((xmin / 1000) * gw), y: Math.round((ymin / 1000) * gh), w: Math.round(((xmax - xmin) / 1000) * gw), h: Math.round(((ymax - ymin) / 1000) * gh) }
    const fine = refineBox(gray, gw, gh, rough)
    // 2 px in meno per lato: nessun filo della grafica dello screenshot sul bordo.
    const pad = Math.ceil(2 / scale)
    const box: Box = { x: Math.round(fine.x / scale) + pad, y: Math.round(fine.y / scale) + pad, w: Math.round(fine.w / scale) - 2 * pad, h: Math.round(fine.h / scale) - 2 * pad }
    box.w = Math.min(box.w, width - box.x)
    box.h = Math.min(box.h, height - box.y)
    if (box.w < 60 || box.h < 60) continue
    found.push({ box, note: typeof item.cosa === 'string' ? item.cosa.slice(0, 200) : '' })
  }
  // Niente doppioni (una foto dentro l'altra): resta la piu' grande.
  const area = (b: Box) => b.w * b.h
  const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  const unique = found
    .sort((a, b) => area(b.box) - area(a.box))
    .filter((f, i, all) => !all.slice(0, i).some((g) => overlap(f.box, g.box) > 0.6 * area(f.box)))
  // Ordine di lettura: dall'alto in basso, nella stessa riga da sinistra a destra.
  unique.sort((a, b) => (Math.abs(a.box.y - b.box.y) < height * 0.04 ? a.box.x - b.box.x : a.box.y - b.box.y))
  return { boxes: unique.map((f) => f.box), notes: unique.map((f) => f.note), width, height }
}

/** Foto ritagliata pronta per una slide: ingrandita con cura se piccola, 4:5 (intera su sfondo sfocato se serve). */
async function slidePhotoFrom(image: Buffer, box: Box): Promise<Buffer> {
  const crop = await sharp(image).rotate().extract({ left: box.x, top: box.y, width: box.w, height: box.h }).toBuffer()
  const up = box.w < 1080 ? await sharp(crop).resize({ width: 1080, kernel: 'lanczos3' }).sharpen({ sigma: 0.6 }).toBuffer() : crop
  return fitPostPhoto(up)
}

/**
 * La slide scelta e' uno screenshot (o un collage) con piu' foto: ogni foto diventa una
 * slide a se', al suo posto e nello stesso ordine. La prima tiene i testi della slide
 * (o il gancio, se e' la copertina); per le altre l'AI scrive titolo e testo. Le altre
 * slide restano com'erano: cambia solo il numero (es. "05 / 12").
 */
export async function extractPhotos(db: WorkspaceDb, id: string, numbers: number[]): Promise<{ post: PostRow; done: string[] }> {
  const done: string[] = []
  // Dalla slide piu' in fondo: cosi' i numeri delle altre scelte non cambiano mentre si lavora.
  for (const n of [...new Set(numbers)].sort((a, b) => b - a)) {
    const post = await getPost(db, id)
    if (!post) throw new Error('post non trovato')
    if (['publishing', 'published'].includes(post.status)) throw new Error('il post è già pubblicato')
    const source = await loadSource(id)
    await keepBaseline(post, source)
    const k = Math.round(n) - 1
    const photos = source ? source.photos : post.kind === 'photos' ? post.media : null
    if (!photos) throw new Error('in questo carosello grafico non si possono estrarre le foto: crealo dalle foto')
    if (k < 0 || k >= photos.length || !photos[k]) throw new Error(`la slide ${n} non ha una foto da cui estrarre`)
    const image = await download(photos[k])
    const { boxes, notes } = await findPhotos(image, db.workspaceId)
    if (boxes.length < 2) throw new Error(`nella slide ${n} non ho trovato più foto da separare${boxes.length ? ' (ce n’è una sola)' : ''}`)
    const room = 10 - (photos.length - 1) - (source?.closing ? 1 : 0)
    if (room < 2) throw new Error('il carosello ha già quasi 10 slide (il massimo di Instagram): togline qualcuna e riprova')
    const taken = boxes.slice(0, room)
    const urls = await Promise.all(taken.map(async (box) => store(db.workspaceId, 'uploads', await slidePhotoFrom(image, box))))
    const skipped = boxes.length - taken.length

    if (!source) {
      // Post con le foto senza scritte: si sostituisce la foto con quelle estratte.
      const media = [...post.media.slice(0, k), ...urls, ...post.media.slice(k + 1)]
      await updatePost(db, id, { media })
    } else {
      // Testi delle nuove slide (dalla seconda foto estratta in poi), nel tono del carosello.
      const extra = taken.length - 1
      let written: { titolo?: string; testo?: string }[] = []
      try {
        const result = await callAI(
          [
            {
              role: 'user',
              content: `Carosello: gancio «${source.hook}». Slide di partenza: «${source.slides[k]?.title || ''}» ${source.slides[k]?.text || ''}\nAltre slide (per lo stile): ${source.slides
                .filter((_, j) => j !== k)
                .slice(0, 6)
                .map((x) => `«${x.title}» ${x.text}`)
                .join(' | ')}\n\nNuove foto (in ordine):\n${notes.slice(1, 1 + extra).map((note, j) => `${j + 1}. ${note || 'foto'}`).join('\n')}`,
            },
          ],
          `${await businessContext(db.workspaceId)}Scrivi i testi di ${extra} nuove slide di un carosello Instagram, una per ogni foto indicata e nello stesso ordine, nello stile delle altre slide: "titolo" max 45 caratteri, "testo" max 140 caratteri, che parlino di quello che mostra la foto. Niente prezzi o promesse inventate, niente markdown. Rispondi SOLO con JSON: {"slide": [{"titolo": "", "testo": ""}]}`,
          { feature: 'saas_slide', temperature: 0.5, maxOutputTokens: 900, workspaceId: db.workspaceId }
        )
        const data = JSON.parse((result.message || '').match(/\{[\s\S]*\}/)?.[0] || '{}')
        written = Array.isArray(data.slide) ? data.slide : []
      } catch {}
      const newSlides = Array.from({ length: extra }, (_, j) => ({
        title: trim(written[j]?.titolo, 90) || trim(notes[j + 1], 45),
        text: trim(written[j]?.testo, 220),
      }))
      const next: CarouselSource = {
        ...source,
        photos: [...source.photos.slice(0, k), ...urls, ...source.photos.slice(k + 1)],
        slides: [...source.slides.slice(0, k), source.slides[k] || { title: '', text: '' }, ...newSlides, ...source.slides.slice(k + 1)],
      }
      // Cambia il numero di tutte le slide: si rifanno tutte (senza AI).
      const media = await renderPhotoCarousel(db.workspaceId, next)
      await saveSource(id, next)
      await updatePost(db, id, { media })
    }
    done.push(`slide ${n}: ${taken.length} foto estratte dallo screenshot, ora sono le slide ${n}–${n + taken.length - 1}${skipped ? ` (${skipped} non messe: si arriva al massimo di 10 slide)` : ''}`)
    console.log(`saas slide: post ${id.slice(0, 8)} slide ${n} -> ${taken.length} foto estratte`)
  }
  const post = await getPost(db, id)
  if (!post) throw new Error('post non trovato')
  return { post, done }
}

/**
 * Si possono spostare o togliere le slide dall'anteprima?
 * - 'free': si' (foto senza scritte, o carosello con le foto senza slide finale);
 * - 'closing': si', ma l'ultima e' la slide finale e resta in fondo;
 * - null: no (carosello grafico: i numeri sono disegnati nelle immagini e non si rifa').
 */
export type ArrangeMode = 'free' | 'closing' | null

export async function arrangeModes(
  posts: { id: string; kind: string }[]
): Promise<{
  modes: Map<string, ArrangeMode>
  outdated: Set<string>
  designs: Map<string, { kind: 'photo' | 'text'; layout: string; mix: number }>
  /** Pagine da cui vengono le immagini prese dal web (nell'ordine delle slide, senza doppioni). */
  sources: Map<string, WebSource[]>
}> {
  const keys = posts.filter((p) => p.kind === 'carousel').map((p) => sourceKey(p.id))
  const { data } = keys.length ? await supabaseAdmin.from('app_settings').select('key, value').in('key', keys) : { data: [] }
  const sources = new Map<string, CarouselSource>()
  for (const row of data || []) {
    try {
      sources.set(row.key as string, JSON.parse(row.value as string) as CarouselSource)
    } catch {}
  }
  const modes = new Map<string, ArrangeMode>(
    posts.map((p) => {
      if (p.kind === 'photos') return [p.id, 'free']
      const source = sources.get(sourceKey(p.id))
      return [p.id, source ? (source.closing ? 'closing' : 'free') : null]
    })
  )
  // Caroselli fatti con una grafica vecchia (es. ombra chiara sotto il testo).
  const outdated = new Set(
    posts.filter((p) => {
      const source = sources.get(sourceKey(p.id))
      return Boolean(source) && (source!.style ?? 1) < SLIDE_STYLE
    }).map((p) => p.id)
  )
  // Stile e colori attuali (per la scelta nell'anteprima).
  const designs = new Map(
    posts.flatMap((p) => {
      const source = sources.get(sourceKey(p.id))
      return source
        ? [
            [
              p.id,
              {
                kind: source.photos.every((x) => !x) ? ('text' as const) : ('photo' as const),
                layout: source.photos.every((x) => !x) ? asTextLayout(source.textLayout) : asPhotoLayout(source.layout),
                mix: ((source.mix % PALETTE_MIXES) + PALETTE_MIXES) % PALETTE_MIXES,
              },
            ] as const,
          ]
        : []
    })
  )
  const webSources = new Map<string, WebSource[]>()
  for (const p of posts) {
    const list = postWebSources(sources.get(sourceKey(p.id)))
    if (list.length) webSources.set(p.id, list)
  }
  return { modes, outdated, designs, sources: webSources }
}

/** Pagina da cui viene un'immagine presa dal web, con il sito (per "Fonti:" sotto l'anteprima). */
export type WebSource = { url: string; site: string }

/** Fonti delle immagini prese dal web di un carosello (una per pagina, nell'ordine delle slide). */
export function postWebSources(source: CarouselSource | null | undefined): WebSource[] {
  const seen = new Set<string>()
  const out: WebSource[] = []
  for (const slide of source?.slides || []) {
    if (!slide?.source || seen.has(slide.source)) continue
    seen.add(slide.source)
    const site = siteOf(slide.source)
    if (site) out.push({ url: slide.source, site })
  }
  return out
}

// Stile e colori: quelli scelti l'ultima volta valgono anche per i caroselli nuovi.
const designKey = (workspaceId: string) => `ws_design:${workspaceId}`

async function workspaceDesign(workspaceId: string): Promise<{ layout: PhotoLayout; textLayout: TextLayout; mix: number }> {
  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', designKey(workspaceId)).maybeSingle()
  try {
    const saved = data?.value ? JSON.parse(data.value) : null
    if (saved) {
      return { layout: asPhotoLayout(saved.layout), textLayout: asTextLayout(saved.textLayout), mix: Number.isInteger(saved.mix) ? saved.mix : Math.floor(Math.random() * PALETTE_MIXES) }
    }
  } catch {}
  return { layout: 'classico', textLayout: 'titolo', mix: Math.floor(Math.random() * PALETTE_MIXES) }
}

/** Cambia stile e/o colori di un carosello con le foto: si rifanno tutte le slide, senza AI. */
export async function setDesign(db: WorkspaceDb, id: string, wish: { layout?: unknown; mix?: unknown; textLayout?: unknown }): Promise<{ post: PostRow; done: string[] }> {
  const post = await getPost(db, id)
  if (!post) throw new Error('post non trovato')
  if (['publishing', 'published'].includes(post.status)) throw new Error('il post è già pubblicato')
  const source = await loadSource(id)
  if (!source) throw new Error('lo stile non si può scegliere per questo post: ricrealo (con le foto o di solo testo)')
  const layout = wish.layout === undefined ? asPhotoLayout(source.layout) : asPhotoLayout(wish.layout)
  const textLayout = wish.textLayout === undefined ? asTextLayout(source.textLayout) : asTextLayout(wish.textLayout)
  const mix = Number.isInteger(wish.mix) ? (((wish.mix as number) % PALETTE_MIXES) + PALETTE_MIXES) % PALETTE_MIXES : ((source.mix % PALETTE_MIXES) + PALETTE_MIXES) % PALETTE_MIXES
  if (
    layout === asPhotoLayout(source.layout) &&
    textLayout === asTextLayout(source.textLayout) &&
    mix === ((source.mix % PALETTE_MIXES) + PALETTE_MIXES) % PALETTE_MIXES &&
    (source.style ?? 1) >= SLIDE_STYLE
  ) {
    return { post, done: [] }
  }
  await keepBaseline(post, source)
  const next: CarouselSource = { ...source, layout, textLayout, mix }
  const media = await renderPhotoCarousel(db.workspaceId, next)
  await saveSource(id, next)
  await supabaseAdmin
    .from('app_settings')
    .upsert({ key: designKey(db.workspaceId), value: JSON.stringify({ layout, textLayout, mix }), updated_at: new Date().toISOString() }, { onConflict: 'key' })
  const textOnly = source.photos.every((p) => !p)
  const styleName = textOnly ? TEXT_LAYOUTS.find((l) => l.id === textLayout)?.label : PHOTO_LAYOUTS.find((l) => l.id === layout)?.label
  return { post: await updatePost(db, id, { media }), done: [`stile «${styleName}», colori ${mix + 1}: tutte le slide rifatte con gli stessi testi${textOnly ? '' : ' e foto'}`] }
}

/** Rifa' tutte le slide con la grafica attuale: stessi testi e stesse foto, nessuna AI. */
export async function restyleSlides(db: WorkspaceDb, id: string): Promise<{ post: PostRow; done: string[] }> {
  const post = await getPost(db, id)
  if (!post) throw new Error('post non trovato')
  if (['publishing', 'published'].includes(post.status)) throw new Error('il post è già pubblicato')
  const source = await loadSource(id)
  if (!source) throw new Error('questo carosello non si può rifare: è fatto senza i testi separati')
  if ((source.style ?? 1) >= SLIDE_STYLE) return { post, done: [] }
  await keepBaseline(post, source)
  const next: CarouselSource = { ...source }
  const media = await renderPhotoCarousel(db.workspaceId, next)
  await saveSource(id, next)
  return { post: await updatePost(db, id, { media }), done: ['tutte le slide rifatte con la grafica nuova: ombra scura sotto il testo, scritte più leggibili (testi e foto sono gli stessi)'] }
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
    const started = Date.now()
    const updated = await editCarousel(db, id, {
      remove: source.photos.map((_, k) => k).filter((k) => !kept.includes(k)).map((k) => k + 1),
      order: kept.map((k) => remaining.indexOf(k) + 1),
      closing: source.closing && !seq.includes(count) ? false : undefined,
    })
    console.log(`saas slide: nuovo ordine post ${id.slice(0, 8)} [${sequence.join(',')}] rifatto in ${((Date.now() - started) / 1000).toFixed(1)}s`)
    return updated
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
  await keepBaseline(post, source)
  if (source && k >= 0 && k < source.photos.length) {
    if (!source.photos[k]) throw new Error(`la slide ${k + 1} è di solo testo: non ha una foto da modificare`)
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
    slide: [
      ...source.slides.map((s, k) => ({
        ...(k === 0 ? { n: 1, copertina: true, gancio: source.hook, etichetta: source.label, sottotitolo: s.title } : { n: k + 1, titolo: s.title, testo: s.text }),
        // Credito della foto presa dal web (scritto piccolo sulla slide, si aggiunge da solo).
        ...(s.credit ? { credito_foto: s.credit } : {}),
        ...(!source.photos[k] && source.photos.some(Boolean) ? { solo_testo: true } : {}),
      })),
      ...(source.closing ? [{ n: source.slides.length + 1, slide_finale: true, titolo: source.closing.title, testo: source.closing.text, pulsante: source.closing.button }] : []),
    ],
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
  if (typeof patch.caption === 'string') update.caption = limitHashtags(patch.caption.trim()).slice(0, 2200)
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
  // Ogni nuova versione delle slide si conserva (con i testi per poterla riprendere).
  if (patch.media) await recordVersion(data as PostRow, await loadSource(id))
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
  const post = await getPost(db, id)
  if (post?.status === 'published') throw new Error('il post è già uscito su Instagram: per toglierlo eliminalo dall’app di Instagram')
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
        platform === 'instagram' ? await publishInstagram(account, post.media, limitHashtags(post.caption)) : await publishFacebook(account, post.media, post.facebook_text || post.caption)
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
