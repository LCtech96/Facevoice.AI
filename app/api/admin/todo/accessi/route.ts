import { NextRequest } from 'next/server'
import { getAdminEmail } from '@/lib/admin-request'
import { accessView, createAccess, listAccesses } from '@/lib/todo-access'
import { errorResponse, json, readBody } from '@/lib/todo-http'

export const dynamic = 'force-dynamic'

// Accessi delle persone (solo l'admin): elenco e nuovo accesso con nome, email (per il
// codice di entrata, una per persona), password (scelta dall'admin, mai mandata per
// email) e progetti.

export async function GET(req: NextRequest) {
  if (!(await getAdminEmail(req))) return json({ error: 'Non autorizzato' }, 401)
  try {
    return json({ accesses: (await listAccesses()).map((a) => accessView(a)) })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(req: NextRequest) {
  if (!(await getAdminEmail(req))) return json({ error: 'Non autorizzato' }, 401)
  try {
    const body = await readBody(req, 20_000)
    if (!body) return json({ error: 'Dati non validi.' }, 400)
    const access = await createAccess(body.name, body.password, body.boardIds, body.email)
    return json({ access: accessView(access) })
  } catch (error) {
    return errorResponse(error)
  }
}
