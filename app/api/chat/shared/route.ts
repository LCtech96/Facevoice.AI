import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Crea una nuova chat condivisa
export async function POST(req: NextRequest) {
  try {
    const { title, model, createdBy } = await req.json()

    const { data: chat, error } = await supabase
      .from('shared_chats')
      .insert({
        title: title || 'Shared Chat',
        model: model || 'llama-3.1-8b-instant',
        created_by: createdBy || 'anonymous',
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating shared chat:', error)
      return NextResponse.json(
        { error: error.message || 'Failed to create shared chat' },
        { status: 500 }
      )
    }

    // Ottieni l'URL base dalla richiesta o dalla variabile d'ambiente
    const getBaseUrl = () => {
      // In produzione, usa la variabile d'ambiente o l'header della richiesta
      if (process.env.NEXT_PUBLIC_BASE_URL) {
        return process.env.NEXT_PUBLIC_BASE_URL
      }
      // Se non c'è la variabile d'ambiente, prova a costruire l'URL dall'header
      const host = req.headers.get('host')
      const protocol = req.headers.get('x-forwarded-proto') || 'https'
      if (host) {
        return `${protocol}://${host}`
      }
      // Fallback per sviluppo locale
      return 'http://localhost:3000'
    }
    
    const shareLink = `${getBaseUrl()}/ai-chat/shared/${chat.id}`

    return NextResponse.json({
      success: true,
      chat: {
        ...chat,
        shareLink,
      },
    })
  } catch (error: any) {
    console.error('Error in POST /api/chat/shared:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

// Ottieni una chat condivisa e i suoi messaggi
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const chatId = searchParams.get('id')

    if (!chatId) {
      return NextResponse.json(
        { error: 'Chat ID is required' },
        { status: 400 }
      )
    }

    // Ottieni la chat
    const { data: chat, error: chatError } = await supabase
      .from('shared_chats')
      .select('*')
      .eq('id', chatId)
      .single()

    if (chatError || !chat) {
      return NextResponse.json(
        { error: 'Chat not found' },
        { status: 404 }
      )
    }

    // Ottieni i messaggi
    const { data: messages, error: messagesError } = await supabase
      .from('shared_chat_messages')
      .select('*')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true })

    if (messagesError) {
      console.error('Error fetching messages:', messagesError)
    }

    return NextResponse.json({
      success: true,
      chat: {
        ...chat,
        messages: messages || [],
      },
    })
  } catch (error: any) {
    console.error('Error in GET /api/chat/shared:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

