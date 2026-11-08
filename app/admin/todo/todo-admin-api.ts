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
