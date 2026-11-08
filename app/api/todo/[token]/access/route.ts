import { NextRequest } from 'next/server'
import { INVALID_LINK, UNAVAILABLE, clientIp, errorResponse, json, readBody, sameOrigin, setSessionCookie } from '@/lib/todo-http'
import { hashPassword, ipHashOf, sessionCookieName, verifyPassword } from '@/lib/todo-auth'
import { TodoError, boardByToken, clearAttempts, memberForLogin, reserveAttempt } from '@/lib/todo-store'
import { randomBytes } from 'crypto'

export const dynamic = 'force-dynamic'

// Entrata nella todo list con nome e password personale. Il nome si confronta senza
// badare a maiuscole e accenti; la risposta sbagliata e' sempre la stessa (non si
// capisce se esiste una persona con quel nome). Al massimo 10 tentativi per todo
// list e 30 per IP ogni 15 minuti (il tentativo si prenota prima del controllo).
// Giusti: cookie firmato HttpOnly valido 14 giorni, solo per questa todo list e
// questa persona. La password non si salva e non finisce mai nei log.

type Ctx = { params: Promise<{ token: string }> }

const WRONG = 'Nome o password non corretti.'

// Hash finto: con un nome sconosciuto si fa lo stesso lavoro, cosi' i tempi non dicono nulla.
let dummyHash: Promise<string> | null = null
const dummy = () => (dummyHash ??= hashPassword(randomBytes(18).toString('base64url')))

export async function POST(req: NextRequest, { params }: Ctx) {
  if (!sameOrigin(req)) return json({ error: 'Richiesta non valida.' }, 403)
  try {
    const { token } = await params
    const body = await readBody(req, 2_000)
    const name = typeof body?.name === 'string' ? body.name : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    const board = await boardByToken(token)
    if (!board) return json(INVALID_LINK, 404)
    if (!name.trim()) return json({ error: 'Scrivi il tuo nome.' }, 400)
    if (!password) return json({ error: 'Scrivi la password.' }, 400)
    const ipHash = ipHashOf(clientIp(req))
    const slot = await reserveAttempt(board.id, ipHash)
    if (!slot.ok) return json({ error: `Troppi tentativi. Riprova tra ${slot.minutes} ${slot.minutes === 1 ? 'minuto' : 'minuti'}.` }, 429)
    const member = await memberForLogin(board.id, name)
    const ok = await verifyPassword(password, member ? member.password_hash : await dummy())
    if (!member || !ok) return json({ error: WRONG }, 401)
    await clearAttempts(board.id, ipHash)
    const res = json({ ok: true })
    if (!setSessionCookie(res, req, board, member)) return json({ error: UNAVAILABLE }, 503)
    return res
  } catch (error) {
    // SQL delle persone non ancora eseguito: messaggio neutro, nessun dettaglio.
    if (error instanceof TodoError && error.setup) return json({ error: UNAVAILABLE }, 503)
    return errorResponse(error, { guest: true })
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
    return errorResponse(error, { guest: true })
  }
}
