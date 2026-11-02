import { NextRequest, NextResponse, after } from 'next/server'
import { runBlogAuto } from '@/lib/blog-auto'

export const dynamic = 'force-dynamic'
// Lettura delle fonti e scrittura dell'articolo: fino a un paio di minuti.
export const maxDuration = 300

/** Generazione dell'articolo: solo dal server stesso (chiave interna). */
export async function POST(req: NextRequest) {
  const key = (process.env.CRON_SECRET || '').trim()
  if (!key || req.headers.get('x-internal-key') !== key) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  after(() => runBlogAuto(body?.manual === true))
  return NextResponse.json({ ok: true })
}
