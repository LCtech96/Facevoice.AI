import { NextRequest } from 'next/server'
import { getAdminEmail } from '@/lib/admin-request'
import { adminCalendarLink, rotateAdminCalendar } from '@/lib/todo-calendar'
import { errorResponse, json } from '@/lib/todo-http'

export const dynamic = 'force-dynamic'

// Calendario dell'admin con le scadenze di tutti i progetti (solo con l'accesso admin).
// GET: il link. POST: «Nuovo link» (quello di prima smette di funzionare).

export async function GET(req: NextRequest) {
  if (!(await getAdminEmail(req))) return json({ error: 'Non autorizzato' }, 401)
  try {
    const link = await adminCalendarLink(req.nextUrl.origin)
    return link ? json(link) : json({ error: 'Calendario non disponibile in questo momento.' }, 503)
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(req: NextRequest) {
  if (!(await getAdminEmail(req))) return json({ error: 'Non autorizzato' }, 401)
  try {
    const link = await rotateAdminCalendar(req.nextUrl.origin)
    return link ? json(link) : json({ error: 'Calendario non disponibile in questo momento.' }, 503)
  } catch (error) {
    return errorResponse(error)
  }
}
