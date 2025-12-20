import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Usa SERVICE_ROLE_KEY per bypassare RLS e permettere lettura pubblica
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    console.log('Fetching comments for tool:', id)
    
    const { data, error } = await supabase
      .from('tool_comments')
      .select('id, user_id, user_name, comment, created_at')
      .eq('tool_id', id)
      .eq('is_verified', true) // Mostra solo commenti verificati
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      console.error('Error fetching comments:', error)
      console.error('Error details:', JSON.stringify(error, null, 2))
      // Restituisci array vuoto invece di errore per non bloccare l'UI
      return NextResponse.json({ comments: [] })
    }

    console.log(`Found ${data?.length || 0} verified comments for tool ${id}`)
    
    return NextResponse.json({ comments: data || [] })
  } catch (error) {
    console.error('Error in GET /api/tools/[id]/comments:', error)
    return NextResponse.json({ comments: [] }, { status: 500 })
  }
}

