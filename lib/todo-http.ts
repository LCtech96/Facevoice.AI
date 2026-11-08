import { after, NextRequest, NextResponse } from 'next/server'
import { sessionCookieName, SESSION_TTL_S, signSession, verifySession } from '@/lib/todo-auth'
import { TodoError, addImage, addList, addTask, boardByToken, deleteList, deleteTask, imageUploadUrl, moveList, moveTask, refreshLinks, removeImage, renameList, sortListByPriority, updateTask, type BoardRow } from '@/lib/todo-store'

// Pezzi comuni delle route della todo list: mai in cache, mai indicizzate, solo
// dalla stessa origine per le modifiche, e la todo list verificata dal link + cookie.

export const NO_STORE = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE })

export async function readBody(req: NextRequest, max = 20_000): Promise<Record<string, unknown> | null> {
  const raw = await req.text().catch(() => '')
  if (!raw || raw.length > max) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Le richieste che cambiano qualcosa arrivano dalla stessa origine (difesa in piu' oltre al cookie SameSite). */
export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return true
  try {
    return new URL(origin).host === (req.headers.get('x-forwarded-host') || req.headers.get('host') || req.nextUrl.host)
  } catch {
    return false
  }
}

export function clientIp(req: NextRequest): string {
  const raw = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || ''
  return raw.replace(/[^0-9a-fA-F:.]/g, '').slice(0, 64) || 'sconosciuto'
}

export function errorResponse(error: unknown) {
  if (error instanceof TodoError) return json({ error: error.message, ...(error.setup ? { setup: true } : {}) }, error.status)
  console.error('todo: errore', error instanceof Error ? error.message.slice(0, 200) : 'sconosciuto')
  return json({ error: 'Qualcosa non è andato: riprova.' }, 500)
}

export const INVALID_LINK = { error: 'Link non valido.' }

/** Cookie di accesso alla todo list (HttpOnly, firmato, solo per questa todo list). */
export function setSessionCookie(res: NextResponse, req: NextRequest, board: BoardRow): boolean {
  const value = signSession(board)
  if (!value) return false
  res.cookies.set(sessionCookieName(board.id), value, {
    httpOnly: true,
    secure: req.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_S,
  })
  return true
}

/** Todo list del link, solo se chi chiede ha il cookie giusto per QUESTA todo list. */
export async function guestBoard(req: NextRequest, token: string): Promise<{ board: BoardRow } | { res: NextResponse }> {
  const board = await boardByToken(token)
  if (!board) return { res: json(INVALID_LINK, 404) }
  if (!verifySession(req.cookies.get(sessionCookieName(board.id))?.value, board)) {
    return { res: json({ error: 'Serve la password per aprire questa todo list.', needPassword: true }, 401) }
  }
  return { board }
}

/** Lavoro da fare dopo la risposta (anteprime dei link). */
export function runAfter(task: () => Promise<unknown>) {
  const safe = () => task().catch((e) => console.error('todo: lavoro in coda', e instanceof Error ? e.message.slice(0, 160) : 'errore'))
  try {
    after(safe)
  } catch {
    void safe()
  }
}

/** Le operazioni sulla todo list (uguali per l'admin e per chi ha il link). */
export async function applyOp(board: BoardRow, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const op = body.op
  switch (op) {
    case 'addList':
      return { list: await addList(board, body.title) }
    case 'renameList':
      await renameList(board, body.listId, body.title)
      return {}
    case 'moveList':
      await moveList(board, body.listId, body.index)
      return {}
    case 'deleteList':
      await deleteList(board, body.listId)
      return {}
    case 'sortList':
      await sortListByPriority(board, body.listId)
      return {}
    case 'addTask': {
      const r = await addTask(board, body.listId, body.fields)
      if (r.linksChanged) runAfter(() => refreshLinks(board.id, r.id))
      return { id: r.id }
    }
    case 'updateTask': {
      const r = await updateTask(board, body.taskId, body.fields)
      if (r.linksChanged) runAfter(() => refreshLinks(board.id, body.taskId as string))
      return {}
    }
    case 'moveTask':
      await moveTask(board, body.taskId, body.listId, body.index)
      return {}
    case 'deleteTask':
      await deleteTask(board, body.taskId)
      return {}
    case 'uploadUrl':
      return await imageUploadUrl(board, body.taskId, body.contentType, body.size)
    case 'addImage':
      return await addImage(board, body.taskId, body.path, body.name)
    case 'removeImage':
      await removeImage(board, body.taskId, body.imageId)
      return {}
    default:
      throw new TodoError('Operazione non valida.')
  }
}
