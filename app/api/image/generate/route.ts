import { NextRequest, NextResponse } from 'next/server'

const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY || ''

export async function POST(req: NextRequest) {
  try {
    const { prompt, negativePrompt = '', width = 1024, height = 1024 } = await req.json()

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
    }

    if (!HUGGINGFACE_API_KEY) {
      return NextResponse.json(
        { error: 'HUGGINGFACE_API_KEY not configured' },
        { status: 500 }
      )
    }

    // Usa Stable Diffusion XL per migliori risultati
    const model = 'stabilityai/stable-diffusion-xl-base-1.0'
    
    // Prova con l'endpoint inference tradizionale con formato semplificato
    const response = await fetch(
      `https://api-inference.huggingface.co/models/${model}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${HUGGINGFACE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: prompt,
        }),
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      
      // Se il modello sta ancora caricando
      if (response.status === 503) {
        try {
          const error = JSON.parse(errorText)
          return NextResponse.json(
            { 
              error: 'Modello in caricamento, riprova tra qualche secondo',
              estimated_time: error.estimated_time 
            },
            { status: 503 }
          )
        } catch {
          return NextResponse.json(
            { error: 'Modello in caricamento, riprova tra qualche secondo' },
            { status: 503 }
          )
        }
      }
      
      // Se l'endpoint non è più supportato, suggerisci alternative
      if (errorText.includes('no longer supported') || response.status === 404 || response.status === 410) {
        return NextResponse.json(
          { 
            error: 'L\'endpoint Hugging Face per la generazione immagini non è più disponibile. Per favore, configura REPLICATE_API_TOKEN come alternativa, oppure usa un servizio di generazione immagini diverso.',
            suggestion: 'Configura REPLICATE_API_TOKEN nel file .env.local per usare Replicate API come alternativa'
          },
          { status: 503 }
        )
      }
      
      throw new Error(`Hugging Face API error: ${errorText}`)
    }

    // Hugging Face ritorna l'immagine come blob
    const imageBlob = await response.blob()
    
    // Verifica che sia un'immagine valida
    if (!imageBlob.type.startsWith('image/')) {
      throw new Error('Invalid response from Hugging Face API')
    }
    
    // Converti il blob in base64
    const buffer = Buffer.from(await imageBlob.arrayBuffer())
    const base64 = buffer.toString('base64')
    const imageUrl = `data:${imageBlob.type};base64,${base64}`

    return NextResponse.json({
      success: true,
      imageUrl,
      prompt,
    })
  } catch (error: any) {
    console.error('Image generation error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to generate image' },
      { status: 500 }
    )
  }
}
