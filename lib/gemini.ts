import { getGeminiModelsToTry } from '@/lib/chat-models'

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

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta'

export function getGeminiApiKey(): string {
  return (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim()
}

export function isGeminiModel(model: string): boolean {
  return model.startsWith('gemini-') || model in GEMINI_MODELS
}

function extractGeminiText(data: any): string {
  const parts = data?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return ''

  return parts
    .map((part: { text?: string }) => part.text || '')
    .join('')
    .trim()
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

export async function callGeminiAPI(
  messages: Array<{ role: string; content: string }>,
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
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = []

  for (const msg of messages) {
    if (msg.role === 'system') continue

    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(msg.content).trim() }],
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
    const errorMessage =
      data?.error?.message || `Gemini API error: ${response.status}`

    if (response.status === 429) {
      if (errorMessage.includes('prepayment credits are depleted')) {
        throw new Error(errorMessage)
      }
      throw new Error(
        'Rate limit raggiunto. Il piano gratuito ha limiti di richieste per minuto. Riprova tra qualche secondo.'
      )
    }

    if (response.status === 403 && errorMessage.toLowerCase().includes('quota')) {
      throw new Error(
        'Quota giornaliera esaurita. Il piano gratuito ha limiti giornalieri. Riprova domani.'
      )
    }

    throw new Error(errorMessage)
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
  messages: Array<{ role: string; content: string }>,
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
