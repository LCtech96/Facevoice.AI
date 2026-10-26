import { NextRequest, NextResponse } from 'next/server'
import { guard } from '@/lib/staff-access'
import { loadOutreachReplySettings, saveOutreachReplySettings } from '@/lib/outreach-reply'

export const dynamic = 'force-dynamic'

/** Interruttore e strategia delle risposte automatiche ai contatti che abbiamo scritto noi. */
export async function GET(req: NextRequest) {
  const access = await guard(req, 'leads', 'view')
  if (access instanceof NextResponse) return access
  return NextResponse.json({ settings: await loadOutreachReplySettings() })
}

/** Solo l'admin: le risposte partono a suo nome. body: { auto?, strategy? } */
export async function PUT(req: NextRequest) {
  const access = await guard(req, 'leads', 'email')
  if (access instanceof NextResponse) return access
  if (!access.isAdmin) return NextResponse.json({ error: 'Solo l’amministratore può cambiare le risposte automatiche' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  return NextResponse.json({ settings: await saveOutreachReplySettings({ auto: body?.auto, strategy: body?.strategy }) })
}
