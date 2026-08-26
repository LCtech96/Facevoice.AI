export const DEFAULT_CHAT_MODEL = 'gemini-flash-latest'

export const CHAT_MODELS = [
  {
    id: 'gemini-flash-latest',
    name: 'Gemini Flash (Latest)',
    description: 'Default fast Gemini model',
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    description: 'Fast and efficient',
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    description: 'Most advanced reasoning',
  },
  {
    id: 'gemini-1.5-flash',
    name: 'Gemini 1.5 Flash',
    description: 'Stable fallback model',
  },
] as const

export function getChatModelName(modelId: string): string {
  return CHAT_MODELS.find((m) => m.id === modelId)?.name ?? modelId
}

export function resolveChatModel(model?: string | null): string {
  if (!model) return DEFAULT_CHAT_MODEL
  if (CHAT_MODELS.some((m) => m.id === model)) return model
  return DEFAULT_CHAT_MODEL
}
