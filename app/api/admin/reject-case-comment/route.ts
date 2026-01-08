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

    const { error } = await supabaseAdmin
      .from('case_study_comments')
      .delete()
      .eq('id', commentId)

    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Errore' }, { status: 500 })
  }
}

