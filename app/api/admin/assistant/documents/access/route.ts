import { NextRequest, NextResponse } from 'next/server'
import { getStaffAccess } from '@/lib/staff-access'
import { DOC_COOKIE, DOC_COOKIE_PATH, DOC_COOKIE_TTL_S, signDocAccess } from '@/lib/doc-access'

export const dynamic = 'force-dynamic'

/**
 * La scheda del documento chiede il cookie per aprire i PDF in una scheda nuova
 * ("Apri PDF", "Scarica"): dura un'ora e si rinnova al clic. Solo l'amministratore,
 * con il suo token.
 */
export async function POST(req: NextRequest) {
  const access = await getStaffAccess(req)
  if (!access) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  if (!access.isAdmin) return NextResponse.json({ error: 'Solo l’amministratore può aprire i documenti.' }, { status: 403 })
  const value = signDocAccess(access.userId)
  if (!value) return NextResponse.json({ error: 'Accesso ai documenti non configurato sul server.' }, { status: 503 })
  const res = NextResponse.json({ ok: true, expiresIn: DOC_COOKIE_TTL_S })
  res.cookies.set(DOC_COOKIE, value, {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.nextUrl.protocol === 'https:',
    path: DOC_COOKIE_PATH,
    maxAge: DOC_COOKIE_TTL_S,
  })
  res.headers.set('Cache-Control', 'no-store')
  return res
}

/**
 * Uscita dall'account: il cookie dei PDF si cancella subito. Senza controlli (togliere
 * un accesso non fa danni), cosi' funziona anche quando la sessione e' gia' chiusa.
 */
export async function DELETE(req: NextRequest) {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(DOC_COOKIE, '', {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.nextUrl.protocol === 'https:',
    path: DOC_COOKIE_PATH,
    maxAge: 0,
  })
  res.headers.set('Cache-Control', 'no-store')
  return res
}
