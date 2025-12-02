import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Aggiungi un messaggio a una chat condivisa
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json()
    const { role, content, userId, userName } = body
    const chatId = params.id

    if (!role || !content) {
      return NextResponse.json(
        { error: 'Role and content are required' },
        { status: 400 }
      )
    }

    if (role !== 'user' && role !== 'assistant' && role !== 'system') {
      return NextResponse.json(
        { error: 'Invalid role. Must be user, assistant, or system' },
        { status: 400 }
      )
    }

    // Inserisci il messaggio
    const { data: message, error } = await supabase
      .from('shared_chat_messages')
      .insert({
        chat_id: chatId,
        role,
        content: content.trim(),
        user_id: userId || null,
        user_name: userName || null,
      })
      .select()
      .single()

    if (error) {
      console.error('Error adding message:', error)
      return NextResponse.json(
        { error: error.message || 'Failed to add message' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message,
    })
  } catch (error: any) {
    console.error('Error in POST /api/chat/shared/[id]/message:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}







