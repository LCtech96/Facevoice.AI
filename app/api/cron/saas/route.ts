import { createHmac, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse, after } from 'next/server'
import { syncAllWorkspaces } from '@/lib/saas/sync'
import { renewInstagramTokens } from '@/lib/saas/instagram'
import { publishDuePosts } from '@/lib/saas/posts'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Lavori periodici della piattaforma clienti: post programmati, caselle email,
// rinnovo degli accessi Instagram. Le anteprime non hanno il cron di Vercel:
// il sito vero, a ogni minuto, chiama questo indirizzo con una firma fatta con
// la chiave dell'app Meta (uguale nei due ambienti), valida 5 minuti.

function authorized(req: NextRequest): boolean {
  const cron = process.env.CRON_SECRET?.trim()
  if (cron && req.headers.get('authorization') === `Bearer ${cron}`) return true
  const secret = process.env.META_APP_SECRET?.trim()
  const [ts, mac] = (req.headers.get('x-saas-cron') || '').split('.')
  if (!secret || !ts || !mac || Math.abs(Date.now() - Number(ts)) > 5 * 60_000) return false
  const expected = Buffer.from(createHmac('sha256', secret).update(`saas-cron:${ts}`).digest('hex'))
  const received = Buffer.from(mac)
  return expected.length === received.length && timingSafeEqual(expected, received)
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  // Risposta subito (chi chiama non aspetta): il lavoro prosegue dopo.
  after(async () => {
    const [posts, mail, renewed] = await Promise.all([
      publishDuePosts().catch((error) => (console.error('saas cron post:', error), 0)),
      syncAllWorkspaces(4).catch((error) => (console.error('saas cron email:', error), null)),
      renewInstagramTokens().catch((error) => (console.error('saas cron instagram:', error), 0)),
    ])
    if (posts || renewed || mail?.inserted) console.log(`saas cron: ${posts} post, ${mail?.inserted ?? 0} email nuove, ${renewed} accessi rinnovati`)
  })
  return NextResponse.json({ ok: true })
}
