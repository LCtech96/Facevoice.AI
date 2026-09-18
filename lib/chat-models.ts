/**
 * Modelli selezionabili nella chat interna (dipendenti).
 *
 * Il widget pubblico del sito (`/api/chat-widget`) e le route immagini
 * restano su Gemini: sono gratuiti e non autenticati, non devono
 * consumare credito Anthropic.
 */

// Gemini di default: non intacca il budget mensile dei dipendenti.
// Chi vuole Claude lo sceglie dal menu quando gli serve davvero.
export const DEFAULT_CHAT_MODEL = 'gemini-3.6-flash'

/** Prezzi in USD per milione di token. */
type ModelPricing = {
  input: number
  output: number
}

export type ChatProvider = 'anthropic' | 'google'

export type ChatModel = {
  id: string
  name: string
  provider: ChatProvider
  description: string
  /**
   * null = non conteggiato nel budget.
   *
   * I modelli Gemini girano sulla chiave gratuita di AI Studio: i token
   * vengono registrati lo stesso, ma il costo resta a zero. Se passi a
   * un piano a pagamento, metti qui i prezzi reali di Google e il
   * conteggio si adegua da solo.
   */
  pricing: ModelPricing | null
}

export const CHAT_MODELS: ChatModel[] = [
  {
    id: 'claude-opus-5',
    name: 'Claude Opus 5',
    provider: 'anthropic',
    description: "Il più capace. Per analisi complesse e lavoro lungo.",
    pricing: { input: 5, output: 25 },
  },
  {
    id: 'claude-sonnet-5',
    name: 'Claude Sonnet 5',
    provider: 'anthropic',
    description: "Equilibrio tra qualità e costo. Buono per l'uso quotidiano.",
    pricing: { input: 2, output: 10 },
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    description: "Il più economico e rapido. Per domande brevi.",
    pricing: { input: 1, output: 5 },
  },
  {
    id: 'gemini-3.6-flash',
    name: 'Gemini 3.6 Flash',
    provider: 'google',
    description: 'Rapido e senza costo sul budget. Buono per bozze e domande veloci.',
    pricing: null,
  },
  {
    id: 'gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    provider: 'google',
    description: 'Versione precedente del Flash. Senza costo sul budget.',
    pricing: null,
  },
  {
    id: 'gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash Lite',
    provider: 'google',
    description: 'Il più leggero. Senza costo sul budget.',
    pricing: null,
  },
]

export function getChatModel(modelId: string): ChatModel | undefined {
  return CHAT_MODELS.find((m) => m.id === modelId)
}

export function getModelProvider(modelId: string): ChatProvider {
  return getChatModel(modelId)?.provider ?? 'anthropic'
}

/** Solo i modelli con un prezzo consumano il budget mensile. */
export function isBilledModel(modelId: string): boolean {
  return getChatModel(modelId)?.pricing != null
}

/** Modelli non piu' offerti, salvati in vecchie chat o in localStorage. */
const LEGACY_MODEL_MAP: Record<string, string> = {
  'gemini-2.0-flash': 'gemini-3.6-flash',
  'gemini-2.5-flash': 'gemini-3.6-flash',
  'gemini-2.5-flash-lite': 'gemini-3.5-flash-lite',
  'gemini-1.5-flash': 'gemini-3.6-flash',
  'gemini-1.5-pro': 'gemini-3.6-flash',
  'gemini-pro': 'gemini-3.6-flash',
  'gemini-flash-latest': 'gemini-3.6-flash',
  'llama-3.1-8b-instant': 'gemini-3.6-flash',
  'llama-3.3-70b-versatile': 'gemini-3.6-flash',
}

export function getChatModelName(modelId: string): string {
  return CHAT_MODELS.find((m) => m.id === modelId)?.name ?? modelId
}

export function resolveChatModel(model?: string | null): string {
  if (!model) return DEFAULT_CHAT_MODEL
  if (CHAT_MODELS.some((m) => m.id === model)) return model
  return LEGACY_MODEL_MAP[model] ?? DEFAULT_CHAT_MODEL
}

/**
 * Costo in USD di una chiamata.
 *
 * I token scritti in cache costano ~1.25x l'input, quelli letti dalla
 * cache ~0.1x: e' da qui che arriva il risparmio sulle conversazioni lunghe.
 */
export function calculateCostUsd(
  model: string,
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
): number {
  const pricing = getChatModel(model)?.pricing
  if (!pricing) return 0

  const perToken = (millionPrice: number) => millionPrice / 1_000_000

  return (
    usage.input_tokens * perToken(pricing.input) +
    usage.output_tokens * perToken(pricing.output) +
    (usage.cache_creation_input_tokens ?? 0) * perToken(pricing.input) * 1.25 +
    (usage.cache_read_input_tokens ?? 0) * perToken(pricing.input) * 0.1
  )
}

export function getChatErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Errore sconosciuto'

  if (message.includes('ANTHROPIC_API_KEY') || message.includes('authentication')) {
    return 'Chiave API Anthropic mancante o non valida. Controlla ANTHROPIC_API_KEY.'
  }

  if (message.includes('limite mensile') || message.includes('Limite mensile')) {
    return message
  }

  if (message.includes('413')) {
    return 'Allegati troppo pesanti per essere inviati. Riprova con un\u2019immagine per volta, oppure con una foto più leggera.'
  }

  if (message.includes('rate') || message.includes('429')) {
    return 'Troppe richieste in poco tempo. Riprova tra qualche secondo.'
  }

  if (message.includes('credit') || message.includes('billing')) {
    return 'Credito Anthropic esaurito. Ricarica dalla console Anthropic.'
  }

  return `Errore chat: ${message}`
}
