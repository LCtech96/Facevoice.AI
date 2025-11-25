import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')

    if (!userId) {
      return NextResponse.json({ isLiked: false })
    }

    // Verifica se l'utente ha già messo like
    const { data, error } = await supabase
      .from('tool_likes')
      .select('id')
      .eq('tool_id', params.id)
      .eq('user_id', userId)
      .single()

    if (error && error.code !== 'PGRST116') {
      console.error('Error checking like:', error)
    }

    return NextResponse.json({ isLiked: !!data })
  } catch (error) {
    console.error('Error in GET /api/tools/[id]/like:', error)
    return NextResponse.json({ isLiked: false }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json()
    const { userId, isLiked } = body

    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 })
    }

    if (isLiked) {
      // Aggiungi like
      const { error } = await supabase
        .from('tool_likes')
        .upsert({
          tool_id: params.id,
          user_id: userId,
          created_at: new Date().toISOString(),
        })

      if (error) {
        console.error('Error adding like:', error)
        return NextResponse.json({ error: 'Failed to add like' }, { status: 500 })
      }
    } else {
      // Rimuovi like
      const { error } = await supabase
        .from('tool_likes')
        .delete()
        .eq('tool_id', params.id)
        .eq('user_id', userId)

      if (error) {
        console.error('Error removing like:', error)
        return NextResponse.json({ error: 'Failed to remove like' }, { status: 500 })
      }
    }

    // Aggiorna contatore likes
    const { count } = await supabase
      .from('tool_likes')
      .select('*', { count: 'exact', head: true })
      .eq('tool_id', params.id)

    await supabase
      .from('ai_tools')
      .update({ likes: count || 0 })
      .eq('id', params.id)

    return NextResponse.json({ success: true, likes: count || 0 })
  } catch (error) {
    console.error('Error in POST /api/tools/[id]/like:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

