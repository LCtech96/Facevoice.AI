import { after, NextRequest, NextResponse } from 'next/server'
import {
  ACCESS_COOKIE,
  ADMIN_COOKIE,
  ADMIN_SESSION_TTL_S,
  PENDING_COOKIE,
  PENDING_TTL_S,
  PORTAL_SESSION_TTL_S,
  accessSessionNeedsRefresh,
  readAccessSession,
  readAdminSession,
  sessionCookieName,
  SESSION_TTL_S,
  signAccessSession,
  signAdminSession,
  signPending,
  signSession,
  verifySession,
} from '@/lib/todo-auth'
import { accessForSession, type AccessRow } from '@/lib/todo-access'
import { rememberOwnTask, viewerKey } from '@/lib/todo-bell'
import { LINK_GUEST_NAME, notifyTaskDone } from '@/lib/todo-notify'
import { TodoError, addImage, addList, addTask, boardById, boardByToken, deleteList, deleteTask, imageUploadUrl, moveList, moveTask, refreshLinks, removeImage, renameList, sortListByPriority, todoOrigin, updateTask, type BoardRow } from '@/lib/todo-store'

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

/** Chi sta lavorando: l'admin, una persona entrata con nome e password, o chi ha il link del progetto. */
export type Viewer = { kind: 'admin' } | { kind: 'link' } | { kind: 'person'; access: AccessRow }

const cookieOptions = (req: NextRequest, maxAge: number) => ({ httpOnly: true, secure: req.nextUrl.protocol === 'https:', sameSite: 'lax' as const, path: '/', maxAge })

/** Cookie della persona (dopo nome, password e codice giusti): 180 giorni, rinnovato con l'uso. */
export function setAccessCookie(res: NextResponse, req: NextRequest, access: AccessRow): boolean {
  const value = signAccessSession(access)
  if (!value) return false
  res.cookies.set(ACCESS_COOKIE, value, cookieOptions(req, PORTAL_SESSION_TTL_S))
  return true
}

export const clearAccessCookie = (res: NextResponse, req: NextRequest) => res.cookies.set(ACCESS_COOKIE, '', cookieOptions(req, 0))

/** La persona sta usando la pagina: se il cookie ha piu' di un giorno, altri 180 giorni da adesso. */
export function refreshAccessCookie(res: NextResponse, req: NextRequest, access: AccessRow): NextResponse {
  const session = readAccessSession(req.cookies.get(ACCESS_COOKIE)?.value)
  if (session && session.id === access.id && session.version === access.session_version && accessSessionNeedsRefresh(session)) setAccessCookie(res, req, access)
  return res
}

/** Cookie «in attesa del codice» (10 minuti): non apre nessun progetto. */
export function setPendingCookie(res: NextResponse, req: NextRequest, access: AccessRow, nonce: string): boolean {
  const value = signPending(access, nonce)
  if (!value) return false
  res.cookies.set(PENDING_COOKIE, value, cookieOptions(req, PENDING_TTL_S))
  return true
}

export const clearPendingCookie = (res: NextResponse, req: NextRequest) => res.cookies.set(PENDING_COOKIE, '', cookieOptions(req, 0))

/** Cookie dell'admin per i progetti (si chiede con il suo accesso al pannello). */
export function setAdminCookie(res: NextResponse, req: NextRequest, email: string): boolean {
  const value = signAdminSession(email)
  if (!value) return false
  res.cookies.set(ADMIN_COOKIE, value, cookieOptions(req, ADMIN_SESSION_TTL_S))
  return true
}

export const isAdminCookie = (req: NextRequest) => readAdminSession(req.cookies.get(ADMIN_COOKIE)?.value) !== null

/** La persona del cookie, verificata ora (password cambiata o accesso eliminato: null). */
export async function personFromCookie(req: NextRequest): Promise<AccessRow | null> {
  return accessForSession(readAccessSession(req.cookies.get(ACCESS_COOKIE)?.value))
}

/** Admin (cookie) o persona; null se nessuno dei due. */
export async function viewerFromCookies(req: NextRequest): Promise<Viewer | null> {
  if (isAdminCookie(req)) return { kind: 'admin' }
  const access = await personFromCookie(req)
  return access ? { kind: 'person', access } : null
}

export const NEED_LOGIN = { error: 'Entra con il tuo nome e la tua password.', needPassword: true }
export const NOT_FOUND = { error: 'Progetto non trovato o non più condiviso con te.' }

/**
 * Progetto aperto dalla pagina generale (per id): l'admin li apre tutti, una persona
 * solo quelli del suo accesso. Per gli altri lo stesso «non trovato» (non si scopre
 * nemmeno se esiste).
 */
export async function projectAccess(req: NextRequest, id: string): Promise<{ board: BoardRow; viewer: Viewer } | { res: NextResponse }> {
  const viewer = await viewerFromCookies(req)
  if (!viewer) return { res: json(NEED_LOGIN, 401) }
  if (viewer.kind === 'person' && !viewer.access.board_ids.includes(String(id).toLowerCase())) return { res: json(NOT_FOUND, 404) }
  const board = await boardById(id)
  if (!board) return { res: json(NOT_FOUND, 404) }
  return { board, viewer }
}

/** Todo list del link, solo se chi chiede ha il cookie giusto per QUESTA todo list (o e' l'admin). */
export async function guestBoard(req: NextRequest, token: string): Promise<{ board: BoardRow; viewer: Viewer } | { res: NextResponse }> {
  const board = await boardByToken(token)
  if (!board) return { res: json(INVALID_LINK, 404) }
  if (verifySession(req.cookies.get(sessionCookieName(board.id))?.value, board)) return { board, viewer: isAdminCookie(req) ? { kind: 'admin' } : { kind: 'link' } }
  return { res: json({ error: 'Serve la password per aprire questa todo list.', needPassword: true }, 401) }
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

/** Fatta (o spostata in «Fatto») da chi non e' l'admin: email all'admin dopo la risposta. */
function noticeDone(req: NextRequest, board: BoardRow, viewer: Viewer, taskId: string, fromListId: string, toListId: string) {
  if (viewer.kind === 'admin') return
  const who = viewer.kind === 'person' ? viewer.access.name : LINK_GUEST_NAME
  const origin = todoOrigin(req.nextUrl.origin)
  runAfter(() => notifyTaskDone({ board, who, taskId, fromListId, toListId, origin }))
}

/** Solo l'admin modifica il progetto (tabelle, attivita', foto). */
export const canEditProject = (viewer: Viewer) => viewer.kind === 'admin'

export const READ_ONLY_MESSAGE = 'Questo progetto lo modifica solo l’admin: puoi spostare le attività e segnarle come fatte.'

/** Cosa puo' fare chi non e' l'admin: spostare un'attivita' o segnarla fatta / da fare (e nient'altro). */
function allowedForGuest(body: Record<string, unknown>): boolean {
  if (body.op === 'moveTask') return true
  if (body.op !== 'updateTask') return false
  const fields = body.fields
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return false
  const keys = Object.keys(fields)
  return keys.length === 1 && keys[0] === 'done' && typeof (fields as Record<string, unknown>).done === 'boolean'
}

/**
 * Le operazioni sulla todo list. L'admin puo' tutto; le persone e chi ha il link
 * possono solo spostare le attivita' e segnarle fatte: niente tabelle nuove, rinominate,
 * spostate o cancellate, niente attivita' nuove, modificate o cancellate, niente foto.
 */
export async function applyOp(req: NextRequest, board: BoardRow, viewer: Viewer, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!canEditProject(viewer) && !allowedForGuest(body)) throw new TodoError(READ_ONLY_MESSAGE, 403)
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
      // Per chi l'ha aggiunta non e' una «nuova attivita'» nella campanella.
      if (viewer.kind !== 'link') await rememberOwnTask(viewerKey(viewer.kind === 'admin' ? viewer : { kind: 'person', id: viewer.access.id }), r.id).catch(() => undefined)
      return { id: r.id }
    }
    case 'updateTask': {
      const r = await updateTask(board, body.taskId, body.fields)
      if (r.linksChanged) runAfter(() => refreshLinks(board.id, body.taskId as string))
      if (r.becameDone) noticeDone(req, board, viewer, body.taskId as string, r.listId, r.listId)
      return {}
    }
    case 'moveTask': {
      const m = await moveTask(board, body.taskId, body.listId, body.index)
      if (m.intoDoneList) noticeDone(req, board, viewer, body.taskId as string, m.fromListId, m.toListId)
      return {}
    }
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
