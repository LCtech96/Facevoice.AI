import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ChatAuthError, requireChatMember } from '@/lib/chat-auth'

export const dynamic = 'force-dynamic'

const PROJECT_FIELDS = 'id, name, color, system_instructions, created_at, updated_at'

function fail(error: unknown) {
  if (error instanceof ChatAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  console.error('Project API error:', error)
  return NextResponse.json({ error: 'Errore nel progetto.' }, { status: 500 })
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
    if (typeof body?.name === 'string' && body.name.trim()) {
      updates.name = body.name.trim()
    }
    if (typeof body?.color === 'string') {
      updates.color = body.color
    }
    if ('system_instructions' in (body || {})) {
      const value = String(body.system_instructions || '').trim()
      updates.system_instructions = value || null
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nessuna modifica richiesta.' }, { status: 400 })
    }

    // Il filtro su user_id e' la garanzia che non si possa modificare
    // il progetto di un altro passando il suo id.
    const { data, error } = await supabaseAdmin
      .from('chat_projects')
      .update(updates)
      .eq('id', id)
      .eq('user_id', member.user_id)
      .select(PROJECT_FIELDS)
      .maybeSingle()

    if (error) throw error
    if (!data) {
      return NextResponse.json({ error: 'Progetto non trovato.' }, { status: 404 })
    }

    return NextResponse.json({ project: data })
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

    // Le chat non vengono cancellate: il vincolo e' ON DELETE SET NULL,
    // quindi tornano semplicemente fuori da ogni progetto.
    const { error } = await supabaseAdmin
      .from('chat_projects')
      .delete()
      .eq('id', id)
      .eq('user_id', member.user_id)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error) {
    return fail(error)
  }
}
