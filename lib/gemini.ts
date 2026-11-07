
export type GeminiAttachment = {
  mimeType: string
  data: string
}

export type GeminiChatMessage = {
  role: string
  content: string
  attachments?: GeminiAttachment[]
}

const GEMINI_MODELS: Record<string, string> = {
  'gemini-3.6-flash': 'gemini-3.6-flash',
  'gemini-3.5-flash': 'gemini-3.5-flash',
  'gemini-3.5-flash-lite': 'gemini-3.5-flash-lite',
  'gemini-2.5-flash': 'gemini-3.6-flash',
  'gemini-2.5-flash-lite': 'gemini-3.5-flash-lite',
  'gemini-2.5-pro': 'gemini-3.5-flash',
  'gemini-flash-latest': 'gemini-flash-latest',
  'gemini-flash-lite-latest': 'gemini-flash-lite-latest',
  'gemini-pro': 'gemini-3.5-flash',
  'gemini-flash': 'gemini-flash-latest',
}

const IMAGE_MODELS = [
  'gemini-2.5-flash-image',
  'gemini-3.1-flash-image',
  'gemini-3-pro-image',
] as const

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta'

/** Modello usato dal widget pubblico e dalle chat condivise. */
export const GEMINI_DEFAULT_MODEL = 'gemini-3.6-flash'

const GEMINI_FALLBACK_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-flash-latest',
] as const

export function resolveGeminiModel(model?: string | null): string {
  if (!model) return GEMINI_DEFAULT_MODEL
  return GEMINI_MODELS[model] ?? GEMINI_DEFAULT_MODEL
}

export function getGeminiModelsToTry(model: string): string[] {
  return [...new Set([resolveGeminiModel(model), ...GEMINI_FALLBACK_MODELS])]
}

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }

export function getGeminiApiKey(): string {
  return (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim()
}

export function isGeminiModel(model: string): boolean {
  return model.startsWith('gemini-') || model in GEMINI_MODELS
}

function buildParts(content: string, attachments?: GeminiAttachment[]): GeminiPart[] {
  const parts: GeminiPart[] = []

  if (content.trim()) {
    parts.push({ text: content.trim() })
  }

  for (const attachment of attachments || []) {
    // Immagini e video brevi (es. un reel inoltrato in Direct): Gemini li legge entrambi.
    if ((attachment.mimeType.startsWith('image/') || attachment.mimeType.startsWith('video/')) && attachment.data) {
      parts.push({
        inlineData: {
          mimeType: attachment.mimeType,
          data: attachment.data.replace(/^data:[^;]+;base64,/, ''),
        },
      })
    }
  }

  if (parts.length === 0) {
    parts.push({ text: 'Describe the attached content.' })
  }

  return parts
}

function extractGeminiText(data: any): string {
  const parts = data?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return ''

  return parts
    .map((part: { text?: string }) => part.text || '')
    .join('')
    .trim()
}

function extractGeminiImage(data: any): string | null {
  const parts = data?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return null

  for (const part of parts) {
    if (part.inlineData?.data) {
      const mimeType = part.inlineData.mimeType || 'image/png'
      return `data:${mimeType};base64,${part.inlineData.data}`
    }
  }

  return null
}

function getGeminiFailureReason(data: any): string | null {
  const candidate = data?.candidates?.[0]
  if (!candidate) {
    return data?.promptFeedback?.blockReason
      ? `Prompt bloccato: ${data.promptFeedback.blockReason}`
      : null
  }

  if (candidate.finishReason && candidate.finishReason !== 'STOP') {
    return `Risposta interrotta: ${candidate.finishReason}`
  }

  return null
}

/**
 * Dettagli di un errore dell'API Gemini, solo per i log e per decidere quanto lasciare a
 * riposo il modello: non si mostrano mai a chi usa il sito (il limite e' del servizio AI
 * di Facevoice, non suo).
 */
export type GeminiErrorInfo = {
  httpStatus: number
  /** Stato di Google, es. RESOURCE_EXHAUSTED, INVALID_ARGUMENT, UNAVAILABLE. */
  status: string
  /** Testo originale di Google con le quote superate (quotaId, quotaMetric). */
  detail: string
  /** Quota del giorno esaurita (quotaId "...PerDay...", "per day"). */
  daily: boolean
  /** Attesa suggerita da Google (RetryInfo.retryDelay, es. "36s"), in ms. */
  retryDelayMs: number | null
}

/** Errore dell'API Gemini: il messaggio e' neutro, i dettagli di Google restano in info. */
export class GeminiAPIError extends Error {
  info: GeminiErrorInfo
  constructor(message: string, info: GeminiErrorInfo) {
    super(message)
    this.name = 'GeminiAPIError'
    this.info = info
  }
}

/** Dettagli di Google di un errore Gemini (null se l'errore non viene dall'API Gemini). */
export function geminiErrorInfo(error: unknown): GeminiErrorInfo | null {
  const info = (error as { info?: GeminiErrorInfo } | null)?.info
  return info && typeof info.httpStatus === 'number' ? info : null
}

/** Limite di richieste o quota (al minuto o del giorno). */
export function isGeminiLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /rate limit|quota|prepayment|credits are depleted|RESOURCE_EXHAUSTED|429/i.test(message)
}

/** "36s", "1.5s" -> millisecondi. */
const delayMs = (value: unknown) => {
  const m = typeof value === 'string' ? value.trim().match(/^(\d+(?:\.\d+)?)s$/) : null
  return m ? Math.round(Number(m[1]) * 1000) : null
}

function parseGeminiError(response: Response, data: any): Error {
  const errorMessage = data?.error?.message || `Gemini API error: ${response.status}`
  const details: any[] = Array.isArray(data?.error?.details) ? data.error.details : []
  const quotas = details
    .flatMap((d) => (Array.isArray(d?.violations) ? d.violations : []))
    .map((v: any) => [v?.quotaId, v?.quotaMetric].filter((x) => typeof x === 'string').join(' '))
    .filter(Boolean)
  const retryDelayMs = details.map((d) => delayMs(d?.retryDelay)).find((ms): ms is number => ms !== null) ?? null
  const status = typeof data?.error?.status === 'string' ? data.error.status : ''
  const detail = [`HTTP ${response.status}`, status, errorMessage, ...quotas].filter(Boolean).join(' · ').replace(/\s+/g, ' ').slice(0, 1000)
  const info: GeminiErrorInfo = {
    httpStatus: response.status,
    status,
    detail,
    daily: /PerDay|per[ -]day|daily/i.test([errorMessage, ...quotas].join(' ')),
    retryDelayMs,
  }

  if (response.status === 429) {
    if (errorMessage.includes('prepayment credits are depleted')) {
      return new GeminiAPIError(errorMessage, info)
    }
    // "Rate limit" resta nel testo: lo riconoscono i controlli dei limiti (isLimitError e simili).
    return new GeminiAPIError('Rate limit raggiunto: il servizio AI ha ricevuto troppe richieste. Riprova tra qualche minuto.', info)
  }

  if (response.status === 403 && errorMessage.toLowerCase().includes('quota')) {
    return new GeminiAPIError('Quota giornaliera del servizio AI esaurita: riprova più tardi.', { ...info, daily: true })
  }

  return new GeminiAPIError(errorMessage, info)
}

export type GeminiCallOptions = {
  temperature?: number
  maxOutputTokens?: number
  /** Per i modelli che rifiutano thinkingConfig (400 INVALID_ARGUMENT). */
  withoutThinkingConfig?: boolean
  /** Risposta in JSON (responseMimeType application/json): niente testo intorno, stringhe valide. */
  json?: boolean
}

export async function callGeminiAPI(
  messages: GeminiChatMessage[],
  model: string,
  systemMessage?: string,
  options?: GeminiCallOptions
) {
  const apiKey = getGeminiApiKey()
  if (!apiKey) {
    throw new Error(
      'Gemini API key not configured. Please set GEMINI_API_KEY or GOOGLE_API_KEY environment variable.'
    )
  }

  const geminiModel = GEMINI_MODELS[model] || model
  const contents: Array<{ role: string; parts: GeminiPart[] }> = []

  for (const msg of messages) {
    if (msg.role === 'system') continue

    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: buildParts(msg.content, msg.attachments),
    })
  }

  if (contents.length === 0) {
    throw new Error('No valid messages to send to Gemini API')
  }

  // Prima la parte stabile (istruzioni di sistema), poi la conversazione: le richieste che
  // iniziano allo stesso modo possono riusare la cache implicita di Gemini.
  const requestBody: Record<string, unknown> = {}
  if (systemMessage?.trim()) {
    requestBody.systemInstruction = {
      parts: [{ text: systemMessage.trim() }],
    }
  }
  requestBody.contents = contents
  requestBody.generationConfig = {
    temperature: options?.temperature ?? 0.7,
    maxOutputTokens: options?.maxOutputTokens ?? 8192,
    ...(options?.json ? { responseMimeType: 'application/json' } : {}),
    // I modelli Gemini 3.x ragionano prima di rispondere, e quel
    // "pensiero" pesca dallo stesso budget di maxOutputTokens della
    // risposta visibile. Con un budget stretto (es. il widget
    // pubblico, a 800 token) il ragionamento poteva consumarne la
    // maggior parte e troncare il testo a meta' frase, senza che
    // l'errore emergesse: la risposta parziale veniva restituita
    // come se fosse completa. Qui non serve un ragionamento
    // profondo — sono risposte da chat, non problemi complessi —
    // quindi lo disattiviamo (tranne per i modelli che non accettano
    // thinkingConfig: lib/ai.ts li richiama senza, con piu' spazio).
    ...(options?.withoutThinkingConfig ? {} : { thinkingConfig: { thinkingBudget: 0 } }),
  }

  const response = await fetch(
    `${GEMINI_API_URL}/models/${geminiModel}:generateContent`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    }
  )

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw parseGeminiError(response, data)
  }

  const text = extractGeminiText(data)
  if (text) {
    if (data?.candidates?.[0]?.finishReason === 'MAX_TOKENS') {
      // Il testo c'e' ma e' stato interrotto a meta': meglio saperlo
      // dai log che scoprirlo da uno screenshot di un utente.
      console.warn(
        `Gemini (${geminiModel}) ha troncato la risposta per limite di token (maxOutputTokens: ${
          (requestBody.generationConfig as { maxOutputTokens?: number })?.maxOutputTokens
        })`
      )
    }

    return {
      message: text,
      model: (data.modelVersion as string) || geminiModel,
      /** Motivo della fine (es. "MAX_TOKENS" = testo interrotto a meta'). */
      finishReason: (data?.candidates?.[0]?.finishReason as string | undefined) || null,
      usage: data.usageMetadata
        ? {
            prompt_tokens: data.usageMetadata.promptTokenCount,
            completion_tokens: data.usageMetadata.candidatesTokenCount,
            total_tokens: data.usageMetadata.totalTokenCount,
          }
        : undefined,
    }
  }

  const failureReason = getGeminiFailureReason(data)
  throw new Error(failureReason || 'Invalid response from Gemini API')
}

// ---------------------------------------------------------------------
// Errori dei modelli Gemini: cosa fare di ciascuno (usato qui e in lib/ai.ts)
// ---------------------------------------------------------------------

/** Per quanto si ricorda che un modello va chiamato senza thinkingConfig (poi si riprova con). */
const NO_THINKING_CONFIG_MS = 6 * 60 * 60_000
/** Senza thinkingConfig il ragionamento usa lo stesso budget della risposta: spazio in piu' per non troncarla. */
export const THINKING_ROOM_TOKENS = 2048
/** Modelli che rifiutano thinkingConfig (400 INVALID_ARGUMENT) -> fino a quando si chiamano senza. */
const noThinkingConfig = new Map<string, number>()
export const callsWithoutThinkingConfig = (model: string) => Date.now() < (noThinkingConfig.get(model) || 0)
export const rememberWithoutThinkingConfig = (model: string) => {
  noThinkingConfig.set(model, Date.now() + NO_THINKING_CONFIG_MS)
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Dettagli di Google per i log (mai per chi usa il sito). */
export const geminiDetail = (error: unknown) => geminiErrorInfo(error)?.detail || errorText(error)

/** Modello inesistente o non piu' disponibile. */
export const isMissingGeminiModel = (error: unknown) => /not found|NOT_FOUND|is not supported|no longer available/i.test(errorText(error))

/** 400 "Request contains an invalid argument" (INVALID_ARGUMENT): vale solo per quel modello, non per tutti. */
export function isInvalidArgument(error: unknown): boolean {
  if (isGeminiLimitError(error)) return false
  return geminiErrorInfo(error)?.status === 'INVALID_ARGUMENT' || /invalid argument|INVALID_ARGUMENT/i.test(errorText(error))
}

/**
 * Richiesta rifiutata per il suo contenuto (allegato troppo grande o illeggibile, troppi token,
 * testo bloccato) o chiave non valida: nessun modello la accetterebbe, quindi non si provano gli
 * altri e nessuno va a riposo.
 */
export function isRequestFault(error: unknown): boolean {
  return /payload|too large|exceeds|size limit|mime|unable to process|unsupported (file|image|media|mime)|token count|input token|No valid messages|Prompt bloccato|API key not valid|API_KEY_INVALID/i.test(
    `${errorText(error)} ${geminiDetail(error)}`
  )
}

/** Modello momentaneamente non disponibile (503 "high demand", 500, rete): il problema e' del modello. */
export function isGeminiServerError(error: unknown): boolean {
  const status = geminiErrorInfo(error)?.httpStatus || 0
  return status >= 500 || /high demand|overloaded|UNAVAILABLE|INTERNAL|DEADLINE_EXCEEDED|try again later|fetch failed|ECONNRESET|timeout/i.test(errorText(error))
}

/** Errore da cui conviene passare al modello dopo: non disponibile, o risposta vuota/interrotta per questa richiesta. */
export function isTransientGeminiError(error: unknown): boolean {
  return isGeminiServerError(error) || /Invalid response|Risposta interrotta/i.test(errorText(error))
}

/**
 * Prova i modelli Gemini uno dopo l'altro (widget pubblico, chat condivise, chat interna). Un
 * modello al limite, non disponibile o che rifiuta la richiesta non ferma il giro: si passa al
 * successivo. Chi rifiuta la richiesta (INVALID_ARGUMENT) si riprova prima una volta senza
 * thinkingConfig. Solo una richiesta che nessun modello accetterebbe (allegato troppo grande)
 * si ferma subito.
 */
export async function callGeminiWithFallback(
  messages: GeminiChatMessage[],
  model: string,
  systemMessage?: string,
  options?: GeminiCallOptions
) {
  const modelsToTry = getGeminiModelsToTry(model)
  let lastError: Error | null = null

  for (const candidateModel of modelsToTry) {
    let withoutThinkingConfig = callsWithoutThinkingConfig(candidateModel)
    for (;;) {
      try {
        const result = await callGeminiAPI(messages, candidateModel, systemMessage, {
          ...options,
          withoutThinkingConfig,
          ...(withoutThinkingConfig ? { maxOutputTokens: (options?.maxOutputTokens ?? 8192) + THINKING_ROOM_TOKENS } : {}),
        })
        if (withoutThinkingConfig && !callsWithoutThinkingConfig(candidateModel)) rememberWithoutThinkingConfig(candidateModel)
        return result
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        if (isInvalidArgument(error) && !isRequestFault(error) && !withoutThinkingConfig) {
          withoutThinkingConfig = true
          continue
        }
        const retryable =
          isGeminiLimitError(error) || isMissingGeminiModel(error) || isTransientGeminiError(error) || (isInvalidArgument(error) && !isRequestFault(error))
        if (!retryable) throw lastError
        console.warn(`Gemini model ${candidateModel} failed, trying next model: ${geminiDetail(error)}`)
        break
      }
    }
  }

  throw lastError || new Error('Failed to get AI response from Gemini')
}

// ---------------------------------------------------------------------
// Immagini
// ---------------------------------------------------------------------

/** Modello immagini al limite -> istante fino a cui non si prova (in questa istanza del server). */
const imageCooling = new Map<string, number>()
const IMAGE_MINUTE_COOLDOWN_MS = 60_000
const IMAGE_DAILY_COOLDOWN_MS = 6 * 60 * 60_000

export const GEMINI_IMAGE_MODELS: readonly string[] = IMAGE_MODELS

/** Riposo di un modello immagini dopo un limite: quota del giorno, attesa suggerita da Google o un minuto. */
export function imageLimitCooldownMs(error: unknown): number {
  const info = geminiErrorInfo(error)
  if (info?.daily) return IMAGE_DAILY_COOLDOWN_MS
  if (info?.retryDelayMs) return Math.min(IMAGE_DAILY_COOLDOWN_MS, Math.max(IMAGE_MINUTE_COOLDOWN_MS, info.retryDelayMs))
  return IMAGE_MINUTE_COOLDOWN_MS
}

export type ImageGenerationOptions = {
  /** Modelli da non provare in questa chiamata (es. a riposo per tutti i server, da app_settings). */
  skip?: (model: string) => boolean
  /** Avvisato quando un modello risponde con un limite (per il riposo condiviso). */
  onLimit?: (model: string, error: unknown) => void
}

/**
 * Immagine con Gemini: ogni modello si prova al massimo una volta per chiamata. Un modello
 * al limite resta a riposo (attesa suggerita da Google, un minuto o, con la quota del giorno
 * finita, qualche ora) e le chiamate successive non lo riprovano finche' non torna libero.
 */
export async function generateGeminiImage(
  prompt: string,
  referenceImage?: GeminiAttachment,
  options?: ImageGenerationOptions
) {
  const apiKey = getGeminiApiKey()
  if (!apiKey) {
    throw new Error('Gemini API key not configured.')
  }

  const models = IMAGE_MODELS.filter((m) => Date.now() >= (imageCooling.get(m) || 0) && !options?.skip?.(m))
  if (!models.length) {
    throw new GeminiAPIError('Rate limit raggiunto: i modelli per le immagini sono a riposo. Riprova più tardi.', {
      httpStatus: 429,
      status: 'COOLDOWN',
      detail: 'tutti i modelli immagine a riposo',
      daily: false,
      retryDelayMs: null,
    })
  }

  let lastError: Error | null = null

  for (const imageModel of models) {
    try {
      const parts: GeminiPart[] = [{ text: prompt.trim() }]

      if (referenceImage) {
        parts.push({
          inlineData: {
            mimeType: referenceImage.mimeType,
            data: referenceImage.data.replace(/^data:[^;]+;base64,/, ''),
          },
        })
      }

      const response = await fetch(
        `${GEMINI_API_URL}/models/${imageModel}:generateContent`,
        {
          method: 'POST',
          headers: {
            'x-goog-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{ role: 'user', parts }],
            generationConfig: {
              responseModalities: ['TEXT', 'IMAGE'],
            },
          }),
        }
      )

      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw parseGeminiError(response, data)
      }

      const imageUrl = extractGeminiImage(data)
      if (imageUrl) {
        return {
          imageUrl,
          model: (data.modelVersion as string) || imageModel,
          text: extractGeminiText(data),
        }
      }

      throw new Error('Gemini non ha restituito un\'immagine. Prova un prompt diverso.')
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (isGeminiLimitError(error)) {
        const cooldown = imageLimitCooldownMs(error)
        imageCooling.set(imageModel, Date.now() + cooldown)
        try {
          options?.onLimit?.(imageModel, error)
        } catch {}
        console.warn(`Gemini image model ${imageModel} al limite (a riposo ${Math.round(cooldown / 1000)} s): ${geminiDetail(error)}`)
      } else {
        console.warn(`Gemini image model ${imageModel} failed:`, lastError.message)
      }
    }
  }

  throw lastError || new Error('Failed to generate image with Gemini')
}
