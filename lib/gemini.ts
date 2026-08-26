const GEMINI_MODELS: Record<string, string> = {
  'gemini-flash-latest': 'gemini-flash-latest',
  'gemini-2.5-flash': 'gemini-2.5-flash',
  'gemini-2.5-pro': 'gemini-2.5-pro',
  'gemini-1.5-pro': 'gemini-1.5-pro',
  'gemini-1.5-flash': 'gemini-1.5-flash',
  'gemini-1.5-flash-lite': 'gemini-1.5-flash-lite',
  'gemini-pro': 'gemini-1.5-pro',
  'gemini-flash': 'gemini-flash-latest',
}

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta'

export function getGeminiApiKey(): string {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || ''
}

export function isGeminiModel(model: string): boolean {
  return model.startsWith('gemini-') || model in GEMINI_MODELS
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

  if (systemMessage) {
    contents.push({
      role: 'user',
      parts: [{ text: systemMessage }],
    })
    contents.push({
      role: 'model',
      parts: [{ text: 'Understood. I will follow these guidelines.' }],
    })
  }

  for (const msg of messages) {
    if (msg.role === 'system') continue

    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(msg.content).trim() }],
    })
  }

  const response = await fetch(
    `${GEMINI_API_URL}/models/${geminiModel}:generateContent`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents,
        generationConfig: {
          temperature: options?.temperature ?? 0.7,
          maxOutputTokens: options?.maxOutputTokens ?? 8192,
        },
      }),
    }
  )

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    const errorMessage =
      errorData.error?.message || `Gemini API error: ${response.status}`

    if (response.status === 429) {
      throw new Error(
        'Rate limit raggiunto. Il piano gratuito ha limiti di richieste per minuto. Riprova tra qualche secondo.'
      )
    }

    if (response.status === 403 && errorMessage.includes('quota')) {
      throw new Error(
        'Quota giornaliera esaurita. Il piano gratuito ha limiti giornalieri. Riprova domani.'
      )
    }

    throw new Error(errorMessage)
  }

  const data = await response.json()

  if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
    throw new Error('Invalid response from Gemini API')
  }

  return {
    message: data.candidates[0].content.parts[0].text as string,
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
