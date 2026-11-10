import { NextRequest } from 'next/server'
import { bellFor, markBellSeen, viewerKey } from '@/lib/todo-bell'
import { NEED_LOGIN, errorResponse, json, personFromCookie, refreshAccessCookie, sameOrigin } from '@/lib/todo-http'
import { listBoards } from '@/lib/todo-store'

export const dynamic = 'force-dynamic'

// Campanella della persona: avvisi SOLO dei progetti del suo accesso (verificato ora,
// a ogni richiesta). GET: avvisi e quanti da leggere. POST: campanella aperta, tutto
// letto. Usarla rinnova il cookie (non si deve rientrare).

export async function GET(req: NextRequest) {
  try {
    const person = await personFromCookie(req)
    if (!person) return json(NEED_LOGIN, 401)
    const allowed = new Set(person.board_ids)
    const boards = (await listBoards()).filter((b) => allowed.has(b.id))
    const data = await bellFor(boards, { key: viewerKey({ kind: 'person', id: person.id }), person: { name: person.name, email: person.email } })
    return refreshAccessCookie(json(data), req, person)
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: 'Richiesta non valida.' }, 403)
  try {
    const person = await personFromCookie(req)
    if (!person) return json(NEED_LOGIN, 401)
    return json({ ok: true, seenAt: await markBellSeen(viewerKey({ kind: 'person', id: person.id })) })
  } catch (error) {
    return errorResponse(error)
  }
}
