import { NextRequest } from 'next/server'
import { getAdminEmail } from '@/lib/admin-request'
import { accessView, listAccesses } from '@/lib/todo-access'
import { errorResponse, json, readBody } from '@/lib/todo-http'
import { adminView, boardLink, boardLinkOf, createBoard, homeData, listBoards, todoOrigin } from '@/lib/todo-store'

export const dynamic = 'force-dynamic'

// Progetti (todo list condivise): elenco con conteggi e calendario, accessi delle
// persone, creazione (solo l'admin). La password scelta qui si salva solo come hash;
// il link si puo' ricopiare quando serve.

export async function GET(req: NextRequest) {
  if (!(await getAdminEmail(req))) return json({ error: 'Non autorizzato' }, 401)
  try {
    const origin = todoOrigin(req.nextUrl.origin)
    const boards = (await listBoards()).sort((a, b) => a.name.localeCompare(b.name, 'it'))
    const [home, people] = await Promise.all([homeData(boards), listAccesses()])
    const existing = new Set(boards.map((b) => b.id))
    return json({
      boards: boards.map((b) => adminView(b, boardLinkOf(b, origin))),
      home,
      accesses: people.sort((a, b) => a.name.localeCompare(b.name, 'it')).map((a) => accessView(a, existing)),
      portal: `${origin}/todo`,
    })
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
