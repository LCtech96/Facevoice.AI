import { NextRequest } from 'next/server'
import { getAdminEmail } from '@/lib/admin-request'
import { errorResponse, json, readBody } from '@/lib/todo-http'
import { adminView, boardLink, boardLinkOf, createBoard, listBoards, probePeople, todoOrigin } from '@/lib/todo-store'

export const dynamic = 'force-dynamic'

// Todo list condivise: elenco e creazione (solo l'admin). Si crea con il solo nome;
// poi l'admin aggiunge le persone (ognuna con la sua password) dalla todo list.
// Il link si puo' ricopiare quando serve.

export async function GET(req: NextRequest) {
  if (!(await getAdminEmail(req))) return json({ error: 'Non autorizzato' }, 401)
  try {
    const origin = todoOrigin(req.nextUrl.origin)
    const boards = await listBoards()
    await probePeople()
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
    const { board, token } = await createBoard(body.name, admin)
    return json({ board: adminView(board, boardLink(todoOrigin(req.nextUrl.origin), token)) })
  } catch (error) {
    return errorResponse(error)
  }
}
