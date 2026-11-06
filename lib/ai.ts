import { AsyncLocalStorage } from 'node:async_hooks'
import { facevoiceDb, workspaceDb } from '@/lib/workspace-db'
import Anthropic from '@anthropic-ai/sdk'
import {
  GEMINI_DEFAULT_MODEL,
  callGeminiAPI,
  callGeminiGrounded,
  getGeminiApiKey,
  type GeminiChatMessage,
  type GroundedAnswer,
} from '@/lib/gemini'
import { getAnthropicApiKey } from '@/lib/claude'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { afterAIUsage, assertAIAllowed } from '@/lib/usage-limits'

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

/** Modelli Gemini che hanno rifiutato la ricerca Google (o non esistono): istante fino a cui non si riprovano. */
const groundingUnsupported = new Map<string, number>()

/** Risposta di Gemini scritta dalle pagine trovate con la ricerca Google, con le fonti. */
export type GroundedResult = GroundedAnswer & { provider: 'gemini' }

/**
 * Chiamata con la ricerca Google (solo Gemini: Claude non ha questo strumento). Prima si
 * controlla il limite del piano (AI finita: non parte); si provano i modelli Gemini come in
 * callAI (quello al limite resta a riposo). Il consumo va nello spazio con la tariffa della ricerca.
 */
export async function groundedSearch(prompt: string, options: AIOptions & { system?: string; timeoutMs?: number }): Promise<GroundedResult> {
  const workspaceId = workspaceOf(options)
  await assertAIAllowed(workspaceId)
  if (!getGeminiApiKey()) throw new Error('ricerca sul web non disponibile (manca la chiave Gemini)')
  let lastError: unknown = new Error('Rate limit: tutti i modelli Gemini sono a riposo')
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
      return { ...answer, provider: 'gemini' }
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      if (isLimitError(message)) {
        geminiCooling.set(model, Date.now() + (/giornalier|daily|per day/i.test(message) ? DAILY_QUOTA_COOLDOWN_MS : GEMINI_COOLDOWN_MS))
        recordUsage({ feature: options.feature, workspaceId, provider: 'gemini', model, outcome: 'limit' })
        continue
      }
      // Modello che non c'e' o che non fa la ricerca Google: a riposo solo per la ricerca
      // (per le altre chiamate puo' andare benissimo).
      if (isMissingModel(message)) {
        groundingUnsupported.set(model, Date.now() + MISSING_MODEL_COOLDOWN_MS)
        continue
      }
      recordUsage({ feature: options.feature, workspaceId, provider: 'gemini', model, outcome: 'error' })
      throw error
    }
  }
  throw lastError
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
        feature: options?.feature, workspaceId: options?.workspaceId,
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
        recordUsage({ feature: options?.feature, workspaceId: options?.workspaceId, provider: 'gemini', model, outcome: 'limit' })
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

function noteGeminiFailure(error: unknown, feature?: string, workspaceId?: string): string {
  const message = error instanceof Error ? error.message : String(error)
  if (isLimitError(message)) {
    console.warn(`Tutti i modelli Gemini sono al limite, passo a Claude: ${message}`)
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
    return new Error('Gemini gratuito è al limite in questo momento: scegli "Automatico" o un modello Claude per continuare.')
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
