import { callAI, hasAIProvider } from '@/lib/ai'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { createCarousel, type Cta, type Slide } from '@/lib/blog-image'
import { loadContentDirections, nextPaletteMix } from '@/lib/content-directions'
import { publishInstagramCarousel, publishPagePhotos } from '@/lib/meta/graph'

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
  createdAt: string
  updatedAt: string
}

type Plan = { title: string; hook: string; label: string; slides: Slide[]; caption: string; facebook: string; cta: Cta }

const PLAN_PROMPT = `Sei il social media manager di Facevoice AI (agenzia digitale e software house a Terrasini, Palermo: siti, app, automazioni, chatbot e soluzioni di intelligenza artificiale per le aziende).
Prepari un CAROSELLO per Instagram e Facebook dalle indicazioni di Luca (il titolare) e, se ci sono, dalle sue immagini (te ne do la descrizione, nell'ordine).

Regole:
- Usa solo le informazioni di Luca e quello che si vede nelle immagini: niente numeri, clienti, risultati o promesse inventate.
- "hook": il gancio della prima slide, fortissimo e concreto, massimo 42 caratteri, niente emoji, niente punto finale.
- "label": etichetta breve sopra il gancio (max 34 caratteri, es. "CASO STUDIO", "NOVITÀ", "DIETRO LE QUINTE"), oppure "" se non serve.
- "slides": da 2 a 8 slide (una per immagine di Luca, nello stesso ordine, se ci sono immagini; altrimenti 3-4). Ogni slide: "title" massimo 55 caratteri e "text" massimo 190 caratteri, chiari e utili.
- "cta": ultima slide: "title" (max 50 caratteri), "text" (max 150), "button" (max 26, es. "Scrivici su WhatsApp", "facevoice.ai").
- "caption": didascalia Instagram (max 1600 caratteri): apertura forte, 2-4 paragrafi brevi, invito all'azione, poi 5-8 hashtag pertinenti. I link non sono cliccabili su Instagram.
- "facebook": testo del post Facebook (max 1200 caratteri), simile alla didascalia ma senza hashtag in fondo; puoi mettere https://www.facevoice.ai.
- "title": titolo interno breve del post.
- Tono: chiaro, umano, professionale, in italiano (salvo diversa indicazione di Luca). Niente markdown.
Rispondi SOLO con JSON: {"title": "", "hook": "", "label": "", "slides": [{"title": "", "text": ""}], "cta": {"title": "", "text": "", "button": ""}, "caption": "", "facebook": ""}`

const trim = (value: unknown, max: number) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

async function planPost(brief: string, imageNotes: string, photoCount: number, directions: string): Promise<Plan> {
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
    PLAN_PROMPT,
    { feature: 'super_chat_carosello', temperature: 0.6, maxOutputTokens: 3000 }
  )
  const json = (result.message || '').match(/\{[\s\S]*\}/)?.[0]
  if (!json) throw new Error('l’AI non ha preparato il carosello, riprova')
  const data = JSON.parse(json)
  const slides = (Array.isArray(data.slides) ? data.slides : [])
    .map((s: { title?: unknown; text?: unknown }) => ({ title: trim(s.title, 70), text: trim(s.text, 230) }))
    .filter((s: Slide) => s.title && s.text)
    .slice(0, 8)
  if (!slides.length) throw new Error('il carosello non ha slide, riprova con più indicazioni')
  const cta = data.cta || {}
  return {
    title: trim(data.title, 120) || slides[0].title,
    hook: trim(data.hook, 60) || slides[0].title,
    label: trim(data.label, 40),
    slides,
    caption: String(data.caption || '').trim().slice(0, 2200),
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

export async function loadPostDraft(id: string): Promise<PostDraft | null> {
  if (!/^[a-z0-9]{6,40}$/.test(id)) return null
  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', `${PREFIX}${id}`).maybeSingle()
  try {
    return data?.value ? (JSON.parse(data.value) as PostDraft) : null
  } catch {
    return null
  }
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
  onlyMyImages?: boolean
  coverFromPhotos?: boolean
}): Promise<PostDraft> {
  if (!hasAIProvider()) throw new Error('manca una chiave AI')
  const photos = (input.photos || []).filter((u) => /^https:\/\//.test(u)).slice(0, 9)
  const directions = (await loadContentDirections()).text
  // Con piu' di una foto la prima fa da copertina; con una sola foto va in copertina.
  const coverPhoto = photos.length && input.coverFromPhotos !== false ? photos[0] : null
  const slidePhotos = coverPhoto && photos.length > 1 ? photos.slice(1) : coverPhoto ? [] : photos
  const plan = await planPost(input.brief, input.imageNotes || '', photos.length, directions)
  if (input.slides?.length) plan.slides = input.slides.slice(0, 8)
  if (input.hook?.trim()) plan.hook = input.hook.trim().slice(0, 60)
  if (input.caption?.trim()) plan.caption = input.caption.trim().slice(0, 2200)
  // Almeno una slide per ogni foto di Luca.
  while (plan.slides.length < slidePhotos.length) plan.slides.push({ title: plan.title, text: '' })

  const carousel = await createCarousel(plan.title, plan.slides, input.brief, coverPhoto, {
    hook: plan.hook,
    mix: await nextPaletteMix(),
    imageNotes: directions || null,
    photos: slidePhotos,
    onlyMyImages: input.onlyMyImages,
    label: plan.label,
    cta: plan.cta,
    maxSlides: 8,
  })
  const now = new Date().toISOString()
  const draft: PostDraft = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    title: plan.title,
    hook: plan.hook,
    slides: plan.slides,
    caption: plan.caption,
    facebook: plan.facebook,
    urls: carousel.urls,
    photos,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  }
  await save(draft)
  return draft
}

/** Pubblica la bozza su Instagram e/o Facebook (testi eventualmente modificati da Luca). */
export async function publishPostDraft(
  id: string,
  options: { platforms?: ('instagram' | 'facebook')[]; caption?: string; facebook?: string } = {}
): Promise<PostDraft> {
  const draft = await loadPostDraft(id)
  if (!draft) throw new Error('bozza non trovata')
  if (draft.status === 'published') return draft
  if (draft.status === 'publishing' && Date.now() - new Date(draft.updatedAt).getTime() < 5 * 60_000) throw new Error('pubblicazione già in corso')
  const platforms = options.platforms?.length ? options.platforms : (['instagram', 'facebook'] as const)
  if (options.caption?.trim()) draft.caption = options.caption.trim().slice(0, 2200)
  if (options.facebook?.trim()) draft.facebook = options.facebook.trim().slice(0, 5000)
  draft.status = 'publishing'
  draft.updatedAt = new Date().toISOString()
  await save(draft)

  const results: NonNullable<PostDraft['results']> = { errors: [] }
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
