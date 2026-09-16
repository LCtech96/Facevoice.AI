import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ChatAuthError, requireChatMember } from '@/lib/chat-auth'

export const dynamic = 'force-dynamic'

const PROJECT_FIELDS = 'id, name, color, system_instructions, created_at, updated_at'

function fail(error: unknown) {
  if (error instanceof ChatAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  console.error('Projects API error:', error)
  return NextResponse.json({ error: 'Errore nei progetti.' }, { status: 500 })
}

export async function GET(req: NextRequest) {
  try {
    const member = await requireChatMember(req)
    const { data, error } = await supabaseAdmin
      .from('chat_projects')
      .select(PROJECT_FIELDS)
      .eq('user_id', member.user_id)
      .order('created_at', { ascending: true })

    if (error) throw error
    return NextResponse.json({ projects: data || [] })
  } catch (error) {
    return fail(error)
  }
}

export async function POST(req: NextRequest) {
  try {
    const member = await requireChatMember(req)
    const body = await req.json()
    const name = String(body?.name || '').trim()

    if (!name) {
      return NextResponse.json({ error: 'Serve un nome per il progetto.' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('chat_projects')
      .insert({
        user_id: member.user_id,
        name,
        color: String(body?.color || '#3b82f6'),
        system_instructions: body?.system_instructions
          ? String(body.system_instructions)
          : null,
      })
      .select(PROJECT_FIELDS)
      .single()

    if (error) throw error
    return NextResponse.json({ project: data })
  } catch (error) {
    return fail(error)
  }
}
