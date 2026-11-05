import { callAI, hasAIProvider } from '@/lib/ai'
import { readSetting, updateSetting } from '@/lib/settings-store'
import { carouselLength, DEFAULT_LABEL, newSlideImage, renderCarouselSlides, type CarouselSource, type Slide } from '@/lib/blog-image'
import {
  DraftConflictError,
  DraftError,
  loadPostDraft,
  MIN_IMAGES,
  publishingNow,
  sameSlides,
  updatePostDraft,
  validDraftId,
  type PostDraft,
} from '@/lib/social-posts'

// Modifiche a UNA o piu' slide di un carosello in bozza della super chat (come nella
// beta): testo a mano, richiesta all'AI, nuovo ordine, slide tolte, annulla.
// Si rifanno SOLO le slide cambiate: le altre restano gli stessi file (stesso
// indirizzo). Se cambia il numero di slide si rifanno tutte (il "02 / 05" cambia).
// Ogni modifica parte dalle slide che Luca ha davanti (base): se intanto il
// carosello e' cambiato si ferma con DraftConflictError (409) e la versione attuale.
// Le versioni precedenti stanno in app_settings, chiave content_post_ver:<id> (con il
// trattino basso: "content_post:..." finirebbe nell'elenco dei caroselli).

const VERSIONS = 'content_post_ver:'
const MAX_VERSIONS = 20

/** Lunghezze massime dei testi delle slide (le stesse dei caroselli creati dall'AI). */
export const SLIDE_LIMITS = { hook: 60, label: 40, subtitle: 120, title: 70, text: 230, ctaTitle: 70, ctaText: 180, button: 30 }

export type SlideKind = 'cover' | 'content' | 'closing'

/** Una slide come la vede la scheda: n da 1, testi attuali e indirizzo dell'immagine. */
export type SlideOutline = {
  n: number
  kind: SlideKind
  url: string
  /** Copertina. */
  hook?: string
  label?: string
  subtitle?: string
  /** Slide di contenuto e slide finale. */
  title?: string
  text?: string
  /** Slide finale. */
  button?: string
  /** C'e' una foto nella slide; mine: e' una foto di Luca. */
  image: boolean
  mine?: boolean
}

/** Testi nuovi per la slide n (si cambiano solo i campi presenti). */
export type SlideEdit = { n: number; hook?: string; label?: string; subtitle?: string; title?: string; text?: string; button?: string }

export type EditOutcome = { draft: PostDraft; done: string[]; changed: boolean }

type DraftVersion = { at: string; urls: string[]; source: CarouselSource; slides: Slide[]; hook: string }

const clean = (value: string, max: number) => value.replace(/\s+/g, ' ').trim().slice(0, max)
const published = (draft: PostDraft) => Boolean(draft.results?.instagram || draft.results?.facebook)
const fits = (draft: PostDraft) => Boolean(draft.source && carouselLength(draft.source) === draft.urls.length)

/** Si possono cambiare le slide: ci sono i dati per rifarle e non e' (ne' sta per essere) pubblicato. */
export const isEditable = (draft: PostDraft) => fits(draft) && !published(draft) && !publishingNow(draft)

function editableSource(draft: PostDraft): CarouselSource {
  if (published(draft)) throw new DraftError('Questo carosello è già pubblicato: non si può più modificare.')
  if (publishingNow(draft)) throw new DraftError('Il carosello si sta pubblicando: aspetta un momento.')
  if (!draft.source || !fits(draft)) throw new DraftError('Questo carosello è di prima: rifallo per modificare le slide.')
  return draft.source
}

const kindAt = (source: CarouselSource, k: number): SlideKind => (k === 0 ? 'cover' : k <= source.slides.length ? 'content' : 'closing')

const copy = (source: CarouselSource): CarouselSource => ({ ...source, slides: source.slides.map((s) => ({ ...s })), cta: source.cta ? { ...source.cta } : null })

/** Tutto quello che entra nel disegno della slide k: se non cambia, la slide resta lo stesso file. */
const slideKey = (source: CarouselSource, k: number) =>
  JSON.stringify(
    kindAt(source, k) === 'cover'
      ? [source.hook, source.label ?? DEFAULT_LABEL, source.subtitle, source.cover]
      : kindAt(source, k) === 'content'
        ? source.slides[k - 1]
        : source.cta
  )

/** Le slide del carosello per la scheda (null se il carosello non si puo' modificare slide per slide). */
export function carouselOutline(draft: PostDraft): SlideOutline[] | null {
  const s = draft.source
  if (!s || !fits(draft)) return null
  return [
    { n: 1, kind: 'cover' as const, url: draft.urls[0], hook: s.hook, label: s.label ?? DEFAULT_LABEL, subtitle: s.subtitle, image: Boolean(s.cover) },
    ...s.slides.map((x, k) => ({ n: k + 2, kind: 'content' as const, url: draft.urls[k + 1], title: x.title, text: x.text, image: Boolean(x.image), mine: Boolean(x.image && x.mine) })),
    ...(s.cta ? [{ n: s.slides.length + 2, kind: 'closing' as const, url: draft.urls[s.slides.length + 1], title: s.cta.title, text: s.cta.text, button: s.cta.button, image: false }] : []),
  ]
}

/** Bozza come la riceve la scheda della super chat. */
export function draftView(draft: PostDraft) {
  return {
    id: draft.id,
    title: draft.title,
    hook: draft.hook,
    urls: draft.urls,
    caption: draft.caption,
    facebook: draft.facebook,
    status: draft.status,
    results: draft.results,
    editable: isEditable(draft),
    updatedAt: draft.updatedAt,
  }
}

// ---------------------------------------------------------------------
// Versioni (per annullare)
// ---------------------------------------------------------------------

const parseVersions = (raw: string | null): DraftVersion[] => {
  try {
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

async function readVersions(id: string): Promise<DraftVersion[]> {
  return parseVersions((await readSetting(`${VERSIONS}${id}`)).value)
}

/** Versioni precedenti, dalla piu' recente (senza quella uguale al carosello attuale). */
export async function draftVersions(draft: PostDraft): Promise<{ at: string; slides: number; cover: string; urls: string[] }[]> {
  if (!validDraftId(draft.id)) return []
  const list = await readVersions(draft.id).catch(() => [])
  return list
    .filter((v) => !sameSlides(v.urls, draft.urls))
    .reverse()
    .map((v) => ({ at: v.at, slides: v.urls.length, cover: v.urls[0], urls: v.urls }))
}

/** Salva lo stato attuale tra le versioni (prima di cambiarlo). */
async function keepVersion(draft: PostDraft) {
  if (!draft.source) return
  const version: DraftVersion = { at: new Date().toISOString(), urls: draft.urls, source: draft.source, slides: draft.slides, hook: draft.hook }
  await updateSetting(`${VERSIONS}${draft.id}`, parseVersions, (list) => [...list.filter((v) => !sameSlides(v.urls, draft.urls)), version].slice(-MAX_VERSIONS))
}

async function dropVersion(id: string, at: string) {
  await updateSetting(`${VERSIONS}${id}`, parseVersions, (list) => (list.some((v) => v.at === at) ? list.filter((v) => v.at !== at) : false)).catch((error) =>
    console.warn('carosello: versione non tolta:', error instanceof Error ? error.message : error)
  )
}

// ---------------------------------------------------------------------
// Modifiche
// ---------------------------------------------------------------------

/** Carica la bozza e controlla che Luca stia guardando proprio questa versione. */
async function start(id: string, base: string[]) {
  const draft = await loadPostDraft(id)
  if (!draft) throw new DraftError('Carosello non trovato', 404)
  if (!sameSlides(base, draft.urls)) throw new DraftConflictError(draft)
  return { draft, source: copy(editableSource(draft)) }
}

/** Salva le slide nuove (la versione di prima resta per annullare). */
async function commit(draft: PostDraft, base: string[], source: CarouselSource, urls: string[]): Promise<PostDraft> {
  // Senza la versione di prima si salva lo stesso (solo non si potra' annullare).
  await keepVersion(draft).catch((error) => console.warn('carosello: versione non salvata:', error instanceof Error ? error.message : error))
  return updatePostDraft(draft.id, base, (current) => {
    editableSource(current)
    return { ...current, urls, source, hook: source.hook, slides: source.slides.map(({ title, text }) => ({ title, text })) }
  })
}

/** Rifa' solo le slide in redo, salva e restituisce la bozza aggiornata. */
async function redoSlides(draft: PostDraft, base: string[], source: CarouselSource, redo: Set<number>) {
  const urls = await renderCarouselSlides(
    source,
    draft.urls.map((url, k) => (redo.has(k) ? null : url))
  )
  console.log(`super chat carosello ${draft.id}: rifatte solo le slide ${[...redo].sort((a, b) => a - b).map((k) => k + 1).join(', ')}`)
  return commit(draft, base, source, urls)
}

/** Applica i testi nuovi alla slide e dice se e' cambiata. */
function applyEdit(source: CarouselSource, edit: SlideEdit): boolean {
  const k = edit.n - 1
  const before = slideKey(source, k)
  const value = (v: unknown, max: number) => (typeof v === 'string' ? clean(v, max) : undefined)
  const kind = kindAt(source, k)
  if (kind === 'cover') {
    const hook = value(edit.hook, SLIDE_LIMITS.hook)
    if (hook !== undefined) {
      if (!hook) throw new DraftError('Il gancio della copertina non può essere vuoto.')
      source.hook = hook
    }
    const label = value(edit.label, SLIDE_LIMITS.label)
    if (label !== undefined && label !== (source.label ?? DEFAULT_LABEL)) source.label = label
    const subtitle = value(edit.subtitle, SLIDE_LIMITS.subtitle)
    if (subtitle !== undefined) source.subtitle = subtitle
  } else if (kind === 'content') {
    const slide = source.slides[k - 1]
    const title = value(edit.title, SLIDE_LIMITS.title)
    if (title !== undefined) {
      if (!title) throw new DraftError(`Il titolo della slide ${edit.n} non può essere vuoto.`)
      slide.title = title
    }
    const text = value(edit.text, SLIDE_LIMITS.text)
    if (text !== undefined) slide.text = text
  } else if (source.cta) {
    const title = value(edit.title, SLIDE_LIMITS.ctaTitle)
    if (title !== undefined) {
      if (!title) throw new DraftError('Il titolo della slide finale non può essere vuoto.')
      source.cta.title = title
    }
    const text = value(edit.text, SLIDE_LIMITS.ctaText)
    if (text !== undefined) source.cta.text = text
    const button = value(edit.button, SLIDE_LIMITS.button)
    if (button !== undefined) {
      if (!button) throw new DraftError('Il pulsante della slide finale non può essere vuoto.')
      source.cta.button = button
    }
  }
  return slideKey(source, k) !== before
}

function slideNumber(value: unknown, n: number): number {
  const pos = Math.round(Number(value))
  if (!(pos >= 1 && pos <= n)) throw new DraftError(`Slide ${String(value)} non trovata: il carosello ne ha ${n}.`)
  return pos
}

/** Testi scritti a mano da Luca per una o piu' slide. */
export async function editSlideTexts(id: string, base: string[], edits: SlideEdit[]): Promise<EditOutcome> {
  const { draft, source } = await start(id, base)
  const n = carouselLength(source)
  if (!edits.length) throw new DraftError('Scegli la slide da cambiare.')
  const redo = new Set<number>()
  for (const edit of edits) {
    const pos = slideNumber(edit.n, n)
    if (applyEdit(source, { ...edit, n: pos })) redo.add(pos - 1)
  }
  if (!redo.size) return { draft, done: [], changed: false }
  const saved = await redoSlides(draft, base, source, redo)
  return { draft: saved, done: [...redo].sort((a, b) => a - b).map((k) => `slide ${k + 1}: testo cambiato`), changed: true }
}

const EDIT_PROMPT = `Sei il social media manager di Facevoice AI (agenzia digitale e software house a Terrasini, Palermo).
Correggi SOLO le slide di un carosello Instagram indicate qui sotto, seguendo la richiesta di Luca (il titolare). Le altre slide non esistono per te: non nominarle e non cambiarle.
Per ogni slide indicata restituisci SOLO i campi da cambiare (ometti quelli che restano uguali):
- copertina: "gancio" (titolo grande, max 42 caratteri, niente emoji, niente punto finale), "etichetta" (sopra il gancio, max 34 caratteri, "" per toglierla), "sottotitolo" (riga piccola sotto il gancio, max 90 caratteri, "" per toglierla);
- slide normale: "titolo" (max 55 caratteri), "testo" (max 190 caratteri);
- slide finale: "titolo" (max 50 caratteri), "testo" (max 150 caratteri), "pulsante" (max 26 caratteri);
- "immagine": SOLO se la richiesta chiede un'immagine nuova o diversa (non per la slide finale): scrivi in breve cosa deve mostrare, la crea l'AI;
- "senza_immagine": true SOLO se la richiesta chiede di togliere l'immagine dalla slide.
Se la richiesta riguarda solo il testo non toccare l'immagine, e viceversa. Se Luca scrive le parole esatte (es. «scrivi: …»), usale così come sono.
Usa solo le informazioni di Luca e quelle già nelle slide: niente numeri, clienti o risultati inventati. Scrivi nella lingua della richiesta. Niente markdown.
Rispondi SOLO con JSON: {"slide": [{"n": 2, "titolo": "…"}]}`

/** Stato attuale delle slide scelte, come lo vede l'AI. */
function describe(source: CarouselSource, n: number) {
  const k = n - 1
  const kind = kindAt(source, k)
  if (kind === 'cover') return { n, copertina: true, gancio: source.hook, etichetta: source.label ?? DEFAULT_LABEL, sottotitolo: source.subtitle, immagine: source.cover ? 'sì' : 'nessuna' }
  if (kind === 'content') {
    const s = source.slides[k - 1]
    return { n, titolo: s.title, testo: s.text, immagine: s.image ? (s.mine ? 'foto di Luca' : 'creata dall’AI') : 'nessuna' }
  }
  return { n, slide_finale: true, titolo: source.cta?.title, testo: source.cta?.text, pulsante: source.cta?.button }
}

/**
 * Correzione delle SOLE slide scelte (n da 1) con una richiesta all'AI, che vede solo
 * quelle slide: testi e, se Luca lo chiede, un'immagine nuova o nessuna immagine.
 * Le altre slide restano gli stessi file; niente riordino, niente slide tolte.
 */
export async function editSlidesAI(id: string, base: string[], numbers: number[], instruction: string): Promise<EditOutcome> {
  const request = instruction.trim().slice(0, 1500)
  if (!request) throw new DraftError('Scrivi cosa cambiare nella slide.')
  if (!hasAIProvider()) throw new DraftError('Manca una chiave AI.')
  const { draft, source } = await start(id, base)
  const n = carouselLength(source)
  const picked = [...new Set(numbers.map((x) => Math.round(Number(x))))].filter((x) => x >= 1 && x <= n).sort((a, b) => a - b)
  if (!picked.length) throw new DraftError(`Scegli le slide da cambiare (da 1 a ${n}).`)

  const result = await callAI(
    [{ role: 'user', content: `Slide da correggere (stato attuale):\n${JSON.stringify(picked.map((p) => describe(source, p)))}\n\nRichiesta di Luca: ${request}` }],
    EDIT_PROMPT,
    { feature: 'super_chat_slide', temperature: 0.3, maxOutputTokens: Math.min(4000, 600 + 220 * picked.length) }
  )
  let answer: { slide?: Record<string, unknown>[] } = {}
  try {
    answer = JSON.parse((result.message || '').match(/\{[\s\S]*\}/)?.[0] || '{}')
  } catch {}
  const allowed = new Set(picked)
  const changes = (Array.isArray(answer.slide) ? answer.slide : []).filter((c) => c && allowed.has(Math.round(Number(c.n))))
  const text = (v: unknown) => (typeof v === 'string' ? v : undefined)

  const redo = new Set<number>()
  const done: string[] = []
  const newImages: { k: number; description: string }[] = []
  for (const c of changes) {
    const pos = Math.round(Number(c.n))
    const k = pos - 1
    const kind = kindAt(source, k)
    const edit: SlideEdit =
      kind === 'cover'
        ? { n: pos, hook: text(c.gancio), label: text(c.etichetta), subtitle: text(c.sottotitolo) }
        : kind === 'content'
          ? { n: pos, title: text(c.titolo), text: text(c.testo) }
          : { n: pos, title: text(c.titolo), text: text(c.testo), button: text(c.pulsante) }
    // Un campo vuoto dove non e' permesso (es. gancio "") si ignora: resta quello di prima.
    if (kind === 'cover' && !edit.hook?.trim()) delete edit.hook
    if (kind !== 'cover' && !edit.title?.trim()) delete edit.title
    if (kind === 'closing' && !edit.button?.trim()) delete edit.button
    if (applyEdit(source, edit)) {
      redo.add(k)
      done.push(`slide ${pos}: testo cambiato`)
    }
    if (kind === 'closing') continue
    if (c.senza_immagine === true) {
      const had = kind === 'cover' ? source.cover : source.slides[k - 1].image
      if (had) {
        if (kind === 'cover') source.cover = null
        else source.slides[k - 1] = { ...source.slides[k - 1], image: null, mine: false }
        redo.add(k)
        done.push(`slide ${pos}: immagine tolta`)
      }
    } else {
      const description = text(c.immagine)?.trim()
      if (description) newImages.push({ k, description })
    }
  }
  if (newImages.length > 2) throw new DraftError('Per le immagini nuove scegli al massimo 2 slide per volta.')
  // Immagini nuove una alla volta (limite al minuto dell'AI), entro 2 minuti e mezzo.
  const deadline = Date.now() + 150_000
  for (const wish of newImages) {
    const url = await newSlideImage(source, wish.k, wish.description, deadline).catch(() => null)
    if (!url) {
      done.push(`slide ${wish.k + 1}: immagine nuova non riuscita, riprova`)
      continue
    }
    if (wish.k === 0) source.cover = url
    else source.slides[wish.k - 1] = { ...source.slides[wish.k - 1], image: url, mine: false }
    redo.add(wish.k)
    done.push(`slide ${wish.k + 1}: immagine nuova`)
  }
  if (!redo.size) return { draft, done, changed: false }
  const saved = await redoSlides(draft, base, source, redo)
  return { draft: saved, done: [...new Set(done)], changed: true }
}

/**
 * Nuovo ordine delle slide: numeri attuali (da 1) nell'ordine voluto; quelli che
 * mancano si tolgono. La copertina resta la prima; la slide finale resta l'ultima
 * (si puo' solo togliere). Con lo stesso numero di slide si rifanno solo quelle che
 * hanno cambiato posto; se il numero cambia si rifanno tutte (cambia "N / M").
 */
export async function arrangeSlides(id: string, base: string[], sequence: number[]): Promise<EditOutcome> {
  const { draft, source } = await start(id, base)
  const n = carouselLength(source)
  const order = sequence.map((x) => Math.round(Number(x)))
  if (!order.length || order.some((x) => !(x >= 1 && x <= n)) || new Set(order).size !== order.length) throw new DraftError('Ordine delle slide non valido.')
  if (order[0] !== 1) throw new DraftError('La copertina resta la prima slide: non si può spostare né togliere.')
  const closing = source.cta ? n : null
  if (closing && order.includes(closing) && order[order.length - 1] !== closing) throw new DraftError('La slide finale resta l’ultima: puoi solo toglierla.')
  if (order.length < MIN_IMAGES) throw new DraftError(`Servono almeno ${MIN_IMAGES} slide per un carosello.`)
  if (order.length === n && order.every((x, i) => x === i + 1)) return { draft, done: [], changed: false }

  const next: CarouselSource = {
    ...source,
    slides: order.filter((x) => x !== 1 && x !== closing).map((x) => source.slides[x - 2]),
    cta: closing && order.includes(closing) ? source.cta : null,
  }
  const m = carouselLength(next)
  // Stesso numero di slide: la slide rimasta allo stesso posto e' identica, resta lo stesso file.
  const keep = m === n ? order.map((x, i) => (x === i + 1 ? draft.urls[i] : null)) : []
  const urls = await renderCarouselSlides(next, keep)
  const saved = await commit(draft, base, next, urls)

  const removed = Array.from({ length: n }, (_, i) => i + 1).filter((x) => !order.includes(x))
  const kept = order.filter((x) => !removed.includes(x))
  const done = [
    removed.length ? (removed.length === 1 ? `tolta la slide ${removed[0]}` : `tolte le slide ${removed.join(', ')}`) : '',
    kept.some((x, i) => i > 0 && x < kept[i - 1]) ? 'nuovo ordine salvato' : '',
    m !== n ? `numeri aggiornati su tutte le slide (ora sono ${m})` : '',
  ].filter(Boolean)
  return { draft: saved, done, changed: true }
}

/** Torna alla versione salvata at; quella attuale resta tra le versioni. */
export async function restoreDraftVersion(id: string, base: string[], at: string): Promise<EditOutcome> {
  const { draft } = await start(id, base)
  const version = (await readVersions(id)).find((v) => v.at === at && !sameSlides(v.urls, draft.urls))
  if (!version) throw new DraftError('Versione non trovata.')
  await keepVersion(draft)
  const saved = await updatePostDraft(id, base, (current) => {
    editableSource(current)
    return { ...current, urls: version.urls, source: version.source, slides: version.slides, hook: version.hook }
  })
  await dropVersion(id, version.at)
  return { draft: saved, done: ['versione ripresa'], changed: true }
}

/** Annulla l'ultima modifica: torna alla versione precedente (che esce dall'elenco). */
export async function undoLastChange(id: string, base: string[]): Promise<EditOutcome> {
  const { draft } = await start(id, base)
  const last = (await readVersions(id)).filter((v) => !sameSlides(v.urls, draft.urls)).pop()
  if (!last) throw new DraftError('Non c’è una modifica da annullare.')
  const saved = await updatePostDraft(id, base, (current) => {
    editableSource(current)
    return { ...current, urls: last.urls, source: last.source, slides: last.slides, hook: last.hook }
  })
  await dropVersion(id, last.at)
  return { draft: saved, done: ['ultima modifica annullata'], changed: true }
}

/** Tutto quello che serve alla scheda: bozza, slide e versioni per annullare. */
export async function carouselState(draft: PostDraft) {
  return {
    draft: draftView(draft),
    outline: carouselOutline(draft),
    versions: isEditable(draft) ? await draftVersions(draft) : [],
    limits: SLIDE_LIMITS,
  }
}
