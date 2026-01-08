import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { commentId } = await req.json()

    if (!commentId) {
      return NextResponse.json({ error: 'commentId richiesto' }, { status: 400 })
    }

    // Elimina il commento rifiutato
    const { error } = await supabaseAdmin
      .from('tool_comments')
      .delete()
      .eq('id', commentId)

    if (error) {
      throw error
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error rejecting comment:', error)
    return NextResponse.json(
      { error: error.message || 'Errore nel rifiutare il commento' },
      { status: 500 }
    )
  }
}

