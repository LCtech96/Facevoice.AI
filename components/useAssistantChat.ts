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

type ActionState = { state?: 'sending' | 'sent' | 'error'; error?: string }

/** Stato di una scheda di conferma (lo decide il server). */
export type ConfirmState = 'pending' | 'running' | 'done' | 'failed' | 'discarded' | 'expired' | 'unknown'

/**
 * Doppia conferma: azione preparata dall'assistente (messaggio, email, pubblicazione…)
 * con il contenuto esatto. Parte solo con "Accetta e invia" (o "Conferma") sulla scheda.
 */
export type ConfirmAction = {
  kind: 'confirm'
  id: string
  action: string
  title: string
  text?: string
  editable?: boolean
  maxLength?: number
  lines?: string[]
  items?: { label: string; text: string }[]
  images?: string[]
  warning?: string
  confirmLabel: string
  expiresAt: string
  state: ConfirmState
  outcome?: string
  error?: string
  retryable?: boolean
  /** Contratti: la scheda chiede il PIN (resta nel browser fino al clic, mai nella chat). */
  pin?: boolean
  contractId?: string
}

/** Documento scritto dall'assistente: si apre in PDF con un tocco. */
export type DocumentAction = {
  kind: 'document'
  docId: string
  version: number
  title: string
  docKind: string
  basedOn: { name: string; platform: string } | null
  pages: number
  placeholders: string[]
  createdAt: string
}

export type SocialAction =
  | ConfirmAction
  | DocumentAction
  | ({
      /** Scheda delle chat di prima: messaggio con il pulsante Invia (le nuove sono "confirm"). */
      kind: 'social_message'
      platform: 'instagram' | 'facebook'
      key: string
      name: string
      text: string
      lastIncomingAt: string | null
    } & ActionState)
  | ({
      /** Carosello creato dalla super chat, da pubblicare con il pulsante. */
      kind: 'post_preview'
      draftId: string
      title: string
      urls: string[]
      caption: string
      facebook: string
      platforms?: ('instagram' | 'facebook')[]
      published?: string[]
      /** Si possono toccare le singole slide (modificare, spostare, togliere). */
      editable?: boolean
      /**
       * Didascalia, testo Facebook e social di questa scheda sono suoi (cambiati da Luca
       * o ripresi dalla scheda di prima): una scheda nuova dello stesso carosello li riprende.
       */
      edited?: boolean
    } & ActionState)

export type Usage = { calls: number; input: number; output: number; cost: number; models: Record<string, number> }

export type Turn = { id: string; role: 'user' | 'assistant'; text: string; actions?: SocialAction[]; usage?: Usage; job?: string; images?: string[] }

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
  /** Limite di spesa letto dalla richiesta. */
  budget?: { tokens?: number; usd?: number } | null
}

/** Chat salvata (current: quella aperta adesso). */
export type ChatInfo = { id: string; title: string; updatedAt: string; count: number; current?: boolean }

type ServerState = { turns: Turn[]; drafts: Draft[]; job: Job | null; running: boolean; chatId?: string | null }

export type PutResult = { ok: boolean; error?: string }

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
  const [turns, setTurnsState] = useState<Turn[]>([])
  const [drafts, setDraftsState] = useState<Draft[]>([])
  const [job, setJob] = useState<Job | null>(null)
  const [running, setRunning] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chatId, setChatId] = useState<string | null>(null)
  const draftsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftsDirty = useRef(false)
  const doneRef = useRef(onJobDone)
  doneRef.current = onJobDone
  // Ultima lista nota (anche prima del render): piu' modifiche di fila a una scheda non si perdono.
  const turnsRef = useRef<Turn[]>([])
  // Ogni scrittura alza il contatore: una lettura partita prima non sovrascrive cio' che e' stato appena salvato.
  const gen = useRef(0)

  const setTurns = useCallback((next: Turn[]) => {
    turnsRef.current = next
    setTurnsState(next)
  }, [])

  const apply = useCallback(
    (data: ServerState) => {
      setTurns(data.turns || [])
      // Bozze in modifica sulla pagina: non sovrascriverle mentre si scrive.
      if (!draftsDirty.current) setDraftsState(data.drafts || [])
      setJob(data.job || null)
      setRunning(Boolean(data.running))
      setChatId(data.chatId ?? null)
      setLoaded(true)
    },
    [setTurns]
  )

  const refresh = useCallback(async () => {
    const started = gen.current
    const res = await authFetch(`${API}?scope=${scope}`).catch(() => null)
    if (!res?.ok) return
    const data = await res.json().catch(() => null)
    if (data && gen.current === started) apply(data)
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
    async (body: Record<string, unknown>): Promise<PutResult> => {
      const mine = ++gen.current
      // Cambio di chat: la risposta e' la chat aperta adesso sul server, si mostra sempre.
      const switching = body.newChat === true || typeof body.openChat === 'string'
      const res = await authFetch(API, { method: 'PUT', body: JSON.stringify({ scope, ...body }) }).catch(() => null)
      const data = res ? await res.json().catch(() => ({})) : {}
      if (res?.ok) {
        if (gen.current === mine || switching) apply(data)
        if (switching) {
          // Una scrittura partita prima che risponde dopo non rimette la chat di prima.
          gen.current++
          void refresh()
        }
        return { ok: true }
      }
      return { ok: false, error: data.error || (res ? 'Operazione non riuscita, riprova.' : 'Connessione interrotta, riprova.') }
    },
    [scope, apply, refresh]
  )

  const ask = useCallback(
    async (message: string, model?: string, images?: { data?: string; path?: string; thumb: string }[]) => {
      const text = message.trim()
      if ((!text && !images?.length) || running) return false
      setError(null)
      const mine = ++gen.current
      // Mostra subito il messaggio, poi lo stato vero arriva dal server.
      setTurns([...turnsRef.current, { id: `local-${Date.now()}`, role: 'user', text, images: images?.map((i) => i.thumb) }])
      setRunning(true)
      const res = await authFetch(API, {
        method: 'POST',
        body: JSON.stringify({
          scope,
          message: text,
          model,
          // Foto gia' caricate (percorso) o, per le chat che non caricano, l'immagine intera.
          images: images?.filter((i) => i.data && !i.path).map(({ data, thumb }) => ({ data, thumb })),
          uploads: images?.filter((i) => i.path).map(({ path, thumb }) => ({ path, thumb })),
        }),
      }).catch(() => null)
      const data = res ? await res.json().catch(() => ({})) : {}
      if (!res?.ok) {
        setError(data.error || 'Invio non riuscito, riprova.')
        await refresh()
        return false
      }
      if (gen.current === mine) apply(data)
      else setRunning(true)
      return true
    },
    [scope, running, apply, refresh, setTurns]
  )

  const setDrafts = useCallback(
    (update: Draft[] | ((list: Draft[]) => Draft[])) => {
      setDraftsState((list) => {
        const next = typeof update === 'function' ? update(list) : update
        draftsDirty.current = true
        if (draftsTimer.current) clearTimeout(draftsTimer.current)
        draftsTimer.current = setTimeout(async () => {
          gen.current++
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
      setTurns(turnsRef.current.map((t) => (t.id === turnId ? { ...t, actions } : t)))
      return put({ updateTurn: { id: turnId, actions } })
    },
    [put, setTurns]
  )
  /**
   * Cambia solo alcuni campi di un'azione (parte dall'ultima versione, anche con piu' modifiche di fila).
   * patch puo' essere una funzione: riceve l'azione com'e' adesso (non com'era all'ultimo disegno).
   */
  const patchAction = useCallback(
    (turnId: string, index: number, patch: Partial<SocialAction> | ((current: SocialAction) => Partial<SocialAction>)) => {
      const turn = turnsRef.current.find((t) => t.id === turnId)
      if (!turn?.actions?.[index]) return Promise.resolve<PutResult>({ ok: false })
      return updateActions(
        turnId,
        turn.actions.map((a, i) => (i === index ? ({ ...a, ...(typeof patch === 'function' ? patch(a) : patch) } as SocialAction) : a))
      )
    },
    [updateActions]
  )
  const clearTurns = useCallback(() => put({ clearTurns: true }), [put])
  /** Nuova chat vuota: quella di adesso resta tra le chat salvate. */
  const newChat = useCallback(() => put({ newChat: true }), [put])
  /** Riapre una chat salvata. */
  const openChat = useCallback((id: string) => put({ openChat: id }), [put])
  /** Elenco delle chat salvate (la prima e' quella aperta); null se non si legge. */
  const listChats = useCallback(async (): Promise<ChatInfo[] | null> => {
    const res = await authFetch(`${API}?scope=${scope}&chats=1`).catch(() => null)
    if (!res?.ok) return null
    const data = await res.json().catch(() => null)
    return Array.isArray(data?.chats) ? data.chats : null
  }, [scope])

  return {
    turns,
    drafts,
    job,
    running,
    loaded,
    error,
    chatId,
    ask,
    setDrafts,
    appendTurn,
    updateActions,
    patchAction,
    clearTurns,
    newChat,
    openChat,
    listChats,
    refresh,
  }
}
