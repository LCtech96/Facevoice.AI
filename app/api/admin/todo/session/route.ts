import { NextRequest } from 'next/server'
import { getAdminEmail } from '@/lib/admin-request'
import { json, setAdminCookie } from '@/lib/todo-http'

export const dynamic = 'force-dynamic'

// Cookie dell'admin per aprire i progetti dal pannello (12 ore): serve anche per le
// foto, che il browser apre senza intestazioni. Si chiede con l'accesso admin.

export async function POST(req: NextRequest) {
  const admin = await getAdminEmail(req)
  if (!admin) return json({ error: 'Non autorizzato' }, 401)
  const res = json({ ok: true })
  if (!setAdminCookie(res, req, admin)) return json({ error: 'Pagina non disponibile in questo momento.' }, 503)
  return res
}
