import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { acceptanceError, recordAcceptance, requestIp, requestUserAgent } from '@/lib/terms-acceptance'

export const dynamic = 'force-dynamic'

// Registrazione con email e password: subito dopo la creazione dell'account (prima della
// conferma dell'email, quindi senza sessione) la pagina manda qui le tre caselle spuntate.
// POST { userId, email, version, accept: { a, b, c } }.
// Vale solo per un account creato da pochi minuti con quella email: l'id lo conosce solo
// chi ha appena fatto la registrazione. Data, IP e browser li prende il server.

const SIGNUP_WINDOW_MS = 30 * 60_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const invalid = acceptanceError(body)
  if (invalid) return NextResponse.json({ error: invalid, code: 'terms_invalid' }, { status: 400 })
  const b = body as { userId?: unknown; email?: unknown }
  const userId = typeof b.userId === 'string' ? b.userId.trim() : ''
  const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : ''
  if (!UUID.test(userId) || !email.includes('@') || email.length > 200) {
    return NextResponse.json({ error: 'Dati non validi.' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId).catch(() => ({ data: null, error: true }))
  const user = !error ? data?.user : null
  const created = Date.parse(user?.created_at || '')
  if (!user || (user.email || '').toLowerCase() !== email || !Number.isFinite(created) || Date.now() - created > SIGNUP_WINDOW_MS) {
    return NextResponse.json({ error: 'Registrazione non trovata.' }, { status: 404 })
  }

  try {
    const { entry } = await recordAcceptance({
      userId: user.id,
      email,
      ip: requestIp(req.headers),
      userAgent: requestUserAgent(req.headers),
      source: 'signup',
    })
    return NextResponse.json({ ok: true, version: entry.version, acceptedAt: entry.acceptedAt })
  } catch (err) {
    console.error('termini registrazione:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Accettazione non salvata.' }, { status: 500 })
  }
}
