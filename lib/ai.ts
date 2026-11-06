import { AsyncLocalStorage } from 'node:async_hooks'
import { facevoiceDb, workspaceDb } from '@/lib/workspace-db'
import Anthropic from '@anthropic-ai/sdk'
import {
  GEMINI_DEFAULT_MODEL,
  callGeminiAPI,
  callGeminiGrounded,
  geminiErrorInfo,
  getGeminiApiKey,
  type GeminiChatMessage,
  type GroundedAnswer,
  type GroundingChunk,
  type GroundingSupport,
} from '@/lib/gemini'
import { getAnthropicApiKey } from '@/lib/claude'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { afterAIUsage, assertAIAllowed, isAIBlockedError } from '@/lib/usage-limits'

// ---------------------------------------------------------------------
// Gemini + Claude combinati: si lavora con Gemini (gratuito) finché regge;
// quando arriva al limite (rate limit, quota, credito esaurito) o non
// risponde, la stessa richiesta passa a Claude. Dopo un limite Gemini resta
// "a riposo" per un po' e le chiamate successive vanno dirette su Claude,
// senza attese.
// ---------------------------------------------------------------------

// Riserva quando tutti i modelli Gemini gratuiti sono al limite: Haiku 4.5 e' il
// Claude piu' economico ($1/$5 per milione di token), adatto a testi brevi,
// analisi e traduzioni.
export const CLAUDE_FALLBACK_MODEL = 'claude-haiku-4-5'

// Il piano gratuito di Gemini ha limiti separati per ogni modello: prima di
// passare a Claude si provano tutti, dal migliore al piu' leggero.
const GEMINI_ROTATION = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest']
const DAILY_QUOTA_COOLDOWN_MS = 60 * 60_000
const MISSING_MODEL_COOLDOWN_MS = 6 * 60 * 60_000
/**
 * Modello che rifiuta una richiesta (400 INVALID_ARGUMENT) che un altro modello accetta: a riposo
 * per mezz'ora. Se la rifiutano tutti, la colpa e' della richiesta e nessuno va a riposo.
 */
const INVALID_ARGUMENT_COOLDOWN_MS = 30 * 60_000
/** Per quanto si ricorda che un modello va chiamato senza thinkingConfig (poi si riprova con). */
const NO_THINKING_CONFIG_MS = 6 * 60 * 60_000
/** Senza thinkingConfig il ragionamento usa lo stesso budget della risposta: spazio in piu' per non troncarla. */
const THINKING_ROOM_TOKENS = 2048

const GEMINI_COOLDOWN_MS = 60_000
const PACE_MS = 4500
const RATE_LIMIT_WAITS_MS = [15_000, 30_000, 45_000]

type AIOptions = {
  temperature?: number
  maxOutputTokens?: number
  /** Funzione che usa l'AI, per la pagina Consumi (es. "chat_sito", "assistente_clienti"). */
  feature?: string
  /**
   * Spazio di lavoro a cui addebitare il consumo (default: quello del lavoro in corso,
   * vedi runWithStatus, altrimenti Facevoice). Al limite del piano la chiamata non parte.
   */
  workspaceId?: string
  /**
   * Conversazione che si rimanda piu' volte (es. i passi dell'assistente): con Claude
   * la parte gia' mandata si rilegge dalla cache a circa un decimo del prezzo.
   * Per le chiamate singole no: la prima scrittura in cache costa il 25% in piu'.
   */
  cache?: boolean
}

// Prezzi Claude in USD per milione di token (Gemini e' sul piano gratuito).
const CLAUDE_PRICES: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
}
const priceOf = (model: string) =>
  CLAUDE_PRICES[Object.keys(CLAUDE_PRICES).find((id) => model.startsWith(id)) || 'claude-haiku-4-5']

export { AI_MODEL_CHOICES, asModelChoice, type AIModelChoice } from '@/lib/ai-models'
import type { AIModelChoice } from '@/lib/ai-models'

/** Token e costi accumulati durante un lavoro (mostrati in tempo reale nella Super chat). */
export type UsageTally = { calls: number; input: number; output: number; cost: number; models: Record<string, number> }
export const emptyTally = (): UsageTally => ({ calls: 0, input: 0, output: 0, cost: 0, models: {} })

/** Registra la chiamata per la pagina Consumi. Non blocca e non fa mai fallire la risposta. */
function recordUsage(row: {
  feature?: string
  workspaceId?: string
  provider: 'gemini' | 'claude'
  model: string
  outcome?: 'ok' | 'limit' | 'error'
  input?: number
  output?: number
  /** Parte dell'input letta dalla cache (~0,1x) e scritta in cache (1,25x): gia' compresa in input. */
  cacheRead?: number
  cacheWrite?: number
  /** Costo in piu' oltre ai token, in USD (es. la ricerca Google: GROUNDING_FEE_USD). */
  extraCost?: number
}) {
  const input = row.input || 0
  const output = row.output || 0
  const workspaceId = row.workspaceId || work.getStore()?.workspaceId
  const price = priceOf(row.model)
  const read = row.cacheRead || 0
  const write = row.cacheWrite || 0
  const plain = Math.max(0, input - read - write)
  const tokens = row.provider === 'claude' ? ((plain + read * 0.1 + write * 1.25) * price.input + output * price.output) / 1_000_000 : 0
  const cost = tokens + ((row.outcome || 'ok') === 'ok' ? Math.max(0, row.extraCost || 0) : 0)
  const tally = work.getStore()?.usage
  if (tally && (row.outcome || 'ok') === 'ok') {
    tally.calls++
    tally.input += input
    tally.output += output
    tally.cost += cost
    tally.models[row.model] = (tally.models[row.model] || 0) + 1
    try {
      work.getStore()?.onUsage?.()
    } catch {}
  }
  const logged = Promise.resolve(
    (workspaceId ? workspaceDb(workspaceId) : facevoiceDb).from('ai_usage').insert({
      feature: row.feature || 'altro',
      provider: row.provider,
      model: row.model,
      outcome: row.outcome || 'ok',
      input_tokens: input,
      output_tokens: output,
      cost_usd: cost,
    })
  )
    .then(({ error }) => {
      if (error) console.warn('ai_usage:', error.message)
      return !error
    })
    .catch(() => false)
  // Soglie del piano del cliente (gettoni, blocco, avvisi a Facevoice): dopo la risposta.
  if ((row.outcome || 'ok') === 'ok') afterAIUsage(workspaceId, cost, logged)
}
export type AIResult = { message: string; provider: 'gemini' | 'claude'; model: string }

// Modello Gemini → istante fino a cui resta a riposo.
const geminiCooling = new Map<string, number>()
let paceQueue: Promise<unknown> = Promise.resolve()
let lastPacedCall = 0
let claudeClient: Anthropic | null = null

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// Stato del lavoro in corso: chi avvia un lavoro lungo (es. l'assistente della
// Ricerca clienti) riceve brevi messaggi di avanzamento e una scadenza oltre la
// quale non conviene iniziare altro (Vercel chiude la richiesta a 300s).
type WorkContext = {
  status: (text: string) => void
  deadline?: number
  /** Modello scelto per questo lavoro (Super chat). */
  model?: AIModelChoice
  /** Contatore dei token, aggiornato a ogni chiamata. */
  usage?: UsageTally
  /** Avvisato dopo ogni chiamata conteggiata (per salvare i token in tempo reale). */
  onUsage?: () => void
  /** Limite di spesa chiesto da Luca per questa richiesta: true quando e' (quasi) raggiunto. */
  overBudget?: () => boolean
  /** Spazio di lavoro del cliente per cui si lavora: consumo e limite del piano vanno li'. */
  workspaceId?: string
}
const work = new AsyncLocalStorage<WorkContext>()

/** Spazio a cui va la chiamata: quello indicato, altrimenti quello del lavoro in corso. */
const workspaceOf = (options?: AIOptions) => options?.workspaceId || work.getStore()?.workspaceId

export function runWithStatus<T>(context: WorkContext, fn: () => Promise<T>): Promise<T> {
  return work.run(context, fn)
}

export function reportStatus(text: string) {
  try {
    work.getStore()?.status(text)
  } catch {
    // Il client puo' essersi scollegato: il lavoro continua comunque.
  }
}

/** Limite di spesa della richiesta raggiunto: i lavori lunghi si fermano qui. */
export function budgetReached(): boolean {
  try {
    return Boolean(work.getStore()?.overBudget?.())
  } catch {
    return false
  }
}

export function timeIsUp(): boolean {
  const deadline = work.getStore()?.deadline
  return Boolean(deadline && Date.now() > deadline)
}

export function hasAIProvider(): boolean {
  return Boolean(getGeminiApiKey() || getAnthropicApiKey())
}

function isLimitError(message: string): boolean {
  return /rate limit|quota|prepayment|credits are depleted|RESOURCE_EXHAUSTED|429/i.test(message)
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Quanto resta a riposo un modello Gemini al limite: quota del giorno esaurita (dai dettagli di
 * Google: quotaId "...PerDay...", "per day") = DAILY_QUOTA_COOLDOWN_MS; limite al minuto = l'attesa
 * suggerita da Google (retryDelay) se c'e', altrimenti GEMINI_COOLDOWN_MS.
 */
function limitCooldownMs(error: unknown): number {
  const info = geminiErrorInfo(error)
  if (info?.daily || /giornalier|daily|per day/i.test(errorText(error))) return DAILY_QUOTA_COOLDOWN_MS
  if (info?.retryDelayMs) return Math.min(DAILY_QUOTA_COOLDOWN_MS, Math.max(1_000, info.retryDelayMs))
  return GEMINI_COOLDOWN_MS
}

/** Dettagli di Google per i log (mai per il cliente). */
const geminiDetail = (error: unknown) => geminiErrorInfo(error)?.detail || errorText(error)

/** 400 "Request contains an invalid argument" (INVALID_ARGUMENT): vale solo per quel modello, non per tutti. */
function isInvalidArgument(error: unknown): boolean {
  const message = errorText(error)
  if (isLimitError(message)) return false
  return geminiErrorInfo(error)?.status === 'INVALID_ARGUMENT' || /invalid argument|INVALID_ARGUMENT/i.test(message)
}

/**
 * Richiesta rifiutata per il suo contenuto (allegato troppo grande o illeggibile, troppi token):
 * nessun modello la accetterebbe, quindi non si provano gli altri e nessuno va a riposo.
 */
function isRequestFault(error: unknown): boolean {
  return /payload|too large|exceeds|size limit|mime|unable to process|unsupported (file|image|media|mime)|token count|input token/i.test(`${errorText(error)} ${geminiDetail(error)}`)
}

/** Modelli Gemini che rifiutano thinkingConfig (400 INVALID_ARGUMENT) -> fino a quando si chiamano senza. */
const noThinkingConfig = new Map<string, number>()
const callsWithoutThinkingConfig = (model: string) => Date.now() < (noThinkingConfig.get(model) || 0)

const availableGeminiModels = () => GEMINI_ROTATION.filter((m) => Date.now() >= (geminiCooling.get(m) || 0))

function geminiUsable(): boolean {
  return Boolean(getGeminiApiKey()) && availableGeminiModels().length > 0
}

/** Converte la cronologia nel formato Claude: ruoli alternati, si apre e si chiude con l'utente. */
function toClaudeMessages(messages: GeminiChatMessage[]): Anthropic.MessageParam[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = []
  for (const msg of messages) {
    const content = (msg.content || '').trim()
    if (!content) continue
    const role = msg.role === 'user' ? 'user' : 'assistant'
    const last = out[out.length - 1]
    if (last && last.role === role) last.content += `\n\n${content}`
    else out.push({ role, content })
  }
  if (out[0]?.role !== 'user') out.unshift({ role: 'user', content: '(inizio conversazione)' })
  if (out[out.length - 1].role !== 'user') out.push({ role: 'user', content: 'Continua.' })
  return out
}

const preferredModel = (): AIModelChoice => work.getStore()?.model || 'auto'

async function callClaudeText(
  messages: GeminiChatMessage[],
  system: string | undefined,
  options?: AIOptions,
  model: string = CLAUDE_FALLBACK_MODEL
): Promise<AIResult> {
  if (!claudeClient) claudeClient = new Anthropic({ apiKey: getAnthropicApiKey() })
  const isHaiku = model.startsWith('claude-haiku')
  const response = await claudeClient.messages.create({
    model,
    // Sonnet e Opus ragionano prima di rispondere: serve piu' spazio per il pensiero.
    max_tokens: isHaiku ? Math.min(8192, Math.max(1024, options?.maxOutputTokens || 2048)) : 16000,
    ...(system ? { system } : {}),
    messages: toClaudeMessages(messages),
    // Passi successivi della stessa conversazione: il prefisso gia' mandato si rilegge dalla cache.
    ...(options?.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
    // Haiku accetta la temperatura; Sonnet/Opus 5.5 no, e con effort basso costano meno.
    ...(isHaiku
      ? options?.temperature !== undefined
        ? { temperature: options.temperature }
        : {}
      : { output_config: { effort: 'low' as const } }),
  })
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()
  recordUsage({
    feature: options?.feature, workspaceId: options?.workspaceId,
    provider: 'claude',
    model: response.model,
    outcome: text && response.stop_reason !== 'refusal' ? 'ok' : 'error',
    input: (response.usage.input_tokens || 0) + (response.usage.cache_creation_input_tokens || 0) + (response.usage.cache_read_input_tokens || 0),
    output: response.usage.output_tokens || 0,
    cacheRead: response.usage.cache_read_input_tokens || 0,
    cacheWrite: response.usage.cache_creation_input_tokens || 0,
  })
  if (response.stop_reason === 'refusal' || !text) throw new Error('Claude non ha restituito una risposta')
  return { message: text, provider: 'claude', model: response.model }
}

/**
 * Ricerca Google dentro Gemini ("grounding"): Google la fa pagare a parte, anche quando i
 * token sono sul piano gratuito. Prezzo di listino: 35 USD ogni 1000 richieste con la
 * ricerca (0,035 USD l'una). Si aggiunge al cost_usd della riga di ai_usage, cosi' conta nei
 * gettoni e nel limite in euro del piano del cliente (lib/usage-limits.ts). Si addebita solo
 * se la ricerca e' partita davvero (nella risposta ci sono ricerche o pagine trovate).
 */
export const GROUNDING_FEE_USD = 0.035
/**
 * Ricerca sul web con Claude (strumento web_search di Anthropic), la riserva quando Gemini non
 * puo' cercare: 10 USD ogni 1000 ricerche (0,01 USD l'una) piu' i token (le pagine trovate
 * contano come token in ingresso). Si addebita per le ricerche fatte davvero
 * (usage.server_tool_use.web_search_requests), nella stessa riga di ai_usage dei token.
 */
export const CLAUDE_WEB_SEARCH_FEE_USD = 0.01
/** Ricerche al massimo per ogni richiesta a Claude. */
const CLAUDE_SEARCH_MAX_USES = 4
/** Spazio per la risposta JSON con gli eventi. */
const CLAUDE_SEARCH_MAX_TOKENS = 8000
/** Volte che si riprende una risposta in pausa (stop_reason "pause_turn"). */
const CLAUDE_SEARCH_MAX_RESUMES = 2
/** Se Gemini ha gia' consumato il suo tempo (es. non ha risposto), Claude ha al massimo questo in piu'. */
const CLAUDE_SEARCH_EXTRA_MS = 30_000
/** Limite breve: si consiglia di riprovare dopo questa attesa (una volta, nella stessa richiesta). */
const SHORT_LIMIT_RETRY_MS = 4_000
const SHORT_LIMIT_MAX_MS = 5_000

const CLAUDE_SEARCH_SYSTEM = `Per cercare usa lo strumento web_search: poche ricerche mirate (al massimo ${CLAUDE_SEARCH_MAX_USES}). Riporta solo quello che è scritto nelle pagine trovate. Dopo le ricerche rispondi SOLO con il JSON richiesto, senza testo prima o dopo.`

/** Modelli Gemini che hanno rifiutato la ricerca Google (o non esistono): istante fino a cui non si riprovano. */
const groundingUnsupported = new Map<string, number>()

/**
 * Risposta scritta dalle pagine trovate con la ricerca sul web, con le fonti: Gemini (ricerca
 * Google) o Claude (web_search). Con Claude: chunks = le pagine restituite dalla ricerca e
 * quelle citate (indirizzi veri, senza rimandi), supports = i pezzi di testo citati (indici in
 * byte UTF-8 nel testo, come Gemini), cited = i testi citati di ogni pagina (stesso indice di chunks).
 */
export type GroundedResult = GroundedAnswer & { provider: 'gemini' | 'claude'; cited?: string[][] }

export type GroundedSearchOptions = AIOptions & {
  system?: string
  timeoutMs?: number
  /** Luogo della ricerca: posizione approssimata della ricerca con Claude (in Italia). */
  place?: { city?: string; region?: string }
  /** Istruzioni in piu' solo per la ricerca con Claude (es. come scrivere le fonti). */
  claudeSystem?: string
}

/**
 * Ricerca sul web non riuscita con nessun servizio (Gemini e Claude). Il messaggio si puo'
 * mostrare al cliente: niente nomi di fornitori, piani o limiti (i dettagli vanno nei log).
 */
export class WebSearchUnavailableError extends Error {
  /** Limite breve (troppe richieste in pochi secondi): si puo' riprovare una volta dopo questa attesa. Null = non conviene riprovare ora. */
  retryAfterMs: number | null
  constructor(retryAfterMs: number | null) {
    super('ricerca sul web non disponibile in questo momento')
    this.name = 'WebSearchUnavailableError'
    this.retryAfterMs = retryAfterMs
  }
}

export const isWebSearchUnavailable = (error: unknown): error is WebSearchUnavailableError =>
  error instanceof WebSearchUnavailableError || (error as { name?: unknown } | null)?.name === 'WebSearchUnavailableError'

/** Errore della ricerca con Claude per troppe richieste in pochi secondi (anche dentro la risposta: too_many_requests). */
class ShortLimitError extends Error {
  retryAfterMs: number
  constructor(message: string, retryAfterMs = SHORT_LIMIT_RETRY_MS) {
    super(message)
    this.name = 'ShortLimitError'
    this.retryAfterMs = retryAfterMs
  }
}

/**
 * Chiamata con la ricerca sul web. Prima si controlla il limite del piano (AI finita: non parte).
 * Si provano i modelli Gemini con la ricerca Google come in callAI (quello al limite resta a
 * riposo; quello che rifiuta la richiesta si salta); se nessun modello Gemini puo' cercare
 * (nessuna chiave, tutti al limite o a riposo, richiesta rifiutata, qualsiasi altro errore) e
 * c'e' la chiave Anthropic, la stessa ricerca si fa con Claude (web_search). Il consumo va nello
 * spazio con la tariffa della ricerca di chi l'ha fatta. Se non riesce nessuno: WebSearchUnavailableError.
 */
export async function groundedSearch(prompt: string, options: GroundedSearchOptions): Promise<GroundedResult> {
  const workspaceId = workspaceOf(options)
  await assertAIAllowed(workspaceId)
  const startedAt = Date.now()
  let geminiError: unknown = null
  if (getGeminiApiKey()) {
    try {
      return await geminiGroundedSearch(prompt, options, workspaceId)
    } catch (error) {
      geminiError = error
    }
  }
  const why = geminiError ? `${errorText(geminiError)}${geminiErrorInfo(geminiError) ? ` · ${geminiDetail(geminiError)}` : ''}` : 'manca la chiave Gemini'
  // Come in callAI: con "Gemini" scelto dal cliente non si passa a Claude.
  if (!getAnthropicApiKey() || preferredModel() === 'gemini') {
    console.warn(`Ricerca sul web: Gemini non può cercare (${why}) e non c'è la riserva Claude`)
    throw new WebSearchUnavailableError(geminiError && isLimitError(errorText(geminiError)) ? geminiRetryAfterMs() : null)
  }
  console.warn(`Ricerca sul web: Gemini non può cercare (${why}), passo a Claude`)
  const spent = { searches: 0 }
  try {
    return await claudeWebSearch(prompt, options, workspaceId, startedAt, spent)
  } catch (error) {
    // AI del piano finita durante la ricerca: come in callAI, l'errore arriva cosi' com'e'.
    if (isAIBlockedError(error)) throw error
    console.warn(`Ricerca sul web con Claude non riuscita (${spent.searches} ricerche pagate): ${errorText(error)}`)
    // Una nuova prova rifarebbe da capo ricerche gia' pagate: si consiglia solo se non ne e' partita nessuna.
    throw new WebSearchUnavailableError(spent.searches > 0 ? null : claudeRetryAfterMs(error))
  }
}

/** Prova i modelli Gemini con la ricerca Google; quello al limite resta a riposo, quello che rifiuta la richiesta si salta. */
async function geminiGroundedSearch(prompt: string, options: GroundedSearchOptions, workspaceId?: string): Promise<GroundedResult> {
  let lastError: unknown = new Error('Rate limit: tutti i modelli Gemini sono a riposo')
  /** Modelli che hanno rifiutato questa richiesta: non cercano per mezz'ora solo se un altro modello la accetta. */
  const rejected: string[] = []
  for (const model of availableGeminiModels().filter((m) => Date.now() >= (groundingUnsupported.get(m) || 0))) {
    try {
      const answer = await callGeminiGrounded(prompt, model, options.system, { temperature: options.temperature, maxOutputTokens: options.maxOutputTokens, timeoutMs: options.timeoutMs })
      const searched = answer.queries.length > 0 || answer.chunks.length > 0
      recordUsage({
        feature: options.feature,
        workspaceId,
        provider: 'gemini',
        model,
        input: answer.usage?.prompt_tokens,
        output: answer.usage?.completion_tokens,
        extraCost: searched ? GROUNDING_FEE_USD : 0,
      })
      for (const other of rejected) {
        groundingUnsupported.set(other, Date.now() + INVALID_ARGUMENT_COOLDOWN_MS)
        console.warn(`Ricerca sul web: Gemini ${other} rifiuta una richiesta che ${model} accetta, non cerca per 30 min`)
      }
      return { ...answer, provider: 'gemini' }
    } catch (error) {
      lastError = error
      const message = errorText(error)
      if (isLimitError(message)) {
        const cooldown = limitCooldownMs(error)
        geminiCooling.set(model, Date.now() + cooldown)
        recordUsage({ feature: options.feature, workspaceId, provider: 'gemini', model, outcome: 'limit' })
        console.warn(`Ricerca sul web: Gemini ${model} al limite (a riposo ${Math.round(cooldown / 1000)} s), provo il modello successivo · ${geminiDetail(error)}`)
        continue
      }
      // Modello che non c'e' o che non fa la ricerca Google: a riposo solo per la ricerca
      // (per le altre chiamate puo' andare benissimo).
      if (isMissingModel(message)) {
        groundingUnsupported.set(model, Date.now() + MISSING_MODEL_COOLDOWN_MS)
        continue
      }
      // Richiesta rifiutata da questo modello (400 INVALID_ARGUMENT): si prova il successivo; va a riposo
      // per la ricerca solo se un altro modello la accetta (se la rifiutano tutti e' colpa della richiesta).
      if (isInvalidArgument(error)) {
        recordUsage({ feature: options.feature, workspaceId, provider: 'gemini', model, outcome: 'error' })
        if (isRequestFault(error)) throw error
        rejected.push(model)
        console.warn(`Ricerca sul web: Gemini ${model} rifiuta la richiesta, provo il modello successivo · ${geminiDetail(error)}`)
        continue
      }
      recordUsage({ feature: options.feature, workspaceId, provider: 'gemini', model, outcome: 'error' })
      throw error
    }
  }
  throw lastError
}

/** Attesa fino al primo modello Gemini che torna a cercare, se e' di pochi secondi (limite breve), altrimenti null. */
function geminiRetryAfterMs(): number | null {
  const now = Date.now()
  const soonest = Math.min(...GEMINI_ROTATION.map((m) => Math.max(geminiCooling.get(m) || 0, groundingUnsupported.get(m) || 0)))
  const wait = soonest - now
  return wait <= SHORT_LIMIT_MAX_MS ? Math.max(1_000, wait) : null
}

/** Limite breve di Claude (429 con poca attesa, o ricerche rifiutate per troppe richieste): attesa consigliata, altrimenti null. */
function claudeRetryAfterMs(error: unknown): number | null {
  if (error instanceof ShortLimitError) return error.retryAfterMs
  const e = error as { status?: unknown; headers?: { get?: (name: string) => string | null } } | null
  if (e?.status !== 429) return null
  const header = Number(e.headers?.get?.('retry-after'))
  if (!Number.isFinite(header) || header <= 0) return SHORT_LIMIT_RETRY_MS
  return header * 1000 <= SHORT_LIMIT_MAX_MS ? Math.max(1_000, header * 1000) : null
}

/**
 * La stessa ricerca con Claude e lo strumento web_search (messages.create, senza streaming).
 * Modello: quello scelto dal cliente se e' un Claude, altrimenti la riserva di sempre
 * (CLAUDE_FALLBACK_MODEL, Haiku 4.5: niente "thinking"). Tempo: options.timeoutMs per tutta la
 * ricerca (riprese comprese), al massimo CLAUDE_SEARCH_EXTRA_MS oltre il tempo gia' usato da Gemini.
 */
async function claudeWebSearch(
  prompt: string,
  options: GroundedSearchOptions,
  workspaceId: string | undefined,
  startedAt: number,
  /** Ricerche pagate finora (anche se poi la ricerca non riesce). */
  spent: { searches: number } = { searches: 0 }
): Promise<GroundedResult> {
  if (!claudeClient) claudeClient = new Anthropic({ apiKey: getAnthropicApiKey() })
  const pref = preferredModel()
  const model = pref.startsWith('claude') ? pref : CLAUDE_FALLBACK_MODEL
  const isHaiku = model.startsWith('claude-haiku')
  const limit = options.timeoutMs ?? 60_000
  const deadline = Math.min(Date.now() + limit, startedAt + limit + CLAUDE_SEARCH_EXTRA_MS)
  const city = options.place?.city?.trim()
  const region = options.place?.region?.trim()
  const tool: Anthropic.WebSearchTool20250305 = {
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: CLAUDE_SEARCH_MAX_USES,
    user_location: { type: 'approximate', country: 'IT', timezone: 'Europe/Rome', ...(city ? { city: city.slice(0, 80) } : {}), ...(region ? { region: region.slice(0, 80) } : {}) },
  }
  const system = [options.system, CLAUDE_SEARCH_SYSTEM, options.claudeSystem].filter(Boolean).join('\n\n')
  const content: Anthropic.ContentBlock[] = []
  let usedModel: string = model
  let paused = false
  for (let resume = 0; ; resume++) {
    // Ogni ripresa e' un'altra chiamata pagata: il piano si ricontrolla (AIBlockedError passa cosi' com'e').
    if (resume > 0) await assertAIAllowed(workspaceId)
    const left = deadline - Date.now()
    if (left < 5_000) throw new Error('tempo finito per la ricerca sul web')
    const response = await claudeClient.messages.create(
      {
        model,
        max_tokens: CLAUDE_SEARCH_MAX_TOKENS,
        system,
        tools: [tool],
        // Ripresa dopo "pause_turn": si rimanda la risposta in pausa cosi' com'e' (niente "continua").
        messages: [{ role: 'user', content: prompt }, ...(content.length ? [{ role: 'assistant' as const, content: content as Anthropic.ContentBlockParam[] }] : [])],
        // Haiku accetta la temperatura; Sonnet/Opus 5.5 no, e con effort basso costano meno.
        ...(isHaiku ? (options.temperature !== undefined ? { temperature: options.temperature } : {}) : { output_config: { effort: 'low' as const } }),
      },
      // Un solo tentativo per chiamata: una chiamata lenta non si moltiplica.
      { timeout: left, maxRetries: 0 }
    )
    usedModel = response.model || model
    const usage = response.usage
    // Ricerche fatte davvero (quelle finite in errore non si pagano).
    const searches =
      usage.server_tool_use?.web_search_requests ??
      response.content.filter((b) => b.type === 'web_search_tool_result' && Array.isArray(b.content)).length
    spent.searches += Math.max(0, searches)
    recordUsage({
      feature: options.feature,
      workspaceId,
      provider: 'claude',
      model: usedModel,
      input: (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0),
      output: usage.output_tokens || 0,
      cacheRead: usage.cache_read_input_tokens || 0,
      cacheWrite: usage.cache_creation_input_tokens || 0,
      extraCost: Math.max(0, searches) * CLAUDE_WEB_SEARCH_FEE_USD,
    })
    content.push(...response.content)
    if (response.stop_reason === 'refusal') throw new Error('Claude non ha fatto la ricerca')
    paused = response.stop_reason === 'pause_turn'
    if (!paused) break
    if (resume >= CLAUDE_SEARCH_MAX_RESUMES || deadline - Date.now() < 15_000) break
  }
  const answer = claudeGroundedAnswer(content, usedModel)
  if (!answer.chunks.length && answer.searchErrors.length) {
    // Nessuna pagina trovata: tutte le ricerche sono state rifiutate.
    const message = `ricerche rifiutate (${answer.searchErrors.join(', ')})`
    throw answer.searchErrors.includes('too_many_requests') ? new ShortLimitError(message) : new Error(message)
  }
  // Ricerca non finita (ancora in pausa dopo le riprese o senza tempo per riprenderla) o nessun
  // JSON dopo le ricerche: non e' "0 eventi trovati", la ricerca non e' riuscita.
  if (paused) throw new Error('ricerca sul web non finita (ancora in pausa)')
  const lastSearch = content.map((b) => b.type).lastIndexOf('web_search_tool_result')
  const after = content.slice(lastSearch + 1).map((b) => (b.type === 'text' ? b.text : '')).join('')
  if (!/[{[]/.test(after)) throw new Error('Claude non ha restituito la risposta con gli eventi')
  console.log(`Ricerca sul web con Claude (${usedModel}): ${answer.queries.length} ricerche, ${answer.chunks.length} pagine, ${answer.supports.length} pezzi citati`)
  const { searchErrors: _errors, ...result } = answer
  return result
}

/**
 * Risposta di Claude con web_search nella forma di quella di Gemini: text = i blocchi di testo
 * uniti (senza separatori: le citazioni dividono il testo in piu' blocchi, anche dentro il JSON);
 * queries = le ricerche fatte; chunks = le pagine restituite dalla ricerca e quelle citate (una
 * volta sola); supports = i pezzi di testo con citazioni, con la posizione in byte UTF-8 nel
 * testo e le pagine citate; cited = i testi citati di ogni pagina; searchErrors = errori delle ricerche.
 */
export function claudeGroundedAnswer(content: Anthropic.ContentBlock[], model: string): GroundedResult & { searchErrors: string[] } {
  let text = ''
  const queries: string[] = []
  const chunks: GroundingChunk[] = []
  const cited: string[][] = []
  const supports: GroundingSupport[] = []
  const searchErrors: string[] = []
  const index = new Map<string, number>()
  const chunkOf = (url: string, title: string | null) => {
    const key = url.trim()
    let k = index.get(key)
    if (k === undefined) {
      k = chunks.length
      index.set(key, k)
      chunks.push({ uri: key, title: title || '' })
      cited.push([])
    } else if (title && !chunks[k].title) chunks[k].title = title
    return k
  }
  for (const block of content) {
    if (block.type === 'server_tool_use') {
      const query = (block.input as { query?: unknown } | null)?.query
      if (block.name === 'web_search' && typeof query === 'string' && query.trim()) queries.push(query.trim())
    } else if (block.type === 'web_search_tool_result') {
      // Errore della ricerca: arriva dentro la risposta (HTTP 200), non come eccezione.
      if (Array.isArray(block.content)) {
        for (const result of block.content) if (result.type === 'web_search_result' && result.url) chunkOf(result.url, result.title)
      } else searchErrors.push(block.content.error_code)
    } else if (block.type === 'text') {
      const startIndex = Buffer.byteLength(text, 'utf8')
      text += block.text
      const pages: number[] = []
      for (const c of block.citations || []) {
        if (c.type !== 'web_search_result_location' || !c.url) continue
        const k = chunkOf(c.url, c.title)
        if (c.cited_text && !cited[k].includes(c.cited_text)) cited[k].push(c.cited_text.slice(0, 1000))
        pages.push(k)
      }
      if (pages.length && block.text.trim()) supports.push({ text: block.text, startIndex, endIndex: Buffer.byteLength(text, 'utf8'), chunks: [...new Set(pages)] })
    }
  }
  return { text, model, queries, chunks, supports, provider: 'claude', cited, searchErrors }
}

const isMissingModel = (message: string) => /not found|NOT_FOUND|is not supported|no longer available/i.test(message)

/**
 * Prova i modelli Gemini gratuiti uno dopo l'altro; quello al limite resta a riposo. Un modello
 * che rifiuta la richiesta (400 INVALID_ARGUMENT, es. per thinkingConfig) si riprova una volta
 * senza thinkingConfig (se va, si ricorda per qualche ora); se rifiuta ancora si passa al
 * successivo. Va a riposo mezz'ora solo se un modello dopo accetta la stessa richiesta: se la
 * rifiutano tutti (allegato o testo che Gemini non prende) la colpa e' della richiesta, nessuno va
 * a riposo e solo questa chiamata passa a Claude (chi chiama). Se un modello la rifiuta anche senza
 * thinkingConfig, agli altri non si rifa' la prova senza (sarebbe solo una richiesta in piu').
 */
async function tryGemini(
  messages: GeminiChatMessage[],
  system: string | undefined,
  options?: AIOptions
): Promise<AIResult> {
  let lastError: unknown = new Error('Rate limit: tutti i modelli Gemini sono a riposo')
  const record = (model: string, outcome: 'limit' | 'error') =>
    recordUsage({ feature: options?.feature, workspaceId: options?.workspaceId, provider: 'gemini', model, outcome })
  /** Modelli che hanno rifiutato questa richiesta: a riposo solo se un altro modello la accetta. */
  const rejected: string[] = []
  /** Un modello l'ha rifiutata anche senza thinkingConfig: e' la richiesta, non thinkingConfig. */
  let retryUseless = false
  for (const model of availableGeminiModels()) {
    const remembered = callsWithoutThinkingConfig(model)
    let withoutThinkingConfig = remembered
    for (;;) {
      try {
        const result = await callGeminiAPI(messages, model, system, {
          ...options,
          withoutThinkingConfig,
          // Senza thinkingConfig il ragionamento pesca dallo stesso budget: spazio in piu'.
          ...(withoutThinkingConfig ? { maxOutputTokens: (options?.maxOutputTokens ?? 8192) + THINKING_ROOM_TOKENS } : {}),
        })
        // Testo interrotto a meta' senza thinkingConfig (il ragionamento ha usato lo spazio): non
        // si restituisce come risposta completa, si prova il modello successivo.
        if (withoutThinkingConfig && result.finishReason === 'MAX_TOKENS') {
          lastError = new Error(`Gemini ${model}: risposta interrotta (MAX_TOKENS) senza thinkingConfig`)
          record(model, 'error')
          console.warn(`Gemini ${model} senza thinkingConfig ha troncato la risposta, provo il modello successivo`)
          break
        }
        if (withoutThinkingConfig && !remembered) {
          noThinkingConfig.set(model, Date.now() + NO_THINKING_CONFIG_MS)
          console.warn(`Gemini ${model} non accetta thinkingConfig: per qualche ora lo chiamo senza`)
        }
        // Questo modello accetta la richiesta: quelli che l'hanno rifiutata hanno un problema loro.
        for (const other of rejected) {
          geminiCooling.set(other, Date.now() + INVALID_ARGUMENT_COOLDOWN_MS)
          console.warn(`Gemini ${other} rifiuta una richiesta che ${model} accetta: a riposo 30 min`)
        }
        recordUsage({
          feature: options?.feature, workspaceId: options?.workspaceId,
          provider: 'gemini',
          model,
          input: result.usage?.prompt_tokens,
          output: result.usage?.completion_tokens,
        })
        return { message: result.message || '', provider: 'gemini', model }
      } catch (error) {
        lastError = error
        const message = errorText(error)
        if (isLimitError(message)) {
          const cooldown = limitCooldownMs(error)
          geminiCooling.set(model, Date.now() + cooldown)
          record(model, 'limit')
          console.warn(`Gemini ${model} al limite (a riposo ${Math.round(cooldown / 1000)} s), provo il modello successivo · ${geminiDetail(error)}`)
          break
        }
        if (isMissingModel(message)) {
          geminiCooling.set(model, Date.now() + MISSING_MODEL_COOLDOWN_MS)
          break
        }
        if (isInvalidArgument(error)) {
          // Allegato troppo grande o illeggibile, troppi token: nessun modello la prende (come prima).
          if (isRequestFault(error)) throw error
          if (!withoutThinkingConfig && !retryUseless) {
            console.warn(`Gemini ${model} rifiuta la richiesta, riprovo senza thinkingConfig · ${geminiDetail(error)}`)
            withoutThinkingConfig = true
            continue
          }
          if (withoutThinkingConfig) retryUseless = true
          rejected.push(model)
          record(model, 'error')
          console.warn(`Gemini ${model} rifiuta la richiesta, provo il modello successivo · ${geminiDetail(error)}`)
          break
        }
        // Seconda prova (senza thinkingConfig) fallita per altro: si passa al successivo, senza riposo.
        if (withoutThinkingConfig && !remembered) {
          record(model, 'error')
          console.warn(`Gemini ${model} senza thinkingConfig non risponde, provo il modello successivo · ${geminiDetail(error)}`)
          break
        }
        throw error
      }
    }
  }
  if (rejected.length) console.warn(`Gemini: la richiesta e' rifiutata da ${rejected.join(', ')} e nessun altro modello l'ha accettata: nessuno a riposo, questa chiamata passa a Claude`)
  throw lastError
}

function noteGeminiFailure(error: unknown, feature?: string, workspaceId?: string): string {
  const message = error instanceof Error ? error.message : String(error)
  if (isLimitError(message)) {
    console.warn(`Tutti i modelli Gemini sono al limite, passo a Claude: ${message} · ${geminiDetail(error)}`)
    if (getAnthropicApiKey()) reportStatus('Gemini ha raggiunto il limite: continuo con Claude…')
  } else {
    recordUsage({ feature, workspaceId, provider: 'gemini', model: GEMINI_DEFAULT_MODEL, outcome: 'error' })
    console.warn(`Gemini non disponibile, passo a Claude: ${message}`)
  }
  return message
}

/** Una chiamata singola: Gemini se disponibile, altrimenti (o al limite) Claude. */
export async function callAI(
  messages: GeminiChatMessage[],
  system?: string,
  options?: AIOptions
): Promise<AIResult> {
  // AI del piano finita: la chiamata non parte (lo spazio Facevoice non ha limiti).
  await assertAIAllowed(workspaceOf(options))
  const pref = preferredModel()
  const claudeReady = Boolean(getAnthropicApiKey()) && pref !== 'gemini'
  if (pref.startsWith('claude') && claudeReady) return callClaudeText(messages, system, options, pref)
  if (geminiUsable() || !claudeReady) {
    try {
      return await tryGemini(messages, system, options)
    } catch (error) {
      noteGeminiFailure(error, options?.feature, workspaceOf(options))
      if (!claudeReady) throw geminiOnlyError(pref, error)
    }
  }
  return callClaudeText(messages, system, options)
}

function geminiOnlyError(pref: AIModelChoice, error: unknown) {
  if (pref === 'gemini' && isLimitError(error instanceof Error ? error.message : '')) {
    return new Error('Gemini è al limite in questo momento: scegli "Automatico" o un modello Claude per continuare.')
  }
  return error
}

/**
 * Per i lavori in blocco (Ricerca clienti): le chiamate Gemini partono una
 * alla volta e distanziate. Al limite si passa subito a Claude; senza chiave
 * Claude si aspetta e si riprova come prima.
 */
export async function callAIPaced(
  messages: GeminiChatMessage[],
  system?: string,
  options?: AIOptions
): Promise<AIResult> {
  await assertAIAllowed(workspaceOf(options))
  return pacedCall(messages, system, options)
}

function pacedCall(
  messages: GeminiChatMessage[],
  system?: string,
  options?: AIOptions
): Promise<AIResult> {
  const pref = preferredModel()
  // Modello Claude scelto: niente fila, si va dritti.
  if (pref.startsWith('claude') && getAnthropicApiKey()) return callClaudeText(messages, system, options, pref)
  // Con Gemini a riposo si va dritti su Claude, senza fila: regge piu' richieste insieme.
  if (!geminiUsable() && getAnthropicApiKey() && pref !== 'gemini') return callClaudeText(messages, system, options)
  const run = async (): Promise<AIResult> => {
    const claudeReady = Boolean(getAnthropicApiKey()) && pref !== 'gemini'
    for (let attempt = 0; ; attempt++) {
      if (!geminiUsable() && claudeReady) return callClaudeText(messages, system, options)
      const wait = lastPacedCall + PACE_MS - Date.now()
      if (wait > 0) await sleep(wait)
      lastPacedCall = Date.now()
      try {
        return await tryGemini(messages, system, options)
      } catch (error) {
        const message = noteGeminiFailure(error, options?.feature, workspaceOf(options))
        if (claudeReady) return callClaudeText(messages, system, options)
        if (!isLimitError(message) || attempt >= RATE_LIMIT_WAITS_MS.length) throw error
        geminiCooling.clear()
        reportStatus(`Gemini ha raggiunto il limite: attendo ${RATE_LIMIT_WAITS_MS[attempt] / 1000}s e riprovo…`)
        await sleep(RATE_LIMIT_WAITS_MS[attempt])
      }
    }
  }
  const result = paceQueue.then(run, run)
  // La coda prosegue anche se questa chiamata fallisce.
  paceQueue = result.catch(() => undefined)
  return result
}

/** Immagine allegata (es. uno screenshot incollato nella Super chat). data: base64 senza prefisso. */
export type ImageInput = { mimeType: string; data: string }

const IMAGE_PROMPT = `Luca ha allegato queste immagini a una richiesta per il suo assistente. Il tuo compito è solo LEGGERLE, non eseguire la richiesta.
Scrivi in italiano, in modo asciutto:
- che cosa mostra ogni immagine (es. "schermata della pagina Messaggi con una conversazione email", "profilo Instagram", "sito web", "fattura");
- TUTTO il testo visibile che può servire, trascritto fedelmente: nomi di persone e aziende, indirizzi email, numeri di telefono, oggetti delle email, testi dei messaggi, importi, date, codici, link;
- se è una conversazione: chi ha scritto cosa e in che ordine.
Niente commenti, niente consigli.`

/**
 * Legge le immagini e restituisce una descrizione testuale (con tutto il testo
 * trascritto): l'assistente poi lavora solo sul testo, senza rimandare le
 * immagini a ogni passo. Gemini se disponibile, altrimenti (o se fallisce) Claude.
 */
export async function readImages(images: ImageInput[], request: string): Promise<string> {
  if (!images.length) return ''
  await assertAIAllowed(workspaceOf())
  const pref = preferredModel()
  const prompt = `${IMAGE_PROMPT}\n\nRichiesta di Luca: ${request || '(nessun testo)'}`
  const viaClaude = async () => {
    if (!claudeClient) claudeClient = new Anthropic({ apiKey: getAnthropicApiKey() })
    const model = pref.startsWith('claude') ? pref : CLAUDE_FALLBACK_MODEL
    const response = await claudeClient.messages.create({
      model,
      max_tokens: 3000,
      messages: [
        {
          role: 'user',
          content: [
            ...images.map((img) => ({
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: img.mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif', data: img.data },
            })),
            { type: 'text' as const, text: prompt },
          ],
        },
      ],
    })
    recordUsage({
      feature: 'lettura_immagini',
      provider: 'claude',
      model: response.model,
      input: (response.usage.input_tokens || 0) + (response.usage.cache_creation_input_tokens || 0) + (response.usage.cache_read_input_tokens || 0),
      output: response.usage.output_tokens || 0,
    })
    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim()
  }
  const claudeReady = Boolean(getAnthropicApiKey()) && pref !== 'gemini'
  if (pref.startsWith('claude') && claudeReady) return viaClaude()
  if (geminiUsable()) {
    try {
      const result = await tryGemini([{ role: 'user', content: prompt, attachments: images }], undefined, {
        temperature: 0.1,
        maxOutputTokens: 3000,
        feature: 'lettura_immagini',
      })
      if (result.message.trim()) return result.message.trim()
    } catch (error) {
      noteGeminiFailure(error, 'lettura_immagini', workspaceOf())
      if (!claudeReady) throw error
    }
  }
  if (!claudeReady) throw new Error('Nessun modello disponibile per leggere le immagini')
  return viaClaude()
}

const MEDIA_PROMPT = `Un cliente ha mandato questo contenuto (foto, post, reel o storia) in un messaggio diretto a un'azienda.
Descrivi in italiano, in 2-5 frasi asciutte, cosa mostra: soggetto, situazione, prodotto o servizio, tono.
Trascrivi il testo importante che si vede o si sente (titoli, scritte, nomi, prezzi, link).
Niente commenti, niente consigli, niente risposta al cliente.`

/**
 * Descrive foto e video ricevuti in Direct, per rispondere sapendo cosa e' stato
 * mandato. Gemini legge anche i video; Claude (riserva) solo le immagini.
 */
export async function describeMedia(media: ImageInput[], prompt = MEDIA_PROMPT, feature = 'lettura_media_direct', workspaceId?: string): Promise<string> {
  if (!media.length) return ''
  workspaceId = workspaceId || workspaceOf()
  await assertAIAllowed(workspaceId)
  if (geminiUsable()) {
    try {
      const result = await tryGemini([{ role: 'user', content: prompt, attachments: media }], undefined, {
        temperature: 0.1,
        maxOutputTokens: 600,
        feature,
        workspaceId,
      })
      if (result.message.trim()) return result.message.trim()
    } catch (error) {
      noteGeminiFailure(error, feature, workspaceId)
    }
  }
  const images = media.filter((m) => m.mimeType.startsWith('image/'))
  if (!images.length || !getAnthropicApiKey()) return ''
  if (!claudeClient) claudeClient = new Anthropic({ apiKey: getAnthropicApiKey() })
  const response = await claudeClient.messages.create({
    model: CLAUDE_FALLBACK_MODEL,
    max_tokens: 600,
    messages: [
      {
        role: 'user',
        content: [
          ...images.map((img) => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: img.mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif', data: img.data },
          })),
          { type: 'text' as const, text: prompt },
        ],
      },
    ],
  })
  recordUsage({ feature, workspaceId, provider: 'claude', model: response.model, input: response.usage.input_tokens || 0, output: response.usage.output_tokens || 0 })
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()
}
