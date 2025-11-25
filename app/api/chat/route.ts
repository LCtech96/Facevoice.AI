import { NextRequest, NextResponse } from 'next/server'
import Groq from 'groq-sdk'
import type { ChatCompletionMessageParam } from 'groq-sdk/resources/chat/completions'

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || '',
})

// Groq model mapping - Updated with currently available models
const GROQ_MODELS: Record<string, string> = {
  'llama-3.1-8b-instant': 'llama-3.1-8b-instant',
  'llama-3.3-70b-versatile': 'llama-3.3-70b-versatile',
  'mixtral-8x7b-32768': 'mixtral-8x7b-32768',
  // Legacy - for backwards compatibility
  'llama-3.1-70b-versatile': 'llama-3.3-70b-versatile', // Redirect to newer version
}

export async function POST(req: NextRequest) {
  let requestBody: any
  try {
    requestBody = await req.json()
    const { messages, model = 'llama-3.1-8b-instant' } = requestBody

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: 'Messages array is required and must not be empty' },
        { status: 400 }
      )
    }

    // Validate messages format
    const validMessages: ChatCompletionMessageParam[] = messages
      .filter((msg: any) => msg && msg.role && msg.content)
      .map((msg: any): ChatCompletionMessageParam => {
        const role = msg.role === 'user' ? 'user' as const : msg.role === 'assistant' ? 'assistant' as const : 'system' as const
        return {
          role,
          content: String(msg.content).trim(),
        } as ChatCompletionMessageParam
      })

    if (validMessages.length === 0) {
      return NextResponse.json(
        { error: 'No valid messages found' },
        { status: 400 }
      )
    }

    // Add system message with current date
    const currentDate = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })

    // Lista degli AI Tools disponibili nel feed
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
- AITryOn: Video di Prodotto per E-commerce

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

    const systemMessage: ChatCompletionMessageParam = {
      role: 'system',
      content: `You are a helpful AI assistant specialized in recommending AI tools. Today's date is ${currentDate}.

IMPORTANT GUIDELINES:
1. Keep responses SHORT and CONCISE (2-4 sentences max). Break longer explanations into multiple messages to keep readers engaged.
2. When users ask for AI tool recommendations, ALWAYS prioritize tools from this list first:
${availableTools}
3. If a user asks about a specific use case, recommend 1-2 relevant tools from the list above that match their needs.
4. Only suggest tools NOT in the list if the user specifically asks for something different or if no tool in the list fits their needs.
5. If no tool in the list fits, ask ONE follow-up question to understand their needs better - don't ask multiple questions at once.
6. Be conversational and friendly, but keep it brief.`,
    }

    // Prepend system message if the first message is not already a system message
    const messagesWithSystem: ChatCompletionMessageParam[] = validMessages[0]?.role === 'system'
      ? validMessages
      : [systemMessage, ...validMessages]

    // Use Groq-compatible model name
    const groqModel = GROQ_MODELS[model] || 'llama-3.1-8b-instant'

    console.log('Sending request to Groq with model:', groqModel, 'Messages count:', messagesWithSystem.length)

    const completion = await groq.chat.completions.create({
      messages: messagesWithSystem,
      model: groqModel,
      temperature: 0.7,
      max_tokens: 4096,
      stream: false,
    })

    const response = completion.choices[0]?.message?.content || ''

    if (!response) {
      console.error('Empty response from Groq API')
      return NextResponse.json(
        { error: 'Empty response from AI' },
        { status: 500 }
      )
    }

    return NextResponse.json({ 
      message: response,
      model: completion.model,
      usage: completion.usage,
    })
  } catch (error: any) {
    console.error('Groq API error details:', {
      message: error.message,
      status: error.status,
      code: error.code,
      stack: error.stack,
    })

    // Extract error message from Groq error response
    let userFriendlyError = error.message || 'Failed to get AI response'
    let isDecommissioned = false
    
    // Try to extract error from response body
    try {
      if (error.body) {
        const errorBody = typeof error.body === 'string' ? JSON.parse(error.body) : error.body
        if (errorBody.error?.message) {
          userFriendlyError = errorBody.error.message
          isDecommissioned = errorBody.error.message.includes('decommissioned')
        }
      }
      // Also check error.response or error.error
      if (error.response) {
        const responseData = typeof error.response === 'string' ? JSON.parse(error.response) : error.response
        if (responseData.error?.message) {
          userFriendlyError = responseData.error.message
          isDecommissioned = responseData.error.message.includes('decommissioned')
        }
      }
      if (error.error?.message) {
        userFriendlyError = error.error.message
        isDecommissioned = error.error.message.includes('decommissioned')
      }
    } catch (e) {
      // Check message directly
      if (error.message?.includes('decommissioned')) {
        isDecommissioned = true
      }
    }

    // Check if it's a model decommissioned error and try fallback
    if ((isDecommissioned || userFriendlyError.includes('decommissioned')) && requestBody) {
      try {
        console.log('Model decommissioned, trying fallback model: llama-3.1-8b-instant')
        const { messages: originalMessages } = requestBody
        const fallbackModel = 'llama-3.1-8b-instant'
        const currentDate = new Date().toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        })
        const systemMessage: ChatCompletionMessageParam = {
          role: 'system',
          content: `You are a helpful AI assistant. Today's date is ${currentDate}. Always provide accurate and up-to-date information based on the current date.`,
        }
        const validMessages: ChatCompletionMessageParam[] = originalMessages
          .filter((msg: any) => msg && msg.role && msg.content)
          .map((msg: any): ChatCompletionMessageParam => {
            const role = msg.role === 'user' ? 'user' as const : msg.role === 'assistant' ? 'assistant' as const : 'system' as const
            return {
              role,
              content: String(msg.content).trim(),
            } as ChatCompletionMessageParam
          })
        const messagesWithSystem: ChatCompletionMessageParam[] = validMessages[0]?.role === 'system'
          ? validMessages
          : [systemMessage, ...validMessages]

        const completion = await groq.chat.completions.create({
          messages: messagesWithSystem,
          model: fallbackModel,
          temperature: 0.7,
          max_tokens: 4096,
          stream: false,
        })

        const response = completion.choices[0]?.message?.content || ''
        if (response) {
          return NextResponse.json({ 
            message: response,
            model: completion.model,
            usage: completion.usage,
          })
        }
      } catch (fallbackError: any) {
        console.error('Fallback model also failed:', fallbackError)
      }
    }

    // Provide more detailed error information
    const errorDetails = error.status ? `Status: ${error.status}` : ''
    
    return NextResponse.json(
      { 
        error: userFriendlyError,
        details: errorDetails,
        type: error.constructor.name,
      },
      { status: error.status || 500 }
    )
  }
}

