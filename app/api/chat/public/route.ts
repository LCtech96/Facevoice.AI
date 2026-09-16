import { NextRequest, NextResponse } from 'next/server'
import {
  callGeminiWithFallback,
  getGeminiApiKey,
  resolveGeminiModel,
  type GeminiAttachment,
  type GeminiChatMessage,
} from '@/lib/gemini'
import { buildRealtimeDateTimeInstructions } from '@/lib/current-datetime'

/**
 * Chat pubblica, senza autenticazione, usata dalle chat condivise
 * (/ai-chat/shared/[id]). Gira su Gemini per non consumare credito
 * Anthropic: la chat interna dei dipendenti e' /api/chat, autenticata.
 */
export const dynamic = 'force-dynamic'

function normalizeMessages(messages: unknown[]): GeminiChatMessage[] {
  return messages
    .filter((msg: any) => msg && msg.role && (msg.content || msg.attachments?.length))
    .map((msg: any): GeminiChatMessage => {
      const attachments: GeminiAttachment[] | undefined = Array.isArray(msg.attachments)
        ? msg.attachments
            .filter((item: any) => item?.mimeType && item?.data)
            .map((item: any) => ({
              mimeType: String(item.mimeType),
              data: String(item.data),
            }))
        : undefined

      return {
        role: msg.role === 'user' ? 'user' : msg.role === 'assistant' ? 'assistant' : 'system',
        content: String(msg.content || '').trim(),
        attachments: attachments?.length ? attachments : undefined,
      }
    })
}

export async function POST(req: NextRequest) {
  try {
    const { messages, model } = await req.json()

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'Nessun messaggio ricevuto.' }, { status: 400 })
    }

    const validMessages = normalizeMessages(messages).filter((msg) => msg.role !== 'system')

    if (validMessages.length === 0) {
      return NextResponse.json({ error: 'Nessun messaggio valido.' }, { status: 400 })
    }

    if (!getGeminiApiKey()) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY non configurata.' },
        { status: 500 }
      )
    }

    const systemMessage = `Sei un assistente AI di Facevoice.AI in una chat condivisa fra piu' partecipanti.

${buildRealtimeDateTimeInstructions()}

Rispondi in modo breve e concreto (2-4 frasi), nella lingua di chi scrive. Quando qualcuno invia un'immagine, analizzala con attenzione.`

    const result = await callGeminiWithFallback(
      validMessages,
      resolveGeminiModel(model),
      systemMessage
    )

    return NextResponse.json({
      message: result.message,
      model: result.model,
      usage: result.usage,
    })
  } catch (error: any) {
    console.error('Public chat error:', error?.message)
    return NextResponse.json(
      { error: error?.message || 'Errore nella risposta AI' },
      { status: 500 }
    )
  }
}
