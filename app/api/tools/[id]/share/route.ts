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
    // Registra condivisione
    const { error } = await supabase
      .from('tool_shares')
      .insert({
        tool_id: id,
        created_at: new Date().toISOString(),
      })

    if (error) {
      console.error('Error recording share:', error)
      // Non fallire se c'è un errore, è solo tracking
    }

    // Aggiorna contatore condivisioni
    const { count } = await supabase
      .from('tool_shares')
      .select('*', { count: 'exact', head: true })
      .eq('tool_id', id)

    await supabase
      .from('ai_tools')
      .update({ shares: count || 0 })
      .eq('id', id)

    return NextResponse.json({ success: true, shares: count || 0 })
  } catch (error) {
    console.error('Error in POST /api/tools/[id]/share:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}










