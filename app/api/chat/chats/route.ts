import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ChatAuthError, getUsageSummary, requireChatMember } from '@/lib/chat-auth'

export const dynamic = 'force-dynamic'

function fail(error: unknown) {
  if (error instanceof ChatAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  console.error('Chats API error:', error)
  return NextResponse.json({ error: 'Errore nelle chat.' }, { status: 500 })
}

/**
 * Carico iniziale della pagina: chat con i messaggi, progetti, e stato
 * del consumo. Una sola chiamata invece di tre.
 */
export async function GET(req: NextRequest) {
  try {
    const member = await requireChatMember(req)

    const [chatsResult, messagesResult, projectsResult, usage] = await Promise.all([
      supabaseAdmin
        .from('user_chats')
        .select('id, title, model, project_id, created_at, updated_at')
        .eq('user_id', member.user_id)
        .order('updated_at', { ascending: false }),
      supabaseAdmin
        .from('user_chat_messages')
        .select('id, chat_id, role, content, attachments, created_at')
        .eq('user_id', member.user_id)
        .order('created_at', { ascending: true }),
      supabaseAdmin
        .from('chat_projects')
        .select('id, name, color, system_instructions, created_at, updated_at')
        .eq('user_id', member.user_id)
        .order('created_at', { ascending: true }),
      getUsageSummary(member),
    ])

    if (chatsResult.error) throw chatsResult.error
    if (messagesResult.error) throw messagesResult.error
    if (projectsResult.error) throw projectsResult.error

    const messagesByChat = new Map<string, any[]>()
    for (const message of messagesResult.data || []) {
      const list = messagesByChat.get(message.chat_id) || []
      list.push(message)
      messagesByChat.set(message.chat_id, list)
    }

    const chats = (chatsResult.data || []).map((chat) => ({
      ...chat,
      messages: messagesByChat.get(chat.id) || [],
    }))

    return NextResponse.json({
      chats,
      projects: projectsResult.data || [],
      member: {
        role: member.role,
        email: member.email,
        display_name: member.display_name,
      },
      usage,
    })
  } catch (error) {
    return fail(error)
  }
}
