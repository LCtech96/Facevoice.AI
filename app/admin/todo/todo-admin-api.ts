'use client'

import { getAccessToken } from '@/lib/session-token'

/** Chiamata alle route admin della todo list con il token di accesso dell'admin. */
export async function adminTodoFetch(url: string, init: RequestInit = {}) {
  const token = await getAccessToken()
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  }).catch(() => null)
  const data = res ? await res.json().catch(() => ({})) : {}
  return { ok: Boolean(res?.ok), status: res?.status || 0, data: data as Record<string, any> }
}

/** Copia negli appunti (con ripiego per i browser che non lo permettono). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    window.prompt('Copia il link:', text)
    return false
  }
}

/** Password facile da dettare (niente 0/O, 1/l/I): 10 caratteri casuali. */
export function generatePassword(length = 10): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = new Uint32Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}

export type AdminBoard = { id: string; name: string; createdAt: string; updatedAt: string; link: string | null }
export type AdminAccess = { id: string; name: string; boardIds: string[]; createdAt: string }

/** Cookie dell'admin per aprire i progetti (anche le foto). */
export async function ensureAdminCookie(): Promise<boolean> {
  return (await adminTodoFetch('/api/admin/todo/session', { method: 'POST' })).ok
}
