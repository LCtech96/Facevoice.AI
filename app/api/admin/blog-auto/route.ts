import { NextRequest, NextResponse } from 'next/server'
import { getStaffAccess } from '@/lib/staff-access'
import {
  BLOG_TOPICS,
  BlogBusyError,
  BlogScheduleError,
  MAX_SLOTS,
  MAX_TOPIC_LENGTH,
  MIN_GAP_MINUTES,
  loadBlogAutoSettings,
  loadBlogAutoState,
  saveBlogAutoSettings,
  startBlogNow,
} from '@/lib/blog-auto'

export const dynamic = 'force-dynamic'

/** Solo l'amministratore: l'articolo esce a nome di Facevoice AI. */
async function admin(req: NextRequest) {
  const access = await getStaffAccess(req)
  return access?.isAdmin ? access : null
}

const limits = { topics: BLOG_TOPICS.map((t) => t.label), maxSlots: MAX_SLOTS, maxTopicLength: MAX_TOPIC_LENGTH, minGapMinutes: MIN_GAP_MINUTES }

export async function GET(req: NextRequest) {
  if (!(await admin(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const [settings, state] = await Promise.all([loadBlogAutoSettings(), loadBlogAutoState()])
  return NextResponse.json({ settings, state, ...limits })
}

/** Modifica (giorni, uscite con ora e argomento, interruttori): controllata, errori in italiano. */
export async function PUT(req: NextRequest) {
  if (!(await admin(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Richiesta non valida.' }, { status: 400 })
  try {
    return NextResponse.json({ settings: await saveBlogAutoSettings(body) })
  } catch (error) {
    if (error instanceof BlogScheduleError) return NextResponse.json({ error: error.message }, { status: 400 })
    throw error
  }
}

/** "Genera ora": scrive e pubblica subito un articolo sull'argomento scelto (di default quello della prima uscita). */
export async function POST(req: NextRequest) {
  if (!(await admin(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  try {
    const { topic } = await startBlogNow(req.nextUrl.origin, body && typeof body === 'object' ? (body as { topic?: unknown }).topic : undefined)
    return NextResponse.json({ ok: true, topic })
  } catch (error) {
    if (error instanceof BlogBusyError) return NextResponse.json({ error: error.message }, { status: 409 })
    if (error instanceof BlogScheduleError) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ error: 'Avvio non riuscito, riprova.' }, { status: 500 })
  }
}
