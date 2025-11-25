import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    const memberId = formData.get('memberId') as string
    const fileName = formData.get('fileName') as string

    if (!file || !memberId || !fileName) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Converti il file in un buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Upload del file nello storage di Supabase
    const filePath = `${memberId}/${fileName}`
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('team-photos')
      .upload(filePath, buffer, {
        contentType: file.type,
        upsert: true,
      })

    if (uploadError) {
      console.error('Upload error:', uploadError)
      return NextResponse.json(
        { error: uploadError.message },
        { status: 500 }
      )
    }

    // Ottieni l'URL pubblico dell'immagine
    const { data: { publicUrl } } = supabase.storage
      .from('team-photos')
      .getPublicUrl(filePath)

    // Aggiorna il membro del team con l'URL dell'immagine
    const { error: updateError } = await supabase
      .from('team_members')
      .update({
        image_url: publicUrl,
        image_path: filePath,
      })
      .eq('id', parseInt(memberId))

    if (updateError) {
      console.error('Update error:', updateError)
      return NextResponse.json(
        { error: updateError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      imageUrl: publicUrl,
      imagePath: filePath,
    })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

