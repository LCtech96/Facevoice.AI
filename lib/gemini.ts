import { getGeminiModelsToTry } from '@/lib/chat-models'

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

  return new Error(errorMessage)
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
