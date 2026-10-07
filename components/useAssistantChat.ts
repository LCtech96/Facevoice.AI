'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getAccessToken } from '@/lib/session-token'

// Stato dell'assistente letto dal server: la conversazione e il lavoro in corso
// restano anche chiudendo o cambiando pagina. Mentre l'assistente lavora la
// pagina si aggiorna ogni secondo e mezzo; le modifiche alle bozze si salvano.

export type Draft = {
  leadId: string
  name: string
  email: string
  kind: 'first' | 'followup'
  subject: string
  body: string
  threadId?: string | null
}

export type SocialAction = {
  kind: 'social_message'
  platform: 'instagram' | 'facebook'
  key: string
  name: string
  text: string
  lastIncomingAt: string | null
  state?: 'sending' | 'sent' | 'error'
  error?: string
}

export type Usage = { calls: number; input: number; output: number; cost: number; models: Record<string, number> }

export type Turn = { id: string; role: 'user' | 'assistant'; text: string; actions?: SocialAction[]; usage?: Usage }

export type Job = {
  id: string
  status: 'running' | 'done' | 'error'
  statusText: string
  startedAt: string
  updatedAt: string
  result?: { refresh?: boolean; confirmSend?: boolean; focus?: { label: string; ids: string[] } }
  handled?: boolean
  model?: string
  usage?: Usage
}

type ServerState = { turns: Turn[]; drafts: Draft[]; job: Job | null; running: boolean }

export async function authFetch(url: string, init: RequestInit = {}) {
  const token = await getAccessToken()
  return fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  })
}

const API = '/api/admin/leads/assistant'
const FAST_POLL_MS = 1500
const SLOW_POLL_MS = 15000

export function useAssistantChat(scope: 'leads' | 'super', onJobDone?: (job: Job) => void | Promise<void>) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [drafts, setDraftsState] = useState<Draft[]>([])
  const [job, setJob] = useState<Job | null>(null)
  const [running, setRunning] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const draftsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftsDirty = useRef(false)
  const doneRef = useRef(onJobDone)
  doneRef.current = onJobDone

  const apply = useCallback((data: ServerState) => {
    setTurns(data.turns || [])
    // Bozze in modifica sulla pagina: non sovrascriverle mentre si scrive.
    if (!draftsDirty.current) setDraftsState(data.drafts || [])
    setJob(data.job || null)
    setRunning(Boolean(data.running))
    setLoaded(true)
  }, [])

  const refresh = useCallback(async () => {
    const res = await authFetch(`${API}?scope=${scope}`).catch(() => null)
    if (!res?.ok) return
    apply(await res.json())
  }, [scope, apply])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Aggiornamento: veloce mentre lavora, lento altrimenti; fermo a pagina nascosta.
  useEffect(() => {
    const timer = setInterval(
      () => {
        if (document.visibilityState === 'visible') refresh()
      },
      running ? FAST_POLL_MS : SLOW_POLL_MS
    )
    const onVisible = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [running, refresh])

  // Lavoro appena finito (anche se era partito con la pagina chiusa): azioni una sola volta.
  useEffect(() => {
    if (!job || running || job.handled || job.status !== 'done') return
    const current = job
    setJob({ ...current, handled: true })
    authFetch(API, { method: 'PUT', body: JSON.stringify({ scope, handled: current.id }) }).catch(() => null)
    doneRef.current?.(current)
  }, [job, running, scope])

  const put = useCallback(
    async (body: Record<string, unknown>) => {
      const res = await authFetch(API, { method: 'PUT', body: JSON.stringify({ scope, ...body }) }).catch(() => null)
      if (res?.ok) apply(await res.json())
    },
    [scope, apply]
  )

  const ask = useCallback(
    async (message: string, model?: string) => {
      const text = message.trim()
      if (!text || running) return false
      setError(null)
      // Mostra subito il messaggio, poi lo stato vero arriva dal server.
      setTurns((t) => [...t, { id: `local-${Date.now()}`, role: 'user', text }])
      setRunning(true)
      const res = await authFetch(API, { method: 'POST', body: JSON.stringify({ scope, message: text, model }) }).catch(() => null)
      const data = res ? await res.json().catch(() => ({})) : {}
      if (!res?.ok) {
        setError(data.error || 'Invio non riuscito, riprova.')
        await refresh()
        return false
      }
      apply(data)
      return true
    },
    [scope, running, apply, refresh]
  )

  const setDrafts = useCallback(
    (update: Draft[] | ((list: Draft[]) => Draft[])) => {
      setDraftsState((list) => {
        const next = typeof update === 'function' ? update(list) : update
        draftsDirty.current = true
        if (draftsTimer.current) clearTimeout(draftsTimer.current)
        draftsTimer.current = setTimeout(async () => {
          await authFetch(API, { method: 'PUT', body: JSON.stringify({ scope, drafts: next }) }).catch(() => null)
          draftsDirty.current = false
        }, 700)
        return next
      })
    },
    [scope]
  )

  const appendTurn = useCallback((role: Turn['role'], text: string) => put({ appendTurns: [{ role, text }] }), [put])
  const updateActions = useCallback(
    (turnId: string, actions: SocialAction[]) => {
      setTurns((list) => list.map((t) => (t.id === turnId ? { ...t, actions } : t)))
      return put({ updateTurn: { id: turnId, actions } })
    },
    [put]
  )
  const clearTurns = useCallback(() => put({ clearTurns: true }), [put])

  return { turns, drafts, job, running, loaded, error, ask, setDrafts, appendTurn, updateActions, clearTurns, refresh }
}
