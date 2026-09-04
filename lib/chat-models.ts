export const DEFAULT_CHAT_MODEL = 'gemini-3.6-flash'

/** Legacy model IDs saved in localStorage or old deploys */
const LEGACY_MODEL_MAP: Record<string, string> = {
  'gemini-2.0-flash': 'gemini-3.6-flash',
  'gemini-1.5-flash': 'gemini-3.6-flash',
  'gemini-1.5-pro': 'gemini-3.6-flash',
  'gemini-pro': 'gemini-3.6-flash',
  'llama-3.1-8b-instant': 'gemini-3.6-flash',
  'llama-3.3-70b-versatile': 'gemini-3.6-flash',
}

/**
 * Ordered fallbacks when the selected model is overloaded / unavailable.
 * Prefer capacity-stable flash variants after the user's choice.
 */
export const GEMINI_FALLBACK_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-flash-latest',
  'gemini-3.6-flash',
] as const

export const CHAT_MODELS = [
  {
    id: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash',
    description: 'Default fast model',
  },
  {
    id: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    description: 'Balanced speed and quality',
  },
  {
    id: 'gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash Lite',
    description: 'Lightweight free-tier model',
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    description: 'Stable capacity fallback',
  },
  {
    id: 'gemini-flash-latest',
    name: 'Gemini Flash (Latest)',
    description: 'Always uses the latest flash model',
  },
] as const

export function getChatModelName(modelId: string): string {
  return CHAT_MODELS.find((m) => m.id === modelId)?.name ?? modelId
}

export function resolveChatModel(model?: string | null): string {
  if (!model) return DEFAULT_CHAT_MODEL
  if (CHAT_MODELS.some((m) => m.id === model)) return model
  if (LEGACY_MODEL_MAP[model]) return LEGACY_MODEL_MAP[model]
  if (model.startsWith('gemini-')) return DEFAULT_CHAT_MODEL
  return DEFAULT_CHAT_MODEL
}

export function getGeminiModelsToTry(model: string): string[] {
  const resolved = resolveChatModel(model)
  return [...new Set([resolved, ...GEMINI_FALLBACK_MODELS])]
}

export function getChatErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Errore sconosciuto'

  if (
    message.includes('API key not valid') ||
    message.includes('API_KEY_INVALID') ||
    message.includes('API key not configured')
  ) {
    return 'Chiave API Gemini non valida o mancante. Verifica GEMINI_API_KEY su Vercel (Generative Language API abilitata, senza restrizioni referrer).'
  }

  if (
    message.includes('prepayment credits are depleted') ||
    message.includes('billing') ||
    message.includes('PAYMENT')
  ) {
    return 'Crediti prepagati esauriti su questo progetto Google. Crea una nuova chiave API gratuita su aistudio.google.com/apikey (senza ricarica) oppure ricarica i crediti in AI Studio → Billing.'
  }

  if (
    message.includes('high demand') ||
    message.includes('UNAVAILABLE') ||
    message.includes('overloaded') ||
    message.includes('no capacity') ||
    message.includes('temporaneamente sovraccarico')
  ) {
    return 'I modelli Gemini sono temporaneamente sovraccarichi. Riprova tra qualche secondo o seleziona Gemini 3.5 Flash Lite.'
  }

  if (message.includes('Rate limit') || message.includes('429')) {
    return 'Limite richieste raggiunto. Riprova tra qualche secondo.'
  }

  if (message.includes('Quota') || message.includes('quota')) {
    return 'Quota Gemini esaurita. Riprova più tardi o usa un altro modello.'
  }

  if (message.includes('not found') || message.includes('NOT_FOUND') || message.includes('no longer available')) {
    return 'Modello Gemini non disponibile. Prova a selezionare Gemini 3.5 Flash Lite dal menu modelli.'
  }

  return `Errore chat: ${message}`
}
