import { AsyncLocalStorage } from 'node:async_hooks'
import Anthropic from '@anthropic-ai/sdk'
import {
  THINKING_ROOM_TOKENS,
  callGeminiAPI,
  callsWithoutThinkingConfig,
  geminiDetail,
  geminiErrorInfo,
  getGeminiApiKey,
  isGeminiServerError,
  isInvalidArgument,
  isMissingGeminiModel,
  isRequestFault,
  rememberWithoutThinkingConfig,
  type GeminiChatMessage,
} from '@/lib/gemini'
import { REFUSAL_RETRY_MODEL, getAnthropicApiKey } from '@/lib/claude'
import { supabaseAdmin } from '@/lib/supabase-admin'

// ---------------------------------------------------------------------
// Gemini + Claude combinati: si lavora con Gemini finché regge; quando arriva
// al limite (rate limit, quota, credito esaurito) o non risponde, la stessa
// richiesta passa a Claude. Dopo un limite Gemini resta "a riposo" per un po'
// e le chiamate successive vanno dirette su Claude, senza attese.
// ---------------------------------------------------------------------

// Riserva quando tutti i modelli Gemini sono al limite: Claude Haiku 5.5, il Claude
// piu' economico ($0,10 / $0,50 per milione di token fino a 100K token di prompt,
// circa un decimo di Haiku 4.5) e con la cache dei prompt gia' da 512 token.
export const CLAUDE_FALLBACK_MODEL = 'claude-haiku-5-5'
// Haiku 5.5 puo' rifiutare una richiesta (stop_reason "refusal") e non ha una riserva
// lato server: la stessa richiesta si rifa' una volta con Haiku 4.5.
export const CLAUDE_REFUSAL_RETRY_MODEL = REFUSAL_RETRY_MODEL

// I limiti di Gemini sono separati per ogni modello: prima di passare a Claude si
// provano tutti, dal migliore al piu' leggero.
const GEMINI_ROTATION = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest']
/** Quota del giorno finita e mezzanotte del Pacifico non calcolabile: si riprova dopo un'ora. */
const DAILY_QUOTA_COOLDOWN_MS = 60 * 60_000
const MISSING_MODEL_COOLDOWN_MS = 6 * 60 * 60_000
/**
 * Modello che rifiuta una richiesta (400 INVALID_ARGUMENT) che un altro modello accetta: a riposo
 * per mezz'ora. Se la rifiutano tutti, la colpa e' della richiesta e nessuno va a riposo.
 */
const INVALID_ARGUMENT_COOLDOWN_MS = 30 * 60_000
/** Modello momentaneamente non disponibile (503 "high demand", 500, rete): breve riposo. */
const TRANSIENT_COOLDOWN_MS = 2 * 60_000

const GEMINI_COOLDOWN_MS = 60_000
const PACE_MS = 4500
const RATE_LIMIT_WAITS_MS = [15_000, 30_000, 45_000]

type AIOptions = {
  temperature?: number
  maxOutputTokens?: number
  /** Funzione che usa l'AI, per la pagina Consumi (es. "chat_sito", "assistente_clienti"). */
  feature?: string
  /**
   * Parte delle istruzioni che cambia a ogni richiesta (data e ora, nome del contatto, stato
   * della verifica...): va DOPO le istruzioni stabili, cosi' il prefisso stabile si rilegge
   * dalla cache (Claude: blocco di sistema separato, senza breakpoint; Gemini: in coda).
   */
  systemTail?: string
  /**
   * Parte delle istruzioni che cambia di rado ma non e' fissa (es. esempi di stile presi dalle
   * ultime risposte inviate): tra le istruzioni stabili e systemTail. Claude: blocco con un suo
   * breakpoint, cosi' quando cambia la parte fissa prima si rilegge ancora dalla cache.
   */
  stableTail?: string
  /**
   * Breakpoint di cache anche sulla conversazione (Claude): conviene quando la stessa
   * conversazione si rimanda allungata (passi dell'assistente, chat a piu' turni). Se non
   * indicato: si' quando la funzione lavora a passi, o quando la conversazione ha piu'
   * messaggi e non c'e' una parte variabile (systemTail) prima di lei.
   */
  cache?: boolean
  /** Risposta in JSON: con Gemini si chiede responseMimeType application/json. */
  json?: boolean
  /**
   * Gemini che non accetta thinkingConfig (ragiona sempre): token in piu' per il ragionamento,
   * oltre a maxOutputTokens (default THINKING_ROOM_TOKENS). Per le risposte lunghe (es. un
   * articolo intero) 2048 non bastano: il ragionamento li consuma e il testo si interrompe.
   */
  thinkingRoom?: number
}

/** Funzioni che rimandano la stessa conversazione allungata a ogni passo (loop degli strumenti). */
const MULTI_STEP_FEATURES = new Set(['assistente_clienti'])

// Prezzi Claude in USD per milione di token (Gemini non si paga a token).
// Haiku 4.5 resta per le righe vecchie di ai_usage e per la riprova dopo un rifiuto.
// cacheRead = moltiplicatore della lettura dalla cache, se diverso da CACHE_READ_MULTIPLIER.
type ClaudePrice = { input: number; output: number; cacheRead?: number; long?: { from: number; input: number; output: number } }
const CLAUDE_PRICES: Record<string, ClaudePrice> = {
  // Prompt oltre 100K token: tariffa piu' alta per tutta la richiesta.
  'claude-haiku-5-5': { input: 0.1, output: 0.5, long: { from: 100_000, input: 0.5, output: 2.5 } },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  // Opus 5.5: la lettura dalla cache costa 0,05x ($0,20 per milione), non 0,1x.
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.05 },
}
const priceOf = (model: string) =>
  CLAUDE_PRICES[Object.keys(CLAUDE_PRICES).find((id) => model.startsWith(id)) || 'claude-haiku-4-5']

/** Scrittura in cache (durata 5 minuti) e lettura dalla cache, rispetto al prezzo dell'input (Opus 5.5: 0,05x). */
export const CACHE_WRITE_MULTIPLIER = 1.25
export const CACHE_READ_MULTIPLIER = 0.1

/**
 * Costo in USD di una chiamata Claude. input = token del prompt in tutto (non in cache +
 * scritti in cache + letti dalla cache, come li conta la pagina Consumi); cacheRead e
 * cacheWrite sono le parti di input lette (0,1x, Opus 5.5 0,05x) e scritte (1,25x) in cache.
 */
export function claudeCostUsd(model: string, usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number }): number {
  const price = priceOf(model)
  const input = Math.max(0, usage.input || 0)
  const read = Math.max(0, usage.cacheRead || 0)
  const write = Math.max(0, usage.cacheWrite || 0)
  const plain = Math.max(0, input - read - write)
  const card = price.long && input > price.long.from ? price.long : price
  return ((plain + read * (price.cacheRead ?? CACHE_READ_MULTIPLIER) + write * CACHE_WRITE_MULTIPLIER) * card.input + Math.max(0, usage.output || 0) * card.output) / 1_000_000
}

export { AI_MODEL_CHOICES, asModelChoice, type AIModelChoice } from '@/lib/ai-models'
import type { AIModelChoice } from '@/lib/ai-models'

/** Token e costi accumulati durante un lavoro (mostrati in tempo reale nella Super chat). */
export type UsageTally = { calls: number; input: number; output: number; cost: number; models: Record<string, number> }
export const emptyTally = (): UsageTally => ({ calls: 0, input: 0, output: 0, cost: 0, models: {} })

/** Registra la chiamata per la pagina Consumi. Non blocca e non fa mai fallire la risposta. */
function recordUsage(row: {
  feature?: string
  provider: 'gemini' | 'claude'
  model: string
  outcome?: 'ok' | 'limit' | 'error'
  /** Token del prompt in tutto (cache comprese). */
  input?: number
  output?: number
  /** Parte di input letta dalla cache (0,1x) e scritta in cache (1,25x). */
  cacheRead?: number
  cacheWrite?: number
}) {
  const input = row.input || 0
  const output = row.output || 0
  const outcome = row.outcome || 'ok'
  const cost = row.provider === 'claude' ? claudeCostUsd(row.model, { input, output, cacheRead: row.cacheRead, cacheWrite: row.cacheWrite }) : 0
  const tally = work.getStore()?.usage
  // Anche una chiamata senza risposta utile (es. rifiutata) consuma token: conta nel limite di spesa.
  if (tally && (outcome === 'ok' || input + output > 0)) {
    if (outcome === 'ok') {
      tally.calls++
      tally.models[row.model] = (tally.models[row.model] || 0) + 1
    }
    tally.input += input
    tally.output += output
    tally.cost += cost
    try {
      work.getStore()?.onUsage?.()
    } catch {}
  }
  void Promise.resolve(
    supabaseAdmin.from('ai_usage').insert({
      feature: row.feature || 'altro',
      provider: row.provider,
      model: row.model,
      outcome,
      input_tokens: input,
      output_tokens: output,
      cost_usd: cost,
    })
  )
    .then(({ error }) => {
      if (error) console.warn('ai_usage:', error.message)
    })
    .catch(() => undefined)
}
export type AIResult = {
  message: string
  provider: 'gemini' | 'claude'
  model: string
  /** Risposta interrotta dal limite di token (Gemini MAX_TOKENS, Claude max_tokens): il testo e' incompleto. */
  truncated?: boolean
}

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
}
const work = new AsyncLocalStorage<WorkContext>()

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

/** Millisecondi fino alla prossima mezzanotte del Pacifico, quando Google azzera le quote del giorno. */
function msUntilPacificMidnight(now = Date.now()): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(new Date(now))
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0)
    const elapsed = ((get('hour') * 60 + get('minute')) * 60 + get('second')) * 1000
    return Math.max(0, 86_400_000 - elapsed)
  } catch {
    return null
  }
}

/**
 * Quanto resta a riposo un modello Gemini al limite: quota del giorno esaurita (dai dettagli di
 * Google: quotaId "...PerDay...", "per day") = fino alla mezzanotte del Pacifico (almeno 15
 * minuti); limite al minuto = l'attesa suggerita da Google (retryDelay) se c'e', altrimenti un minuto.
 */
function limitCooldownMs(error: unknown): number {
  const info = geminiErrorInfo(error)
  if (info?.daily || /giornalier|daily|per day/i.test(errorText(error))) {
    const untilReset = msUntilPacificMidnight()
    return untilReset === null ? DAILY_QUOTA_COOLDOWN_MS : Math.min(86_400_000, Math.max(15 * 60_000, untilReset + 60_000))
  }
  if (info?.retryDelayMs) return Math.min(DAILY_QUOTA_COOLDOWN_MS, Math.max(1_000, info.retryDelayMs))
  return GEMINI_COOLDOWN_MS
}

const availableGeminiModels = () => GEMINI_ROTATION.filter((m) => Date.now() >= (geminiCooling.get(m) || 0))

function geminiUsable(): boolean {
  return Boolean(getGeminiApiKey()) && availableGeminiModels().length > 0
}

/** Converte la cronologia nel formato Claude: ruoli alternati, si apre e si chiude con l'utente (mai un prefill). */
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

function claude(): Anthropic {
  if (!claudeClient) claudeClient = new Anthropic({ apiKey: getAnthropicApiKey() })
  return claudeClient
}

/** Haiku 4.5 e precedenti: niente effort ne' thinking adattivo, temperatura ammessa, cache da 4096 token. */
const isLegacyModel = (model: string) => /^claude-(haiku-4|3)/.test(model)

/**
 * Spazio per la risposta. Haiku 4.5: come prima. Haiku 5.5: lo stesso testo conta circa il 30%
 * di token in piu' (tokenizer nuovo) e il ragionamento, anche breve, pesca dallo stesso budget:
 * 1,3x + 1024 token, almeno 2048. Sonnet/Opus: 16000 (ragionano di piu'). Sempre sotto i ~21K
 * oltre i quali l'SDK chiede lo streaming.
 */
export function claudeMaxTokens(model: string, requested?: number): number {
  const want = Math.max(1, requested || 2048)
  if (isLegacyModel(model)) return Math.min(8192, Math.max(1024, want))
  if (model.startsWith('claude-haiku')) return Math.min(16000, Math.max(2048, Math.ceil(want * 1.3) + 1024))
  return 16000
}

type ClaudeInput = {
  feature?: string
  /** Istruzioni stabili: un blocco di sistema con il breakpoint di cache. */
  system?: string
  /** Istruzioni che cambiano di rado (es. esempi di stile): blocco dopo, con un secondo breakpoint. */
  stableTail?: string
  /** Istruzioni che cambiano a ogni richiesta: blocco di sistema dopo, senza breakpoint. */
  systemTail?: string
  messages: Anthropic.MessageParam[]
  maxOutputTokens?: number
  /** Solo per Haiku 4.5 (i modelli 5.5 rifiutano una temperatura diversa da quella di default). */
  temperature?: number
  /** Breakpoint automatico sull'ultimo blocco della conversazione. */
  cacheConversation?: boolean
}

/**
 * Corpo della richiesta a Claude, in ordine fisso e senza niente di variabile prima dei
 * breakpoint: system = [istruzioni stabili + cache_control] (+ [parte che cambia di rado +
 * cache_control]) (+ [parte variabile]), poi i messaggi (sempre chiusi da un messaggio
 * dell'utente: niente prefill), con il breakpoint automatico sulla conversazione quando
 * richiesto. Al massimo 3 breakpoint su 4.
 * Modelli 5.5: thinking adattivo con effort "low" (risposte da chat e passi brevi: il modello
 * pensa poco o niente e costa meno), nessuna temperatura. Haiku 4.5: niente thinking/effort.
 */
export function claudeRequest(model: string, input: ClaudeInput): Anthropic.MessageCreateParamsNonStreaming {
  const system: Anthropic.TextBlockParam[] = []
  if (input.system?.trim()) system.push({ type: 'text', text: input.system, cache_control: { type: 'ephemeral' } })
  if (input.stableTail?.trim()) system.push({ type: 'text', text: input.stableTail, cache_control: { type: 'ephemeral' } })
  if (input.systemTail?.trim()) system.push({ type: 'text', text: input.systemTail })
  const legacy = isLegacyModel(model)
  return {
    model,
    max_tokens: claudeMaxTokens(model, input.maxOutputTokens),
    ...(system.length ? { system } : {}),
    messages: input.messages,
    ...(input.cacheConversation ? { cache_control: { type: 'ephemeral' as const } } : {}),
    ...(legacy
      ? input.temperature !== undefined
        ? { temperature: input.temperature }
        : {}
      : { thinking: { type: 'adaptive' as const }, output_config: { effort: 'low' as const } }),
  }
}

/** Token di una risposta: input in tutto (cache comprese) e le parti lette/scritte in cache. */
function claudeUsage(response: Anthropic.Message) {
  const read = response.usage.cache_read_input_tokens || 0
  const write = response.usage.cache_creation_input_tokens || 0
  return {
    input: (response.usage.input_tokens || 0) + read + write,
    output: response.usage.output_tokens || 0,
    cacheRead: read,
    cacheWrite: write,
  }
}

/** Testo della risposta, letto per tipo di blocco (una risposta puo' iniziare con blocchi "thinking"). */
const textOf = (response: Anthropic.Message) =>
  response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()

/**
 * Una chiamata a Claude con il consumo registrato. Se il modello rifiuta (stop_reason "refusal",
 * HTTP 200: Haiku 5.5 non ha una riserva lato server) si registra la chiamata rifiutata, si
 * scrive nei log solo la categoria e la stessa richiesta si rifa' una volta con Haiku 4.5.
 */
async function claudeAnswer(model: string, input: ClaudeInput): Promise<AIResult> {
  const response = await claude().messages.create(claudeRequest(model, input))
  const text = textOf(response)
  const refused = response.stop_reason === 'refusal'
  recordUsage({
    feature: input.feature,
    provider: 'claude',
    model: response.model || model,
    outcome: text && !refused ? 'ok' : 'error',
    ...claudeUsage(response),
  })
  if (refused) {
    const category = response.stop_details?.category ?? 'non indicata'
    if (!isLegacyModel(model)) {
      console.warn(`Claude ${response.model || model} ha rifiutato la richiesta (categoria: ${category}): la rifaccio con ${CLAUDE_REFUSAL_RETRY_MODEL}`)
      return claudeAnswer(CLAUDE_REFUSAL_RETRY_MODEL, input)
    }
    console.warn(`Claude ${response.model || model} ha rifiutato la richiesta (categoria: ${category})`)
  }
  if (refused || !text) throw new Error('Claude non ha restituito una risposta')
  return { message: text, provider: 'claude', model: response.model || model, ...(response.stop_reason === 'max_tokens' ? { truncated: true } : {}) }
}

async function callClaudeText(
  messages: GeminiChatMessage[],
  system: string | undefined,
  options?: AIOptions,
  model: string = CLAUDE_FALLBACK_MODEL
): Promise<AIResult> {
  const claudeMessages = toClaudeMessages(messages)
  return claudeAnswer(model, {
    feature: options?.feature,
    system,
    stableTail: options?.stableTail,
    systemTail: options?.systemTail,
    messages: claudeMessages,
    maxOutputTokens: options?.maxOutputTokens,
    temperature: options?.temperature,
    // Breakpoint sulla conversazione solo se si potra' rileggere: con una parte variabile nel system
    // (data e ora al minuto, ecc.) il prefisso della conversazione cambia a ogni richiesta e la
    // scrittura in cache (1,25x) sarebbe solo un costo in piu'; resta il breakpoint sulle istruzioni.
    cacheConversation:
      options?.cache ?? (MULTI_STEP_FEATURES.has(options?.feature || '') || (claudeMessages.length > 1 && !options?.systemTail?.trim())),
  })
}

/** Istruzioni per Gemini: la parte stabile prima, quella che cambia in coda (cache implicita). */
const geminiSystem = (system: string | undefined, options?: AIOptions) =>
  [system || '', options?.stableTail || '', options?.systemTail || ''].join('') || undefined

/**
 * Prova i modelli Gemini uno dopo l'altro; un errore di un modello non ferma il giro:
 * - limite (al minuto o del giorno): il modello resta a riposo (attesa di Google / fino al
 *   reset del giorno) e si passa al successivo;
 * - richiesta rifiutata (400 INVALID_ARGUMENT, es. per thinkingConfig): si riprova una volta senza
 *   thinkingConfig (se va, si ricorda per qualche ora); se rifiuta ancora si passa al successivo,
 *   che va a riposo mezz'ora solo se un modello dopo accetta la stessa richiesta (se la
 *   rifiutano tutti la colpa e' della richiesta: nessuno a riposo, passa a Claude chi chiama);
 * - modello inesistente: a riposo qualche ora;
 * - non disponibile (503 "high demand", 500, risposta vuota) o altro: breve riposo, successivo;
 * - richiesta che nessun modello accetterebbe (allegato troppo grande): si ferma subito.
 * Per la pagina Consumi: una riga "limit" per ogni modello al limite (come prima) e al massimo
 * UNA riga "error" per chiamata, solo se nessun modello ha risposto (gli errori dei singoli
 * modelli restano nei log): il contatore degli errori conta le chiamate fallite, non i tentativi.
 */
async function tryGemini(
  messages: GeminiChatMessage[],
  system: string | undefined,
  options?: AIOptions
): Promise<AIResult> {
  let lastError: unknown = new Error('Rate limit: tutti i modelli Gemini sono a riposo')
  const record = (model: string, outcome: 'limit' | 'error') => recordUsage({ feature: options?.feature, provider: 'gemini', model, outcome })
  const instructions = geminiSystem(system, options)
  /** Modelli che hanno rifiutato questa richiesta: a riposo solo se un altro modello la accetta. */
  const rejected: string[] = []
  /** Un modello l'ha rifiutata anche senza thinkingConfig: e' la richiesta, non thinkingConfig. */
  let retryUseless = false
  /** Ultimo modello fallito per un errore (non un limite): la riga "error" si scrive solo se nessuno risponde. */
  let failedModel: string | null = null
  for (const model of availableGeminiModels()) {
    const remembered = callsWithoutThinkingConfig(model)
    let withoutThinkingConfig = remembered
    for (;;) {
      try {
        const result = await callGeminiAPI(messages, model, instructions, {
          temperature: options?.temperature,
          maxOutputTokens: (options?.maxOutputTokens ?? 8192) + (withoutThinkingConfig ? (options?.thinkingRoom ?? THINKING_ROOM_TOKENS) : 0),
          withoutThinkingConfig,
          json: options?.json,
        })
        // Testo interrotto a meta' senza thinkingConfig (il ragionamento ha usato lo spazio): non
        // si restituisce come risposta completa, si prova il modello successivo.
        if (withoutThinkingConfig && result.finishReason === 'MAX_TOKENS') {
          lastError = new Error(`Gemini ${model}: risposta interrotta (MAX_TOKENS) senza thinkingConfig`)
          failedModel = model
          console.warn(`Gemini ${model} senza thinkingConfig ha troncato la risposta, provo il modello successivo`)
          break
        }
        if (withoutThinkingConfig && !remembered) {
          rememberWithoutThinkingConfig(model)
          console.warn(`Gemini ${model} non accetta thinkingConfig: per qualche ora lo chiamo senza`)
        }
        // Questo modello accetta la richiesta: quelli che l'hanno rifiutata hanno un problema loro.
        for (const other of rejected) {
          geminiCooling.set(other, Date.now() + INVALID_ARGUMENT_COOLDOWN_MS)
          console.warn(`Gemini ${other} rifiuta una richiesta che ${model} accetta: a riposo 30 min`)
        }
        recordUsage({
          feature: options?.feature,
          provider: 'gemini',
          model,
          input: result.usage?.prompt_tokens,
          output: result.usage?.completion_tokens,
        })
        return { message: result.message || '', provider: 'gemini', model, ...(result.finishReason === 'MAX_TOKENS' ? { truncated: true } : {}) }
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
        if (isRequestFault(error)) {
          // Allegato troppo grande o illeggibile, troppi token: nessun modello la prende.
          record(model, 'error')
          throw error
        }
        if (isMissingGeminiModel(error)) {
          geminiCooling.set(model, Date.now() + MISSING_MODEL_COOLDOWN_MS)
          failedModel = model
          console.warn(`Gemini ${model} non disponibile (modello non trovato): a riposo 6 ore · ${geminiDetail(error)}`)
          break
        }
        if (isInvalidArgument(error)) {
          if (!withoutThinkingConfig && !retryUseless) {
            console.warn(`Gemini ${model} rifiuta la richiesta, riprovo senza thinkingConfig · ${geminiDetail(error)}`)
            withoutThinkingConfig = true
            continue
          }
          if (withoutThinkingConfig) retryUseless = true
          rejected.push(model)
          failedModel = model
          console.warn(`Gemini ${model} rifiuta la richiesta, provo il modello successivo · ${geminiDetail(error)}`)
          break
        }
        // Non disponibile (503 "high demand", 500, rete) o errore sconosciuto: breve riposo per
        // questo modello. Risposta vuota o interrotta (vale solo per questa richiesta): nessun riposo.
        // In tutti e due i casi si prova il modello successivo.
        const answerOnly = !isGeminiServerError(error) && /Invalid response|Risposta interrotta/i.test(message)
        if (!answerOnly) geminiCooling.set(model, Date.now() + TRANSIENT_COOLDOWN_MS)
        failedModel = model
        console.warn(`Gemini ${model} ${answerOnly ? 'ha risposto senza testo utile' : 'non risponde (a riposo 2 min)'}, provo il modello successivo · ${geminiDetail(error)}`)
        break
      }
    }
  }
  if (rejected.length) console.warn(`Gemini: la richiesta e' rifiutata da ${rejected.join(', ')} e nessun altro modello l'ha accettata: nessuno a riposo, questa chiamata passa a Claude`)
  if (failedModel) record(failedModel, 'error')
  throw lastError
}

/** Gemini non ha risposto: solo log (la chiamata fallita e' gia' registrata da tryGemini). */
function noteGeminiFailure(error: unknown): string {
  const message = errorText(error)
  if (isLimitError(message)) {
    console.warn(`Tutti i modelli Gemini sono al limite, passo a Claude: ${message} · ${geminiDetail(error)}`)
    if (getAnthropicApiKey()) reportStatus('Gemini ha raggiunto il limite: continuo con Claude…')
  } else {
    console.warn(`Gemini non disponibile, passo a Claude: ${message} · ${geminiDetail(error)}`)
  }
  return message
}

/** Una chiamata singola: Gemini se disponibile, altrimenti (o al limite) Claude. */
export async function callAI(
  messages: GeminiChatMessage[],
  system?: string,
  options?: AIOptions
): Promise<AIResult> {
  const pref = preferredModel()
  const claudeReady = Boolean(getAnthropicApiKey()) && pref !== 'gemini'
  if (pref.startsWith('claude') && claudeReady) return callClaudeText(messages, system, options, pref)
  if (geminiUsable() || !claudeReady) {
    try {
      return await tryGemini(messages, system, options)
    } catch (error) {
      noteGeminiFailure(error)
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
export function callAIPaced(
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
        const message = noteGeminiFailure(error)
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

const imageBlocks = (images: ImageInput[]): Anthropic.ImageBlockParam[] =>
  images.map((img) => ({
    type: 'image',
    source: { type: 'base64', media_type: img.mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif', data: img.data },
  }))

/**
 * Lettura di immagini con Claude: niente cache (le immagini cambiano ogni volta e il testo e'
 * sotto il minimo), ma stesse regole dei modelli 5.5 e la stessa riprova dopo un rifiuto.
 * Una risposta vuota resta vuota (come prima): decide chi chiama.
 */
const claudeText = (model: string, input: ClaudeInput) =>
  claudeAnswer(model, input).then(
    (result) => result.message,
    (error) => {
      if (error instanceof Error && error.message === 'Claude non ha restituito una risposta') return ''
      throw error
    }
  )

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
  const pref = preferredModel()
  const prompt = `${IMAGE_PROMPT}\n\nRichiesta di Luca: ${request || '(nessun testo)'}`
  const viaClaude = () =>
    claudeText(pref.startsWith('claude') ? pref : CLAUDE_FALLBACK_MODEL, {
      feature: 'lettura_immagini',
      messages: [{ role: 'user', content: [...imageBlocks(images), { type: 'text', text: prompt }] }],
      maxOutputTokens: 3000,
    })
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
      noteGeminiFailure(error)
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
export async function describeMedia(media: ImageInput[]): Promise<string> {
  if (!media.length) return ''
  if (geminiUsable()) {
    try {
      const result = await tryGemini([{ role: 'user', content: MEDIA_PROMPT, attachments: media }], undefined, {
        temperature: 0.1,
        maxOutputTokens: 600,
        feature: 'lettura_media_direct',
      })
      if (result.message.trim()) return result.message.trim()
    } catch (error) {
      noteGeminiFailure(error)
    }
  }
  const images = media.filter((m) => m.mimeType.startsWith('image/'))
  if (!images.length || !getAnthropicApiKey()) return ''
  return claudeText(CLAUDE_FALLBACK_MODEL, {
    feature: 'lettura_media_direct',
    messages: [{ role: 'user', content: [...imageBlocks(images), { type: 'text', text: MEDIA_PROMPT }] }],
    maxOutputTokens: 600,
  }).catch((error) => {
    console.warn('lettura media con Claude non riuscita:', errorText(error))
    return ''
  })
}

/**
 * Immagini lette con istruzioni proprie (es. descrizione delle foto della Libreria foto):
 * Stesso ordine dei fornitori di readImages (con riserva se il primo fallisce). Testo vuoto se nessuno risponde.
 */
export async function describeImagesWith(images: ImageInput[], prompt: string, feature: string, maxOutputTokens = 2000): Promise<string> {
  if (!images.length) return ''
  const pref = preferredModel()
  const claudeReady = Boolean(getAnthropicApiKey()) && pref !== 'gemini'
  const viaClaude = () =>
    claudeText(pref.startsWith('claude') ? pref : CLAUDE_FALLBACK_MODEL, {
      feature,
      messages: [{ role: 'user', content: [...imageBlocks(images), { type: 'text', text: prompt }] }],
      maxOutputTokens,
    })
  if (pref.startsWith('claude') && claudeReady) return viaClaude()
  if (geminiUsable()) {
    try {
      const result = await tryGemini([{ role: 'user', content: prompt, attachments: images }], undefined, { temperature: 0.2, maxOutputTokens, feature })
      if (result.message.trim()) return result.message.trim()
    } catch (error) {
      noteGeminiFailure(error)
      if (!claudeReady) throw error
    }
  }
  if (!claudeReady) throw new Error('Nessun modello disponibile per leggere le immagini')
  return viaClaude()
}
