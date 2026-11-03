import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireWorkspace } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

// Lingua scelta nella dashboard dello spazio: l'AI la usa per rispondere quando
// dal messaggio ricevuto non si capisce la lingua (es. "test", "ok").

export async function PUT(req: NextRequest) {
  const access = await requireWorkspace(req)
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  const language = body.language === 'en' ? 'en' : 'it'
  const { error } = await supabaseAdmin
    .from('app_settings')
    .upsert({ key: `workspace_lang:${access.workspace.id}`, value: language, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) return NextResponse.json({ error: 'Lingua non salvata' }, { status: 500 })
  return NextResponse.json({ ok: true, language })
}
