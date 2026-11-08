import { NextRequest } from 'next/server'
import { getAdminEmail } from '@/lib/admin-request'
import { openToken } from '@/lib/todo-auth'
import { errorResponse, json, readBody, setSessionCookie } from '@/lib/todo-http'
import {
  addMember,
  adminView,
  boardById,
  boardLink,
  boardLinkOf,
  deleteBoard,
  listMembers,
  memberView,
  probePeople,
  regenerateLink,
  removeMember,
  renameBoard,
  setMemberEmail,
  setMemberPassword,
  todoOrigin,
  type BoardRow,
} from '@/lib/todo-store'

export const dynamic = 'force-dynamic'

// Una todo list (solo l'admin): nome, persone (nome, email, password personale), link
// nuovo, apertura, eliminazione. Password di una persona cambiata o persona tolta: esce
// solo lei. Link nuovo: escono tutti. «Apri»: l'admin riceve un cookie da admin (senza
// password, valido 12 ore) e la pagina usa le stesse route della todo list condivisa.

type Ctx = { params: Promise<{ id: string }> }

const peopleOf = async (board: BoardRow) => (await listMembers(board.id)).map(memberView)

export async function GET(req: NextRequest, { params }: Ctx) {
  if (!(await getAdminEmail(req))) return json({ error: 'Non autorizzato' }, 401)
  try {
    const { id } = await params
    const board = await boardById(id)
    if (!board) return json({ error: 'Todo list non trovata.' }, 404)
    return json({ board: adminView(board, boardLinkOf(board, todoOrigin(req.nextUrl.origin))), members: await peopleOf(board) })
  } catch (error) {
    return errorResponse(error)
  }
}

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
      case 'regenerate': {
        const { board, token } = await regenerateLink(id)
        return json({ board: adminView(board, boardLink(origin, token)) })
      }
      case 'open': {
        const board = await boardById(id)
        if (!board) return json({ error: 'Todo list non trovata.' }, 404)
        await probePeople()
        const token = openToken(board.token_enc)
        if (!token) return json({ error: 'Link non leggibile: crea un link nuovo.' }, 409)
        const res = json({ token, name: board.name, link: boardLink(origin, token) })
        if (!setSessionCookie(res, req, board, null)) return json({ error: 'Pagina non disponibile in questo momento.' }, 503)
        return res
      }
      case 'addMember':
      case 'memberPassword':
      case 'memberEmail':
      case 'removeMember': {
        const board = await boardById(id)
        if (!board) return json({ error: 'Todo list non trovata.' }, 404)
        if (body.action === 'addMember') await addMember(board, { name: body.name, email: body.email, password: body.password })
        else if (body.action === 'memberPassword') await setMemberPassword(board, body.memberId, body.password)
        else if (body.action === 'memberEmail') await setMemberEmail(board, body.memberId, body.email)
        else await removeMember(board, body.memberId)
        return json({ ok: true, members: await peopleOf(board) })
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
