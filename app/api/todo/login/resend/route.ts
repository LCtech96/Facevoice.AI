import { NextRequest } from 'next/server'
import { PENDING_COOKIE, readPending } from '@/lib/todo-auth'
import { accessById } from '@/lib/todo-access'
import { RESTART_MESSAGE, resendCode } from '@/lib/todo-login'
import { clearPendingCookie, errorResponse, json, sameOrigin, setPendingCookie } from '@/lib/todo-http'

export const dynamic = 'force-dynamic'

// «Invia di nuovo il codice»: solo con il cookie «in attesa del codice». Un invio ogni
// 60 secondi, al massimo 3 invii in piu' ogni 15 minuti. Il codice nuovo sostituisce
// quello di prima e il cookie di attesa riparte da 10 minuti.

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
    const result = await resendCode(pending, access)
    if (!result.ok) {
      if (result.restart) return restart(result.error, result.status)
      return json({ error: result.error, ...(result.resendIn !== undefined ? { resendIn: result.resendIn } : {}) }, result.status)
    }
    const res = json({ ok: true, resendIn: result.resendIn })
    if (!setPendingCookie(res, req, access, pending.nonce)) return json({ error: 'Pagina non disponibile in questo momento.' }, 503)
    return res
  } catch (error) {
    return errorResponse(error)
  }
}
