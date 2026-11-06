
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
 * riposo il modello: non si mostrano mai al cliente (il limite e' del piano Gemini di
 * Facevoice, non del suo).
 */
export type GeminiErrorInfo = {
  httpStatus: number
  /** Stato di Google, es. RESOURCE_EXHAUSTED, INVALID_ARGUMENT. */
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
  const info: GeminiErrorInfo = { httpStatus: response.status, status, detail, daily: /PerDay|per[ -]day|daily/i.test([errorMessage, ...quotas].join(' ')), retryDelayMs }

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

export async function callGeminiAPI(
  messages: GeminiChatMessage[],
  model: string,
  systemMessage?: string,
  /** withoutThinkingConfig: per i modelli che rifiutano thinkingConfig (400 INVALID_ARGUMENT). */
  options?: { temperature?: number; maxOutputTokens?: number; withoutThinkingConfig?: boolean }
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

  const requestBody: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: options?.temperature ?? 0.7,
      maxOutputTokens: options?.maxOutputTokens ?? 8192,
      // I modelli Gemini 3.x ragionano prima di rispondere, e quel
      // "pensiero" pesca dallo stesso budget di maxOutputTokens della
      // risposta visibile. Con un budget stretto (es. il widget
      // pubblico, a 800 token) il ragionamento poteva consumarne la
      // maggior parte e troncare il testo a meta' frase, senza che
      // l'errore emergesse: la risposta parziale veniva restituita
      // come se fosse completa. Qui non serve un ragionamento
      // profondo — sono risposte da chat, non problemi complessi —
      // quindi lo disattiviamo.
      ...(options?.withoutThinkingConfig ? {} : { thinkingConfig: { thinkingBudget: 0 } }),
    },
  }

  if (systemMessage?.trim()) {
    requestBody.systemInstruction = {
      parts: [{ text: systemMessage.trim() }],
    }
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

/** Pagina trovata dalla ricerca Google (uri spesso e' un rimando vertexaisearch.cloud.google.com). */
export type GroundingChunk = { uri: string; title: string }
/** Pezzo della risposta (testo) e pagine che lo sostengono (indici in chunks). */
export type GroundingSupport = { text: string; startIndex: number | null; endIndex: number | null; chunks: number[] }
export type GroundedAnswer = {
  text: string
  model: string
  queries: string[]
  chunks: GroundingChunk[]
  supports: GroundingSupport[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

/**
 * Una chiamata con la ricerca Google (strumento "google_search" dell'API Gemini):
 * la risposta e' scritta dalle pagine trovate, con le fonti nei metadati
 * (groundingMetadata: pagine, frasi sostenute da quali pagine, ricerche fatte).
 */
export async function callGeminiGrounded(
  prompt: string,
  model: string,
  systemMessage?: string,
  options?: { temperature?: number; maxOutputTokens?: number; timeoutMs?: number }
): Promise<GroundedAnswer> {
  const apiKey = getGeminiApiKey()
  if (!apiKey) throw new Error('Gemini API key not configured.')
  const geminiModel = GEMINI_MODELS[model] || model
  const requestBody: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: options?.temperature ?? 0.2, maxOutputTokens: options?.maxOutputTokens ?? 8192 },
  }
  if (systemMessage?.trim()) requestBody.systemInstruction = { parts: [{ text: systemMessage.trim() }] }
  const response = await fetch(`${GEMINI_API_URL}/models/${geminiModel}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(options?.timeoutMs ?? 60_000),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw parseGeminiError(response, data)
  const text = extractGeminiText(data)
  if (!text) throw new Error(getGeminiFailureReason(data) || 'Invalid response from Gemini API')
  const meta = data?.candidates?.[0]?.groundingMetadata || {}
  const chunks: GroundingChunk[] = (Array.isArray(meta.groundingChunks) ? meta.groundingChunks : []).map((c: { web?: { uri?: unknown; title?: unknown } }) => ({
    uri: typeof c?.web?.uri === 'string' ? c.web.uri : '',
    title: typeof c?.web?.title === 'string' ? c.web.title : '',
  }))
  const supports: GroundingSupport[] = (Array.isArray(meta.groundingSupports) ? meta.groundingSupports : []).map(
    (s: { segment?: { text?: unknown; startIndex?: unknown; endIndex?: unknown }; groundingChunkIndices?: unknown }) => ({
      text: typeof s?.segment?.text === 'string' ? s.segment.text : '',
      startIndex: typeof s?.segment?.startIndex === 'number' ? s.segment.startIndex : null,
      endIndex: typeof s?.segment?.endIndex === 'number' ? s.segment.endIndex : null,
      chunks: Array.isArray(s?.groundingChunkIndices) ? (s.groundingChunkIndices as unknown[]).filter((i): i is number => typeof i === 'number') : [],
    })
  )
  return {
    text,
    model: (data.modelVersion as string) || geminiModel,
    queries: Array.isArray(meta.webSearchQueries) ? meta.webSearchQueries.filter((q: unknown): q is string => typeof q === 'string') : [],
    chunks,
    supports,
    usage: data.usageMetadata ? { prompt_tokens: data.usageMetadata.promptTokenCount, completion_tokens: data.usageMetadata.candidatesTokenCount } : undefined,
  }
}

export async function callGeminiWithFallback(
  messages: GeminiChatMessage[],
  model: string,
  systemMessage?: string,
  options?: { temperature?: number; maxOutputTokens?: number }
) {
  const modelsToTry = getGeminiModelsToTry(model)
  let lastError: Error | null = null

  for (const candidateModel of modelsToTry) {
    try {
      return await callGeminiAPI(messages, candidateModel, systemMessage, options)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      const retryable =
        lastError.message.includes('not found') ||
        lastError.message.includes('NOT_FOUND') ||
        lastError.message.includes('is not supported') ||
        lastError.message.includes('no longer available') ||
        lastError.message.includes('Invalid response')

      if (!retryable) {
        throw lastError
      }

      console.warn(`Gemini model ${candidateModel} failed, trying next model:`, lastError.message)
    }
  }

  throw lastError || new Error('Failed to get AI response from Gemini')
}

export async function generateGeminiImage(
  prompt: string,
  referenceImage?: GeminiAttachment
) {
  const apiKey = getGeminiApiKey()
  if (!apiKey) {
    throw new Error('Gemini API key not configured.')
  }

  let lastError: Error | null = null

  for (const imageModel of IMAGE_MODELS) {
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
      console.warn(`Gemini image model ${imageModel} failed:`, lastError.message)
    }
  }

  throw lastError || new Error('Failed to generate image with Gemini')
}
