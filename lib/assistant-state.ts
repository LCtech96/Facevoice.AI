import { readSetting, updateSetting } from '@/lib/settings-store'
import { emptyTally, readImages, reportStatus, runWithStatus, type AIModelChoice, type ImageInput, type UsageTally } from '@/lib/ai'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { runAssistant, type Draft, type SocialAction } from '@/lib/lead-assistant'
import { overBudget, type Budget } from '@/lib/assistant-budget'
import sharp from 'sharp'

// Conversazioni dell'assistente salvate sul server (una per pagina: "leads" e
// "super"). Ogni richiesta diventa un lavoro che prosegue anche se la pagina
// viene chiusa: lo stato (avanzamento, risposta, bozze) si legge da qui.

export const SCOPES = ['leads', 'super'] as const
export type Scope = (typeof SCOPES)[number]

/** job: lavoro che ha scritto la risposta (per non contare due volte i token di un lavoro in corso). */
export type Turn = {
  id: string
  role: 'user' | 'assistant'
  text: string
  actions?: SocialAction[]
  usage?: UsageTally
  job?: string
  /** Anteprime delle immagini allegate da Luca (piccole, per la chat). */
  images?: string[]
  /** Immagini intere in attesa di essere lette (app_settings assistant_image:<id>). */
  imageKeys?: string[]
  /** Cosa c'e' nelle immagini, letto dall'AI: resta nella conversazione. */
  imageText?: string
  /** Le stesse immagini salvate come file pubblici: usabili nei post e nei caroselli. */
  imageUrls?: string[]
}

export type Job = {
  id: string
  status: 'running' | 'done' | 'error'
  statusText: string
  startedAt: string
  updatedAt: string
  /** Richiesta originale di Luca (per le continuazioni automatiche). */
  original: string
  round: number
  result?: { refresh?: boolean; confirmSend?: boolean; focus?: { label: string; ids: string[] } }
  /** La pagina ha gia' gestito conferma invio / filtro di questo lavoro. */
  handled?: boolean
  /** Modello scelto per questa richiesta. */
  model?: AIModelChoice
  /** Token e costi usati finora da questa richiesta (si aggiorna mentre lavora). */
  usage?: UsageTally
  /** Limite di spesa scritto da Luca nella richiesta. */
  budget?: Budget | null
  /** Giro in esecuzione: i giri vecchi (fermati per tempo) non possono piu' scrivere. */
  run?: string
  /** Passi gia' fatti (strumenti usati e risultato in breve): chi riprende non li rifa'. */
  steps?: string[]
  /** Chi ha scritto la richiesta e' l'amministratore: solo lui cambia e pubblica i caroselli. */
  admin?: boolean
}

/** chatId: chat aperta (le altre sono salvate a parte, vedi "Chat salvate" in fondo). */
export type AssistantState = { turns: Turn[]; drafts: Draft[]; job: Job | null; chatId?: string }

const MAX_TURNS = 80
/**
 * Oltre questo tempo senza aggiornamenti un lavoro "in corso" e' fermo: la
 * funzione che lo eseguiva (al massimo 300 s) e' stata chiusa dal server.
 */
export const STALE_MS = 330_000
const WORK_BUDGET_MS = 210_000
/** Oltre questo tempo si passa a un nuovo giro, prima che Vercel chiuda la funzione (maxDuration 300 s). */
const HARD_STOP_MS = 270_000
/** Giri massimi per una richiesta (circa 4 minuti l'uno), poi si chiede a Luca se continuare. */
export const MAX_ROUNDS = 8
const MAX_STEPS_SAVED = 40

const keyOf = (scope: Scope) => `assistant_state:${scope}`
export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
const clean = (text: string) => text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^\s*\*\s+/gm, '- ')

export function asScope(value: unknown): Scope {
  return (SCOPES as readonly string[]).includes(String(value)) ? (value as Scope) : 'leads'
}

function parseState(value: string | null | undefined): AssistantState {
  try {
    const parsed = value ? JSON.parse(value) : null
    return {
      turns: parsed?.turns || [],
      drafts: parsed?.drafts || [],
      job: parsed?.job || null,
      ...(typeof parsed?.chatId === 'string' ? { chatId: parsed.chatId } : {}),
    }
  } catch {
    return { turns: [], drafts: [], job: null }
  }
}

export async function loadState(scope: Scope): Promise<AssistantState> {
  return parseState((await readSetting(keyOf(scope))).value)
}

/**
 * Legge, modifica e salva solo se nel frattempo nessun altro ha salvato.
 * Prima un salvataggio di stato lento poteva sovrascrivere la risposta finale:
 * il lavoro sembrava ancora in corso e dopo qualche minuto risultava "interrotto".
 * fn puo' restituire false per non salvare niente.
 */
function casUpdate(scope: Scope, fn: (state: AssistantState) => void | boolean): Promise<AssistantState> {
  return updateSetting(keyOf(scope), parseState, (state) => {
    if (fn(state) === false) return false
    return { ...state, turns: state.turns.slice(-MAX_TURNS) }
  })
}

// Nello stesso server le scritture di una chat passano una alla volta.
const queues = new Map<Scope, Promise<unknown>>()

export function updateState(scope: Scope, fn: (state: AssistantState) => void | boolean): Promise<AssistantState> {
  const run = () => casUpdate(scope, fn)
  const result = (queues.get(scope) || Promise.resolve()).then(run, run)
  queues.set(scope, result.catch(() => undefined))
  return result
}

export const isRunning = (job: Job | null) =>
  Boolean(job && job.status === 'running' && Date.now() - new Date(job.updatedAt).getTime() < STALE_MS)

const sumUsage = (turns: Turn[]) => turns.reduce((sum, t) => (t.usage ? addTally(sum, t.usage) : sum), emptyTally())

function minusTally(a: UsageTally, b: UsageTally): UsageTally {
  return {
    calls: Math.max(0, a.calls - b.calls),
    input: Math.max(0, a.input - b.input),
    output: Math.max(0, a.output - b.output),
    cost: Math.max(0, a.cost - b.cost),
    models: { ...a.models },
  }
}

/** Il lavoro puo' fare un altro giro: restano giri e (se c'e') limite di spesa. */
export const canContinue = (job: Job | null | undefined) =>
  Boolean(job) && (job!.round ?? 0) < MAX_ROUNDS && !overBudget(job!.budget ?? null, job!.usage || emptyTally())

/** Messaggio con cui un nuovo giro riprende la richiesta. */
export const continuationMessage = (original: string) =>
  `Continua il lavoro richiesto prima (“${original}”) con quello che resta: i passi già fatti sono elencati sopra, non rifarli.`

/** Lavoro "in corso" ma fermo da troppo: va ripreso o chiuso. */
export const isStale = (job: Job | null) => Boolean(job && job.status === 'running' && !isRunning(job))

/**
 * Lavoro rimasto "in corso" ma fermo da troppo, che non puo' ripartire da solo:
 * lo chiude con un messaggio e conserva i token spesi, invece di farlo sparire.
 */
export async function recoverStaleJob(scope: Scope, state: AssistantState): Promise<AssistantState> {
  const job = state.job
  if (!job || !isStale(job)) return state
  return updateState(scope, (s) => {
    if (!s.job || s.job.id !== job.id || !isStale(s.job)) return false
    const lost = minusTally(s.job.usage || emptyTally(), sumUsage(s.turns.filter((t) => t.job === job.id)))
    s.turns.push({
      id: newId(),
      role: 'assistant',
      job: job.id,
      text: 'Mi sono fermato prima di finire. Scrivimi "continua" e riprendo da dove sono rimasto: i passi già fatti non li rifaccio.',
      usage: lost.calls ? lost : undefined,
    })
    s.job.status = 'error'
    s.job.updatedAt = new Date().toISOString()
  })
}

export const IMAGE_PREFIX = 'assistant_image:'

const CHAT_BUCKET = 'blog-images'

/** Salva un'immagine della chat come JPEG pubblico (per usarla nei caroselli e nei post). */
async function storeChatImage(image: ImageInput): Promise<string | null> {
  try {
    const jpeg = await sharp(Buffer.from(image.data, 'base64')).rotate().jpeg({ quality: 90 }).toBuffer()
    const path = `chat/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
    const { error } = await supabaseAdmin.storage.from(CHAT_BUCKET).upload(path, jpeg, { contentType: 'image/jpeg', upsert: false })
    if (error) throw new Error(error.message)
    return supabaseAdmin.storage.from(CHAT_BUCKET).getPublicUrl(path).data.publicUrl
  } catch (error) {
    console.warn('super chat: immagine non salvata:', error instanceof Error ? error.message : error)
    return null
  }
}

/** Testo che accompagna la richiesta: cosa c'e' nelle immagini e dove sono salvate. */
function imageNote(text: string | undefined, urls: string[] | undefined, earlier: string[]) {
  return [
    text ? `[Contenuto delle immagini allegate da Luca]\n${text}` : '',
    urls?.length ? `[Immagini allegate da Luca in questa richiesta, utilizzabili nei post e nei caroselli (in quest'ordine)]\n${urls.join('\n')}` : '',
    earlier.length ? `[Immagini mandate da Luca prima in questa chat, ancora utilizzabili]\n${earlier.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Immagini allegate all'ultima richiesta: si leggono una volta sola (all'inizio del
 * lavoro), il testo letto resta nella conversazione e le immagini intere si salvano
 * come file pubblici (per i caroselli), poi si tolgono dalle impostazioni.
 */
async function withImages(scope: Scope, jobId: string, start: AssistantState, message: string): Promise<string> {
  // Nei giri successivi job.original contiene gia' il testo delle immagini.
  if ((start.job?.round ?? 0) > 0) return message
  const userTurns = start.turns.filter((t) => t.role === 'user')
  const turn = userTurns[userTurns.length - 1]
  if (!turn) return message
  const earlier = userTurns.slice(-6, -1).flatMap((t) => t.imageUrls || [])
  const join = (note: string) => (note ? `${message}\n\n${note}` : message)
  if (turn.imageText || !turn.imageKeys?.length) return join(imageNote(turn.imageText, turn.imageUrls, earlier))

  reportStatus(turn.imageKeys.length > 1 ? 'Guardo le immagini…' : 'Guardo l’immagine…')
  const keys = turn.imageKeys.map((k) => `${IMAGE_PREFIX}${k}`)
  const { data } = await supabaseAdmin.from('app_settings').select('key, value').in('key', keys)
  const images: ImageInput[] = keys
    .map((key) => (data || []).find((row) => row.key === key)?.value?.match(/^data:([^;]+);base64,(.+)$/))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => ({ mimeType: m[1], data: m[2] }))
  let text = ''
  const [read, urls] = await Promise.all([
    readImages(images, turn.text).catch((error) => `(non sono riuscito a leggere le immagini: ${error instanceof Error ? error.message : 'errore'})`),
    Promise.all(images.map(storeChatImage)).then((list) => list.filter((u): u is string => Boolean(u))),
  ])
  text = read
  const note = imageNote(text.slice(0, 8000), urls, earlier)
  await updateState(scope, (s) => {
    const t = s.turns.find((x) => x.id === turn.id)
    if (!t) return false
    t.imageText = text.slice(0, 8000)
    if (urls.length) t.imageUrls = urls
    delete t.imageKeys
    // I giri successivi ripartono da job.original: deve contenere anche le immagini lette.
    if (s.job?.id === jobId) s.job.original = `${s.job.original}\n\n${note}`
  }).catch(() => undefined)
  await supabaseAdmin.from('app_settings').delete().in('key', keys)
  return join(note)
}

function addTally(a: UsageTally, b: UsageTally): UsageTally {
  const models = { ...a.models }
  for (const [m, n] of Object.entries(b.models)) models[m] = (models[m] || 0) + n
  return { calls: a.calls + b.calls, input: a.input + b.input, output: a.output + b.output, cost: a.cost + b.cost, models }
}

/**
 * Esegue un giro del lavoro (chiamato dentro after(): prosegue anche a pagina chiusa).
 * Se il tempo del giro finisce prima del termine, chiama `continueJob` per il giro
 * successivo: la richiesta prosegue da sola fino alla fine (o al limite di spesa).
 */
export async function runJob(scope: Scope, jobId: string, message: string, continueJob: (round: number) => Promise<void>) {
  const start = await loadState(scope)
  const job = start.job
  if (!job || job.id !== jobId) return
  const runId = job.run
  const mine = (s: AssistantState) => s.job?.id === jobId && s.job.run === runId

  const history = start.turns
    .slice(-9, -1)
    .map((t) => {
      // Caroselli mostrati in anteprima: l'agente ne conosce il draftId (per correggerli).
      const posts = (t.actions || []).flatMap((a) => (a.kind === 'post_preview' ? [`\n[Carosello in anteprima: draftId ${a.draftId}, ${a.urls.length} slide]`] : []))
      return { role: t.role, text: `${`${t.text}${t.imageText ? `\n[Immagini allegate] ${t.imageText}` : ''}`.slice(0, 2500)}${posts.slice(-3).join('')}` }
    })
  // Token di questo giro; il totale della richiesta somma anche i giri precedenti.
  const tally: UsageTally = emptyTally()
  const base: UsageTally = job.usage && (job.round ?? 0) > 0 ? job.usage : emptyTally()
  const total = () => addTally(base, tally)
  const steps = [...(job.steps || [])]
  const budget = job.budget ?? null
  const round = job.round ?? 0

  let lastWrite = 0
  let pendingText = ''
  let stopped = false
  const writeStatus = async (text?: string, force = false) => {
    if (text !== undefined) pendingText = text
    if (stopped || (!force && Date.now() - lastWrite < 1500)) return
    lastWrite = Date.now()
    await updateState(scope, (s) => {
      if (!mine(s) || s.job!.status !== 'running') return false
      s.job!.statusText = pendingText || s.job!.statusText
      s.job!.usage = total()
      s.job!.steps = steps.slice(-MAX_STEPS_SAVED)
      s.job!.updatedAt = new Date().toISOString()
    }).catch(() => undefined)
  }

  /** Passa al giro successivo (nuova funzione, tempo pieno). false = non si puo'. */
  const nextRound = async (statusText: string) => {
    if (round >= MAX_ROUNDS || overBudget(budget, total())) return false
    await updateState(scope, (s) => {
      if (!mine(s)) return false
      s.job!.status = 'running'
      s.job!.statusText = statusText
      s.job!.usage = total()
      s.job!.steps = steps.slice(-MAX_STEPS_SAVED)
      s.job!.updatedAt = new Date().toISOString()
    })
    return continueJob(round + 1).then(
      () => true,
      () => false
    )
  }

  /** Risposta finale: i token non ancora scritti in nessuna risposta di questa richiesta finiscono qui. */
  const reply = (s: AssistantState, text: string, actions?: SocialAction[]) => {
    const unwritten = minusTally(total(), sumUsage(s.turns.filter((t) => t.job === jobId)))
    s.turns.push({ id: newId(), role: 'assistant', job: jobId, text, actions, usage: unwritten.calls ? unwritten : undefined })
  }

  let seen = total()
  let lastStep: UsageTally | undefined
  // Oggetto condiviso con il lavoro: azzerando la scadenza il giro si ferma al passo successivo.
  const timing = { deadline: Date.now() + WORK_BUDGET_MS }
  try {
    const work = runWithStatus(
      {
        status: (text) => void writeStatus(text),
        get deadline() {
          return timing.deadline
        },
        model: job.model,
        usage: tally,
        onUsage: () => {
          // Costo dell'ultima chiamata: serve a prevedere se la prossima sta nel limite.
          const now = total()
          lastStep = { calls: 1, input: now.input - seen.input, output: now.output - seen.output, cost: now.cost - seen.cost, models: {} }
          seen = now
          void writeStatus()
        },
        overBudget: () => overBudget(budget, total(), lastStep),
      },
      async () =>
        runAssistant(
          await withImages(scope, jobId, start, message),
          history,
          start.drafts,
          budget,
          {
            done: job.steps,
            onStep: (line) => {
              steps.push(line)
              void writeStatus(undefined, true)
            },
          },
          { admin: job.admin === true }
        )
    )
    // Prima che il server chiuda la funzione (300 s) si passa a un nuovo giro.
    const result = await Promise.race([work, new Promise<null>((resolve) => setTimeout(() => resolve(null), HARD_STOP_MS))])
    if (!result) {
      stopped = true
      // Il giro vecchio non deve lavorare in parallelo a quello nuovo.
      timing.deadline = 1
      const ok = await nextRound('Ci sto mettendo più del previsto: continuo…').catch(() => false)
      if (!ok) {
        await updateState(scope, (s) => {
          if (!mine(s)) return false
          reply(s, 'Questo lavoro sta richiedendo molto tempo e mi sono fermato. Scrivimi "continua" e riprendo da dove sono rimasto: i passi già fatti non li rifaccio.')
          s.job!.status = 'done'
          s.job!.statusText = ''
          s.job!.usage = total()
          s.job!.steps = steps.slice(-MAX_STEPS_SAVED)
          s.job!.updatedAt = new Date().toISOString()
        })
      }
      return
    }
    stopped = true
    const again = Boolean(result.more) && round < MAX_ROUNDS && !overBudget(budget, total())
    await updateState(scope, (s) => {
      if (!mine(s)) return false
      const drafts = new Map(s.drafts.map((d) => [d.leadId, d]))
      for (const id of result.removeDrafts || []) drafts.delete(id)
      for (const d of result.drafts || []) drafts.set(d.leadId, d)
      s.drafts = [...drafts.values()]
      // Giro intermedio: niente messaggio in chat (solo lo stato), salvo azioni da confermare.
      if (!again || result.actions?.length) reply(s, clean(result.reply || ''), result.actions?.length ? result.actions : undefined)
      s.job!.status = again ? 'running' : 'done'
      s.job!.statusText = again ? clean(result.reply || '') || 'Continuo con il resto…' : ''
      s.job!.updatedAt = new Date().toISOString()
      s.job!.usage = total()
      s.job!.steps = steps.slice(-MAX_STEPS_SAVED)
      s.job!.result = { refresh: result.refresh, confirmSend: result.confirmSend, focus: result.focus }
    })
    if (again) {
      const ok = await continueJob(round + 1).then(
        () => true,
        () => false
      )
      if (!ok) {
        await updateState(scope, (s) => {
          if (!mine(s)) return false
          s.turns.push({ id: newId(), role: 'assistant', job: jobId, text: 'Mi sono fermato a metà: scrivimi "continua" e riprendo da dove sono rimasto.' })
          s.job!.status = 'done'
        })
      }
    }
  } catch (error) {
    if (stopped) return
    stopped = true
    await updateState(scope, (s) => {
      if (!mine(s)) return false
      reply(s, error instanceof Error ? error.message : 'Qualcosa è andato storto, riprova.')
      s.job!.status = 'error'
      s.job!.usage = total()
      s.job!.steps = steps.slice(-MAX_STEPS_SAVED)
      s.job!.updatedAt = new Date().toISOString()
    }).catch(() => undefined)
  }
}

// ---------------------------------------------------------------------
// Chat salvate (come nella beta): "Nuova chat" non cancella piu' niente.
// La chiave assistant_state:<scope> contiene sempre la chat APERTA, quindi
// lavori, cron, giri successivi e pagina Clienti non cambiano. Le altre chat
// stanno in assistant_chat:<scope>:<id>, con l'elenco in assistant_chats:<scope>.
// Le bozze email restano in comune a tutte le chat ("le bozze non inviate restano").
// Si cambia chat solo a lavoro fermo.
// ---------------------------------------------------------------------

export type ChatInfo = { id: string; title: string; updatedAt: string; count: number; current?: boolean }
type ChatArchive = { turns: Turn[]; job: Job | null }

const MAX_CHATS = 60
const CHAT_ID_RE = /^[a-z0-9]{6,40}$/
const chatsKey = (scope: Scope) => `assistant_chats:${scope}`
const archiveKey = (scope: Scope, id: string) => `assistant_chat:${scope}:${id}`

/** Errore da mostrare nella pagina (status: codice HTTP della risposta). */
export class ChatError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
  }
}

function parseIndex(raw: string | null): { chats: ChatInfo[] } {
  try {
    const parsed = raw ? JSON.parse(raw) : null
    const chats = Array.isArray(parsed?.chats) ? parsed.chats : []
    return { chats: chats.filter((c: Partial<ChatInfo>) => typeof c?.id === 'string' && typeof c?.updatedAt === 'string') }
  } catch {
    return { chats: [] }
  }
}

function parseArchive(raw: string | null): ChatArchive | null {
  try {
    const parsed = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed?.turns) ? { turns: parsed.turns, job: parsed.job || null } : null
  } catch {
    return null
  }
}

/** Titolo della chat: la prima richiesta di Luca (o il primo carosello). */
function chatTitle(turns: Turn[]): string {
  const first = turns.find((t) => t.role === 'user' && t.text.trim())?.text
  const post = turns.flatMap((t) => t.actions || []).find((a) => a.kind === 'post_preview')
  const title = first || (post?.kind === 'post_preview' ? post.title : '')
  return title.replace(/\s+/g, ' ').trim().slice(0, 70) || 'Chat'
}

const sameTurns = (a: Turn[], b: Turn[]) => JSON.stringify(a) === JSON.stringify(b)

async function loadStamped(scope: Scope) {
  const { value, stamp } = await readSetting(keyOf(scope))
  return { state: parseState(value), stamp: stamp || new Date().toISOString() }
}

/** Salva la chat aperta tra quelle salvate (prima di cambiarla: cosi' non si perde mai). */
async function archiveChat(scope: Scope, id: string, state: AssistantState, updatedAt: string, keep: string) {
  // Il lavoro resta (serve a "continua" e al limite di spesa), ma chiuso e gia' gestito.
  const job: Job | null = state.job ? { ...state.job, status: state.job.status === 'running' ? 'error' : state.job.status, handled: true } : null
  await updateSetting<ChatArchive | null>(archiveKey(scope, id), parseArchive, () => ({ turns: state.turns, job }))
  let dropped: string[] = []
  await updateSetting(chatsKey(scope), parseIndex, (index) => {
    const info: ChatInfo = { id, title: chatTitle(state.turns), updatedAt, count: state.turns.length }
    const chats = [info, ...index.chats.filter((c) => c.id !== id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const kept = chats.filter((c, i) => i < MAX_CHATS || c.id === keep)
    dropped = chats.filter((c) => !kept.includes(c)).map((c) => c.id)
    return { chats: kept }
  })
  // Oltre le 60 chat si tolgono le piu' vecchie.
  if (dropped.length) {
    const { error } = await supabaseAdmin.from('app_settings').delete().in('key', dropped.map((d) => archiveKey(scope, d)))
    if (error) console.warn('chat salvate: pulizia non riuscita:', error.message)
  }
}

/**
 * Sostituisce la chat aperta con `next` dopo averla salvata. Si salva solo se intanto
 * la chat aperta non e' cambiata (stessi messaggi, nessun lavoro in corso).
 */
async function switchChat(scope: Scope, target: string | null, load: () => Promise<ChatArchive | null>): Promise<AssistantState> {
  // Chat di prima senza id (salvata prima delle chat multiple): lo stesso id anche se si riprova.
  const fallbackId = newId()
  for (let attempt = 0; attempt < 3; attempt++) {
    const { state: snap, stamp } = await loadStamped(scope)
    if (target && snap.chatId === target) return snap
    if (!target && !snap.turns.length) return snap
    if (isRunning(snap.job)) throw new ChatError('Sto ancora lavorando: aspetta che finisca, poi cambia chat.', 409)
    const next = await load()
    if (!next) throw new ChatError('Chat non trovata', 404)
    if (snap.turns.length) await archiveChat(scope, snap.chatId || fallbackId, snap, stamp, target || '')
    const flag = { applied: false }
    const state = await updateState(scope, (s) => {
      // Si puo' rifare piu' volte (salvataggio conteso): conta solo l'ultima.
      flag.applied = false
      if (isRunning(s.job) || !sameTurns(s.turns, snap.turns)) return false
      s.turns = next.turns
      s.job = next.job
      s.chatId = target || newId()
      flag.applied = true
    })
    if (flag.applied) return state
  }
  throw new ChatError('La chat è cambiata proprio ora: riprova.', 409)
}

/** Nuova chat vuota; quella di prima resta salvata. */
export function startNewChat(scope: Scope): Promise<AssistantState> {
  return switchChat(scope, null, async () => ({ turns: [], job: null }))
}

/** Riapre una chat salvata; quella aperta resta salvata. */
export function openChat(scope: Scope, id: string): Promise<AssistantState> {
  if (!CHAT_ID_RE.test(id)) return Promise.reject(new ChatError('Chat non trovata', 404))
  return switchChat(scope, id, async () => parseArchive((await readSetting(archiveKey(scope, id))).value))
}

/** Chat da mostrare nell'elenco: prima quella aperta, poi le salvate dalla piu' recente. */
export async function listChats(scope: Scope): Promise<ChatInfo[]> {
  const [{ state, stamp }, index] = await Promise.all([loadStamped(scope), readSetting(chatsKey(scope)).then((r) => parseIndex(r.value))])
  const current: ChatInfo = {
    id: state.chatId || '',
    title: state.turns.length ? chatTitle(state.turns) : 'Nuova chat',
    updatedAt: stamp,
    count: state.turns.length,
    current: true,
  }
  return [current, ...index.chats.filter((c) => c.id !== state.chatId)]
}
