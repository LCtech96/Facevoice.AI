import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'
import { syncWorkspace } from '@/lib/saas/sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Omnichat aperta: legge subito le caselle collegate (in produzione lo fa anche
// il cron ogni minuto). Al massimo una lettura ogni 45 secondi per casella.

export async function POST(req: NextRequest) {
  const access = await requireWorkspace(req)
  if (access instanceof NextResponse) return access
  const force = req.nextUrl.searchParams.get('force') === '1'
  try {
    return NextResponse.json(await syncWorkspace(access.workspace.id, { force }))
  } catch (error) {
    console.error('app sync:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Aggiornamento non riuscito, riprova.' }, { status: 500 })
  }
}
