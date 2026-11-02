import { NextRequest, NextResponse } from 'next/server'
import { getStaffAccess } from '@/lib/staff-access'
import { loadBlogAutoSettings, loadBlogAutoState, requestBlogRun, saveBlogAutoSettings } from '@/lib/blog-auto'

export const dynamic = 'force-dynamic'

/** Solo l'amministratore: l'articolo esce a nome di Facevoice AI. */
async function admin(req: NextRequest) {
  const access = await getStaffAccess(req)
  return access?.isAdmin ? access : null
}

export async function GET(req: NextRequest) {
  if (!(await admin(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const [settings, state] = await Promise.all([loadBlogAutoSettings(), loadBlogAutoState()])
  return NextResponse.json({ settings, state })
}

export async function PUT(req: NextRequest) {
  if (!(await admin(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  return NextResponse.json({ settings: await saveBlogAutoSettings(body || {}) })
}

/** "Genera ora": scrive e pubblica subito un articolo. */
export async function POST(req: NextRequest) {
  if (!(await admin(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const state = await loadBlogAutoState()
  if (state.lastStatus === 'running' && state.updatedAt && Date.now() - new Date(state.updatedAt).getTime() < 300_000) {
    return NextResponse.json({ error: 'Sto già scrivendo un articolo, aspetta un paio di minuti.' }, { status: 409 })
  }
  try {
    await requestBlogRun(req.nextUrl.origin, true)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Avvio non riuscito' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
