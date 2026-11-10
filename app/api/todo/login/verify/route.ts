import { NextRequest } from 'next/server'
import { PENDING_COOKIE, ipHashOf, readPending } from '@/lib/todo-auth'
import { accessById, clearPortalAttempts, nextForAccess, reservePortalAttempt } from '@/lib/todo-access'
import { RESTART_MESSAGE, verifyCode } from '@/lib/todo-login'
import { clearPendingCookie, clientIp, errorResponse, json, readBody, sameOrigin, setAccessCookie } from '@/lib/todo-http'

export const dynamic = 'force-dynamic'

// Entrata, secondo passaggio: il codice di 6 cifre arrivato per email. Serve il cookie
// «in attesa del codice». Ogni tentativo conta anche nei limiti dell'entrata (10 per
// nome e 30 per IP ogni 15 minuti); 5 codici sbagliati bruciano il codice. Codice
// giusto: si consuma e solo adesso arriva il cookie della persona (180 giorni). Si
// torna al progetto/attivita' chiesti (?p&t), se sono della persona.

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: 'Richiesta non valida.' }, 403)
  try {
    const pending = readPending(req.cookies.get(PENDING_COOKIE)?.value)
    const restart = (error = RESTART_MESSAGE, status = 401) => {
      const res = json({ error, restart: true }, status)
      clearPendingCookie(res, req)
      return res
    }
    if (!pending) return restart()
    const access = await accessById(pending.id)
    if (!access || access.session_version !== pending.version) return restart()
    const body = await readBody(req, 2_000)
    const ipHash = ipHashOf(clientIp(req))
    const slot = await reservePortalAttempt(ipHash, access.name)
    if (!slot.ok) return json({ error: `Troppi tentativi. Riprova tra ${slot.minutes} ${slot.minutes === 1 ? 'minuto' : 'minuti'}.` }, 429)
    const result = await verifyCode(pending, access, body?.code)
    if (!result.ok) {
      if (result.restart) return restart(result.error, result.status)
      return json({ error: result.error, ...(result.left !== undefined ? { left: result.left } : {}) }, result.status)
    }
    await clearPortalAttempts(ipHash, access.name)
    const res = json({ ok: true, name: access.name, next: nextForAccess(access, body?.p, body?.t) })
    clearPendingCookie(res, req)
    if (!setAccessCookie(res, req, access)) return json({ error: 'Pagina non disponibile in questo momento.' }, 503)
    return res
  } catch (error) {
    return errorResponse(error)
  }
}
