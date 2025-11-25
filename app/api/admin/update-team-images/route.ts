import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export async function POST(request: NextRequest) {
  try {
    const { memberId, imageUrl, imagePath } = await request.json()

    if (!memberId || !imageUrl) {
      return NextResponse.json(
        { error: 'Missing required fields: memberId and imageUrl' },
        { status: 400 }
      )
    }

    // Usa il client admin per bypassare RLS
    const { error } = await supabaseAdmin
      .from('team_members')
      .update({
        image_url: imageUrl,
        image_path: imagePath || null,
      })
      .eq('id', memberId)

    if (error) {
      console.error('Update error:', error)
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

