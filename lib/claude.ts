import Anthropic from '@anthropic-ai/sdk'
import { DEFAULT_CHAT_MODEL, resolveChatModel } from '@/lib/chat-models'

export type ChatAttachmentInput = {
  mimeType: string
  data: string
}

export type ClaudeChatMessage = {
  role: 'user' | 'assistant'
  content: string
  attachments?: ChatAttachmentInput[] | null
}

export type ClaudeResult = {
  message: string
  model: string
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
  }
  refused: boolean
}

/** Immagini accettate dall'API (le altre vengono scartate). */
const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

const BASE_SYSTEM_PROMPT = `Sei l'assistente AI interno di Facevoice.AI, usato dal team per lavorare sui progetti dei clienti.

Rispondi nella lingua dell'utente (di norma italiano). Sii diretto e concreto: niente preamboli, niente riepiloghi di quello che stai per fare. Quando una richiesta è ambigua, fai una sola domanda di chiarimento invece di indovinare. Se non sai una cosa, dillo.

Ogni risposta deve restare entro circa 300 caratteri (poche frasi). Se il compito richiede davvero più spazio, dai la parte più utile ora e chiedi se continuare.`

/**
 * Claude Haiku 5.5 puo' rifiutare una richiesta (stop_reason "refusal") e non ha una riserva
 * lato server: la chat rifa' la stessa richiesta una volta con Haiku 4.5.
 */
export const REFUSAL_RETRY_MODEL = 'claude-haiku-4-5'

/** Modello con cui rifare una richiesta rifiutata (solo per Haiku 5.5), altrimenti null. */
export function refusalRetryModel(model: string): string | null {
  return model.startsWith('claude-haiku-5') ? REFUSAL_RETRY_MODEL : null
}

/**
 * Parametri per modello. Haiku 5.5 (guida di migrazione): thinking adattivo con effort "low",
 * il livello indicato per la chat (pensa poco o niente e costa meno); niente temperature,
 * top_p, top_k, budget_tokens ne' prefill (lo storico finisce sempre col messaggio
 * dell'utente). Gli altri modelli restano come prima.
 */
function modelSettings(model: string): Pick<Anthropic.MessageCreateParams, 'thinking' | 'output_config'> {
  if (model.startsWith('claude-haiku-5')) {
    return { thinking: { type: 'adaptive' }, output_config: { effort: 'low' } }
  }
  return {}
}

export function getAnthropicApiKey(): string {
  return (process.env.ANTHROPIC_API_KEY || '').trim()
}

function getClient(): Anthropic {
  const apiKey = getAnthropicApiKey()
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY non configurata.')
  }
  return new Anthropic({ apiKey })
}

function buildContent(
  message: ClaudeChatMessage
): string | Anthropic.ContentBlockParam[] {
  const images = (message.attachments || []).filter(
    (item) => item?.data && SUPPORTED_IMAGE_TYPES.includes(item.mimeType)
  )

  const text = message.content.trim()

  if (images.length === 0) {
    return text
  }

  const blocks: Anthropic.ContentBlockParam[] = images.map((image) => ({
    type: 'image',
    source: {
      type: 'base64',
      media_type: image.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
      // Il frontend manda base64 puro, ma tolleriamo il prefisso data: URL.
      data: image.data.replace(/^data:[^;]+;base64,/, ''),
    },
  }))

  // Il testo va dopo le immagini: Claude legge meglio la domanda
  // quando ha già il contesto visivo davanti.
  blocks.push({ type: 'text', text: text || 'Analizza questa immagine.' })

  return blocks
}

/**
 * Compone il system prompt: base + istruzioni del progetto.
 *
 * Nota sul prompt caching: la cache si attiva solo sopra una soglia
 * minima di token (512-4096 a seconda del modello). Istruzioni di
 * progetto brevi non la raggiungono e semplicemente non vengono
 * cachate — nessun errore, nessun risparmio. Il risparmio reale
 * arriva dalla conversazione che cresce, coperta dalla cache
 * automatica sull'ultimo blocco della richiesta.
 */
function buildSystem(projectInstructions?: string | null): Anthropic.TextBlockParam[] {
  const blocks: Anthropic.TextBlockParam[] = [
    { type: 'text', text: BASE_SYSTEM_PROMPT },
  ]

  const instructions = projectInstructions?.trim()
  if (instructions) {
    blocks.push({
      type: 'text',
      text: `Contesto specifico di questo progetto. Vale per tutta la conversazione:\n\n${instructions}`,
    })
  }

  // Prefisso stabile fra una richiesta e l'altra: è il punto giusto
  // dove piazzare il breakpoint di cache.
  blocks[blocks.length - 1].cache_control = { type: 'ephemeral' }

  return blocks
}

/**
 * Prepara la richiesta in streaming. Il chiamante itera sugli eventi e
 * alla fine legge `finalMessage()` per usage e stop_reason.
 *
 * max_tokens e' alto perche' in streaming non c'e' il rischio di timeout
 * HTTP che limita le richieste normali.
 */
export function streamClaude(
  messages: ClaudeChatMessage[],
  model: string,
  projectInstructions?: string | null,
  /** Riprova dopo un rifiuto: la stessa richiesta col modello di riserva (refusalRetryModel). */
  options?: { retryAfterRefusal?: boolean }
) {
  const client = getClient()
  const apiMessages = toApiMessages(messages)
  const chosen = resolveChatModel(model) || DEFAULT_CHAT_MODEL
  const resolvedModel = options?.retryAfterRefusal ? refusalRetryModel(chosen) || chosen : chosen

  // max_tokens: Haiku 5.5 scrive fino a 128K token (il tokenizer nuovo conta ~30% in piu'),
  // Haiku 4.5 fino a 64K: 64000 basta a entrambi, si pagano solo i token scritti.
  return client.messages.stream({
    model: resolvedModel,
    max_tokens: 64000,
    system: buildSystem(projectInstructions),
    messages: apiMessages,
    cache_control: { type: 'ephemeral' },
    ...modelSettings(resolvedModel),
  })
}

export function refusalNotice(): string {
  return 'Claude ha rifiutato di rispondere a questa richiesta per motivi di sicurezza. Riformulala o cambia argomento.'
}

function toApiMessages(messages: ClaudeChatMessage[]): Anthropic.MessageParam[] {
  const apiMessages: Anthropic.MessageParam[] = messages
    .filter((msg) => msg.content.trim() || msg.attachments?.length)
    .map((msg) => ({
      role: msg.role,
      content: buildContent(msg),
    }))

  if (apiMessages.length === 0) {
    throw new Error('Nessun messaggio valido da inviare.')
  }

  return apiMessages
}

export async function callClaude(
  messages: ClaudeChatMessage[],
  model: string,
  projectInstructions?: string | null
): Promise<ClaudeResult> {
  const client = getClient()
  const resolvedModel = resolveChatModel(model) || DEFAULT_CHAT_MODEL
  const apiMessages = toApiMessages(messages)

  const response = await client.messages.create({
    model: resolvedModel,
    max_tokens: 16000,
    system: buildSystem(projectInstructions),
    messages: apiMessages,
    // Cache automatica sull'ultimo blocco: copre il prefisso della
    // conversazione, che è la parte che cresce a ogni turno.
    cache_control: { type: 'ephemeral' },
    ...modelSettings(resolvedModel),
  })

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()

  const refused = response.stop_reason === 'refusal'

  return {
    message: refused ? refusalNotice() : text,
    model: response.model,
    usage: {
      input_tokens: response.usage.input_tokens ?? 0,
      output_tokens: response.usage.output_tokens ?? 0,
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
    },
    refused,
  }
}
