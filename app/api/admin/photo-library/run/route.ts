import { NextRequest, NextResponse, after } from 'next/server'
import { runPhotoAutopilot } from '@/lib/photo-library'
import { publishScheduledDraft } from '@/lib/social-posts'

export const dynamic = 'force-dynamic'
// Descrizione delle foto, testi, slide e pubblicazione su Instagram: qualche minuto.
export const maxDuration = 300

/** Lavori lunghi avviati dal cron: solo dal server stesso (chiave interna). */
export async function POST(req: NextRequest) {
  const key = (process.env.CRON_SECRET || '').trim()
  if (!key || req.headers.get('x-internal-key') !== key) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  if (body?.task === 'publish' && typeof body.id === 'string') {
    after(() => publishScheduledDraft(body.id).catch((error) => console.error('carosello programmato:', error)))
  } else if (body?.task === 'autopilot' && typeof body.key === 'string') {
    after(() => runPhotoAutopilot(body.key).catch((error) => console.error('autopilota foto:', error)))
  } else {
    return NextResponse.json({ error: 'Lavoro non valido' }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
