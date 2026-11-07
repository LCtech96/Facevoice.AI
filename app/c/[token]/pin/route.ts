import { NextRequest } from 'next/server'
import { clientIp, json, readBody, sameOrigin } from '@/lib/contract-http'
import { LINK_COOKIE, LINK_COOKIE_TTL_S, clearPinAttempts, contractByToken, noteWrongPin, reservePinAttempt, signLinkCookie, verifyPin } from '@/lib/contracts'

export const dynamic = 'force-dynamic'

// PIN del link del contratto. Al massimo 5 tentativi per link e 20 per IP ogni 15 minuti
// (il tentativo si prenota prima del controllo). PIN giusto: cookie firmato HttpOnly,
// Secure, SameSite=Lax, valido 2 ore e solo per questo link. Link sconosciuto o revocato:
// sempre lo stesso "Link non valido". Il PIN non si salva e non si scrive mai nei log.

const INVALID = { error: 'Link non valido.' }

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  if (!sameOrigin(req)) return json({ error: 'Richiesta non valida.' }, 403)
  const { token } = await params
  const body = await readBody(req, 2_000)
  const pin = typeof body?.pin === 'string' ? body.pin : ''
  const c = await contractByToken(token)
  if (!c || !c.share) return json(INVALID, 404)
  const ip = clientIp(req)
  const slot = await reservePinAttempt(c.share.tokenHash, ip)
  if (!slot.ok) return json({ error: `Troppi tentativi. Riprova tra ${slot.minutes} ${slot.minutes === 1 ? 'minuto' : 'minuti'}.` }, 429)
  if (!(await verifyPin(pin, c.share.pinHash))) {
    // Nel registro del contratto: solo che c'e' stato un tentativo sbagliato.
    await noteWrongPin(c.id)
    console.warn('contratti: PIN sbagliato su un link')
    return json({ error: 'PIN non corretto.' }, 401)
  }
  await clearPinAttempts(c.share.tokenHash, ip)
  const value = signLinkCookie(c.share)
  if (!value) return json({ error: 'Pagina non disponibile in questo momento.' }, 503)
  const res = json({ ok: true })
  res.cookies.set(LINK_COOKIE, value, {
    httpOnly: true,
    secure: req.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    path: `/c/${token}`,
    maxAge: LINK_COOKIE_TTL_S,
  })
  return res
}
