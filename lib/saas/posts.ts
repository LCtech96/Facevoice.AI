import sharp from 'sharp'
import { callAI, describeMedia, hasAIProvider } from '@/lib/ai'
import { createCarousel, fitPostPhoto, PALETTE_MIXES, type Cta, type Palette, type Slide } from '@/lib/blog-image'
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

async function store(workspaceId: string, folder: string, jpeg: Buffer): Promise<string> {
  const path = `${workspaceId}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
  const { error } = await supabaseAdmin.storage.from(MEDIA_BUCKET).upload(path, jpeg, { contentType: 'image/jpeg', upsert: false })
  if (error) throw new Error(`immagine non salvata: ${error.message}`)
  return supabaseAdmin.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl
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

export type WorkspaceBrand = { palette: Palette; handle: string }

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
  return { palette: { ...DEFAULT_PALETTE, ...(saved.palette || {}) }, handle: saved.handle ?? (username ? `@${username}` : await workspaceName(workspaceId)) }
}

export async function setWorkspaceBrand(workspaceId: string, input: { dark?: string; accent?: string; light?: string; handle?: string }) {
  const current = await workspaceBrand(workspaceId)
  const next: WorkspaceBrand = { ...current }
  if (input.dark && input.accent) {
    if (!HEX.test(input.dark) || !HEX.test(input.accent)) throw new Error('colori non validi: usa codici come #1a2b3c')
    next.palette = paletteFrom(input.dark, input.accent, input.light)
  }
  if (typeof input.handle === 'string') next.handle = input.handle.trim().slice(0, 40)
  const { error } = await supabaseAdmin
    .from('app_settings')
    .upsert({ key: brandKey(workspaceId), value: JSON.stringify(next), updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw new Error(`marchio non salvato: ${error.message}`)
  return next
}

// --- Testi dei post --------------------------------------------------------------

type Texts = { title: string; caption: string; facebook: string; hook: string; label: string; slides: Slide[]; cta: Cta }

const trim = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

async function writeTexts(workspaceId: string, brief: string, kind: 'photos' | 'carousel', photoNotes: string, photoCount: number): Promise<Texts> {
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
  kind === 'carousel'
    ? `- È un CAROSELLO GRAFICO: "hook" (gancio della prima slide, max 42 caratteri, fortissimo, niente emoji), "label" (etichetta sopra il gancio, max 30 caratteri, o ""), "slides" da 2 a 6 (${photoCount ? `una per foto, nello stesso ordine, ${photoCount} in tutto, poi eventuali altre` : '3-4'}; "title" max 55 caratteri, "text" max 180), "cta" per l'ultima slide ("title" max 45, "text" max 140, "button" max 26).`
    : '- Post con le foto del titolare: lascia "hook", "label", "slides" e "cta" vuoti.'
}
Rispondi SOLO con JSON: {"title": "", "caption": "", "facebook": "", "hook": "", "label": "", "slides": [{"title": "", "text": ""}], "cta": {"title": "", "text": "", "button": ""}}`
  const result = await callAI(
    [{ role: 'user', content: [`Indicazioni del titolare: ${brief}`, photoCount ? `Foto (${photoCount}, in ordine):\n${photoNotes || '(descrizione non disponibile)'}` : ''].filter(Boolean).join('\n\n') }],
    system,
    { feature: 'saas_post', temperature: 0.6, maxOutputTokens: 2500, workspaceId }
  )
  const json = (result.message || '').match(/\{[\s\S]*\}/)?.[0]
  if (!json) throw new Error('l’AI non ha preparato i testi, riprova')
  const data = JSON.parse(json)
  const slides = (Array.isArray(data.slides) ? data.slides : [])
    .map((s: { title?: unknown; text?: unknown }) => ({ title: trim(s.title, 70), text: trim(s.text, 220) }))
    .filter((s: Slide) => s.title)
    .slice(0, 8)
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

const toImage = (jpeg: Buffer) => ({ mimeType: 'image/jpeg', data: jpeg.toString('base64') })

/**
 * Crea un post in bozza. photos: le foto del cliente cosi' come sono (ritagliate
 * 4:5, o intere su sfondo sfocato); carousel: slide grafiche con i suoi colori,
 * con le sue foto dentro (le altre immagini le crea l'AI, se richiesto).
 */
export async function createPost(
  db: WorkspaceDb,
  input: { brief: string; kind?: 'photos' | 'carousel'; images?: string[]; platforms?: PostPlatform[]; aiImages?: boolean; userId?: string | null }
): Promise<PostRow> {
  if (!hasAIProvider()) throw new Error('AI non configurata')
  const images = (input.images || []).filter(isOurMedia).slice(0, 10)
  const kind = input.kind || (images.length ? 'photos' : 'carousel')
  if (kind === 'photos' && !images.length) throw new Error('per un post con foto carica almeno una foto (o chiedi un carosello grafico)')

  const originals = await Promise.all(images.map(download))
  const fitted = await Promise.all(originals.map(fitPostPhoto))
  const notes = fitted.length ? await describeMedia(fitted.slice(0, 6).map(toImage)).catch(() => '') : ''
  const texts = await writeTexts(db.workspaceId, input.brief, kind, notes, images.length)

  let media: string[]
  if (kind === 'photos') {
    media = await Promise.all(fitted.map((jpeg) => store(db.workspaceId, 'posts', jpeg)))
  } else {
    const brand = await workspaceBrand(db.workspaceId)
    const slides = texts.slides.length ? texts.slides : [{ title: texts.title, text: '' }]
    // Con piu' foto la prima va in copertina, le altre nelle slide.
    const cover = images.length > 1 ? images[0] : null
    const slidePhotos = images.length > 1 ? images.slice(1) : images
    while (slides.length < slidePhotos.length) slides.push({ title: texts.title, text: '' })
    const carousel = await createCarousel(texts.title, slides, input.brief, cover, {
      hook: texts.hook || texts.title,
      label: texts.label,
      cta: texts.cta,
      mix: Math.floor(Math.random() * PALETTE_MIXES),
      photos: slidePhotos,
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
      kind,
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
  return data as PostRow
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
