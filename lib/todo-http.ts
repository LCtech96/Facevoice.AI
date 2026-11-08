import { after, NextRequest, NextResponse } from 'next/server'
import { ADMIN_SESSION_TTL_S, readSession, sessionCookieName, SESSION_TTL_S, signSession } from '@/lib/todo-auth'
import { notifyTaskDone } from '@/lib/todo-notify'
import { isDoneListTitle } from '@/lib/todo-shared'
import {
  TodoError,
  addImage,
  addList,
  addTask,
  boardByToken,
  deleteList,
  deleteTask,
  imageUploadUrl,
  moveList,
  moveTask,
  refreshLinks,
  removeImage,
  renameList,
  sortListByPriority,
  updateTask,
  viewerFor,
  type BoardRow,
  type MemberRow,
  type Viewer,
} from '@/lib/todo-store'
import { supabaseAdmin } from '@/lib/supabase-admin'

// Pezzi comuni delle route della todo list: mai in cache, mai indicizzate, solo
// dalla stessa origine per le modifiche, e la todo list e la persona verificate dal
// link + cookie (la persona deve esserci ancora, con la stessa password).

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

/** Per chi ha il link (non l'admin) niente dettagli tecnici: solo «non disponibile». */
export const UNAVAILABLE = 'La todo list non è disponibile in questo momento. Riprova più tardi.'

export function errorResponse(error: unknown, opts: { guest?: boolean } = {}) {
  if (error instanceof TodoError && error.setup && opts.guest) return json({ error: UNAVAILABLE }, 503)
  if (error instanceof TodoError) return json({ error: error.message, ...(error.setup ? { setup: true } : {}), ...(error.update ? { update: true } : {}) }, error.status)
  console.error('todo: errore', error instanceof Error ? error.message.slice(0, 200) : 'sconosciuto')
  return json({ error: 'Qualcosa non è andato: riprova.' }, 500)
}

export const INVALID_LINK = { error: 'Link non valido.' }

/** Cookie di accesso alla todo list (HttpOnly, firmato, solo per questa todo list e questa persona; member null = admin). */
export function setSessionCookie(res: NextResponse, req: NextRequest, board: BoardRow, member: Pick<MemberRow, 'id' | 'session_version'> | null): boolean {
  const value = signSession(board, member)
  if (!value) return false
  res.cookies.set(sessionCookieName(board.id), value, {
    httpOnly: true,
    secure: req.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    maxAge: member ? SESSION_TTL_S : ADMIN_SESSION_TTL_S,
  })
  return true
}

export const NEED_LOGIN = { error: 'Per aprire questa todo list servono il tuo nome e la tua password.', needPassword: true }

/** Todo list del link e chi chiede, solo se ha il cookie giusto per QUESTA todo list. */
export async function guestBoard(req: NextRequest, token: string): Promise<{ board: BoardRow; viewer: Viewer } | { res: NextResponse }> {
  const board = await boardByToken(token)
  if (!board) return { res: json(INVALID_LINK, 404) }
  const session = readSession(req.cookies.get(sessionCookieName(board.id))?.value, board)
  if (!session) return { res: json(NEED_LOGIN, 401) }
  let viewer: Viewer | null
  try {
    viewer = await viewerFor(board, session)
  } catch (error) {
    return { res: errorResponse(error, { guest: true }) }
  }
  if (!viewer) return { res: json(NEED_LOGIN, 401) }
  return { board, viewer }
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

/** Avviso all'admin (dopo la risposta) quando una persona finisce un'attivita'. */
function noticeDone(board: BoardRow, viewer: Viewer, taskId: string, fromListId: string, toListId: string, origin: string) {
  if (viewer.admin) return
  const who = viewer.member.name
  runAfter(() => notifyTaskDone({ board, who, taskId, fromListId, toListId, origin }))
}

async function listTitles(boardId: string, ids: string[]): Promise<Map<string, string>> {
  const { data } = await supabaseAdmin.from('todo_lists').select('id, title').eq('board_id', boardId).in('id', ids)
  return new Map(((data || []) as { id: string; title: string }[]).map((l) => [l.id, l.title]))
}

/**
 * Le operazioni sulla todo list (per l'admin e per chi ha il link). I permessi li
 * controlla il modulo dei dati in base a chi chiede (viewer). origin: per il link
 * all'admin nell'avviso "fatta".
 */
export async function applyOp(board: BoardRow, viewer: Viewer, body: Record<string, unknown>, origin: string): Promise<Record<string, unknown>> {
  const op = body.op
  switch (op) {
    case 'addList':
      return { list: await addList(board, viewer, body.title) }
    case 'renameList':
      await renameList(board, viewer, body.listId, body.title)
      return {}
    case 'moveList':
      await moveList(board, viewer, body.listId, body.index)
      return {}
    case 'deleteList':
      await deleteList(board, viewer, body.listId)
      return {}
    case 'sortList':
      await sortListByPriority(board, viewer, body.listId)
      return {}
    case 'addTask': {
      const r = await addTask(board, viewer, body.listId, body.fields)
      if (r.linksChanged) runAfter(() => refreshLinks(board.id, r.id))
      return { id: r.id }
    }
    case 'updateTask': {
      const r = await updateTask(board, viewer, body.taskId, body.fields)
      if (r.linksChanged) runAfter(() => refreshLinks(board.id, body.taskId as string))
      if (r.completed) noticeDone(board, viewer, String(body.taskId).toLowerCase(), r.listId, r.listId, origin)
      return {}
    }
    case 'moveTask': {
      const r = await moveTask(board, viewer, body.taskId, body.listId, body.index)
      if (!viewer.admin && r.fromListId !== r.toListId) {
        const titles = await listTitles(board.id, [r.fromListId, r.toListId])
        if (isDoneListTitle(titles.get(r.toListId) || '') && !isDoneListTitle(titles.get(r.fromListId) || '')) noticeDone(board, viewer, String(body.taskId).toLowerCase(), r.fromListId, r.toListId, origin)
      }
      return {}
    }
    case 'deleteTask':
      await deleteTask(board, viewer, body.taskId)
      return {}
    case 'uploadUrl':
      return await imageUploadUrl(board, viewer, body.taskId, body.contentType, body.size)
    case 'addImage':
      return await addImage(board, viewer, body.taskId, body.path, body.name)
    case 'removeImage':
      await removeImage(board, viewer, body.taskId, body.imageId)
      return {}
    default:
      throw new TodoError('Operazione non valida.')
  }
}
