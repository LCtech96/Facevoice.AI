import { NextRequest, NextResponse } from 'next/server'
import { generateGeminiImage, getGeminiApiKey } from '@/lib/gemini'

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || ''
const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY || ''

async function generateWithReplicate(prompt: string) {
  const createResponse = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      Authorization: `Token ${REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version: '39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b',
      input: {
        prompt,
        negative_prompt: 'blurry, low quality, distorted, bad anatomy',
        width: 1024,
        height: 1024,
        num_inference_steps: 30,
        guidance_scale: 7.5,
      },
    }),
  })

  if (!createResponse.ok) {
    const error = await createResponse.json()
    throw new Error(error.detail || 'Failed to create prediction')
  }

  let result = await createResponse.json()
  let attempts = 0

  while ((result.status === 'starting' || result.status === 'processing') && attempts < 60) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    const statusResponse = await fetch(`https://api.replicate.com/v1/predictions/${result.id}`, {
      headers: { Authorization: `Token ${REPLICATE_API_TOKEN}` },
    })

    if (!statusResponse.ok) {
      throw new Error('Failed to check prediction status')
    }

    result = await statusResponse.json()
    attempts++
  }

  if (result.status === 'succeeded' && result.output?.[0]) {
    const imageResponse = await fetch(result.output[0])
    const imageBlob = await imageResponse.blob()
    const buffer = Buffer.from(await imageBlob.arrayBuffer())
    return `data:${imageBlob.type};base64,${buffer.toString('base64')}`
  }

  throw new Error(result.error || 'Prediction failed or timed out')
}

async function generateWithHuggingFace(prompt: string) {
  const response = await fetch(
    'https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${HUGGINGFACE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inputs: prompt }),
    }
  )

  if (!response.ok) {
    throw new Error('Hugging Face image generation failed')
  }

  const imageBlob = await response.blob()
  if (!imageBlob.type.startsWith('image/')) {
    throw new Error('Invalid image response from Hugging Face')
  }

  const buffer = Buffer.from(await imageBlob.arrayBuffer())
  return `data:${imageBlob.type};base64,${buffer.toString('base64')}`
}

export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json()

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 })
    }

    if (getGeminiApiKey()) {
      try {
        const result = await generateGeminiImage(prompt)
        return NextResponse.json({
          success: true,
          imageUrl: result.imageUrl,
          prompt,
          model: result.model,
          provider: 'gemini',
        })
      } catch (geminiError: any) {
        console.warn('Gemini image generation failed, trying fallback:', geminiError.message)
      }
    }

    if (REPLICATE_API_TOKEN) {
      try {
        const imageUrl = await generateWithReplicate(prompt)
        return NextResponse.json({
          success: true,
          imageUrl,
          prompt,
          provider: 'replicate',
        })
      } catch (replicateError) {
        console.warn('Replicate fallback failed:', replicateError)
      }
    }

    if (HUGGINGFACE_API_KEY) {
      try {
        const imageUrl = await generateWithHuggingFace(prompt)
        return NextResponse.json({
          success: true,
          imageUrl,
          prompt,
          provider: 'huggingface',
        })
      } catch (hfError) {
        console.warn('Hugging Face fallback failed:', hfError)
      }
    }

    return NextResponse.json(
      {
        error:
          'Generazione immagini non disponibile. Verifica GEMINI_API_KEY o i limiti del piano gratuito.',
      },
      { status: 503 }
    )
  } catch (error: any) {
    console.error('Image generation error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to generate image' },
      { status: 500 }
    )
  }
}
