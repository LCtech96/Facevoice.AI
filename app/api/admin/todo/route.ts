import { NextRequest } from 'next/server'
import { getAdminEmail } from '@/lib/admin-request'
import { errorResponse, json, readBody } from '@/lib/todo-http'
import { adminView, boardLink, boardLinkOf, createBoard, listBoards, todoOrigin } from '@/lib/todo-store'

export const dynamic = 'force-dynamic'

// Todo list condivise: elenco e creazione (solo l'admin). La password scelta qui si
// salva solo come hash; il link si puo' ricopiare quando serve.

export async function GET(req: NextRequest) {
  if (!(await getAdminEmail(req))) return json({ error: 'Non autorizzato' }, 401)
  try {
    const origin = todoOrigin(req.nextUrl.origin)
    const boards = await listBoards()
    return json({ boards: boards.map((b) => adminView(b, boardLinkOf(b, origin))) })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(req: NextRequest) {
  const admin = await getAdminEmail(req)
  if (!admin) return json({ error: 'Non autorizzato' }, 401)
  try {
    const body = await readBody(req, 4_000)
    if (!body) return json({ error: 'Dati non validi.' }, 400)
    const { board, token } = await createBoard(body.name, body.password, admin)
    return json({ board: adminView(board, boardLink(todoOrigin(req.nextUrl.origin), token)) })
  } catch (error) {
    return errorResponse(error)
  }
}
