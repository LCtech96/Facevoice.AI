import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    const toolId = params.id

    if (!file || !toolId) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Verifica che sia un video
    if (!file.type.startsWith('video/')) {
      return NextResponse.json(
        { error: 'File must be a video' },
        { status: 400 }
      )
    }

    // Limite dimensione video (500MB)
    const maxSize = 500 * 1024 * 1024 // 500MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: 'Video file too large. Maximum size is 500MB' },
        { status: 400 }
      )
    }

    // Converti il file in un buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Genera un nome file unico
    const fileExtension = file.name.split('.').pop() || 'mp4'
    const fileName = `${toolId}/${Date.now()}.${fileExtension}`
    const filePath = `ai-tools-videos/${fileName}`

    // Upload del video nello storage di Supabase
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('ai-tools-videos')
      .upload(filePath, buffer, {
        contentType: file.type,
        upsert: false, // Non sovrascrivere file esistenti
      })

    if (uploadError) {
      console.error('Upload error:', uploadError)
      return NextResponse.json(
        { error: uploadError.message },
        { status: 500 }
      )
    }

    // Ottieni l'URL pubblico del video
    const { data: { publicUrl } } = supabase.storage
      .from('ai-tools-videos')
      .getPublicUrl(filePath)

    // Aggiorna il tool con l'URL del video (se esiste la tabella ai_tools)
    // Per ora restituiamo solo l'URL
    return NextResponse.json({
      success: true,
      videoUrl: publicUrl,
      videoPath: filePath,
    })
  } catch (error: any) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}







