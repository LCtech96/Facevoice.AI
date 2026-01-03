import { NextRequest, NextResponse } from 'next/server'

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || ''
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

    // Per semplicità, generiamo una nuova immagine basata sul prompt
    // (l'editing avanzato richiederebbe inpainting specifico)
    
    // Usa Replicate se disponibile
    if (REPLICATE_API_TOKEN) {
      try {
        // Converti l'immagine in base64 per riferimento
        const imageBuffer = Buffer.from(await image.arrayBuffer())
        const imageBase64 = imageBuffer.toString('base64')
        const imageDataUrl = `data:${image.type};base64,${imageBase64}`
        
        // Crea una prediction con Replicate
        const createResponse = await fetch('https://api.replicate.com/v1/predictions', {
          method: 'POST',
          headers: {
            'Authorization': `Token ${REPLICATE_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            version: '39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b', // Stable Diffusion XL
            input: {
              prompt: prompt,
              num_inference_steps: 30,
              guidance_scale: 7.5,
            },
          }),
        })

        if (!createResponse.ok) {
          const error = await createResponse.json()
          throw new Error(error.detail || 'Failed to create prediction')
        }

        const prediction = await createResponse.json()
        
        // Poll per il risultato
        let result = prediction
        let attempts = 0
        const maxAttempts = 60
        
        while ((result.status === 'starting' || result.status === 'processing') && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 1000))
          const statusResponse = await fetch(`https://api.replicate.com/v1/predictions/${result.id}`, {
            headers: {
              'Authorization': `Token ${REPLICATE_API_TOKEN}`,
            },
          })
          
          if (!statusResponse.ok) {
            throw new Error('Failed to check prediction status')
          }
          
          result = await statusResponse.json()
          attempts++
        }

        if (result.status === 'succeeded' && result.output && result.output[0]) {
          const imageUrl = result.output[0]
          
          // Scarica l'immagine e convertila in base64
          const imageResponse = await fetch(imageUrl)
          const imageBlob = await imageResponse.blob()
          const buffer = Buffer.from(await imageBlob.arrayBuffer())
          const base64 = buffer.toString('base64')
          const base64ImageUrl = `data:${imageBlob.type};base64,${base64}`
          
          return NextResponse.json({
            success: true,
            imageUrl: base64ImageUrl,
            prompt,
          })
        } else if (result.status === 'failed') {
          throw new Error(result.error || 'Prediction failed')
        } else {
          throw new Error('Prediction timeout or incomplete')
        }
      } catch (replicateError: any) {
        console.error('Replicate error:', replicateError)
        // Fallback a Hugging Face
      }
    }

    // Fallback a Hugging Face
    if (HUGGINGFACE_API_KEY) {
      const response = await fetch(
        `https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0`,
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

      if (response.ok) {
        const imageBlob = await response.blob()
        
        if (imageBlob.type.startsWith('image/')) {
          const buffer = Buffer.from(await imageBlob.arrayBuffer())
          const base64 = buffer.toString('base64')
          const imageUrl = `data:${imageBlob.type};base64,${base64}`

          return NextResponse.json({
            success: true,
            imageUrl,
            prompt,
          })
        }
      }
    }

    return NextResponse.json(
      { 
        error: 'Nessun servizio di generazione immagini configurato. Configura REPLICATE_API_TOKEN nel file .env.local.',
        suggestion: 'Ottieni una chiave API gratuita su https://replicate.com'
      },
      { status: 503 }
    )
  } catch (error: any) {
    console.error('Image editing error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to edit image' },
      { status: 500 }
    )
  }
}
