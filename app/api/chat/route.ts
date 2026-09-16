import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { callClaude, type ClaudeChatMessage } from '@/lib/claude'
import { calculateCostUsd, resolveChatModel } from '@/lib/chat-models'
import {
  ChatAuthError,
  assertWithinLimit,
  getUsageSummary,
  recordUsage,
  requireChatMember,
} from '@/lib/chat-auth'

export const dynamic = 'force-dynamic'

type Attachment = { mimeType: string; data: string }

function errorResponse(error: unknown) {
  if (error instanceof ChatAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  const message = error instanceof Error ? error.message : 'Errore sconosciuto'
  console.error('Chat API error:', message)
  return NextResponse.json({ error: message }, { status: 500 })
}

export async function POST(req: NextRequest) {
  try {
    const member = await requireChatMember(req)
    await assertWithinLimit(member)

    const body = await req.json()
    const content: string = String(body?.content || '').trim()
    const attachments: Attachment[] = Array.isArray(body?.attachments)
      ? body.attachments.filter((a: any) => a?.mimeType && a?.data)
      : []

    if (!content && attachments.length === 0) {
      return NextResponse.json({ error: 'Messaggio vuoto.' }, { status: 400 })
    }

    const model = resolveChatModel(body?.model)
    let chatId: string | null = body?.chatId ? String(body.chatId) : null

    // --- Chat: esistente (e di questo utente) oppure nuova ------------
    let projectId: string | null = body?.projectId ? String(body.projectId) : null

    if (chatId) {
      const { data: chat, error } = await supabaseAdmin
        .from('user_chats')
        .select('id, user_id, project_id')
        .eq('id', chatId)
        .maybeSingle()

      if (error || !chat || chat.user_id !== member.user_id) {
        return NextResponse.json({ error: 'Chat non trovata.' }, { status: 404 })
      }
      projectId = chat.project_id
    } else {
      const title = (content || 'Nuova chat').slice(0, 60)
      const { data: created, error } = await supabaseAdmin
        .from('user_chats')
        .insert({ user_id: member.user_id, project_id: projectId, title, model })
        .select('id')
        .single()

      if (error || !created) {
        return NextResponse.json({ error: 'Impossibile creare la chat.' }, { status: 500 })
      }
      chatId = created.id
    }

    // --- Istruzioni del progetto -------------------------------------
    let projectInstructions: string | null = null
    if (projectId) {
      const { data: project } = await supabaseAdmin
        .from('chat_projects')
        .select('system_instructions, user_id')
        .eq('id', projectId)
        .maybeSingle()

      if (project?.user_id === member.user_id) {
        projectInstructions = project.system_instructions
      }
    }

    // --- Storico dal database, non dal client ------------------------
    const { data: history } = await supabaseAdmin
      .from('user_chat_messages')
      .select('role, content, attachments')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true })

    const { data: savedUserMessage, error: insertError } = await supabaseAdmin
      .from('user_chat_messages')
      .insert({
        chat_id: chatId,
        user_id: member.user_id,
        role: 'user',
        content,
        attachments: attachments.length ? attachments : null,
      })
      .select('id, created_at')
      .single()

    if (insertError || !savedUserMessage) {
      return NextResponse.json({ error: 'Impossibile salvare il messaggio.' }, { status: 500 })
    }

    const conversation: ClaudeChatMessage[] = [
      ...((history || []) as ClaudeChatMessage[]),
      { role: 'user', content, attachments },
    ]

    const result = await callClaude(conversation, model, projectInstructions)

    const { data: savedAssistantMessage } = await supabaseAdmin
      .from('user_chat_messages')
      .insert({
        chat_id: chatId,
        user_id: member.user_id,
        role: 'assistant',
        content: result.message,
      })
      .select('id, created_at')
      .single()

    const costUsd = calculateCostUsd(model, result.usage)
    await recordUsage({
      userId: member.user_id,
      chatId,
      model,
      usage: result.usage,
      costUsd,
    })

    await supabaseAdmin
      .from('user_chats')
      .update({ model, updated_at: new Date().toISOString() })
      .eq('id', chatId)

    const usage = await getUsageSummary(member)

    return NextResponse.json({
      chatId,
      message: {
        id: savedAssistantMessage?.id,
        role: 'assistant',
        content: result.message,
        timestamp: savedAssistantMessage?.created_at,
      },
      userMessageId: savedUserMessage.id,
      model: result.model,
      refused: result.refused,
      usage: {
        costUsd,
        spentUsd: usage.spentUsd,
        limitUsd: usage.limitUsd,
        remainingUsd: usage.remainingUsd,
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
