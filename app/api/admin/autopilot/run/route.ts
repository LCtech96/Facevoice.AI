import { NextRequest, NextResponse, after } from 'next/server'
import { runRound } from '@/lib/autopilot'

export const dynamic = 'force-dynamic'
// Un giro dell'automazione lavora fino a ~4 minuti dopo la risposta.
export const maxDuration = 300

/** Giro dell'automazione giornaliera: solo dal server stesso (chiave interna). body: { runId } */
export async function POST(req: NextRequest) {
  const key = (process.env.CRON_SECRET || '').trim()
  if (!key || req.headers.get('x-internal-key') !== key) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  if (typeof body?.runId !== 'string') return NextResponse.json({ error: 'runId mancante' }, { status: 400 })
  const origin = req.nextUrl.origin
  after(() => runRound(origin, body.runId))
  return NextResponse.json({ ok: true })
}
