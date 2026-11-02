'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase-client'

// Stato dell'area clienti: sessione, spazi di lavoro dell'utente e spazio scelto.
// Tutte le chiamate alle API dell'area clienti passano da appFetch, che aggiunge
// il token e lo spazio di lavoro.

export type Workspace = { id: string; name: string; plan: string; role: 'owner' | 'admin' | 'member' }

type State = {
  ready: boolean
  session: Session | null
  email: string | null
  workspaces: Workspace[]
  workspace: Workspace | null
  error: string | null
  selectWorkspace: (id: string) => void
  reload: () => Promise<void>
  signOut: () => Promise<void>
  appFetch: (url: string, init?: RequestInit) => Promise<Response>
}

const Ctx = createContext<State | null>(null)
const CURRENT_KEY = 'fv_app_workspace'

function storedWorkspace(): string | null {
  try {
    return localStorage.getItem(CURRENT_KEY)
  } catch {
    return null
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const supabase = createClient()
  const [session, setSession] = useState<Session | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [loaded, setLoaded] = useState(false)
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setSessionReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [supabase])

  const token = session?.access_token ?? null

  const reload = useCallback(async () => {
    if (!token) {
      setWorkspaces([])
      setLoaded(true)
      return
    }
    setError(null)
    const res = await fetch('/api/app/workspaces', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (!res?.ok) {
      setError(data.error || 'Connessione non riuscita, riprova.')
    } else {
      setWorkspaces(data.workspaces || [])
      setEmail(data.email || null)
    }
    setLoaded(true)
  }, [token])

  useEffect(() => {
    if (!sessionReady) return
    setLoaded(false)
    reload()
  }, [sessionReady, reload])

  const workspace = useMemo(() => {
    const wanted = currentId || storedWorkspace()
    return workspaces.find((w) => w.id === wanted) || workspaces[0] || null
  }, [workspaces, currentId])

  const selectWorkspace = useCallback((id: string) => {
    setCurrentId(id)
    try {
      localStorage.setItem(CURRENT_KEY, id)
    } catch {}
  }, [])

  const appFetch = useCallback(
    (url: string, init: RequestInit = {}) =>
      fetch(url, {
        ...init,
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(workspace ? { 'x-workspace-id': workspace.id } : {}),
          ...(init.headers || {}),
        },
      }),
    [token, workspace]
  )

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setWorkspaces([])
  }, [supabase])

  const value: State = {
    ready: sessionReady && (loaded || !session),
    session,
    email: email || session?.user.email || null,
    workspaces,
    workspace,
    error,
    selectWorkspace,
    reload,
    signOut,
    appFetch,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useWorkspace(): State {
  const value = useContext(Ctx)
  if (!value) throw new Error('useWorkspace va usato dentro WorkspaceProvider')
  return value
}
