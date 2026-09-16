import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ChatAuthError, requireChatMember } from '@/lib/chat-auth'

export const dynamic = 'force-dynamic'

function fail(error: unknown) {
  if (error instanceof ChatAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  console.error('Chat API error:', error)
  return NextResponse.json({ error: 'Errore nella chat.' }, { status: 500 })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const member = await requireChatMember(req)
    const { id } = await params
    const body = await req.json()

    const updates: Record<string, unknown> = {}
    if (typeof body?.title === 'string' && body.title.trim()) {
      updates.title = body.title.trim().slice(0, 120)
    }
    if (typeof body?.model === 'string') {
      updates.model = body.model
    }
    // null e' un valore legittimo: toglie la chat da ogni progetto.
    if ('project_id' in (body || {})) {
      updates.project_id = body.project_id ? String(body.project_id) : null
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nessuna modifica richiesta.' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('user_chats')
      .update(updates)
      .eq('id', id)
      .eq('user_id', member.user_id)
      .select('id, title, model, project_id, created_at, updated_at')
      .maybeSingle()

    if (error) throw error
    if (!data) {
      return NextResponse.json({ error: 'Chat non trovata.' }, { status: 404 })
    }

    return NextResponse.json({ chat: data })
  } catch (error) {
    return fail(error)
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const member = await requireChatMember(req)
    const { id } = await params

    const { error } = await supabaseAdmin
      .from('user_chats')
      .delete()
      .eq('id', id)
      .eq('user_id', member.user_id)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) {
    return fail(error)
  }
}
