
export type GeminiAttachment = {
  mimeType: string
  data: string
}

export type GeminiChatMessage = {
  role: string
  content: string
  attachments?: GeminiAttachment[]
}

/** Map UI / legacy IDs to real Gemini API model names (1:1 for stable fallbacks). */
const GEMINI_MODELS: Record<string, string> = {
  'gemini-3.6-flash': 'gemini-3.6-flash',
  'gemini-3.5-flash': 'gemini-3.5-flash',
  'gemini-3.5-flash-lite': 'gemini-3.5-flash-lite',
  'gemini-2.5-flash': 'gemini-2.5-flash',
  'gemini-2.5-flash-lite': 'gemini-2.5-flash-lite',
  'gemini-2.5-pro': 'gemini-2.5-pro',
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

/**
 * Ordered fallbacks when the selected model is overloaded / unavailable.
 * Prefer capacity-stable flash variants after the user's choice.
 * Keep real 2.5 API names so they remain an escape hatch (do not remap to 3.6).
 */
const GEMINI_FALLBACK_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-flash-latest',
  'gemini-3.6-flash',
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
    if (attachment.mimeType.startsWith('image/') && attachment.data) {
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

function parseGeminiError(response: Response, data: any): Error {
  const errorMessage = data?.error?.message || `Gemini API error: ${response.status}`
  const errorStatus = String(data?.error?.status || '')

  if (response.status === 429) {
    if (errorMessage.includes('prepayment credits are depleted')) {
      return new Error(errorMessage)
    }
    return new Error(
      'Rate limit raggiunto. Il piano gratuito ha limiti di richieste per minuto. Riprova tra qualche secondo.'
    )
  }

  if (response.status === 403 && errorMessage.toLowerCase().includes('quota')) {
    return new Error(
      'Quota giornaliera esaurita. Il piano gratuito ha limiti giornalieri. Riprova domani.'
    )
  }

  // Preserve capacity signals so fallback logic can switch models.
  if (
    response.status === 503 ||
    errorStatus === 'UNAVAILABLE' ||
    errorMessage.includes('high demand') ||
    errorMessage.toLowerCase().includes('overloaded')
  ) {
    return new Error(
      errorMessage.includes('high demand')
        ? errorMessage
        : `This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later. (${response.status})`
    )
  }

  return new Error(errorMessage)
}

/** True when another Gemini model may succeed (capacity / availability), not billing/auth. */
export function isRetryableGeminiError(error: Error): boolean {
  const message = error.message

  if (
    message.includes('prepayment credits are depleted') ||
    message.includes('API key not valid') ||
    message.includes('API_KEY_INVALID') ||
    message.includes('API key not configured')
  ) {
    return false
  }

  return (
    message.includes('high demand') ||
    message.includes('UNAVAILABLE') ||
    message.includes('overloaded') ||
    message.includes('no capacity') ||
    message.includes('MODEL_CAPACITY_EXHAUSTED') ||
    message.includes('Rate limit') ||
    message.includes('429') ||
    message.includes('not found') ||
    message.includes('NOT_FOUND') ||
    message.includes('is not supported') ||
    message.includes('no longer available') ||
    message.includes('Invalid response')
  )
}

export async function callGeminiAPI(
  messages: GeminiChatMessage[],
  model: string,
  systemMessage?: string,
  options?: { temperature?: number; maxOutputTokens?: number }
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
      thinkingConfig: { thinkingBudget: 0 },
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

      if (!isRetryableGeminiError(lastError)) {
        throw lastError
      }

      console.warn(`Gemini model ${candidateModel} failed, trying next model:`, lastError.message)
    }
  }

  if (
    lastError &&
    (lastError.message.includes('high demand') ||
      lastError.message.includes('UNAVAILABLE') ||
      lastError.message.includes('overloaded') ||
      lastError.message.includes('Rate limit') ||
      lastError.message.includes('429'))
  ) {
    throw new Error(
      'I modelli Gemini sono temporaneamente sovraccarichi. Riprova tra qualche secondo o seleziona Gemini 3.5 Flash Lite.'
    )
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
