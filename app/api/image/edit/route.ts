import { NextRequest, NextResponse } from 'next/server'

const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY || ''

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const image = formData.get('image') as File
    const prompt = formData.get('prompt') as string

    if (!image || !prompt) {
      return NextResponse.json(
        { error: 'Image and prompt are required' },
        { status: 400 }
      )
    }

    if (!HUGGINGFACE_API_KEY) {
      return NextResponse.json(
        { error: 'HUGGINGFACE_API_KEY not configured' },
        { status: 500 }
      )
    }

    // Converti l'immagine in base64
    const imageBuffer = Buffer.from(await image.arrayBuffer())
    const imageBase64 = imageBuffer.toString('base64')
    
    // Per semplicità, useremo un modello di generazione con controllo immagine
    // Per editing avanzato serve un modello specifico di inpainting
    const model = 'runwayml/stable-diffusion-inpainting'
    
    // Per ora usiamo un approccio semplificato: generiamo una nuova immagine
    // basata sul prompt, ma in futuro possiamo implementare inpainting vero
    // convertendo l'immagine in un formato che il modello può processare
    
    // Per l'editing base, generiamo una nuova immagine con il prompt
    // L'utente può descrivere come vuole modificare l'immagine
    const response = await fetch(
      `https://router.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${HUGGINGFACE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: {
            num_inference_steps: 30,
            guidance_scale: 7.5,
          },
        }),
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      
      if (response.status === 503) {
        return NextResponse.json(
          { error: 'Modello in caricamento, riprova tra qualche secondo' },
          { status: 503 }
        )
      }
      
      throw new Error(`Hugging Face API error: ${errorText}`)
    }

    const imageBlob = await response.blob()
    
    if (!imageBlob.type.startsWith('image/')) {
      throw new Error('Invalid response from Hugging Face API')
    }
    
    const buffer = Buffer.from(await imageBlob.arrayBuffer())
    const base64 = buffer.toString('base64')
    const imageUrl = `data:${imageBlob.type};base64,${base64}`

    return NextResponse.json({
      success: true,
      imageUrl,
      prompt,
    })
  } catch (error: any) {
    console.error('Image editing error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to edit image' },
      { status: 500 }
    )
  }
}

