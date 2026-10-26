import { NextRequest, NextResponse } from 'next/server'
import { guard } from '@/lib/staff-access'
import { isActive, loadRun, loadSettings, saveSettings, startRun } from '@/lib/autopilot'
import { sentToday } from '@/lib/lead-send'
import { placesKey } from '@/lib/leads'

export const dynamic = 'force-dynamic'

/** Impostazioni e ultima esecuzione dell'automazione giornaliera. */
export async function GET(req: NextRequest) {
  const access = await guard(req, 'leads', 'view')
  if (access instanceof NextResponse) return access
  const [settings, run, sent] = await Promise.all([loadSettings(), loadRun(), sentToday()])
  return NextResponse.json({ settings, run, running: isActive(run), sentToday: sent, placesConfigured: Boolean(placesKey()) })
}

/** Modifica le impostazioni (solo l'admin: l'automazione invia email a suo nome). */
export async function PUT(req: NextRequest) {
  const access = await guard(req, 'leads', 'email')
  if (access instanceof NextResponse) return access
  if (!access.isAdmin) return NextResponse.json({ error: 'Solo l’amministratore può cambiare l’automazione' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  // La posizione nella rotazione la gestisce l'automazione.
  const input = { ...(body || {}) }
  delete input.next
  const settings = await saveSettings(input)
  return NextResponse.json({ settings })
}

/** Avvia subito l'esecuzione (solo l'admin). */
export async function POST(req: NextRequest) {
  const access = await guard(req, 'leads', 'email')
  if (access instanceof NextResponse) return access
  if (!access.isAdmin) return NextResponse.json({ error: 'Solo l’amministratore può avviare l’automazione' }, { status: 403 })
  const result = await startRun(req.nextUrl.origin, true)
  if (result.error) return NextResponse.json({ error: result.error }, { status: 409 })
  return NextResponse.json({ run: result.run, running: true })
}
