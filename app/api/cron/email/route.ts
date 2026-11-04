import { NextRequest, NextResponse } from 'next/server'
import { pollGmail } from '@/lib/gmail-poll'
import { SCOPES, loadState } from '@/lib/assistant-state'
import { resumeOrClose } from '@/lib/assistant-launch'
import { autopilotTick } from '@/lib/autopilot'
import { blogAutoTick } from '@/lib/blog-auto'
import { sendDueOutreachReplies } from '@/lib/outreach-reply'
import { syncAllWorkspaces } from '@/lib/saas/sync'
import { renewInstagramTokens } from '@/lib/saas/instagram'
import { publishDuePosts } from '@/lib/saas/posts'

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
    blogAutoTick(req.nextUrl.origin).catch((error) => console.error('blog auto:', error)),
    // Caselle email dei clienti del SaaS.
    syncAllWorkspaces(4).catch((error) => console.error('saas sync:', error)),
    // Post programmati dei clienti del SaaS.
    publishDuePosts().catch((error) => console.error('saas post programmati:', error)),
    // Token di 60 giorni degli Instagram collegati con l'accesso di Instagram.
    renewInstagramTokens().catch((error) => console.error('instagram renew:', error)),
    sendDueOutreachReplies().catch((error) => console.error('outreach replies:', error)),
    ...SCOPES.map(async (scope) => resumeOrClose(req.nextUrl.origin, scope, await loadState(scope)).catch((error) => console.error('assistant resume:', error))),
  ])
  return NextResponse.json(await pollGmail())
}
