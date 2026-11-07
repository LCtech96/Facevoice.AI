import { NextRequest, NextResponse } from 'next/server'
import { userFromRequest } from '@/lib/workspace'
import { TERMS_VERSION } from '@/lib/terms'
import { acceptanceError, latestAcceptance, recordAcceptance, requestIp, requestUserAgent } from '@/lib/terms-acceptance'

export const dynamic = 'force-dynamic'

// Termini e condizioni della persona collegata.
// GET: ha accettato la versione in vigore? (Se no, l'area clienti mostra il blocco.)
// POST { version, accept: { a, b, c }, source? }: registra l'accettazione con data, IP e
// browser presi dal server. source "signup" = caselle spuntate alla registrazione su questo
// dispositivo pochi minuti prima: vale solo per un account appena creato.

const SIGNUP_WINDOW_MS = 30 * 60_000

export async function GET(req: NextRequest) {
  const user = await userFromRequest(req).catch(() => null)
  if (!user) return NextResponse.json({ error: 'Accedi per continuare' }, { status: 401 })
  try {
    const latest = await latestAcceptance(user.id)
    const accepted = latest?.version === TERMS_VERSION
    return NextResponse.json(
      {
        version: TERMS_VERSION,
        accepted,
        acceptedAt: accepted && latest ? latest.acceptedAt : null,
        previousVersion: latest && !accepted ? latest.version : null,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('termini lettura:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Non riesco a controllare i termini, riprova.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await userFromRequest(req).catch(() => null)
  if (!user?.email) return NextResponse.json({ error: 'Accedi per continuare' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const invalid = acceptanceError(body)
  if (invalid) return NextResponse.json({ error: invalid, code: 'terms_invalid' }, { status: 400 })
  const signup = (body as { source?: unknown }).source === 'signup'
  if (signup) {
    const created = Date.parse(user.created_at || '')
    if (!Number.isFinite(created) || Date.now() - created > SIGNUP_WINDOW_MS) {
      return NextResponse.json({ error: 'Spunta di nuovo le caselle per continuare.', code: 'terms_signup_expired' }, { status: 409 })
    }
  }
  try {
    const { entry } = await recordAcceptance({
      userId: user.id,
      email: user.email,
      ip: requestIp(req.headers),
      userAgent: requestUserAgent(req.headers),
      source: signup ? 'signup' : 'gate',
    })
    return NextResponse.json({ ok: true, version: entry.version, acceptedAt: entry.acceptedAt })
  } catch (error) {
    console.error('termini accettazione:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Accettazione non salvata, riprova.' }, { status: 500 })
  }
}
