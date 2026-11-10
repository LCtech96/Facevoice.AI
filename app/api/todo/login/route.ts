import { NextRequest } from 'next/server'
import { ipHashOf } from '@/lib/todo-auth'
import { checkLogin, maskEmail, reservePortalAttempt } from '@/lib/todo-access'
import { startLogin } from '@/lib/todo-login'
import { clearAccessCookie, clearPendingCookie, clientIp, errorResponse, json, readBody, sameOrigin, setPendingCookie } from '@/lib/todo-http'

export const dynamic = 'force-dynamic'

// Entrata nella pagina generale dei progetti (/todo), primo passaggio: nome e password
// dati dall'admin. Nome senza differenze di maiuscole e accenti. Al massimo 10 tentativi
// per nome e 30 per IP ogni 15 minuti (prenotati prima del controllo). Errore sempre
// uguale (non si scopre se il nome esiste). La password non si salva e non va nei log.
// Password giusta: NON si entra ancora. Parte per email un codice di 6 cifre e si
// riceve solo un cookie «in attesa del codice» (10 minuti) che non apre nessun progetto.
// Senza email salvata dall'admin non si entra.

const WRONG = { error: 'Nome o password non corretti.' }

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: 'Richiesta non valida.' }, 403)
  try {
    const body = await readBody(req, 2_000)
    const name = typeof body?.name === 'string' ? body.name.slice(0, 200) : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    if (!name.trim() || !password) return json({ error: 'Scrivi nome e password.' }, 400)
    const ipHash = ipHashOf(clientIp(req))
    const slot = await reservePortalAttempt(ipHash, name)
    if (!slot.ok) return json({ error: `Troppi tentativi. Riprova tra ${slot.minutes} ${slot.minutes === 1 ? 'minuto' : 'minuti'}.` }, 429)
    const access = await checkLogin(name, password)
    if (!access) return json(WRONG, 401)
    const started = await startLogin(access)
    if (!started.ok) return json({ error: started.error, ...(started.noEmail ? { noEmail: true } : {}) }, started.status)
    const res = json({ ok: true, step: 'code', email: maskEmail(started.email), alreadySent: started.reused, resendIn: started.resendIn })
    if (!setPendingCookie(res, req, access, started.nonce)) return json({ error: 'Pagina non disponibile in questo momento.' }, 503)
    return res
  } catch (error) {
    return errorResponse(error)
  }
}

/** Esci (o ricomincia dall'inizio): via il cookie della persona e quello di attesa del codice. */
export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: 'Richiesta non valida.' }, 403)
  const res = json({ ok: true })
  clearAccessCookie(res, req)
  clearPendingCookie(res, req)
  return res
}
