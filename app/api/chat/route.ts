import { NextRequest, NextResponse } from 'next/server'
import { DEFAULT_CHAT_MODEL, resolveChatModel } from '@/lib/chat-models'
import {
  callGeminiWithFallback,
  getGeminiApiKey,
  type GeminiAttachment,
  type GeminiChatMessage,
} from '@/lib/gemini'

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
        role:
          msg.role === 'user'
            ? 'user'
            : msg.role === 'assistant'
              ? 'assistant'
              : 'system',
        content: String(msg.content || '').trim(),
        attachments: attachments?.length ? attachments : undefined,
      }
    })
}

export async function POST(req: NextRequest) {
  try {
    const requestBody = await req.json()
    const { messages, model = DEFAULT_CHAT_MODEL } = requestBody

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: 'Messages array is required and must not be empty' },
        { status: 400 }
      )
    }

    const validMessages = normalizeMessages(messages)

    if (validMessages.length === 0) {
      return NextResponse.json(
        { error: 'No valid messages found' },
        { status: 400 }
      )
    }

    if (!getGeminiApiKey()) {
      return NextResponse.json(
        {
          error:
            'Gemini API key not configured. Please set GEMINI_API_KEY or GOOGLE_API_KEY environment variable.',
        },
        { status: 500 }
      )
    }

    const currentDate = 'Saturday, January 17, 2026'

    const availableTools = `
VIDEO & STILE:
- Higgsfield: Video e Generazione Stile con estensione Chrome
- Runway: Generazione Video (Gen-3) e VFX
- DomoAI: Generazione Video e Animazione tramite Discord
- Synthesia: Avatar Parlanti e Video Aziendali
- Pika Labs: Generazione Video da Testo/Immagine
- Google Veo: Generazione Video avanzata
- Kling AI: Generazione Video avanzata
- Descript: Editor Video Basato su Testo
- OpusClip: Clip Brevi e Riutilizzo Contenuti
- Muapi.ai: API per Effetti Video

IMMAGINI & GRAFICA:
- Midjourney: Generazione di Immagini artistiche
- DALL·E 3: Generazione Immagini da OpenAI
- Canva (Magic Studio): Suite di Design AI
- Adobe Sensei: AI in Creative Cloud
- Nano Banana (Google): Editing Immagini avanzato
- OpenArt: Piattaforma per Modelli AI di Immagini
- Khroma: Generatore di Palette Colori AI
- Deep Art Effects: Trasformazione Immagini in Arte
- Jasper Art: Generazione Immagini per Marketing
- VREE Labs: Modellazione 3D da Immagini 2D

UX/UI & PROtotipazione:
- Figma AI (Plugins): Assistenti di Design e Wireframe
- Uizard: Prototipazione Rapida e Autodesigner
- Visily: Wireframing e Design Rapido AI
- UXPin: Prototipazione e Test di Accessibilità
- UX Pilot: Flusso di Lavoro UX e Color Palette AI

CONTENUTI & PRODUTTIVITÀ:
- ChatGPT / Gemini (Flash): Generazione Testo e Brainstorming
- Wordtune: Riscrittura e Miglioramento Contenuti
- Fireflies.ai: Trascrizione e Sintesi Riunioni
- Otter AI: Trascrizione e Sottotitoli
- ElevenLabs: Sintesi Vocale e Clonazione Vocale
- Creatio: Piattaforma No-Code per Flussi di Lavoro
`

    const systemMessage = `You are a helpful AI assistant specialized in recommending AI tools. Today's date is ${currentDate}.

IMPORTANT GUIDELINES:
1. Keep responses SHORT and CONCISE (2-4 sentences max). Break longer explanations into multiple messages to keep readers engaged.
2. When users ask for AI tool recommendations, ALWAYS prioritize tools from this list first:
${availableTools}
3. If a user asks about a specific use case, recommend 1-2 relevant tools from the list above that match their needs.
4. Only suggest tools NOT in the list if the user specifically asks for something different or if no tool in the list fits their needs.
5. If no tool in the list fits, ask ONE follow-up question to understand their needs better - don't ask multiple questions at once.
6. Be conversational and friendly, but keep it brief.
7. When the user sends images, analyze them carefully and answer in Italian unless they write in another language.`

    const userMessages = validMessages.filter((msg) => msg.role !== 'system')
    const geminiModel = resolveChatModel(model)

    console.log(
      'Sending request to Gemini with model:',
      geminiModel,
      'Messages count:',
      userMessages.length
    )

    const result = await callGeminiWithFallback(userMessages, geminiModel, systemMessage)

    return NextResponse.json({
      message: result.message,
      model: result.model,
      usage: result.usage,
    })
  } catch (error: any) {
    console.error('Gemini API error:', {
      message: error.message,
      stack: error.stack,
    })

    return NextResponse.json(
      {
        error: error.message || 'Failed to get AI response',
        type: error.constructor?.name,
      },
      { status: 500 }
    )
  }
}
