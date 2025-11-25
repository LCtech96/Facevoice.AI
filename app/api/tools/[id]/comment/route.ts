import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json()
    const { userId, comment, userName } = body

    if (!comment || !comment.trim()) {
      return NextResponse.json({ error: 'Comment is required' }, { status: 400 })
    }

    // Permetti commenti anonimi - genera un ID temporaneo se non fornito
    const finalUserId = userId || `anon_${Date.now()}_${Math.random().toString(36).substring(7)}`
    const finalUserName = userName || (userId ? userId.substring(0, 8) : 'Guest') || 'Guest'

    // Aggiungi commento
    const { data, error } = await supabase
      .from('tool_comments')
      .insert({
        tool_id: params.id,
        user_id: finalUserId,
        user_name: finalUserName,
        comment: comment.trim(),
        created_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) {
      console.error('Error adding comment:', error)
      return NextResponse.json({ error: 'Failed to add comment' }, { status: 500 })
    }

    // Aggiorna contatore commenti
    const { count } = await supabase
      .from('tool_comments')
      .select('*', { count: 'exact', head: true })
      .eq('tool_id', params.id)

    await supabase
      .from('ai_tools')
      .update({ comments: count || 0 })
      .eq('id', params.id)

    return NextResponse.json({ 
      success: true, 
      comment: data,
      comments: count || 0 
    })
  } catch (error) {
    console.error('Error in POST /api/tools/[id]/comment:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

