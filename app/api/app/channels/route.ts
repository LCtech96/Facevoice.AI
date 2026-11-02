import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

// Canali dello spazio di lavoro: stato del collegamento e interruttore dell'automazione.

export async function GET(req: NextRequest) {
  const access = await requireWorkspace(req)
  if (access instanceof NextResponse) return access
  const { data, error } = await access.db
    .from('social_channels')
    .select('id, platform, display_name, handle, status, reply_mode, automation_enabled')
    .order('platform')
  if (error) return NextResponse.json({ error: 'Canali non disponibili, riprova.' }, { status: 500 })
  return NextResponse.json({ channels: data || [] })
}
