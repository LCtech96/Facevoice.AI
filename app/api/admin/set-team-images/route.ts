import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Questa API route permette di impostare manualmente gli URL delle immagini
// Usa il service role key per bypassare RLS
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { images } = body // Array di { memberId, imageUrl, imagePath }

    if (!images || !Array.isArray(images)) {
      return NextResponse.json(
        { error: 'Missing or invalid images array' },
        { status: 400 }
      )
    }

    const results = []

    for (const img of images) {
      const { memberId, imageUrl, imagePath } = img

      if (!memberId || !imageUrl) {
        results.push({ memberId, error: 'Missing memberId or imageUrl' })
        continue
      }

      const { error } = await supabaseAdmin
        .from('team_members')
        .update({
          image_url: imageUrl,
          image_path: imagePath || null,
        })
        .eq('id', memberId)

      if (error) {
        results.push({ memberId, error: error.message })
      } else {
        results.push({ memberId, success: true })
      }
    }

    return NextResponse.json({
      success: true,
      results,
    })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

