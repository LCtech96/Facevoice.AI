import { callAI, hasAIProvider } from '@/lib/ai'
import { limitHashtags } from '@/lib/hashtags'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createCarousel, type CarouselSource, type Cta, type Slide } from '@/lib/blog-image'
import { loadContentDirections, nextPaletteMix } from '@/lib/content-directions'
import { publishInstagramCarousel, publishPagePhotos } from '@/lib/meta/graph'
import { updateSetting } from '@/lib/settings-store'
import { sendPushToAdmins } from '@/lib/push'

// Caroselli creati dalla super chat (anche con le foto e gli screenshot di Luca):
// l'AI scrive gancio, slide e didascalie dalle indicazioni di Luca, il sito crea
// le immagini con i colori del marchio e il post resta in BOZZA finche' Luca non
// preme "Pubblica" (o chiede esplicitamente di pubblicarlo).

const PREFIX = 'content_post:'
export type SocialPlatform = 'instagram' | 'facebook'

export type PostDraft = {
  id: string
  title: string
  hook: string
  slides: Slide[]
  caption: string
  facebook: string
  urls: string[]
  photos: string[]
  status: 'draft' | 'scheduled' | 'publishing' | 'published' | 'error'
  results?: { instagram?: string; facebook?: string; errors?: string[] }
  /** Uscita programmata (ISO): il cron lo pubblica a quell'ora (status 'scheduled'). */
  scheduledAt?: string | null
  /** Dove pubblicarlo quando e' programmato (senza = Instagram e Facebook). */
  platforms?: SocialPlatform[]
  /** Creato dall'autopilota foto con "chiedi conferma": aspetta l'approvazione di Luca. */
  needsApproval?: boolean
  /** Da dove arriva (per l'Overview): super chat o autopilota della Libreria foto. */
  origin?: 'chat' | 'autopilot'
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

export type Plan = { title: string; hook: string; label: string; slides: Slide[]; caption: string; facebook: string; cta: Cta }

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
  const plan = planFromJson(JSON.parse(json), contentCount)
  // Con un numero chiesto da Luca le slide mancanti le gestisce chi chiama (nuovo tentativo).
  if (!plan.slides.length && contentCount === undefined) throw new Error('il carosello non ha slide, riprova con più indicazioni')
  return plan
}

/** Testi del carosello scritti dall'AI (JSON gia' letto), ripuliti e accorciati. maxSlides: slide di contenuto al massimo. */
export function planFromJson(data: Record<string, unknown>, maxSlides?: number): Plan {
  const slides = (Array.isArray(data.slides) ? data.slides : [])
    .map((s: { title?: unknown; text?: unknown }) => ({ title: trim(s?.title, 70), text: trim(s?.text, 230) }))
    .filter((s: Slide) => s.title && s.text)
    .slice(0, maxSlides ?? 8)
  const cta = (data.cta || {}) as Record<string, unknown>
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
  /** Testi gia' scritti (autopilota foto): nessuna chiamata in piu' all'AI. */
  plan?: Plan
  extra?: Pick<PostDraft, 'needsApproval' | 'origin' | 'platforms'>
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
  let plan = input.plan ? { ...input.plan, slides: [...input.plan.slides] } : await planPost(input.brief, input.imageNotes || '', photos.length, directions, contentCount)
  const written = () => Math.max(plan.slides.length, input.slides?.length ?? 0)
  if (contentCount && written() < contentCount && !input.plan) {
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
    ...(input.extra || {}),
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
  return sendClaimed(draft, wanted)
}

/** Manda ai social una bozza gia' prenotata (status 'publishing'), solo dove non e' gia' uscita, e salva l'esito. */
async function sendClaimed(draft: PostDraft, wanted: readonly SocialPlatform[]): Promise<PostDraft> {
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
  draft.needsApproval = false
  draft.updatedAt = new Date().toISOString()
  await save(draft)
  console.log(`super chat post "${draft.title}": ${draft.status}${results.errors?.length ? ` (${results.errors.join(' | ')})` : ''}`)
  return draft
}

// ---------------------------------------------------------------------
// Caroselli programmati: escono da soli all'ora scelta (cron ogni minuto)
// ---------------------------------------------------------------------

const PLATFORM_NAME: Record<SocialPlatform, string> = { instagram: 'Instagram', facebook: 'Facebook' }
/** Pubblicazione programmata partita e mai finita (funzione fermata): oltre questo tempo si segnala l'errore. */
const SCHEDULED_STALE_MS = 15 * 60_000

const cleanPlatforms = (value: unknown): SocialPlatform[] => {
  const list = (Array.isArray(value) ? value : []).filter((p): p is SocialPlatform => p === 'instagram' || p === 'facebook')
  return list.length ? [...new Set(list)] : ['instagram', 'facebook']
}

/**
 * Programma (o riprogramma) un carosello: esce all'ora scelta con le slide che ci sono in
 * quel momento. base: le slide viste da Luca sulla scheda (se intanto sono cambiate,
 * DraftConflictError). when nel passato (fino a 1 minuto) = esce al prossimo giro del cron.
 */
export async function schedulePostDraft(
  id: string,
  input: { scheduledAt: string; platforms?: unknown; base?: string[]; caption?: string; facebook?: string; approve?: boolean }
): Promise<PostDraft> {
  const at = Date.parse(input.scheduledAt)
  if (!Number.isFinite(at)) throw new DraftError('Data e ora non valide.')
  if (at < Date.now() - 60_000 && !input.approve) throw new DraftError('Questa data è già passata: scegli un orario futuro.')
  // Senza canali indicati restano quelli gia' scelti (es. autopilota solo Instagram).
  const chosen = input.platforms === undefined ? null : cleanPlatforms(input.platforms)
  const loaded = await loadPostDraft(id)
  if (!loaded) throw new DraftError('Carosello non trovato', 404)
  return updatePostDraft(id, input.base?.length ? input.base : loaded.urls, (current) => {
    if (current.status === 'publishing' && publishingNow(current)) throw new DraftError('Pubblicazione già in corso.', 409)
    const platforms = chosen || (current.platforms?.length ? current.platforms : cleanPlatforms(undefined))
    const missing = platforms.filter((p) => !current.results?.[p])
    if (!missing.length) throw new DraftError('Questo carosello è già pubblicato dove chiesto.', 409)
    const next: PostDraft = { ...current, status: 'scheduled', scheduledAt: new Date(Math.max(at, Date.now() - 60_000)).toISOString(), platforms: missing, needsApproval: false }
    if (input.caption?.trim()) next.caption = limitHashtags(input.caption.trim()).slice(0, 2200)
    if (input.facebook?.trim()) next.facebook = input.facebook.trim().slice(0, 5000)
    return next
  })
}

/** Annulla la programmazione: torna bozza (si puo' ancora pubblicare a mano). */
export async function unschedulePostDraft(id: string): Promise<PostDraft> {
  const saved = await updateSetting<PostDraft | null>(`${PREFIX}${id}`, parseDraft, (current) => {
    if (!current) throw new DraftError('Carosello non trovato', 404)
    if (current.status !== 'scheduled') throw new DraftError(current.status === 'publishing' ? 'Pubblicazione già in corso.' : 'Il carosello non è programmato.', 409)
    return { ...current, status: 'draft', scheduledAt: null, updatedAt: new Date().toISOString() }
  })
  if (!saved) throw new DraftError('Carosello non trovato', 404)
  return saved
}

const isDue = (d: PostDraft, now = Date.now()) => d.status === 'scheduled' && Boolean(d.scheduledAt) && Date.parse(d.scheduledAt!) <= now

/** Caroselli programmati (in attesa o in pubblicazione), dal piu' vicino; con needsApproval anche quelli da approvare. */
export async function listScheduledDrafts(): Promise<PostDraft[]> {
  // Filtri semplici sul testo JSON (niente tabella nuova): poi si ricontrolla lo stato vero.
  const patterns = ['%"status":"scheduled"%', '%"status":"publishing"%', '%"needsApproval":true%']
  const rows = await Promise.all(
    patterns.map(async (pattern) => {
      const { data, error } = await supabaseAdmin.from('app_settings').select('key, value').like('key', `${PREFIX}%`).like('value', pattern).limit(100)
      if (error) throw new Error(error.message)
      return (data || []) as { key: string; value: string }[]
    })
  )
  const byKey = new Map(rows.flat().map((row) => [row.key, row.value]))
  return [...byKey.values()]
    .map((value) => parseDraft(value))
    .filter((d): d is PostDraft => Boolean(d && (d.status === 'scheduled' || d.status === 'publishing' || (d.needsApproval && d.status === 'draft'))))
    .sort((a, b) => String(a.scheduledAt || a.createdAt).localeCompare(String(b.scheduledAt || b.createdAt)))
}

/**
 * Pubblica un carosello programmato arrivato all'ora: lo prende per se' (una sola funzione
 * ci riesce: due cron insieme non pubblicano due volte), lo manda e avvisa Luca con l'esito.
 * null = non era da pubblicare (gia' preso, annullato, non ancora all'ora).
 */
export async function publishScheduledDraft(id: string): Promise<PostDraft | null> {
  if (!validDraftId(id)) return null
  let mine = false
  const claimed = await updateSetting<PostDraft | null>(`${PREFIX}${id}`, parseDraft, (current) => {
    mine = false
    if (!current || !isDue(current)) return false
    mine = true
    return { ...current, status: 'publishing', updatedAt: new Date().toISOString() }
  })
  if (!claimed || !mine) return null
  const wanted = claimed.platforms?.length ? claimed.platforms : (['instagram', 'facebook'] as SocialPlatform[])
  let done: PostDraft
  try {
    done = await sendClaimed({ ...claimed, caption: limitHashtags(claimed.caption) }, wanted)
  } catch (error) {
    // Errore prima di sapere l'esito: si segnala, non si riprova da soli (niente doppioni).
    done = { ...claimed, status: 'error', results: { ...claimed.results, errors: [error instanceof Error ? error.message : String(error)] }, updatedAt: new Date().toISOString() }
    await save(done).catch(() => undefined)
  }
  await notifyCarousel(done)
  return done
}

export async function notifyCarousel(draft: PostDraft, prefix = 'Carosello') {
  const wanted = draft.platforms?.length ? draft.platforms : (['instagram', 'facebook'] as SocialPlatform[])
  const ok = wanted.filter((p) => draft.results?.[p]).map((p) => PLATFORM_NAME[p])
  const errors = draft.results?.errors || []
  const title = !ok.length ? `${prefix} non pubblicato` : errors.length ? `${prefix} pubblicato in parte` : `${prefix} pubblicato`
  const body = [ok.length ? `Uscito su ${ok.join(' e ')}: «${draft.title}»` : `«${draft.title}»`, ...errors].join('\n').slice(0, 300)
  await sendPushToAdmins({ title, body, url: '/admin/overview', tag: `carosello-${draft.id}` }).catch(() => undefined)
}

/**
 * Cron: caroselli programmati arrivati all'ora (al massimo 3 per giro). launch avvia la
 * pubblicazione in una funzione a parte (con piu' tempo); i caroselli rimasti "in
 * pubblicazione" troppo a lungo diventano errore con un avviso (non si ripubblicano da soli).
 */
export async function scheduledDraftsTick(launch: (id: string) => Promise<unknown>): Promise<{ started: number }> {
  const list = await listScheduledDrafts()
  const now = Date.now()
  for (const stale of list.filter((d) => d.status === 'publishing' && d.scheduledAt && now - Date.parse(d.updatedAt) > SCHEDULED_STALE_MS)) {
    const marked = await updateSetting<PostDraft | null>(`${PREFIX}${stale.id}`, parseDraft, (current) => {
      if (!current || current.status !== 'publishing' || Date.now() - Date.parse(current.updatedAt) <= SCHEDULED_STALE_MS) return false
      const errors = [...(current.results?.errors || []), 'Pubblicazione interrotta: controlla su Instagram e Facebook se è uscito prima di riprovare.']
      return { ...current, status: current.results?.instagram || current.results?.facebook ? 'published' : 'error', results: { ...current.results, errors }, updatedAt: new Date().toISOString() }
    }).catch(() => null)
    if (marked && marked.status !== 'publishing') await notifyCarousel(marked)
  }
  const due = list.filter((d) => isDue(d, now)).slice(0, 3)
  for (const d of due) await launch(d.id).catch((error) => console.error(`carosello programmato ${d.id}:`, error instanceof Error ? error.message : error))
  return { started: due.length }
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
