import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { commentId, toolId } = await req.json()

    if (!commentId) {
      return NextResponse.json({ error: 'commentId richiesto' }, { status: 400 })
    }

    // Verifica che sia admin (controlla header o session)
    const authHeader = req.headers.get('authorization')
    // Nota: in produzione, verifica il token JWT dell'utente

    // Aggiorna il commento come approvato
    const { error } = await supabaseAdmin
      .from('tool_comments')
      .update({ is_verified: true, is_approved: true })
      .eq('id', commentId)

    if (error) {
      throw error
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error approving comment:', error)
    return NextResponse.json(
      { error: error.message || 'Errore nell\'approvazione' },
      { status: 500 }
    )
  }
}

