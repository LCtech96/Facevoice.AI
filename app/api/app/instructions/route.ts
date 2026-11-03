import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireWorkspace } from '@/lib/workspace'
import { INSTRUCTION_CHANNELS, readInstructions, type InstructionChannel } from '@/lib/saas/responder'

export const dynamic = 'force-dynamic'

// Istruzioni per l'AI: una generale e una per ogni canale.

export async function GET(req: NextRequest) {
  const access = await requireWorkspace(req)
  if (access instanceof NextResponse) return access
  try {
    return NextResponse.json({ instructions: await readInstructions(access.workspace.id) })
  } catch (error) {
    console.error('instructions read:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Istruzioni non disponibili, riprova.' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const access = await requireWorkspace(req, 'admin')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  const channel = String(body.channel || '') as InstructionChannel
  const content = String(body.content ?? '')
  if (!INSTRUCTION_CHANNELS.includes(channel)) return NextResponse.json({ error: 'Canale non valido' }, { status: 400 })
  if (content.length > 20000) return NextResponse.json({ error: 'Testo troppo lungo (massimo 20.000 caratteri).' }, { status: 400 })
  const { error } = await supabaseAdmin.from('workspace_instructions').upsert({
    workspace_id: access.workspace.id,
    channel,
    content,
    updated_by: access.userId,
    updated_at: new Date().toISOString(),
  })
  if (error) {
    console.error('instructions save:', error.message)
    return NextResponse.json({ error: 'Istruzioni non salvate, riprova.' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
