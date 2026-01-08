import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const { comment, userEmail, userName } = await request.json()

    if (!comment || !comment.trim()) {
      return NextResponse.json({ error: 'Commento obbligatorio' }, { status: 400 })
    }

    if (!userEmail || !userEmail.trim()) {
      return NextResponse.json({ error: 'Email obbligatoria' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('case_study_comments')
      .insert({
        case_study_id: id,
        user_name: userName || userEmail.split('@')[0] || 'Guest',
        user_email: userEmail.trim().toLowerCase(),
        comment: comment.trim(),
        is_approved: false,
      })
      .select()
      .single()

    if (error) {
      throw error
    }

    return NextResponse.json({ success: true, comment: data })
  } catch (error: any) {
    console.error('Error adding comment:', error)
    return NextResponse.json(
      { error: error.message || 'Errore nel salvare il commento' },
      { status: 500 }
    )
  }
}

