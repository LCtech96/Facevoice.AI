import { NextRequest, NextResponse } from 'next/server'
import { generateGeminiImage, getGeminiApiKey } from '@/lib/gemini'

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

    if (!getGeminiApiKey()) {
      return NextResponse.json(
        { error: 'Gemini API key not configured.' },
        { status: 500 }
      )
    }

    const imageBuffer = Buffer.from(await image.arrayBuffer())
    const imageBase64 = imageBuffer.toString('base64')

    const result = await generateGeminiImage(
      `Modifica o ricrea questa immagine seguendo le istruzioni: ${prompt}`,
      {
        mimeType: image.type || 'image/png',
        data: imageBase64,
      }
    )

    return NextResponse.json({
      success: true,
      imageUrl: result.imageUrl,
      prompt,
      model: result.model,
      provider: 'gemini',
    })
  } catch (error: any) {
    console.error('Image edit error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to edit image' },
      { status: 500 }
    )
  }
}
