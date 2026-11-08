import { NextRequest } from 'next/server'
import { applyOp, errorResponse, guestBoard, json, readBody, sameOrigin } from '@/lib/todo-http'
import { loadState, todoOrigin, type Viewer } from '@/lib/todo-store'

export const dynamic = 'force-dynamic'

// Contenuto della todo list e modifiche (tabelle, attivita', foto), per chi ha il
// link ed e' entrato con nome e password (cookie firmato di QUESTA todo list e di
// questa persona). Ognuno riceve solo quello che puo' vedere; i permessi di ogni
// modifica li controlla il server.

type Ctx = { params: Promise<{ token: string }> }

export async function GET(req: NextRequest, { params }: Ctx) {
  let viewer: Viewer | null = null
  try {
    const { token } = await params
    const access = await guestBoard(req, token)
    if ('res' in access) return access.res
    viewer = access.viewer
    const state = await loadState(access.board, access.viewer, (path) => `/api/todo/${token}/image?p=${encodeURIComponent(path)}`)
    return json(state)
  } catch (error) {
    return errorResponse(error, { guest: !viewer?.admin })
  }
}

export async function POST(req: NextRequest, { params }: Ctx) {
  if (!sameOrigin(req)) return json({ error: 'Richiesta non valida.' }, 403)
  let viewer: Viewer | null = null
  try {
    const { token } = await params
    const body = await readBody(req)
    if (!body) return json({ error: 'Dati non validi.' }, 400)
    const access = await guestBoard(req, token)
    if ('res' in access) return access.res
    viewer = access.viewer
    return json({ ok: true, ...(await applyOp(access.board, access.viewer, body, todoOrigin(req.nextUrl.origin))) })
  } catch (error) {
    return errorResponse(error, { guest: !viewer?.admin })
  }
}
