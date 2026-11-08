import { NextRequest } from 'next/server'
import { applyOp, errorResponse, json, projectAccess, readBody, sameOrigin } from '@/lib/todo-http'
import { loadState } from '@/lib/todo-store'

export const dynamic = 'force-dynamic'

// Un progetto aperto dalla schermata generale (per id): l'admin (suo cookie) o una
// persona a cui l'admin l'ha dato (cookie della persona, progetto nel suo accesso).
// Stesso contenuto e stesse modifiche di chi ha il link del progetto.

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params
    const access = await projectAccess(req, id)
    if ('res' in access) return access.res
    const base = `/api/todo/p/${access.board.id}`
    return json(await loadState(access.board, (path) => `${base}/image?p=${encodeURIComponent(path)}`))
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  if (!sameOrigin(req)) return json({ error: 'Richiesta non valida.' }, 403)
  try {
    const { id } = await params
    const body = await readBody(req)
    if (!body) return json({ error: 'Dati non validi.' }, 400)
    const access = await projectAccess(req, id)
    if ('res' in access) return access.res
    return json({ ok: true, ...(await applyOp(req, access.board, access.viewer, body)) })
  } catch (error) {
    return errorResponse(error)
  }
}
