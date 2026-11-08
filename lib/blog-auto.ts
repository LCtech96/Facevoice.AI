import { supabaseAdmin } from '@/lib/supabase-admin'
import { readSetting, updateSetting } from '@/lib/settings-store'
import { callAI, hasAIProvider } from '@/lib/ai'
import { sendPushToAdmins } from '@/lib/push'
import { SITE_URL } from '@/lib/seo/site'
import { internalOrigin } from '@/lib/internal-origin'
import { shareBlogPost } from '@/lib/blog-share'
import { loadContentDirections } from '@/lib/content-directions'
import { parseJsonObject } from '@/lib/tool-step'

// Blog automatico: nei giorni scelti, a ogni "uscita" (fino a 4 al giorno, ognuna con
// la sua ora e il suo argomento) il sito legge le ultime notizie da testate vere (feed
// RSS e Google News), l'AI scrive un articolo in italiano SOLO su quelle notizie e il
// codice aggiunge i link alle fonti, poi lo pubblica nel blog. Senza abbastanza notizie
// reali non si pubblica niente: un articolo con "scoop" inventati farebbe piu' danni
// che non pubblicare.

const SETTINGS_KEY = 'blog_auto:settings'
const STATE_KEY = 'blog_auto:state'
/** Link (e titoli) gia' usati negli articoli precedenti, di tutte le uscite: la stessa notizia non torna due volte. */
const USED_KEY = 'blog_auto:used'
const MAX_USED = 600
/** Notizie piu' vecchie di cosi' non sono "novita'" (feed delle testate). */
const MAX_AGE_MS = 5 * 86_400_000
/** Ricerche su Google News: solo gli ultimi 3 giorni. */
const SEARCH_MAX_AGE_MS = 3 * 86_400_000
const MIN_NEWS = 3

export const MAX_SLOTS = 4
/** Due uscite dello stesso giorno distano almeno cosi'. */
export const MIN_GAP_MINUTES = 30
/** Un'uscita saltata (cron fermo, generazione in corso) si recupera entro cosi' dopo la sua ora, nello stesso giorno. */
export const CATCH_UP_MINUTES = 120
export const MAX_TOPIC_LENGTH = 80
/** Una generazione "in corso" da piu' di cosi' si e' fermata (la funzione dura al massimo 5 minuti). */
const RUN_LEASE_MS = 330_000
/** L'unico orario salvato prima delle uscite multiple diventa l'uscita con questo id. */
const LEGACY_SLOT_ID = 'main'

// Token per la risposta: un articolo intero in JSON (circa 2.000-3.000 token) con margine.
// Si paga solo quello che il modello scrive davvero, quindi il margine non costa.
const ARTICLE_TOKENS = 8192
const RETRY_TOKENS = 12288
/** Gemini che ragiona sempre (non accetta thinkingBudget 0): token per il ragionamento oltre al testo. */
const THINKING_ROOM = 8192

// ---------------------------------------------------------------------
// Argomenti
// ---------------------------------------------------------------------

export type TopicPreset = { label: string; query: string; aliases: string[] }

export const AI_TOPIC_LABEL = 'Novità sull’AI'

/** Argomenti pronti (oltre a quelli scritti a mano). Le query sono per Google News. */
export const BLOG_TOPICS: TopicPreset[] = [
  { label: AI_TOPIC_LABEL, query: 'intelligenza artificiale', aliases: ['ai', 'ia', 'intelligenza artificiale', 'novita ai', 'novita sull ai', 'novita intelligenza artificiale'] },
  { label: 'Marketing digitale', query: '"marketing digitale" OR "digital marketing" OR "web marketing"', aliases: ['marketing', 'web marketing', 'digital marketing'] },
  { label: 'Social media', query: '"social media" OR Instagram OR TikTok OR Facebook novità', aliases: ['social', 'social network', 'instagram', 'facebook', 'tiktok'] },
  { label: 'Piccole imprese e PMI', query: 'PMI OR "piccole imprese" OR "piccole e medie imprese"', aliases: ['pmi', 'piccole imprese', 'imprese', 'aziende', 'piccole e medie imprese'] },
  { label: 'Tecnologia', query: 'tecnologia OR "innovazione digitale"', aliases: ['tech', 'innovazione', 'tecnologie'] },
  { label: 'Ristorazione e turismo', query: 'ristorazione OR turismo OR ristoranti OR "settore alberghiero"', aliases: ['ristorazione', 'turismo', 'ristoranti', 'hotel', 'ristorazione turismo'] },
]

const topicKey = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

export function findTopicPreset(topic: string): TopicPreset | null {
  const key = topicKey(topic)
  if (!key) return null
  return BLOG_TOPICS.find((p) => topicKey(p.label) === key || p.aliases.some((a) => topicKey(a) === key)) || null
}

/** Testo dell'argomento senza caratteri di controllo, tag e spazi doppi. */
const topicText = (raw: string) =>
  raw
    .replace(/[\u0000-\u001f\u007f<>{}`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["«“]+|["»”]+$/g, '')
    .trim()

/** Argomento pulito (nome esatto se e' uno di quelli pronti), oppure null se vuoto, troppo corto o troppo lungo. */
export function cleanTopic(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const text = topicText(raw)
  if (text.length < 3 || text.length > MAX_TOPIC_LENGTH) return findTopicPreset(text)?.label || null
  return findTopicPreset(text)?.label || text
}

export class BlogScheduleError extends Error {}

/** Argomento da un input da validare (pannello, super chat): errori chiari in italiano. Vuoto = novita' sull'AI. */
export function strictTopic(raw: unknown): string {
  if (raw === undefined || raw === null || (typeof raw === 'string' && !topicText(raw))) return AI_TOPIC_LABEL
  if (typeof raw !== 'string') throw new BlogScheduleError('Argomento non valido.')
  const text = topicText(raw)
  const preset = findTopicPreset(text)
  if (preset) return preset.label
  if (text.length > MAX_TOPIC_LENGTH) throw new BlogScheduleError(`L’argomento può avere al massimo ${MAX_TOPIC_LENGTH} caratteri.`)
  if (text.length < 3) throw new BlogScheduleError('Scrivi un argomento di almeno 3 lettere.')
  return text
}

/** Argomento letto dai dati salvati: mai un errore, al peggio le novita' sull'AI. */
const storedTopic = (raw: unknown) => cleanTopic(raw) || (typeof raw === 'string' && topicText(raw).slice(0, MAX_TOPIC_LENGTH)) || AI_TOPIC_LABEL

type ResolvedTopic = { label: string; preset: TopicPreset | null; ai: boolean }
function resolveTopic(raw: unknown): ResolvedTopic {
  const label = storedTopic(raw)
  const preset = findTopicPreset(label)
  return { label, preset, ai: preset?.label === AI_TOPIC_LABEL }
}

// ---------------------------------------------------------------------
// Impostazioni: giorni comuni + uscite (ora e argomento)
// ---------------------------------------------------------------------

export type BlogSlot = {
  id: string
  /** Ora italiana "HH:MM". */
  time: string
  topic: string
  /** Da quando vale quest'ora (nuova o cambiata): un'ora gia' passata in quel momento parte dal giorno dopo. */
  since?: string
}

export type BlogAutoSettings = {
  enabled: boolean
  /** Giorni della settimana (0 = domenica … 6 = sabato), comuni a tutte le uscite. */
  days: number[]
  /** Da 1 a 4 uscite al giorno, in ordine di ora, a 30 minuti l'una dall'altra almeno. */
  slots: BlogSlot[]
  /** Ora della prima uscita: per chi legge ancora il formato di prima. */
  time: string
  /** Ogni articolo del blog (automatico o a mano) va anche sulla Pagina Facebook. */
  shareFacebook: boolean
  /** Ogni articolo va anche su Instagram (con la copertina). */
  shareInstagram: boolean
  /** Copertina generata (AI, o grafica di riserva) per gli articoli senza immagine. */
  coverImage: boolean
}

export type BlogSlotInput = { id?: string; time?: string; topic?: string }

/** Modifica del blog automatico (pannello, super chat): solo i campi da cambiare. */
export type BlogSchedulePatch = {
  enabled?: boolean
  days?: number[]
  shareFacebook?: boolean
  shareInstagram?: boolean
  coverImage?: boolean
  /** Tutte le uscite (sostituiscono quelle di adesso). */
  slots?: BlogSlotInput[]
  /** Formato di prima: l'ora dell'unica uscita. */
  time?: string
  /** Uscite da aggiungere. */
  add?: BlogSlotInput[]
  /** Ore delle uscite da togliere ("HH:MM"). */
  remove?: string[]
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const ID_RE = /^[a-z0-9]{1,24}$/
const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
const newSlotId = () => `u${Math.random().toString(36).slice(2, 10)}`
const sortSlots = (slots: BlogSlot[]) => [...slots].sort((a, b) => minutesOf(a.time) - minutesOf(b.time))

/** "9:05", "09:05", "9.05" -> "09:05"; altrimenti null. */
export function normTime(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const m = raw.trim().match(/^(\d{1,2})[:.](\d{2})$/)
  if (!m) return null
  const time = `${m[1].padStart(2, '0')}:${m[2]}`
  return TIME_RE.test(time) ? time : null
}

const cleanDays = (list: unknown[]) => [...new Set(list.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()

const DEFAULT_SLOT: BlogSlot = { id: LEGACY_SLOT_ID, time: '09:40', topic: AI_TOPIC_LABEL }
const DEFAULTS: BlogAutoSettings = { enabled: false, days: [2, 5], slots: [DEFAULT_SLOT], time: DEFAULT_SLOT.time, shareFacebook: true, shareInstagram: true, coverImage: true }

/** Uscite dai dati salvati (tolleranti: si scarta solo cio' che non va). Formato di prima: un solo orario = una uscita sulle novita' AI. */
function readSlots(raw: unknown, legacyTime: unknown): BlogSlot[] | null {
  if (Array.isArray(raw)) {
    const ids = new Set<string>()
    const slots: BlogSlot[] = []
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const r = item as Record<string, unknown>
      const time = normTime(r.time)
      if (!time) continue
      const id = typeof r.id === 'string' && ID_RE.test(r.id) && !ids.has(r.id) ? r.id : newSlotId()
      ids.add(id)
      const since = typeof r.since === 'string' && Number.isFinite(Date.parse(r.since)) ? r.since : undefined
      slots.push({ id, time, topic: storedTopic(r.topic), ...(since ? { since } : {}) })
    }
    const kept: BlogSlot[] = []
    for (const slot of sortSlots(slots)) {
      if (!kept.some((k) => Math.abs(minutesOf(k.time) - minutesOf(slot.time)) < MIN_GAP_MINUTES)) kept.push(slot)
    }
    return kept.length ? kept.slice(0, MAX_SLOTS) : null
  }
  const time = normTime(legacyTime)
  return time ? [{ id: LEGACY_SLOT_ID, time, topic: AI_TOPIC_LABEL }] : null
}

export function cleanSettings(input: unknown, base: BlogAutoSettings = DEFAULTS): BlogAutoSettings {
  const v = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const days = Array.isArray(v.days) ? cleanDays(v.days) : base.days
  const slots = readSlots(v.slots, v.time) || base.slots.map((s) => ({ ...s }))
  const bool = (key: 'enabled' | 'shareFacebook' | 'shareInstagram' | 'coverImage') => (typeof v[key] === 'boolean' ? (v[key] as boolean) : base[key])
  return {
    enabled: bool('enabled'),
    days: days.length ? days : base.days,
    slots,
    time: slots[0].time,
    shareFacebook: bool('shareFacebook'),
    shareInstagram: bool('shareInstagram'),
    coverImage: bool('coverImage'),
  }
}

function strictSlotFields(raw: unknown): { time: string; topic: string } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const time = normTime(r.time)
  if (!time) throw new BlogScheduleError(`Orario non valido${typeof r.time === 'string' && r.time.trim() ? `: ${r.time.trim().slice(0, 10)}` : ''}.`)
  return { time, topic: strictTopic(r.topic) }
}

/**
 * Applica una modifica alle impostazioni, con controlli seri (errori in italiano per chi la
 * chiede): orari validi, al massimo 4 uscite, almeno una, almeno 30 minuti tra due uscite,
 * argomenti di al massimo 80 caratteri. Un'uscita nuova (o con l'ora cambiata), e tutte quando
 * il blog si riaccende o cambiano i giorni, valgono da adesso: un'ora gia' passata oggi non
 * fa partire un articolo all'improvviso.
 */
export function applySchedulePatch(current: BlogAutoSettings, input: unknown, now = new Date()): BlogAutoSettings {
  const patch = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>
  const bool = (key: 'enabled' | 'shareFacebook' | 'shareInstagram' | 'coverImage') => (typeof patch[key] === 'boolean' ? (patch[key] as boolean) : current[key])
  const enabled = bool('enabled')

  let days = current.days
  if (patch.days !== undefined) {
    if (!Array.isArray(patch.days)) throw new BlogScheduleError('Giorni non validi.')
    days = cleanDays(patch.days)
    if (!days.length) throw new BlogScheduleError('Scegli almeno un giorno.')
  }

  let slots: BlogSlot[]
  if (patch.slots !== undefined) {
    if (!Array.isArray(patch.slots)) throw new BlogScheduleError('Uscite non valide.')
    if (patch.slots.length > MAX_SLOTS) throw new BlogScheduleError(`Al massimo ${MAX_SLOTS} uscite al giorno.`)
    const taken = new Set<string>()
    slots = patch.slots.map((raw) => {
      const fields = strictSlotFields(raw)
      const id = (raw as { id?: unknown })?.id
      // L'id resta solo se e' di un'uscita che esiste gia' (cosi' resta anche il suo esito di oggi).
      const keep = typeof id === 'string' && current.slots.some((s) => s.id === id) && !taken.has(id)
      const slotId = keep ? (id as string) : newSlotId()
      taken.add(slotId)
      return { id: slotId, ...fields }
    })
  } else {
    slots = current.slots.map((s) => ({ ...s }))
  }

  if (patch.time !== undefined && patch.slots === undefined) {
    const time = normTime(patch.time)
    if (!time) throw new BlogScheduleError('Orario non valido.')
    if (slots.length !== 1) throw new BlogScheduleError('Ci sono più uscite: indica quale cambiare.')
    slots = [{ ...slots[0], time }]
  }

  if (patch.remove !== undefined) {
    for (const raw of Array.isArray(patch.remove) ? patch.remove : [patch.remove]) {
      const time = normTime(raw)
      const at = time ? slots.findIndex((s) => s.time === time) : -1
      if (at < 0) throw new BlogScheduleError(`Nessuna uscita alle ${String(raw).slice(0, 10)}.`)
      slots.splice(at, 1)
    }
  }

  if (patch.add !== undefined) {
    for (const raw of Array.isArray(patch.add) ? patch.add : [patch.add]) slots.push({ id: newSlotId(), ...strictSlotFields(raw) })
  }

  if (!slots.length) throw new BlogScheduleError('Serve almeno un orario.')
  if (slots.length > MAX_SLOTS) throw new BlogScheduleError(`Al massimo ${MAX_SLOTS} uscite al giorno.`)
  slots = sortSlots(slots)
  for (let i = 1; i < slots.length; i++) {
    const gap = minutesOf(slots[i].time) - minutesOf(slots[i - 1].time)
    if (gap === 0) throw new BlogScheduleError(`Ci sono due uscite alle ${slots[i].time}.`)
    if (gap < MIN_GAP_MINUTES) {
      throw new BlogScheduleError(`Le uscite delle ${slots[i - 1].time} e delle ${slots[i].time} sono troppo vicine: lascia almeno ${MIN_GAP_MINUTES} minuti.`)
    }
  }

  const stamp = now.toISOString()
  const restart = (enabled && !current.enabled) || days.join(',') !== current.days.join(',')
  slots = slots.map(({ since: _ignored, ...slot }) => {
    const before = current.slots.find((s) => s.id === slot.id)
    const since = before && before.time === slot.time && !restart ? before.since : stamp
    return since ? { ...slot, since } : slot
  })

  return { enabled, days, slots, time: slots[0].time, shareFacebook: bool('shareFacebook'), shareInstagram: bool('shareInstagram'), coverImage: bool('coverImage') }
}

/** "09:40 Novità sull’AI · 18:00 Marketing digitale" */
export const describeSlots = (slots: { time: string; topic: string }[]) => slots.map((s) => `${s.time} ${s.topic}`).join(' · ')

// ---------------------------------------------------------------------
// Stato: esito per uscita e una sola generazione alla volta
// ---------------------------------------------------------------------

export type BlogRunStatus = 'running' | 'published' | 'skipped' | 'error'

export type BlogSlotState = {
  /** Giorno (italiano) in cui e' partita quest'uscita l'ultima volta: una volta al giorno. */
  lastDate: string | null
  lastStatus: BlogRunStatus | null
  lastNote: string | null
  lastPost: { title: string; url: string } | null
  updatedAt: string | null
}

export type BlogAutoState = {
  /** Ultimo giorno (italiano) in cui e' partita un'uscita programmata. */
  lastDate: string | null
  /** Esito dell'ultima generazione (programmata o "Genera ora"). */
  lastStatus: BlogRunStatus | null
  lastNote: string | null
  /** Ultimo articolo pubblicato. */
  lastPost: { title: string; url: string } | null
  /** Esito della condivisione su Facebook e Instagram dell'ultimo articolo. */
  lastFacebook?: string | null
  /** Argomento dell'ultima generazione. */
  lastTopic?: string | null
  /** Uscita (id) dell'ultima generazione; null = "Genera ora". */
  lastSlot?: string | null
  /** Esito di ogni uscita. */
  slots: Record<string, BlogSlotState>
  updatedAt: string | null
}

const EMPTY_SLOT_STATE: BlogSlotState = { lastDate: null, lastStatus: null, lastNote: null, lastPost: null, updatedAt: null }
const EMPTY_STATE: BlogAutoState = { lastDate: null, lastStatus: null, lastNote: null, lastPost: null, slots: {}, updatedAt: null }

const safeJson = (raw: string | null): Record<string, unknown> => {
  try {
    const value = raw ? JSON.parse(raw) : null
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

const parseSettings = (raw: string | null) => cleanSettings(safeJson(raw))

function parseState(raw: string | null): BlogAutoState {
  const saved = safeJson(raw)
  const state = { ...EMPTY_STATE, ...saved } as BlogAutoState
  // (Si guarda il valore salvato, non quello con i default: EMPTY_STATE ha gia' slots = {}.)
  if (!saved.slots || typeof saved.slots !== 'object' || Array.isArray(saved.slots)) {
    // Stato salvato prima delle uscite multiple: il giorno dell'ultima uscita era quello dell'unico orario.
    state.slots = state.lastDate
      ? { [LEGACY_SLOT_ID]: { lastDate: state.lastDate, lastStatus: state.lastStatus, lastNote: state.lastNote, lastPost: state.lastPost, updatedAt: state.updatedAt } }
      : {}
  }
  return state
}

export const loadBlogAutoSettings = async () => parseSettings((await readSetting(SETTINGS_KEY)).value)
export const loadBlogAutoState = async () => parseState((await readSetting(STATE_KEY)).value)

/** Salva una modifica (BlogScheduleError se non va bene: niente viene salvato). */
export const saveBlogAutoSettings = (input: BlogSchedulePatch) =>
  updateSetting(SETTINGS_KEY, parseSettings, (current) => applySchedulePatch(current, input))

/** C'e' gia' una generazione in corso (di qualsiasi uscita o a mano). */
export function isBlogRunning(state: BlogAutoState, now = Date.now()): boolean {
  return state.lastStatus === 'running' && Boolean(state.updatedAt) && now - new Date(state.updatedAt as string).getTime() < RUN_LEASE_MS
}

/** Esiti delle uscite tolte da tempo: via, perche' lo stato non cresca. */
function pruneSlotStates(slots: Record<string, BlogSlotState>, now: number) {
  return Object.fromEntries(Object.entries(slots).filter(([, s]) => !s.updatedAt || now - Date.parse(s.updatedAt) < 30 * 86_400_000))
}

/**
 * Prende il turno per una generazione (confronto sul timbro di settings-store: due cron o un
 * cron e "Genera ora" insieme non partono mai due volte). false = c'e' gia' una generazione
 * in corso, o quest'uscita e' gia' partita oggi.
 */
async function claimRun(target: { slot: BlogSlot; date: string } | { topic: string }): Promise<boolean> {
  const won = { value: false }
  await updateSetting(STATE_KEY, parseState, (state) => {
    won.value = false
    const now = Date.now()
    if (isBlogRunning(state, now)) return false
    const at = new Date(now).toISOString()
    if ('slot' in target) {
      const { slot, date } = target
      if (state.slots[slot.id]?.lastDate === date) return false
      won.value = true
      return {
        ...state,
        lastDate: date,
        lastStatus: 'running' as const,
        lastNote: null,
        lastTopic: slot.topic,
        lastSlot: slot.id,
        slots: { ...pruneSlotStates(state.slots, now), [slot.id]: { ...EMPTY_SLOT_STATE, ...state.slots[slot.id], lastDate: date, lastStatus: 'running' as const, lastNote: null, updatedAt: at } },
        updatedAt: at,
      }
    }
    won.value = true
    return { ...state, lastStatus: 'running' as const, lastNote: 'Avviato a mano', lastTopic: target.topic, lastSlot: null, updatedAt: at }
  })
  return won.value
}

type RunPatch = { lastStatus: BlogRunStatus; lastNote?: string | null; lastPost?: { title: string; url: string }; lastFacebook?: string | null; lastTopic?: string; lastSlot?: string | null }

/** Registra l'esito (o l'avvio) di una generazione, in generale e per la sua uscita. */
const recordRun = (slotId: string | null, patch: RunPatch) =>
  updateSetting(STATE_KEY, parseState, (state) => {
    const at = new Date().toISOString()
    const slots = slotId
      ? {
          ...state.slots,
          [slotId]: {
            ...EMPTY_SLOT_STATE,
            ...state.slots[slotId],
            lastStatus: patch.lastStatus,
            lastNote: patch.lastNote ?? null,
            ...(patch.lastPost ? { lastPost: patch.lastPost } : {}),
            updatedAt: at,
          },
        }
      : state.slots
    return { ...state, ...patch, lastNote: patch.lastNote ?? null, slots, updatedAt: at }
  })

// Ora italiana, con l'ora sempre 00-23 (anche a mezzanotte).
const ROME = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Rome',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
  hourCycle: 'h23',
})
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function romeNow(now = new Date()) {
  const parts = ROME.formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value || ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}`, weekday: WEEKDAYS.indexOf(get('weekday')) }
}

const romeStamp = (iso: string) => {
  const r = romeNow(new Date(iso))
  return `${r.date} ${r.time}`
}

/** L'uscita va fatta adesso: la sua ora e' passata da al massimo 2 ore e valeva gia' a quell'ora (o era quella del minuto in cui e' stata scelta). */
export function slotIsDue(slot: BlogSlot, now: { date: string; time: string }): boolean {
  const late = minutesOf(now.time) - minutesOf(slot.time)
  if (late < 0 || late > CATCH_UP_MINUTES) return false
  return !slot.since || `${now.date} ${slot.time}` >= romeStamp(slot.since)
}

// ---------------------------------------------------------------------
// Notizie dai feed RSS / Atom e da Google News
// ---------------------------------------------------------------------

export const NEWS_FEEDS: { name: string; url: string; aiOnly: boolean }[] = [
  { name: 'ANSA Tecnologia', url: 'https://www.ansa.it/sito/notizie/tecnologia/tecnologia_rss.xml', aiOnly: false },
  { name: 'AI4Business', url: 'https://www.ai4business.it/feed/', aiOnly: true },
  { name: 'Wired Italia', url: 'https://www.wired.it/feed/rss', aiOnly: false },
  { name: 'Agenda Digitale', url: 'https://www.agendadigitale.eu/feed/', aiOnly: false },
  { name: 'Google News', url: 'https://news.google.com/rss/search?q=intelligenza+artificiale+when:3d&hl=it&gl=IT&ceid=IT:it', aiOnly: true },
  { name: 'TechCrunch', url: 'https://techcrunch.com/category/artificial-intelligence/feed/', aiOnly: true },
  { name: 'The Verge', url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', aiOnly: true },
  { name: 'MIT Technology Review', url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed', aiOnly: true },
]

const AI_TOPIC =
  /intelligenza artificiale|\bIA\b|\bAI\b|\bA\.I\.|openai|chatgpt|\bgpt-?\d|gemini|anthropic|claude|copilot|mistral|deepseek|\bllama\b|nvidia|chatbot|machine learning|apprendimento automatico|\bLLM\b|modell[oi] linguistic|generativ|deepfake|robot|ai act/i

/** Ricerca su Google News (ultimi 3 giorni, in italiano). */
export const googleNewsUrl = (query: string) => `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:3d`)}&hl=it&gl=IT&ceid=IT:it`

export type NewsItem = { source: string; title: string; link: string; summary: string; date: number }

const decode = (text: string) =>
  text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    // Descrizioni con l'HTML scritto come entita' (Google News: &lt;a href=...&gt;): via anche quei tag.
    .replace(/&lt;\/?[a-z][^&]*?&gt;/gi, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#8217;|&#x27;/gi, '’')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/\s+/g, ' ')
    .trim()

const tag = (block: string, name: string) => {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'))
  return m ? decode(m[1]) : ''
}

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Legge le voci di un feed RSS 2.0 o Atom. Google News: la testata e' in <source> (il titolo
 * finisce con " - Testata") e il link e' quello di Google News, che porta all'articolo.
 */
export function parseFeed(xml: string, source: string, options: { googleNews?: boolean } = {}): NewsItem[] {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || []
  return blocks
    .map((block) => {
      const atomLink = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i) || block.match(/<link[^>]*href=["']([^"']+)["']/i)
      const link = tag(block, 'link') || atomLink?.[1] || tag(block, 'guid')
      const when = tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated') || tag(block, 'dc:date')
      let title = tag(block, 'title')
      let summary = (tag(block, 'description') || tag(block, 'summary') || tag(block, 'content')).slice(0, 500)
      let name = source
      if (options.googleNews) {
        const publisher = tag(block, 'source')
        if (publisher) {
          name = publisher
          title = title.replace(new RegExp(`\\s+[-–—|]\\s+${escapeRe(publisher)}$`), '').trim()
        }
        // La descrizione di Google News ripete titolo e testata: utile solo se aggiunge altro.
        if (summary.replace(title, '').replace(publisher, '').trim().length < 25) summary = ''
      }
      return { source: name, title, link: link.trim(), summary, date: when ? new Date(when).getTime() : NaN }
    })
    .filter((item) => item.title && /^https?:\/\//.test(item.link) && Number.isFinite(item.date))
}

const titleKey = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9à-ù]+/g, ' ')
    .trim()
    .slice(0, 60)

type Feed = { name: string; url: string; filter?: RegExp; googleNews: boolean; maxAgeMs: number }

/** Fonti per un argomento: novita' AI = testate scelte (+ Google News); gli altri = ricerca su Google News. */
export function feedsFor(topicLabel: string): Feed[] {
  const topic = resolveTopic(topicLabel)
  if (topic.ai) {
    return NEWS_FEEDS.map((f) => ({ name: f.name, url: f.url, filter: f.aiOnly ? undefined : AI_TOPIC, googleNews: f.url.includes('news.google.com'), maxAgeMs: MAX_AGE_MS }))
  }
  return [{ name: 'Google News', url: googleNewsUrl(topic.preset?.query || topic.label), googleNews: true, maxAgeMs: SEARCH_MAX_AGE_MS }]
}

/** Notizie recenti sull'argomento, dalla piu' nuova, senza doppioni (link e titolo) ne' notizie gia' usate. */
export async function fetchNews(topicLabel: string, used: Set<string> = new Set()): Promise<NewsItem[]> {
  const feeds = feedsFor(topicLabel)
  const results = await Promise.all(
    feeds.map(async (feed) => {
      try {
        const res = await fetch(feed.url, {
          signal: AbortSignal.timeout(8000),
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FacevoiceAI/1.0; +https://www.facevoice.ai)' },
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const items = parseFeed(await res.text(), feed.name, { googleNews: feed.googleNews })
        const now = Date.now()
        return items
          .filter((i) => !feed.filter || feed.filter.test(`${i.title} ${i.summary}`))
          .filter((i) => now - i.date < feed.maxAgeMs && i.date < now + 3_600_000)
      } catch (error) {
        console.error(`blog auto: feed ${feed.name} non letto:`, error instanceof Error ? error.message : error)
        return []
      }
    })
  )
  const seen = new Set<string>()
  return results
    .flat()
    .sort((a, b) => b.date - a.date)
    .filter((item) => {
      const key = `t:${titleKey(item.title)}`
      if (used.has(item.link) || used.has(key) || seen.has(key) || seen.has(item.link)) return false
      seen.add(key)
      seen.add(item.link)
      return true
    })
}

/** Notizie recenti sull'AI (formato di prima). */
export const fetchAINews = (used: Set<string> = new Set()) => fetchNews(AI_TOPIC_LABEL, used)

const parseUsed = (raw: string | null): string[] => {
  try {
    const value = raw ? JSON.parse(raw) : []
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** Notizie usate: link e titolo, cosi' la stessa notizia non torna in un'altra uscita (anche da un'altra fonte). */
async function rememberUsed(items: NewsItem[]) {
  const fresh = [...new Set(items.flatMap((n) => [n.link, `t:${titleKey(n.title)}`]))]
  await updateSetting(USED_KEY, parseUsed, (current) => [...fresh, ...current.filter((x) => !fresh.includes(x))].slice(0, MAX_USED))
}

// ---------------------------------------------------------------------
// Lettura della risposta dell'AI
// ---------------------------------------------------------------------

export type ParsedArticle = { title: string; content: string; used: number[] }

/**
 * Caratteri di controllo (a capo, tab) scritti "veri" dentro le stringhe JSON: JSON.parse li
 * rifiuta, ma i modelli li mettono spesso nel testo dell'articolo (paragrafi separati da una
 * riga vuota). Si trasformano in \\n, \\r, \\t solo dentro le stringhe.
 */
export function escapeControlCharsInStrings(text: string): string {
  let out = ''
  let inString = false
  let escaped = false
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      else if (ch === '\n') {
        out += '\\n'
        continue
      } else if (ch === '\r') {
        out += '\\r'
        continue
      } else if (ch === '\t') {
        out += '\\t'
        continue
      }
    } else if (ch === '"') inString = true
    out += ch
  }
  return out
}

/** Testo di una stringa JSON presa cosi' com'e' (sequenze \\n, \\" ...), anche se non valida. */
function unescapeLoose(value: string): string {
  try {
    return JSON.parse(`"${escapeControlCharsInStrings(`"${value}"`).slice(1, -1)}"`)
  } catch {
    return value.replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\\t/g, ' ').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const isArticleLike = (v: Record<string, unknown>) =>
  typeof v.title === 'string' && (typeof v.content === 'string' || (Array.isArray(v.content) && v.content.every((p) => typeof p === 'string')))

/** L'articolo dentro un valore JSON: l'oggetto stesso, il primo di un array, o dentro {"article": {...}}. */
function findArticle(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 3) return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findArticle(item, depth + 1)
      if (found) return found
    }
    return null
  }
  if (!isObject(value)) return null
  if (isArticleLike(value)) return value
  for (const key of ['article', 'articolo', 'data', 'result']) {
    const found = findArticle(value[key], depth + 1)
    if (found) return found
  }
  return null
}

/** Virgolette tipografiche usate come delimitatori JSON (“title”: “...”): diventano quelle dritte. */
function straightenJsonQuotes(text: string): string {
  return text
    .replace(/[“”„]\s*(title|content|used)\s*[“”]\s*:/g, '"$1":')
    .replace(/("(?:title|content)":\s*)[“”„]/g, '$1"')
    .replace(/[“”]\s*(,\s*"(?:title|content|used)":|\}\s*$)/g, '"$1')
}

/** JSON completo e leggibile (anche con testo intorno, ```json, a capo veri o virgole in piu'). */
function parseArticleJson(text: string): Record<string, unknown> | null {
  const start = text.search(/[{[]/)
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'))
  if (start >= 0 && end > start) {
    const slice = text.slice(start, end + 1)
    for (const candidate of [slice, escapeControlCharsInStrings(slice)]) {
      for (const json of [candidate, candidate.replace(/,\s*([}\]])/g, '$1')]) {
        try {
          const found = findArticle(JSON.parse(json))
          if (found) return found
        } catch {}
      }
    }
  }
  return parseJsonObject(text, isArticleLike) || parseJsonObject(escapeControlCharsInStrings(text), isArticleLike)
}

/**
 * Ultima risorsa: i campi presi uno per uno dal testo, anche con virgolette non escapate dentro
 * il titolo o l'articolo (il titolo va fino alla virgoletta seguita da , "content" / , "used" /
 * graffa; "content" fino a , "used" / , "title" o all'ultima virgoletta che chiude una stringa).
 */
function extractFields(raw: string): Record<string, unknown> | null {
  const titleStart = raw.match(/"title"\s*:\s*"/)
  const start = raw.match(/"content"\s*:\s*"/)
  if (!titleStart || titleStart.index === undefined || !start || start.index === undefined) return null
  const titleRest = raw.slice(titleStart.index + titleStart[0].length)
  const titleEnd = titleRest.search(/"\s*(?:,\s*"(?:content|used)"\s*:|\})/)
  const title = titleEnd > 0 ? titleRest.slice(0, titleEnd) : ''
  // Titolo non delimitato, su piu' righe o lunghissimo: formato rotto, meglio la riprova che un titolo tagliato.
  if (!title || title.length > 200 || /[\r\n]/.test(title)) return null
  const rest = raw.slice(start.index + start[0].length)
  const nextField = rest.search(/"\s*,\s*"(?:used|title)"\s*:/)
  const closing = [...rest.matchAll(/(?<!\\)"\s*(?=[,}\]]|$)/g)].pop()
  const end = nextField >= 0 ? nextField : closing?.index ?? -1
  const usedRaw = raw.match(/"used"\s*:\s*(\[[^\]]*\]|"[^"]*")/)?.[1]
  // Stringa mai chiusa: risposta interrotta a meta' (es. limite di token), mai da pubblicare.
  if (end <= 0) return { title: unescapeLoose(title), content: unescapeLoose(rest), used: [], truncated: true }
  return { title: unescapeLoose(title), content: unescapeLoose(rest.slice(0, end)), used: usedRaw ? usedRaw.match(/\d+/g)?.map(Number) || [] : [] }
}

/** Numeri delle notizie usate: [1, 3], ["1", "3"], "1, 3". */
function usedNumbers(value: unknown): number[] {
  const list: unknown[] = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  const numbers = list.flatMap((v) => (typeof v === 'number' ? [v] : typeof v === 'string' ? (v.match(/\d+/g) || []).map(Number) : []))
  return [...new Set(numbers.filter((n) => Number.isInteger(n) && n > 0))]
}

/** Motivo per cui una risposta non diventa un articolo (null = va bene). */
export type ArticleProblem = 'empty' | 'json' | 'title' | 'short' | 'truncated' | 'format' | 'used'

/**
 * Articolo dalla risposta dell'AI, con un controllo serio prima di pubblicare: JSON letto anche
 * con testo intorno, blocchi ```json, dentro un array, virgole in piu', a capo veri dentro le
 * stringhe, virgolette non escapate o tipografiche, "used" come testo; poi titolo presente,
 * testo di almeno 800 caratteri, niente pezzi di JSON nel testo, testo non troncato (finisce
 * con la fine di una frase) e almeno 2 notizie indicate in "used" (se si sa quante sono).
 * truncated: la risposta e' stata interrotta dal limite di token (detto dal modello).
 */
export function readArticle(
  raw: string,
  options: { truncated?: boolean; newsCount?: number } = {}
): { article: ParsedArticle | null; problem: ArticleProblem | null } {
  const text = (raw || '').replace(/^﻿/, '').trim()
  if (!text) return { article: null, problem: options.truncated ? 'truncated' : 'empty' }
  const straight = /[“”„]\s*(?:title|content|used)\s*[“”]\s*:/.test(text) ? straightenJsonQuotes(text) : null
  const complete = parseArticleJson(text) || (straight ? parseArticleJson(straight) : null)
  const data = complete || extractFields(text) || (straight ? extractFields(straight) : null)
  if (!data) return { article: null, problem: options.truncated ? 'truncated' : 'json' }
  // Interrotta dal limite di token e JSON non chiuso: incompleta, anche se sembra leggibile.
  if (data.truncated || (options.truncated && !complete)) return { article: null, problem: 'truncated' }

  // Virgolette intorno a tutto il titolo: via. Quelle di un nome dentro il titolo (es. Arriva "Nova") restano.
  const title = String(data.title || '')
    .replace(/\*\*?|__/g, '')
    .replace(/^\s*#+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["«“]([^"«»“”]*)["»”]$/, '$1')
    .trim()
  let content = Array.isArray(data.content) ? data.content.map(String).join('\n\n') : String(data.content || '')
  // A capo scritti due volte "escapati" (\\n): nel testo arrivano come barra + n.
  if (/\\n/.test(content) && !/\n/.test(content)) content = content.replace(/(?:\\r)?\\n/g, '\n').replace(/\\"/g, '"').replace(/\\t/g, ' ')
  content = content
    .replace(/\r\n?/g, '\n')
    .replace(/\*\*?|__|^#+\s*/gm, '')
    .replace(/\n*Fonti:[\s\S]*$/i, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const max = options.newsCount
  const used = usedNumbers(data.used).filter((n) => !max || n <= max)

  if (!title) return { article: null, problem: 'title' }
  if (content.length <= 800) return { article: null, problem: options.truncated ? 'truncated' : 'short' }
  if (/"(title|content|used)"\s*:|```|^\s*[{[]\s*"/m.test(content)) return { article: null, problem: 'format' }
  if (!/[.!?…»”"')’]$/.test(content)) return { article: null, problem: 'truncated' }
  if (max && used.length < 2) return { article: null, problem: 'used' }
  return { article: { title: title.slice(0, 140), content, used }, problem: null }
}

/** Motivi in chiaro (pannello e notifica). */
export const PROBLEM_TEXT: Record<ArticleProblem, string> = {
  empty: 'risposta dell’AI vuota',
  json: 'formato non valido',
  title: 'titolo mancante',
  short: 'articolo troppo corto',
  truncated: 'risposta dell’AI interrotta (troppo lunga)',
  format: 'formato non valido',
  used: 'l’AI non ha indicato le notizie usate',
}

const REMINDER_PROBLEM: Record<ArticleProblem, string> = {
  empty: 'era vuota',
  json: 'non era un JSON valido',
  title: 'non aveva il titolo',
  short: 'era troppo corta',
  truncated: 'si è interrotta a metà perché era troppo lunga',
  format: 'aveva pezzi di JSON dentro il testo',
  used: 'non indicava in "used" i numeri delle notizie usate',
}

/** Secondo tentativo, quando la prima risposta non era un articolo valido. */
const FORMAT_REMINDER = (problem: ArticleProblem) =>
  `La tua risposta precedente ${REMINDER_PROBLEM[problem]}, quindi l'articolo NON è stato pubblicato. ${
    problem === 'truncated' ? 'Scrivi di nuovo l’articolo, più breve: 350-550 parole, al massimo 4 notizie. ' : ''
  }Rispondi SOLO con il JSON {"title": "...", "content": "...", "used": [numeri]}, senza testo prima o dopo e senza blocchi di codice. Dentro "content" scrivi \\n per andare a capo (niente a capo veri dentro le stringhe) e non usare virgolette doppie nel testo (usa « »). In "used" metti i numeri delle notizie di cui parli (almeno 2). ${
    problem === 'truncated' ? '' : 'Resta tra 400 e 650 parole e '
  }chiudi l'ultima frase.`

// ---------------------------------------------------------------------
// Scrittura e pubblicazione
// ---------------------------------------------------------------------

/** Istruzioni per l'articolo: stabili per argomento (si rileggono dalla cache). Per le novita' AI come prima. */
export function articlePrompt(topicLabel: string): string {
  const topic = resolveTopic(topicLabel)
  const theme = topic.ai ? "nel mondo dell'intelligenza artificiale" : `sul tema «${topic.label}»`
  const closing = topic.ai
    ? "In chiusura un paragrafo breve e naturale su come un'azienda può iniziare a usare l'AI (senza pubblicità aggressiva; puoi citare Facevoice AI una volta)."
    : "In chiusura un paragrafo breve e naturale su cosa può fare in pratica un'azienda, anche con il digitale e l'AI (senza pubblicità aggressiva; puoi citare Facevoice AI una volta)."
  return `Sei la redazione del blog di Facevoice AI, agenzia digitale e software house con sede a Terrasini (Palermo) che realizza siti, app, automazioni, chatbot e soluzioni di intelligenza artificiale per le aziende.

Scrivi un articolo di blog in italiano sulle novità più importanti dei giorni scorsi ${theme}, usando SOLO le notizie elencate dall'utente.

Regole (obbligatorie):
- Usa solo i fatti presenti nelle notizie fornite. Non inventare nomi, numeri, date, citazioni, prodotti o dettagli. Se un dettaglio non c'è, non scriverlo. Di alcune notizie hai solo il titolo: di quelle scrivi solo ciò che dice il titolo.
- Scegli da 3 a 5 notizie${topic.ai ? '' : ` davvero legate al tema «${topic.label}»`}, le più rilevanti e interessanti per imprenditori e professionisti italiani. Evita notizie di cronaca nera o politiche divisive${topic.ai ? '' : ' e quelle fuori tema'}.
- Per ogni notizia: cosa è successo, in 2-4 frasi chiare, e perché conta per un'azienda.
- Tono: informato, chiaro, niente sensazionalismo, niente «clamoroso» o «shock». Niente promesse.
- Formato testo semplice (verrà mostrato così com'è): niente markdown, niente asterischi, niente #. Separa i paragrafi con una riga vuota. Per ogni notizia un breve sottotitolo su una riga da solo.
- Lunghezza: 450-700 parole (se le notizie hanno pochi dettagli va bene più corto, ma almeno 300 parole).
- ${closing}
- Il titolo fa capire subito di cosa parla l'articolo${topic.ai ? '' : ` (il tema è «${topic.label}»)`}.
- Non scrivere link né l'elenco delle fonti: li aggiungiamo noi in fondo, dai numeri che indichi in "used". In "used" metti SOLO i numeri delle notizie di cui parli davvero.

Rispondi SOLO con un oggetto JSON valido, senza testo prima o dopo e senza blocchi di codice:
{"title": "titolo dell'articolo (max 90 caratteri, senza virgolette)", "content": "testo completo dell'articolo", "used": [numeri delle notizie usate]}
Dentro le stringhe JSON scrivi gli a capo come \\n (tra un paragrafo e l'altro \\n\\n) e non usare virgolette doppie: per nomi e citazioni usa « ».`
}

const slugify = (title: string) =>
  title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

async function uniqueSlug(base: string) {
  for (let n = 0; n < 50; n++) {
    const slug = n ? `${base}-${n + 1}` : base
    const { data } = await supabaseAdmin.from('blog_posts').select('id').eq('slug', slug).limit(1)
    if (!data?.length) return slug
  }
  return `${base}-${Date.now().toString(36)}`
}

type ChatMessage = { role: string; content: string }

/**
 * Fa scrivere l'articolo: prima risposta con spazio per un articolo intero; se non e' valida,
 * una sola riprova (piu' spazio; se era interrotta si chiede un articolo piu' corto, senza
 * rimandare il testo troncato). Mai un articolo vuoto o rotto: altrimenti il motivo in chiaro.
 */
async function writeArticle(
  system: string,
  request: ChatMessage,
  newsCount: number,
  stableTail?: string
): Promise<{ article: ParsedArticle } | { reason: string }> {
  const ask = async (messages: ChatMessage[], maxOutputTokens: number, temperature: number) => {
    try {
      // Gemini: ragionamento spento (thinkingBudget 0) o, per i modelli che ragionano sempre, con
      // THINKING_ROOM token tutti suoi; Claude: effort basso. Il testo ha sempre lo spazio intero.
      const res = await callAI(messages, system, {
        feature: 'blog_automatico',
        temperature,
        maxOutputTokens,
        json: true,
        thinkingRoom: THINKING_ROOM,
        ...(stableTail ? { stableTail } : {}),
      })
      return { res, parsed: readArticle(res.message || '', { truncated: res.truncated, newsCount }) }
    } catch (error) {
      console.warn('blog auto: AI non disponibile:', error instanceof Error ? error.message : error)
      return null
    }
  }
  const describe = (res: { provider: string; model: string; message: string; truncated?: boolean }, problem: ArticleProblem) =>
    `${problem}, ${res.provider} ${res.model}, ${(res.message || '').length} caratteri${res.truncated ? ', interrotta dal limite di token' : ''}`

  const first = await ask([request], ARTICLE_TOKENS, 0.5)
  if (!first) return { reason: 'AI non disponibile in questo momento, riprova più tardi' }
  if (first.parsed.article) return { article: first.parsed.article }
  const problem = first.parsed.problem || 'json'
  console.warn(`blog auto: risposta AI non valida (${describe(first.res, problem)}): riprovo una volta`)
  // Interrotta o vuota: si richiede da capo (il testo troncato non serve e costerebbe token);
  // altrimenti si rimanda la risposta con il promemoria del formato (con Claude il prefisso e' in cache).
  const messages: ChatMessage[] =
    problem === 'truncated' || problem === 'empty'
      ? [{ role: 'user', content: `${request.content}\n\n${FORMAT_REMINDER(problem)}` }]
      : [request, { role: 'assistant', content: (first.res.message || '').slice(0, 6000) }, { role: 'user', content: FORMAT_REMINDER(problem) }]
  const second = await ask(messages, RETRY_TOKENS, 0.4)
  if (!second) return { reason: `${PROBLEM_TEXT[problem]}, poi AI non disponibile` }
  if (second.parsed.article) return { article: second.parsed.article }
  const again = second.parsed.problem || 'json'
  console.warn(`blog auto: anche la seconda risposta non è valida (${describe(second.res, again)})`)
  return { reason: `${PROBLEM_TEXT[again]}, anche al secondo tentativo` }
}

export type GenerateResult =
  | { ok: true; title: string; url: string; content: string; slug: string; id: string; topic: string }
  | { ok: false; reason: string; skipped?: boolean }

/** Legge le notizie sull'argomento, fa scrivere l'articolo e lo pubblica. */
export async function generateNewsPost(topicLabel: string = AI_TOPIC_LABEL): Promise<GenerateResult> {
  if (!hasAIProvider()) return { ok: false, reason: 'nessuna chiave AI configurata' }
  const topic = resolveTopic(topicLabel)
  const usedList = parseUsed((await readSetting(USED_KEY)).value)
  const news = (await fetchNews(topic.label, new Set(usedList))).slice(0, 18)
  if (news.length < MIN_NEWS) {
    return { ok: false, skipped: true, reason: `solo ${news.length} notizie nuove su «${topic.label}» nelle fonti: articolo non pubblicato per non inventare` }
  }

  const list = news
    .map((n, i) => `${i + 1}. [${n.source}, ${new Date(n.date).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' })}] ${n.title}${n.summary ? `\n${n.summary}` : ''}`)
    .join('\n\n')
  const today = new Date().toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  // Indicazioni di Luca dalla super chat (argomenti, taglio, tono): valgono finche' non cambiano.
  const directions = (await loadContentDirections()).text.trim()
  // Istruzioni dell'argomento (stabili, in cache), poi le indicazioni (cambiano di rado), poi notizie e data.
  const tail = directions
    ? `\n\nIndicazioni di Luca per i prossimi contenuti (seguile, ma senza mai inventare fatti e restando sulle notizie fornite):\n${directions}`
    : undefined
  const request = { role: 'user', content: `Oggi è ${today}. Tema: ${topic.label}. Notizie:\n\n${list}` }
  const written = await writeArticle(articlePrompt(topic.label), request, news.length, tail)
  if (!('article' in written)) return { ok: false, reason: written.reason }
  const article = written.article

  // Le fonti le aggiunge il codice, dai numeri indicati dall'AI: i link restano esatti.
  const cited = [...new Set(article.used)].map((i) => news[i - 1]).filter((n): n is NewsItem => Boolean(n))
  if (cited.length < 2) return { ok: false, reason: PROBLEM_TEXT.used }
  const content = `${article.content}\n\nFonti:\n${cited.map((n) => `${n.source}: ${n.title}\n${n.link}`).join('\n\n')}`

  const slug = await uniqueSlug(slugify(article.title) || `${slugify(topic.label) || 'novita'}-${Date.now().toString(36)}`)
  const { data: post, error } = await supabaseAdmin
    .from('blog_posts')
    .insert({ title: article.title, content, image_url: null, author: 'Facevoice AI', slug })
    .select('id, slug')
    .single()
  if (error || !post) return { ok: false, reason: error?.message || 'salvataggio non riuscito' }

  await rememberUsed(cited).catch((err) => console.error('blog auto: notizie usate non salvate:', err instanceof Error ? err.message : err))
  return { ok: true, title: article.title, url: `${SITE_URL}/blog/${post.slug || post.id}`, content, slug: post.slug || post.id, id: post.id, topic: topic.label }
}

// ---------------------------------------------------------------------
// Pianificazione (dal cron di ogni minuto) e "Genera ora"
// ---------------------------------------------------------------------

/** Esegue la generazione (turno gia' preso da chi la chiede) e registra l'esito, con notifica. */
export async function runBlogAuto(manual: boolean, run: { slot?: string | null; topic?: string | null } = {}) {
  const slotId = typeof run.slot === 'string' && ID_RE.test(run.slot) ? run.slot : null
  const topic =
    cleanTopic(run.topic) || (slotId ? (await loadBlogAutoSettings()).slots.find((s) => s.id === slotId)?.topic : null) || AI_TOPIC_LABEL
  await recordRun(slotId, { lastStatus: 'running', lastNote: manual ? 'Avviato a mano' : null, lastTopic: topic, lastSlot: slotId })
  let result: GenerateResult
  try {
    result = await generateNewsPost(topic)
  } catch (error) {
    result = { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
  console.log(`blog auto (${topic}): ${result.ok ? `pubblicato "${result.title}"` : `non pubblicato (${result.reason})`}`)
  if (result.ok) {
    // Facebook, Instagram e notifica (con l'esito della condivisione): una volta per articolo.
    const share = await shareBlogPost({ id: result.id, title: result.title, content: result.content, slug: result.slug }, 'auto')
    await recordRun(slotId, {
      lastStatus: 'published',
      lastNote: null,
      lastPost: { title: result.title, url: result.url },
      lastFacebook: [
        `carosello di ${share.slides} immagini (foto ${share.image}, ${share.slideImages} slide con immagine)`,
        share.hook ? `gancio: "${share.hook}"` : '',
        `Facebook ${share.facebook === 'posted' ? 'pubblicato' : share.facebook === 'failed' ? 'non riuscito' : 'spento'}`,
        `Instagram ${share.instagram === 'posted' ? 'pubblicato' : share.instagram === 'failed' ? 'non riuscito' : 'spento'}`,
        ...share.errors,
      ]
        .filter(Boolean)
        .join(' · '),
    })
    return result
  }
  await recordRun(slotId, { lastStatus: result.skipped ? 'skipped' : 'error', lastNote: result.reason })
  await sendPushToAdmins({ title: 'Blog automatico: articolo non pubblicato', body: `${topic}: ${result.reason}`, url: '/admin' }).catch(() => undefined)
  return result
}

/** Chiede la generazione in una funzione nuova (tempo pieno, fino a 5 minuti). */
export async function requestBlogRun(origin: string, manual: boolean, run: { slot?: string | null; topic?: string | null } = {}) {
  const key = (process.env.CRON_SECRET || '').trim()
  if (!key) throw new Error('CRON_SECRET mancante')
  const res = await fetch(`${internalOrigin(origin)}/api/admin/blog-auto/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': key },
    body: JSON.stringify({ manual, slot: run.slot ?? null, topic: run.topic ?? null }),
  })
  if (!res.ok) throw new Error(`avvio rifiutato: ${res.status}`)
}

export class BlogBusyError extends Error {}

/**
 * "Genera ora" (pannello e super chat): un articolo subito sull'argomento scelto (di default
 * quello della prima uscita). BlogBusyError se c'e' gia' una generazione in corso.
 */
export async function startBlogNow(origin: string, topicInput?: unknown): Promise<{ topic: string }> {
  const empty = topicInput === undefined || topicInput === null || (typeof topicInput === 'string' && !topicInput.trim())
  const topic = empty ? (await loadBlogAutoSettings()).slots[0]?.topic || AI_TOPIC_LABEL : strictTopic(topicInput)
  if (!(await claimRun({ topic }))) throw new BlogBusyError('Sto già scrivendo un articolo, aspetta un paio di minuti.')
  try {
    await requestBlogRun(origin, true, { slot: null, topic })
  } catch (error) {
    await recordRun(null, { lastStatus: 'error', lastNote: `avvio non riuscito: ${error instanceof Error ? error.message : error}` })
    throw error
  }
  return { topic }
}

/**
 * Dal cron di ogni minuto: nei giorni scelti, ogni uscita una volta al giorno alla sua ora
 * (recuperata entro 2 ore se quel minuto e' saltato), una generazione alla volta.
 */
export async function blogAutoTick(origin: string) {
  const settings = await loadBlogAutoSettings()
  if (!settings.enabled) return
  const now = romeNow()
  if (!settings.days.includes(now.weekday)) return
  const due = settings.slots.filter((slot) => slotIsDue(slot, now))
  if (!due.length) return
  const state = await loadBlogAutoState()
  const slot = due.find((s) => state.slots[s.id]?.lastDate !== now.date)
  if (!slot || isBlogRunning(state)) return
  if (!(await claimRun({ slot, date: now.date }))) return
  await requestBlogRun(origin, false, { slot: slot.id, topic: slot.topic }).catch(async (error) => {
    console.error('blog auto: avvio non riuscito:', error instanceof Error ? error.message : error)
    await recordRun(slot.id, { lastStatus: 'error', lastNote: `avvio non riuscito: ${error instanceof Error ? error.message : error}` })
  })
}
