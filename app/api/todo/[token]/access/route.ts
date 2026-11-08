import { NextRequest } from 'next/server'
import { INVALID_LINK, clientIp, errorResponse, json, readBody, sameOrigin, setSessionCookie } from '@/lib/todo-http'
import { ipHashOf, sessionCookieName, verifyPassword } from '@/lib/todo-auth'
import { boardByToken, clearAttempts, reserveAttempt } from '@/lib/todo-store'

export const dynamic = 'force-dynamic'

// Password della todo list. Al massimo 10 tentativi per todo list e 30 per IP ogni
// 15 minuti (il tentativo si prenota prima del controllo). Password giusta: cookie
// firmato HttpOnly valido 14 giorni e solo per questa todo list. La password non si
// salva e non finisce mai nei log.

type Ctx = { params: Promise<{ token: string }> }

export async function POST(req: NextRequest, { params }: Ctx) {
  if (!sameOrigin(req)) return json({ error: 'Richiesta non valida.' }, 403)
  try {
    const { token } = await params
    const body = await readBody(req, 2_000)
    const password = typeof body?.password === 'string' ? body.password : ''
    const board = await boardByToken(token)
    if (!board) return json(INVALID_LINK, 404)
    if (!password) return json({ error: 'Scrivi la password.' }, 400)
    const ipHash = ipHashOf(clientIp(req))
    const slot = await reserveAttempt(board.id, ipHash)
    if (!slot.ok) return json({ error: `Troppi tentativi. Riprova tra ${slot.minutes} ${slot.minutes === 1 ? 'minuto' : 'minuti'}.` }, 429)
    if (!(await verifyPassword(password, board.password_hash))) return json({ error: 'Password non corretta.' }, 401)
    await clearAttempts(board.id, ipHash)
    const res = json({ ok: true })
    if (!setSessionCookie(res, req, board)) return json({ error: 'Pagina non disponibile in questo momento.' }, 503)
    return res
  } catch (error) {
    return errorResponse(error)
  }
}

/** Esci: il cookie di questa todo list si cancella. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  if (!sameOrigin(req)) return json({ error: 'Richiesta non valida.' }, 403)
  try {
    const { token } = await params
    const board = await boardByToken(token)
    const res = json({ ok: true })
    if (board) res.cookies.set(sessionCookieName(board.id), '', { httpOnly: true, secure: req.nextUrl.protocol === 'https:', sameSite: 'lax', path: '/', maxAge: 0 })
    return res
  } catch (error) {
    return errorResponse(error)
  }
}
