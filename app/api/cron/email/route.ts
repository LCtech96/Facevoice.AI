import { NextRequest, NextResponse } from 'next/server'
import { pollGmail } from '@/lib/gmail-poll'
import { SCOPES, loadState } from '@/lib/assistant-state'
import { resumeOrClose } from '@/lib/assistant-launch'
import { autopilotTick } from '@/lib/autopilot'
import { sendDueOutreachReplies } from '@/lib/outreach-reply'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Cron Vercel (vedi vercel.json): legge le nuove email ogni minuto e fa ripartire
 * i lavori della super chat rimasti fermi, anche se nessuno ha la pagina aperta;
 * all'ora scelta avvia l'automazione giornaliera del Motore clienti e invia le
 * controrisposte automatiche programmate.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }
  await Promise.all([
    autopilotTick(req.nextUrl.origin).catch((error) => console.error('autopilot:', error)),
    sendDueOutreachReplies().catch((error) => console.error('outreach replies:', error)),
    ...SCOPES.map(async (scope) => resumeOrClose(req.nextUrl.origin, scope, await loadState(scope)).catch((error) => console.error('assistant resume:', error))),
  ])
  return NextResponse.json(await pollGmail())
}
