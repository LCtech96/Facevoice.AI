import { callAI, hasAIProvider } from '@/lib/ai'
import { limitHashtags } from '@/lib/hashtags'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createCarousel, type CarouselSource, type Cta, type Slide } from '@/lib/blog-image'
import { loadContentDirections, nextPaletteMix } from '@/lib/content-directions'
import { publishInstagramCarousel, publishPagePhotos } from '@/lib/meta/graph'
import { updateSetting } from '@/lib/settings-store'

// Caroselli creati dalla super chat (anche con le foto e gli screenshot di Luca):
// l'AI scrive gancio, slide e didascalie dalle indicazioni di Luca, il sito crea
// le immagini con i colori del marchio e il post resta in BOZZA finche' Luca non
// preme "Pubblica" (o chiede esplicitamente di pubblicarlo).

const PREFIX = 'content_post:'

export type PostDraft = {
  id: string
  title: string
  hook: string
  slides: Slide[]
  caption: string
  facebook: string
  urls: string[]
  photos: string[]
  status: 'draft' | 'publishing' | 'published' | 'error'
  results?: { instagram?: string; facebook?: string; errors?: string[] }
  /** Dati per rifare una slide sola (testi, colori, immagini salvate). Manca nei caroselli di prima. */
  source?: CarouselSource
  createdAt: string
  updatedAt: string
}

/** Errore da mostrare a Luca (status: codice HTTP della risposta). */
export class DraftError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
  }
}

/** Il carosello era gia' cambiato (altra scheda, altra modifica): draft e' la versione attuale. */
export class DraftConflictError extends Error {
  status = 409
  constructor(public draft: PostDraft) {
    super('Il carosello era già cambiato: questa è l’ultima versione. Controllala e riprova.')
  }
}

/** Stesse slide, nello stesso ordine. */
export const sameSlides = (a: string[], b: string[]) => a.length === b.length && a.every((url, i) => url === b[i])

/** Pubblicazione partita da meno di 5 minuti (dopo si considera interrotta). */
export const publishingNow = (draft: PostDraft) => draft.status === 'publishing' && Date.now() - new Date(draft.updatedAt).getTime() < 5 * 60_000

/** Instagram: da 2 a 10 immagini per carosello. */
export const MIN_IMAGES = 2
export const MAX_IMAGES = 10

type Plan = { title: string; hook: string; label: string; slides: Slide[]; caption: string; facebook: string; cta: Cta }

const PLAN_PROMPT = (slidesRule: string) => `Sei il social media manager di Facevoice AI (agenzia digitale e software house a Terrasini, Palermo: siti, app, automazioni, chatbot e soluzioni di intelligenza artificiale per le aziende).
Prepari un CAROSELLO per Instagram e Facebook dalle indicazioni di Luca (il titolare) e, se ci sono, dalle sue immagini (te ne do la descrizione, nell'ordine).

Regole:
- Usa solo le informazioni di Luca e quello che si vede nelle immagini: niente numeri, clienti, risultati o promesse inventate.
- "hook": il gancio della prima slide, fortissimo e concreto, massimo 42 caratteri, niente emoji, niente punto finale.
- "label": etichetta breve sopra il gancio (max 34 caratteri, es. "CASO STUDIO", "NOVITÀ", "DIETRO LE QUINTE"), oppure "" se non serve.
${slidesRule}
- "cta": ultima slide: "title" (max 50 caratteri), "text" (max 150), "button" (max 26, es. "Scrivici su WhatsApp", "facevoice.ai").
- "caption": didascalia Instagram (max 1600 caratteri): apertura forte, 2-4 paragrafi brevi, invito all'azione, poi AL MASSIMO 5 hashtag pertinenti (Instagram non ne accetta di piu'). I link non sono cliccabili su Instagram.
- "facebook": testo del post Facebook (max 1200 caratteri), simile alla didascalia ma senza hashtag in fondo; puoi mettere https://www.facevoice.ai.
- "title": titolo interno breve del post.
- Tono: chiaro, umano, professionale, in italiano (salvo diversa indicazione di Luca). Niente markdown.
Rispondi SOLO con JSON: {"title": "", "hook": "", "label": "", "slides": [{"title": "", "text": ""}], "cta": {"title": "", "text": "", "button": ""}, "caption": "", "facebook": ""}`

const trim = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

const DEFAULT_SLIDES_RULE =
  '- "slides": da 2 a 8 slide (una per immagine di Luca, nello stesso ordine, se ci sono immagini; altrimenti 3-4). Ogni slide: "title" massimo 55 caratteri e "text" massimo 190 caratteri, chiari e utili.'

/** Regola delle slide quando Luca chiede un numero preciso di immagini (copertina e slide finale comprese). */
const countedSlidesRule = (contentCount: number, photoCount: number) =>
  contentCount === 0
    ? `- "slides": [] (Luca vuole solo ${contentCount + 2} immagini in tutto: la copertina e la slide finale "cta").`
    : `- "slides": ESATTAMENTE ${contentCount} slide di contenuto (la copertina e la slide finale "cta" sono a parte: in tutto ${contentCount + 2} immagini)${
        photoCount ? `; la prima immagine di Luca va in copertina${photoCount > 1 ? ', le altre nelle slide, nello stesso ordine' : ''}` : ''
      }. Ogni slide: "title" massimo 55 caratteri e "text" massimo 190 caratteri, chiari e utili.`

/** contentCount: slide di contenuto chieste da Luca (senza copertina e slide finale); undefined = decide l'AI. */
async function planPost(brief: string, imageNotes: string, photoCount: number, directions: string, contentCount?: number): Promise<Plan> {
  const result = await callAI(
    [
      {
        role: 'user',
        content: [
          `Indicazioni di Luca: ${brief}`,
          photoCount ? `Immagini di Luca (${photoCount}, in quest'ordine):\n${imageNotes || '(descrizione non disponibile)'}` : 'Nessuna immagine di Luca: le immagini le crea l’AI.',
          directions ? `Indicazioni generali di Luca per tutti i contenuti: ${directions}` : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
    ],
    PLAN_PROMPT(contentCount === undefined ? DEFAULT_SLIDES_RULE : countedSlidesRule(contentCount, photoCount)),
    { feature: 'super_chat_carosello', temperature: 0.6, maxOutputTokens: 3000 }
  )
  const json = (result.message || '').match(/\{[\s\S]*\}/)?.[0]
  if (!json) throw new Error('l’AI non ha preparato il carosello, riprova')
  const data = JSON.parse(json)
  const slides = (Array.isArray(data.slides) ? data.slides : [])
    .map((s: { title?: unknown; text?: unknown }) => ({ title: trim(s.title, 70), text: trim(s.text, 230) }))
    .filter((s: Slide) => s.title && s.text)
    .slice(0, contentCount ?? 8)
  // Con un numero chiesto da Luca le slide mancanti le gestisce chi chiama (nuovo tentativo).
  if (!slides.length && contentCount === undefined) throw new Error('il carosello non ha slide, riprova con più indicazioni')
  const cta = data.cta || {}
  const fallback = slides[0]?.title || trim(data.hook, 60) || trim(data.title, 120) || 'Carosello'
  return {
    title: trim(data.title, 120) || fallback,
    hook: trim(data.hook, 60) || fallback,
    label: trim(data.label, 40),
    slides,
    caption: limitHashtags(String(data.caption || '').trim()).slice(0, 2200),
    facebook: String(data.facebook || data.caption || '').trim().slice(0, 5000),
    cta: {
      title: trim(cta.title, 70) || 'Vuoi fare lo stesso nella tua azienda?',
      text: trim(cta.text, 180) || 'Scrivici: ti mostriamo cosa si può fare, in concreto.',
      button: trim(cta.button, 30) || 'facevoice.ai',
    },
  }
}

async function save(draft: PostDraft) {
  const { error } = await supabaseAdmin
    .from('app_settings')
    .upsert({ key: `${PREFIX}${draft.id}`, value: JSON.stringify(draft), updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw new Error(`bozza non salvata: ${error.message}`)
}

const parseDraft = (raw: string | null): PostDraft | null => {
  try {
    return raw ? (JSON.parse(raw) as PostDraft) : null
  } catch {
    return null
  }
}

export const validDraftId = (id: string) => /^[a-z0-9]{6,40}$/.test(id)

export async function loadPostDraft(id: string): Promise<PostDraft | null> {
  if (!validDraftId(id)) return null
  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', `${PREFIX}${id}`).maybeSingle()
  return parseDraft(data?.value ?? null)
}

/**
 * Salva una modifica della bozza solo se le slide salvate sono ancora base (quelle
 * che Luca ha davanti): se intanto sono cambiate, DraftConflictError con la versione
 * attuale. fn riceve la bozza appena riletta e puo' fermare tutto lanciando un errore.
 */
export async function updatePostDraft(id: string, base: string[], fn: (current: PostDraft) => PostDraft): Promise<PostDraft> {
  if (!validDraftId(id)) throw new DraftError('Carosello non trovato', 404)
  const saved = await updateSetting<PostDraft | null>(`${PREFIX}${id}`, parseDraft, (current) => {
    if (!current) throw new DraftError('Carosello non trovato', 404)
    if (!sameSlides(current.urls, base)) throw new DraftConflictError(current)
    return { ...fn(current), updatedAt: new Date().toISOString() }
  })
  if (!saved) throw new DraftError('Carosello non trovato', 404)
  return saved
}

/**
 * Crea un carosello in bozza. photos: indirizzi delle foto di Luca (dalla chat),
 * usate nell'ordine: la prima va in copertina se coverFromPhotos, le altre nelle slide.
 */
export async function createPostDraft(input: {
  brief: string
  photos?: string[]
  imageNotes?: string
  slides?: Slide[]
  hook?: string
  caption?: string
  /** Testo Facebook gia' scritto (es. carosello rifatto uguale); senza lo scrive l'AI. */
  facebook?: string
  onlyMyImages?: boolean
  coverFromPhotos?: boolean
  /** Immagini IN TUTTO chieste da Luca (copertina e slide finale comprese), da 2 a 10; senza = decide l'AI. */
  total?: number
}): Promise<PostDraft & { unusedPhotos: number }> {
  if (!hasAIProvider()) throw new Error('manca una chiave AI')
  const photos = (input.photos || []).filter((u) => /^https:\/\//.test(u)).slice(0, 9)
  const directions = (await loadContentDirections()).text
  // "3 slide" = 3 immagini in tutto: copertina + 1 slide di contenuto + slide finale.
  const total = input.total && Number.isFinite(input.total) ? Math.max(MIN_IMAGES, Math.min(MAX_IMAGES, Math.round(input.total))) : undefined
  const contentCount = total === undefined ? undefined : total - 2
  // Con piu' di una foto la prima fa da copertina; con una sola foto va in copertina.
  const coverPhoto = photos.length && input.coverFromPhotos !== false ? photos[0] : null
  const slidePhotos = coverPhoto && photos.length > 1 ? photos.slice(1) : coverPhoto ? [] : photos
  let plan = await planPost(input.brief, input.imageNotes || '', photos.length, directions, contentCount)
  const written = () => Math.max(plan.slides.length, input.slides?.length ?? 0)
  if (contentCount && written() < contentCount) {
    // L'AI ha scritto meno slide di quelle chieste: un altro tentativo, poi si completano.
    const again = await planPost(input.brief, input.imageNotes || '', photos.length, directions, contentCount).catch(() => null)
    if (again && again.slides.length > plan.slides.length) plan = again
    if (!written()) throw new Error('il carosello non ha slide, riprova con più indicazioni')
  }
  if (input.slides?.length) {
    plan.slides = contentCount === undefined ? input.slides.slice(0, 8) : [...input.slides, ...plan.slides.slice(input.slides.length)].slice(0, contentCount)
  }
  if (input.hook?.trim()) plan.hook = input.hook.trim().slice(0, 60)
  if (input.caption?.trim()) plan.caption = limitHashtags(input.caption.trim()).slice(0, 2200)
  if (input.facebook?.trim()) plan.facebook = input.facebook.trim().slice(0, 5000)
  // Almeno una slide per ogni foto di Luca (senza superare il numero chiesto) e mai meno di quelle chieste.
  const slots = Math.min(slidePhotos.length, contentCount ?? 8)
  while (plan.slides.length < Math.max(slots, contentCount ?? 0)) plan.slides.push({ title: plan.title, text: '' })
  const unusedPhotos = slidePhotos.length - slots

  const carousel = await createCarousel(plan.title, plan.slides, input.brief, coverPhoto, {
    // Il giro della super chat dura ~4 minuti: alle immagini AI ne lasciamo meno di 2.
    imageSeconds: 100,
    hook: plan.hook,
    mix: await nextPaletteMix(),
    imageNotes: directions || null,
    photos: slidePhotos,
    onlyMyImages: input.onlyMyImages,
    label: plan.label,
    cta: plan.cta,
    maxSlides: contentCount ?? 8,
  })
  const now = new Date().toISOString()
  const draft: PostDraft = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    title: plan.title,
    hook: plan.hook,
    slides: plan.slides.slice(0, contentCount ?? 8),
    caption: plan.caption,
    facebook: plan.facebook,
    urls: carousel.urls,
    photos,
    status: 'draft',
    ...(carousel.source ? { source: carousel.source } : {}),
    createdAt: now,
    updatedAt: now,
  }
  await save(draft)
  return { ...draft, unusedPhotos }
}

/**
 * Pubblica la bozza su Instagram e/o Facebook (testi eventualmente modificati da Luca),
 * con le slide salvate, nell'ordine salvato. base: le slide che Luca ha davanti; se le
 * slide salvate sono diverse (cambiate da un'altra parte) DraftConflictError e non esce niente.
 */
export async function publishPostDraft(
  id: string,
  options: { platforms?: ('instagram' | 'facebook')[]; caption?: string; facebook?: string; base?: string[] } = {}
): Promise<PostDraft> {
  const loaded = await loadPostDraft(id)
  if (!loaded) throw new Error('bozza non trovata')
  if (options.base?.length && !sameSlides(options.base, loaded.urls)) throw new DraftConflictError(loaded)
  if (publishingNow(loaded)) throw new Error('pubblicazione già in corso')
  // Si pubblica solo dove non e' gia' uscito (es. Instagram fallito, Facebook riuscito).
  const wanted = options.platforms?.length ? options.platforms : (['instagram', 'facebook'] as const)
  if (!wanted.filter((p) => !loaded.results?.[p]).length) return loaded
  // Si prenota la pubblicazione solo se intanto le slide non sono cambiate (una modifica
  // finita proprio ora): cosi' esce esattamente il carosello che Luca ha visto.
  const draft = await updatePostDraft(id, loaded.urls, (current) => {
    if (publishingNow(current)) throw new Error('pubblicazione già in corso')
    const next: PostDraft = { ...current, status: 'publishing' }
    if (options.caption?.trim()) next.caption = options.caption.trim().slice(0, 2200)
    // Anche le bozze di prima: su Instagram al massimo 5 hashtag.
    next.caption = limitHashtags(next.caption)
    if (options.facebook?.trim()) next.facebook = options.facebook.trim().slice(0, 5000)
    return next
  })
  const previous = draft.results || {}
  const platforms = wanted.filter((p) => !previous[p])

  const results: NonNullable<PostDraft['results']> = { instagram: previous.instagram, facebook: previous.facebook, errors: [] }
  if (platforms.includes('instagram')) {
    const sent = await publishInstagramCarousel(draft.urls, draft.caption)
    if (sent.error) results.errors!.push(`Instagram: ${sent.error}`)
    else results.instagram = sent.id || 'ok'
  }
  if (platforms.includes('facebook')) {
    const sent = await publishPagePhotos(draft.urls, draft.facebook || draft.caption)
    if (sent.error) results.errors!.push(`Facebook: ${sent.error}`)
    else results.facebook = sent.id || 'ok'
  }
  draft.results = results
  draft.status = results.instagram || results.facebook ? 'published' : 'error'
  draft.updatedAt = new Date().toISOString()
  await save(draft)
  console.log(`super chat post "${draft.title}": ${draft.status}${results.errors?.length ? ` (${results.errors.join(' | ')})` : ''}`)
  return draft
}

/** Carosello gia' pubblicato (es. dal blog): salvato come bozza per poterlo ripubblicare dove non e' uscito. */
export async function recordCarousel(input: {
  title: string
  hook: string | null
  slides: Slide[]
  caption: string
  facebook: string
  urls: string[]
  results: NonNullable<PostDraft['results']>
  source?: CarouselSource | null
}): Promise<PostDraft> {
  const now = new Date().toISOString()
  const draft: PostDraft = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    title: input.title,
    hook: input.hook || input.title,
    slides: input.slides,
    caption: input.caption,
    facebook: input.facebook,
    urls: input.urls,
    photos: [],
    status: input.results.instagram || input.results.facebook ? 'published' : input.results.errors?.length ? 'error' : 'draft',
    results: input.results,
    ...(input.source ? { source: input.source } : {}),
    createdAt: now,
    updatedAt: now,
  }
  await save(draft).catch((error) => console.warn('carosello non salvato:', error instanceof Error ? error.message : error))
  return draft
}

/** Ultimi caroselli (creati dalla super chat o dal blog), dal piu' recente. */
export async function recentPostDrafts(limit = 10): Promise<PostDraft[]> {
  const { data } = await supabaseAdmin.from('app_settings').select('value, updated_at').like('key', `${PREFIX}%`).order('updated_at', { ascending: false }).limit(limit)
  return (data || []).flatMap((row) => {
    try {
      return [JSON.parse(row.value) as PostDraft]
    } catch {
      return []
    }
  })
}

/** Bozza nuova da un carosello gia' pronto (immagini e testi dati). */
export async function draftFromCarousel(input: {
  title: string
  hook: string
  slides: Slide[]
  caption: string
  facebook: string
  urls: string[]
  source?: CarouselSource | null
}): Promise<PostDraft> {
  const now = new Date().toISOString()
  const { source, ...rest } = input
  const draft: PostDraft = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    ...rest,
    photos: [],
    status: 'draft',
    ...(source ? { source } : {}),
    createdAt: now,
    updatedAt: now,
  }
  await save(draft)
  return draft
}
