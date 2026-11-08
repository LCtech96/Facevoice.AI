import { NextRequest } from 'next/server'
import { applyOp, errorResponse, guestBoard, json, readBody, sameOrigin } from '@/lib/todo-http'
import { loadState } from '@/lib/todo-store'

export const dynamic = 'force-dynamic'

// Contenuto della todo list e modifiche (tabelle, attivita', foto), per chi ha il
// link e ha messo la password (cookie firmato di QUESTA todo list). Si tocca solo
// questa todo list: ogni operazione filtra per il suo id.

type Ctx = { params: Promise<{ token: string }> }

export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    const { token } = await params
    const access = await guestBoard(req, token)
    if ('res' in access) return access.res
    const state = await loadState(access.board, (path) => `/api/todo/${token}/image?p=${encodeURIComponent(path)}`)
    return json(state)
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  if (!sameOrigin(req)) return json({ error: 'Richiesta non valida.' }, 403)
  try {
    const { token } = await params
    const body = await readBody(req)
    if (!body) return json({ error: 'Dati non validi.' }, 400)
    const access = await guestBoard(req, token)
    if ('res' in access) return access.res
    return json({ ok: true, ...(await applyOp(access.board, body)) })
  } catch (error) {
    return errorResponse(error)
  }
}
