import { NextRequest } from 'next/server'
import { personCalendarLink } from '@/lib/todo-calendar'
import { NEED_LOGIN, errorResponse, json, personFromCookie } from '@/lib/todo-http'

export const dynamic = 'force-dynamic'

// Link del calendario della persona (per aggiungerlo all'iPhone): solo per chi e'
// entrato nella pagina generale. Smette di funzionare se l'admin cambia la password.

export async function GET(req: NextRequest) {
  try {
    const person = await personFromCookie(req)
    if (!person) return json(NEED_LOGIN, 401)
    const link = personCalendarLink(person, req.nextUrl.origin)
    if (!link) return json({ error: 'Calendario non disponibile in questo momento.' }, 503)
    return json(link)
  } catch (error) {
    return errorResponse(error)
  }
}
