'use client'

import { IMAGE_TYPES, LIMITS, positionAt, type TodoBoardState, type TodoTask } from '@/lib/todo-shared'

// Chiamate della pagina della todo list verso le sue route (/api/todo/<link>).
// Il cookie di accesso viaggia da solo (HttpOnly): qui non c'e' nessun segreto.

export type OpResult = { ok: true; data: Record<string, unknown> } | { ok: false; error: string; status: number; needPassword?: boolean }

export async function boardOp(token: string, body: Record<string, unknown>): Promise<OpResult> {
  const res = await fetch(`/api/todo/${encodeURIComponent(token)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null)
  const data = res ? await res.json().catch(() => ({})) : {}
  if (res?.ok) return { ok: true, data }
  return { ok: false, error: data?.error || 'Connessione assente: riprova.', status: res?.status || 0, needPassword: Boolean(data?.needPassword) }
}

export type LoadResult = { ok: true; state: TodoBoardState } | { ok: false; error: string; status: number; needPassword?: boolean }

export async function loadBoard(token: string): Promise<LoadResult> {
  const res = await fetch(`/api/todo/${encodeURIComponent(token)}`, { credentials: 'same-origin', cache: 'no-store' }).catch(() => null)
  const data = res ? await res.json().catch(() => null) : null
  if (res?.ok && data?.lists) return { ok: true, state: data as TodoBoardState }
  return { ok: false, error: data?.error || 'Connessione assente: riprova.', status: res?.status || 0, needPassword: Boolean(data?.needPassword) }
}

/** Carica una foto: link a tempo dal server, invio diretto allo spazio privato, poi conferma. */
export async function uploadImage(token: string, taskId: string, file: File): Promise<string | null> {
  if (!IMAGE_TYPES[file.type]) return `«${file.name}»: si possono caricare solo immagini JPG, PNG, WEBP o GIF.`
  if (file.size > LIMITS.imageBytes) return `«${file.name}» è troppo grande (massimo 10 MB).`
  const ticket = await boardOp(token, { op: 'uploadUrl', taskId, contentType: file.type, size: file.size })
  if (!ticket.ok) return ticket.error
  const { signedUrl, path } = ticket.data as { signedUrl: string; path: string }
  const form = new FormData()
  form.append('cacheControl', '3600')
  form.append('', file)
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const put = await fetch(signedUrl, { method: 'PUT', body: form, headers: { 'x-upsert': 'false', ...(anon ? { apikey: anon } : {}) } }).catch(() => null)
  if (!put?.ok) return `«${file.name}»: caricamento non riuscito, riprova.`
  const done = await boardOp(token, { op: 'addImage', taskId, path, name: file.name })
  return done.ok ? null : done.error
}

/** Spostamento mostrato subito (prima della risposta del server), con la stessa regola delle posizioni. */
export function moveLocally(state: TodoBoardState, taskId: string, listId: string, index: number): TodoBoardState {
  const others = state.tasks.filter((t) => t.list_id === listId && t.id !== taskId).sort((a, b) => a.position - b.position)
  let pos = positionAt(others.map((t) => t.position), index)
  if (pos === null) pos = (others[Math.max(0, index - 1)]?.position ?? 0) + 1e-9
  const tasks = state.tasks.map((t) => (t.id === taskId ? { ...t, list_id: listId, position: pos as number } : t))
  return { ...state, tasks }
}

export function patchLocally(state: TodoBoardState, taskId: string, fields: Partial<TodoTask>): TodoBoardState {
  return { ...state, tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, ...fields } : t)) }
}

export const tasksOf = (state: TodoBoardState, listId: string) => state.tasks.filter((t) => t.list_id === listId).sort((a, b) => a.position - b.position)
