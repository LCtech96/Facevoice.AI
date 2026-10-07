import { AsyncLocalStorage } from 'node:async_hooks'
import Anthropic from '@anthropic-ai/sdk'
import {
  GEMINI_DEFAULT_MODEL,
  callGeminiAPI,
  getGeminiApiKey,
  type GeminiChatMessage,
} from '@/lib/gemini'
import { getAnthropicApiKey } from '@/lib/claude'
import { supabaseAdmin } from '@/lib/supabase-admin'

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

const GEMINI_COOLDOWN_MS = 60_000
const PACE_MS = 4500
const RATE_LIMIT_WAITS_MS = [15_000, 30_000, 45_000]

type AIOptions = {
  temperature?: number
  maxOutputTokens?: number
  /** Funzione che usa l'AI, per la pagina Consumi (es. "chat_sito", "assistente_clienti"). */
  feature?: string
}

// Prezzi Claude in USD per milione di token (Gemini e' sul piano gratuito).
const CLAUDE_PRICE = { input: 1, output: 5 }

/** Registra la chiamata per la pagina Consumi. Non blocca e non fa mai fallire la risposta. */
function recordUsage(row: {
  feature?: string
  provider: 'gemini' | 'claude'
  model: string
  outcome?: 'ok' | 'limit' | 'error'
  input?: number
  output?: number
}) {
  const input = row.input || 0
  const output = row.output || 0
  const cost = row.provider === 'claude' ? (input * CLAUDE_PRICE.input + output * CLAUDE_PRICE.output) / 1_000_000 : 0
  void Promise.resolve(
    supabaseAdmin.from('ai_usage').insert({
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
    })
    .catch(() => undefined)
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
type WorkContext = { status: (text: string) => void; deadline?: number }
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

async function callClaudeText(
  messages: GeminiChatMessage[],
  system: string | undefined,
  options?: AIOptions
): Promise<AIResult> {
  if (!claudeClient) claudeClient = new Anthropic({ apiKey: getAnthropicApiKey() })
  const response = await claudeClient.messages.create({
    model: CLAUDE_FALLBACK_MODEL,
    max_tokens: Math.min(8192, Math.max(1024, options?.maxOutputTokens || 2048)),
    ...(system ? { system } : {}),
    messages: toClaudeMessages(messages),
    ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
  })
  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()
  recordUsage({
    feature: options?.feature,
    provider: 'claude',
    model: response.model,
    outcome: text && response.stop_reason !== 'refusal' ? 'ok' : 'error',
    input: (response.usage.input_tokens || 0) + (response.usage.cache_creation_input_tokens || 0) + (response.usage.cache_read_input_tokens || 0),
    output: response.usage.output_tokens || 0,
  })
  if (response.stop_reason === 'refusal' || !text) throw new Error('Claude non ha restituito una risposta')
  return { message: text, provider: 'claude', model: response.model }
}

const isMissingModel = (message: string) => /not found|NOT_FOUND|is not supported|no longer available/i.test(message)

/** Prova i modelli Gemini gratuiti uno dopo l'altro; quello al limite resta a riposo. */
async function tryGemini(
  messages: GeminiChatMessage[],
  system: string | undefined,
  options?: AIOptions
): Promise<AIResult> {
  let lastError: unknown = new Error('Rate limit: tutti i modelli Gemini sono a riposo')
  for (const model of availableGeminiModels()) {
    try {
      const result = await callGeminiAPI(messages, model, system, options)
      recordUsage({
        feature: options?.feature,
        provider: 'gemini',
        model,
        input: result.usage?.prompt_tokens,
        output: result.usage?.completion_tokens,
      })
      return { message: result.message || '', provider: 'gemini', model }
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      if (isLimitError(message)) {
        const cooldown = /giornalier|daily|per day/i.test(message) ? DAILY_QUOTA_COOLDOWN_MS : GEMINI_COOLDOWN_MS
        geminiCooling.set(model, Date.now() + cooldown)
        recordUsage({ feature: options?.feature, provider: 'gemini', model, outcome: 'limit' })
        console.warn(`Gemini ${model} al limite, provo il modello successivo`)
        continue
      }
      if (isMissingModel(message)) {
        geminiCooling.set(model, Date.now() + MISSING_MODEL_COOLDOWN_MS)
        continue
      }
      throw error
    }
  }
  throw lastError
}

function noteGeminiFailure(error: unknown, feature?: string): string {
  const message = error instanceof Error ? error.message : String(error)
  if (isLimitError(message)) {
    console.warn(`Tutti i modelli Gemini sono al limite, passo a Claude: ${message}`)
    if (getAnthropicApiKey()) reportStatus('Gemini ha raggiunto il limite: continuo con Claude…')
  } else {
    recordUsage({ feature, provider: 'gemini', model: GEMINI_DEFAULT_MODEL, outcome: 'error' })
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
  const claudeReady = Boolean(getAnthropicApiKey())
  if (geminiUsable() || !claudeReady) {
    try {
      return await tryGemini(messages, system, options)
    } catch (error) {
      noteGeminiFailure(error, options?.feature)
      if (!claudeReady) throw error
    }
  }
  return callClaudeText(messages, system, options)
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
  // Con Gemini a riposo si va dritti su Claude, senza fila: regge piu' richieste insieme.
  if (!geminiUsable() && getAnthropicApiKey()) return callClaudeText(messages, system, options)
  const run = async (): Promise<AIResult> => {
    const claudeReady = Boolean(getAnthropicApiKey())
    for (let attempt = 0; ; attempt++) {
      if (!geminiUsable() && claudeReady) return callClaudeText(messages, system, options)
      const wait = lastPacedCall + PACE_MS - Date.now()
      if (wait > 0) await sleep(wait)
      lastPacedCall = Date.now()
      try {
        return await tryGemini(messages, system, options)
      } catch (error) {
        const message = noteGeminiFailure(error, options?.feature)
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
