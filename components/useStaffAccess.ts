'use client'

import { useEffect, useState } from 'react'
import { getAccessToken } from '@/lib/session-token'
import { hasCap, type StaffPage, type StaffPermissions } from '@/lib/staff-pages'

// Pagine del gestionale aperte all'utente (admin: tutte). Serve solo a mostrare
// menu e pulsanti giusti: i permessi veri li controlla sempre il server.

type Access = { isAdmin: boolean; permissions: StaffPermissions }

let cached: { token: string; promise: Promise<Access> } | null = null

async function loadAccess(): Promise<Access> {
  const token = await getAccessToken()
  if (!token) return { isAdmin: false, permissions: {} }
  if (cached?.token === token) return cached.promise
  const promise = fetch('/api/staff/me', { headers: { Authorization: `Bearer ${token}` } })
    .then((res) => (res.ok ? res.json() : { isAdmin: false, permissions: {} }))
    .catch(() => ({ isAdmin: false, permissions: {} }))
  cached = { token, promise }
  return promise
}

export function useStaffAccess(enabled = true) {
  const [access, setAccess] = useState<Access | null>(null)

  useEffect(() => {
    if (!enabled) return
    let alive = true
    loadAccess().then((a) => alive && setAccess(a))
    return () => {
      alive = false
    }
  }, [enabled])

  const can = (page: StaffPage, cap = 'view') => Boolean(access && (access.isAdmin || hasCap(access.permissions, page, cap)))

  return { loading: enabled && access === null, isAdmin: Boolean(access?.isAdmin), permissions: access?.permissions ?? {}, can }
}
