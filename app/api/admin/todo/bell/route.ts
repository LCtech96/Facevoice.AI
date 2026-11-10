import { NextRequest } from 'next/server'
import { getAdminEmail } from '@/lib/admin-request'
import { bellFor, markBellSeen, viewerKey } from '@/lib/todo-bell'
import { errorResponse, json } from '@/lib/todo-http'
import { listBoards } from '@/lib/todo-store'

export const dynamic = 'force-dynamic'

// Campanella dell'admin (solo con l'accesso admin): avvisi di tutti i progetti.
// GET: avvisi e quanti da leggere. POST: campanella aperta, tutto letto.

export async function GET(req: NextRequest) {
  if (!(await getAdminEmail(req))) return json({ error: 'Non autorizzato' }, 401)
  try {
    return json(await bellFor(await listBoards(), { key: viewerKey({ kind: 'admin' }), person: null }))
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(req: NextRequest) {
  if (!(await getAdminEmail(req))) return json({ error: 'Non autorizzato' }, 401)
  try {
    return json({ ok: true, seenAt: await markBellSeen(viewerKey({ kind: 'admin' })) })
  } catch (error) {
    return errorResponse(error)
  }
}
