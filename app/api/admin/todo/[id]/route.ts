import { NextRequest } from 'next/server'
import { getAdminEmail } from '@/lib/admin-request'
import { forgetBoard } from '@/lib/todo-access'
import { errorResponse, json, readBody } from '@/lib/todo-http'
import { adminView, boardById, boardLink, boardLinkOf, changePassword, deleteBoard, regenerateLink, renameBoard, todoOrigin } from '@/lib/todo-store'

export const dynamic = 'force-dynamic'

// Un progetto (solo l'admin): nome, password nuova, link nuovo, dati per la pagina, eliminazione.
// Password nuova o link nuovo: chi era dentro con il link deve rientrare con link e password
// nuovi (gli accessi delle persone non cambiano). La pagina del progetto dell'admin usa le
// route per id con il cookie dell'admin (vedi /api/admin/todo/session).

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
        if (!board) return json({ error: 'Progetto non trovato.' }, 404)
        return json({ board: adminView(board, boardLinkOf(board, origin)) })
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
    await forgetBoard(id).catch(() => undefined)
    return json({ ok: true })
  } catch (error) {
    return errorResponse(error)
  }
}
