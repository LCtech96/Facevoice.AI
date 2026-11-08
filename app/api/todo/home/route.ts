import { NextRequest } from 'next/server'
import { NEED_LOGIN, errorResponse, json, viewerFromCookies } from '@/lib/todo-http'
import { homeData, listBoards } from '@/lib/todo-store'

export const dynamic = 'force-dynamic'

// Schermata generale della persona: i SUOI progetti (cartelle con i conteggi) e le
// attivita' con scadenza di quei progetti per il calendario. Niente degli altri.

export async function GET(req: NextRequest) {
  try {
    const viewer = await viewerFromCookies(req)
    if (!viewer) return json(NEED_LOGIN, 401)
    const all = await listBoards()
    const allowed = viewer.kind === 'person' ? new Set(viewer.access.board_ids) : null
    const boards = all.filter((b) => !allowed || allowed.has(b.id)).sort((a, b) => a.name.localeCompare(b.name, 'it'))
    const data = await homeData(boards)
    return json({ name: viewer.kind === 'person' ? viewer.access.name : 'Admin', ...data })
  } catch (error) {
    return errorResponse(error)
  }
}
