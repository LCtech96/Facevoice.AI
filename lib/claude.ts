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

Rispondi nella lingua dell'utente (di norma italiano). Sii diretto e concreto: niente preamboli, niente riepiloghi di quello che stai per fare. Quando una richiesta è ambigua, fai una sola domanda di chiarimento invece di indovinare. Se non sai una cosa, dillo.`

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

export async function callClaude(
  messages: ClaudeChatMessage[],
  model: string,
  projectInstructions?: string | null
): Promise<ClaudeResult> {
  const client = getClient()
  const resolvedModel = resolveChatModel(model) || DEFAULT_CHAT_MODEL

  const apiMessages: Anthropic.MessageParam[] = messages
    .filter((msg) => msg.content.trim() || msg.attachments?.length)
    .map((msg) => ({
      role: msg.role,
      content: buildContent(msg),
    }))

  if (apiMessages.length === 0) {
    throw new Error('Nessun messaggio valido da inviare.')
  }

  const response = await client.messages.create({
    model: resolvedModel,
    max_tokens: 16000,
    system: buildSystem(projectInstructions),
    messages: apiMessages,
    // Cache automatica sull'ultimo blocco: copre il prefisso della
    // conversazione, che è la parte che cresce a ogni turno.
    cache_control: { type: 'ephemeral' },
  })

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()

  const refused = response.stop_reason === 'refusal'

  return {
    message: refused
      ? 'Claude ha rifiutato di rispondere a questa richiesta per motivi di sicurezza. Riformulala o cambia argomento.'
      : text,
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
