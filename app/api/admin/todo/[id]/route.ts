import { NextRequest } from 'next/server'
import { getAdminEmail } from '@/lib/admin-request'
import { openToken } from '@/lib/todo-auth'
import { errorResponse, json, readBody, setSessionCookie } from '@/lib/todo-http'
import { adminView, boardById, boardLink, boardLinkOf, changePassword, deleteBoard, regenerateLink, renameBoard, todoOrigin } from '@/lib/todo-store'

export const dynamic = 'force-dynamic'

// Una todo list (solo l'admin): nome, password nuova, link nuovo, apertura, eliminazione.
// Password nuova o link nuovo: chi era dentro deve rientrare con il link e la password nuovi.
// «Apri»: l'admin riceve lo stesso cookie di chi ha il link (senza password) e la pagina
// usa le stesse route della todo list condivisa.

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Ctx) {
  if (!(await getAdminEmail(req))) return json({ error: 'Non autorizzato' }, 401)
  try {
    const { id } = await params
    const body = await readBody(req, 4_000)
    if (!body) return json({ error: 'Dati non validi.' }, 400)
    const origin = todoOrigin(req.nextUrl.origin)
    switch (body.action) {
      case 'rename': {
        const board = await renameBoard(id, body.name)
        return json({ board: adminView(board, boardLinkOf(board, origin)) })
      }
      case 'password': {
        const board = await changePassword(id, body.password)
        return json({ board: adminView(board, boardLinkOf(board, origin)) })
      }
      case 'regenerate': {
        const { board, token } = await regenerateLink(id)
        return json({ board: adminView(board, boardLink(origin, token)) })
      }
      case 'open': {
        const board = await boardById(id)
        if (!board) return json({ error: 'Todo list non trovata.' }, 404)
        const token = openToken(board.token_enc)
        if (!token) return json({ error: 'Link non leggibile: crea un link nuovo.' }, 409)
        const res = json({ token, name: board.name, link: boardLink(origin, token) })
        if (!setSessionCookie(res, req, board)) return json({ error: 'Pagina non disponibile in questo momento.' }, 503)
        return res
      }
      default:
        return json({ error: 'Azione non valida.' }, 400)
    }
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  if (!(await getAdminEmail(req))) return json({ error: 'Non autorizzato' }, 401)
  try {
    const { id } = await params
    await deleteBoard(id)
    return json({ ok: true })
  } catch (error) {
    return errorResponse(error)
  }
}
