'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase-client'
import { USAGE_REFRESH_EVENT } from '@/lib/usage-shared'
import { TERMS_REQUIRED_EVENT } from '@/lib/terms'

// Stato dell'area clienti: sessione, spazi di lavoro dell'utente e spazio scelto.
// Tutte le chiamate alle API dell'area clienti passano da appFetch, che aggiunge
// il token e lo spazio di lavoro. Con gli spazi arriva anche se la persona ha
// l'Assistente attivo e se vede le Automazioni (le accende Facevoice, persona per persona).
// Due modi di essere dentro: la sessione Supabase del titolare (Google o la sua email e
// password) oppure l'accesso firmato di chi e' entrato con la password dei collaboratori
// (salvato su questo dispositivo). Se il titolare la cambia o la spegne, il server risponde
// 401 shared_revoked e il collaboratore esce subito (anche senza toccare niente: controllo
// ogni 30 secondi). «Esci» chiude solo questo dispositivo, mai le sessioni degli altri.

export type Workspace = { id: string; name: string; plan: string; role: 'owner' | 'admin' | 'member' }

type State = {
  ready: boolean
  session: Session | null
  email: string | null
  workspaces: Workspace[]
  workspace: Workspace | null
  error: string | null
  /** Assistente attivo per questa persona; null: non si sa (lettura non riuscita), decide il server. */
  assistant: boolean | null
  /** Rilegge soltanto lo stato dell'Assistente (es. tornando sulla pagina dopo aver chiesto di attivarlo); null: non letto. */
  refreshAssistant: () => Promise<boolean | null>
  /** Pagina Automazioni visibile per questa persona; null: non si sa, decide il server. */
  automations: boolean | null
  /** Rilegge lo stato delle Automazioni; null: non letto. */
  refreshAutomations: () => Promise<boolean | null>
  /** Video automazione (scheda in Automazioni) visibile per questa persona; null: non si sa, decide il server. */
  videoReplies: boolean | null
  selectWorkspace: (id: string) => void
  reload: () => Promise<void>
  signOut: () => Promise<void>
  appFetch: (url: string, init?: RequestInit) => Promise<Response>
  /** Utente collegato (titolare o collaboratore: lo stesso account). */
  userId: string | null
  /** Entrato con la password dei collaboratori (non il titolare). */
  isShared: boolean
  /** Perche' si e' usciti da soli (password dei collaboratori cambiata o spenta), da mostrare all'accesso. */
  sessionNotice: string | null
  clearSessionNotice: () => void
  /** Ultima email usata su questo dispositivo (per riempire l'accesso). */
  lastEmail: string | null
  /** Entrata riuscita con la password dei collaboratori. */
  startSharedSession: (shared: SharedSession) => void
}

export type SharedSession = { token: string; exp: number; userId: string; email: string }

const Ctx = createContext<State | null>(null)
const CURRENT_KEY = 'fv_app_workspace'
const SHARED_KEY = 'fv_shared_session'
const LAST_EMAIL_KEY = 'fv_last_email'
/** Come si e' entrati l'ultima volta su questo dispositivo ('owner' | 'shared'): l'accesso lo usa per i suggerimenti. */
export const LAST_KIND_KEY = 'fv_last_login_kind'
const HEARTBEAT_MS = 30_000

const NOTICES = {
  changed: 'La password dei collaboratori è stata cambiata dal titolare: entra con quella nuova.',
  disabled: 'Il titolare ha spento l’accesso con la password dei collaboratori.',
  expired: 'Accesso scaduto: entra di nuovo con l’email e la password dei collaboratori.',
} as const
type EndReason = keyof typeof NOTICES
const endReason = (value: unknown): EndReason => (value === 'disabled' || value === 'expired' ? value : 'changed')

function readShared(): SharedSession | null {
  try {
    const v = JSON.parse(localStorage.getItem(SHARED_KEY) || 'null')
    if (!v || typeof v.token !== 'string' || typeof v.email !== 'string' || typeof v.userId !== 'string' || !Number.isFinite(v.exp)) return null
    if (v.exp * 1000 <= Date.now()) {
      localStorage.removeItem(SHARED_KEY)
      return null
    }
    return v as SharedSession
  } catch {
    return null
  }
}

function storage(action: (ls: Storage) => void) {
  try {
    action(localStorage)
  } catch {}
}

/** Chiave della sessione Supabase in questo browser (sb-<progetto>-auth-token). */
function supabaseStorageKey(): string | null {
  try {
    return `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').hostname.split('.')[0]}-auth-token`
  } catch {
    return null
  }
}

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
  const [assistant, setAssistant] = useState<boolean | null>(null)
  const [automations, setAutomations] = useState<boolean | null>(null)
  const [videoReplies, setVideoReplies] = useState<boolean | null>(null)
  const [shared, setShared] = useState<SharedSession | null>(null)
  const [sessionNotice, setSessionNotice] = useState<string | null>(null)
  const [lastEmail, setLastEmail] = useState<string | null>(null)
  const ending = useRef(false)

  useEffect(() => {
    // L'accesso dei collaboratori salvato su questo dispositivo (solo se non c'e' una sessione Supabase).
    const saved = readShared()
    storage((ls) => setLastEmail(ls.getItem(LAST_EMAIL_KEY)))
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session && saved) setShared(saved)
      setSessionReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      // Il titolare entra (Google o email): l'accesso da collaboratore su questo dispositivo non serve piu'.
      if (next) {
        storage((ls) => {
          ls.removeItem(SHARED_KEY)
          ls.setItem(LAST_KIND_KEY, 'owner')
        })
        setShared(null)
        setSessionNotice(null)
      }
    })
    return () => data.subscription.unsubscribe()
  }, [supabase])

  const token = session?.access_token ?? shared?.token ?? null

  /**
   * Esce chi era entrato con la password dei collaboratori (cambiata o spenta dal titolare, o
   * accesso scaduto). Si toglie solo l'accesso rifiutato: se nel frattempo (anche da un'altra
   * scheda) si e' entrati di nuovo, si passa al nuovo accesso salvato (questa scheda puo' non
   * averlo saputo, per esempio se tornava dalla cache del browser).
   */
  const endShared = useCallback((reason: EndReason, usedToken: string | null) => {
    if (ending.current) return
    const current = readShared()
    if (usedToken && current && current.token !== usedToken) {
      setShared((cur) => (cur?.token === current.token ? cur : current))
      return
    }
    ending.current = true
    storage((ls) => ls.removeItem(SHARED_KEY))
    setShared(null)
    setWorkspaces([])
    setAssistant(null)
    setAutomations(null)
    setVideoReplies(null)
    setSessionNotice(NOTICES[reason])
  }, [])

  /** 401 shared_revoked: si esce subito. Ogni altro 401 (o un errore di rete) non fa uscire nessuno. */
  const checkRevoked = useCallback(
    (res: Response | null, usedToken: string | null) => {
      if (res?.status !== 401 || !usedToken?.startsWith('fvs1.')) return
      res
        .clone()
        .json()
        .then((data) => {
          if (data?.code === 'shared_revoked') endShared(endReason(data.reason), usedToken)
        })
        .catch(() => undefined)
    },
    [endShared]
  )

  // Altre schede: accesso dei collaboratori fatto o tolto la' vale anche qui. Anche tornando
  // sulla scheda o dalla cache del browser (back/forward), che non riceve gli eventi «storage».
  useEffect(() => {
    const sync = () => {
      const next = readShared()
      setShared((cur) => (cur?.token === next?.token ? cur : next))
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === SHARED_KEY || e.key === null) sync()
    }
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) sync()
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('focus', sync)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('focus', sync)
    }
  }, [])

  // Nuovo accesso da collaboratore: si puo' uscire di nuovo in futuro.
  useEffect(() => {
    if (shared) ending.current = false
  }, [shared])

  // Collaboratori: controllo ogni 30 secondi (con la pagina in vista) e tornando sulla pagina.
  useEffect(() => {
    if (!shared) return
    const ping = () => {
      if (document.visibilityState !== 'visible') return
      // Scaduto anche sul dispositivo: si esce senza chiedere al server.
      if (shared.exp * 1000 <= Date.now()) return endShared('expired', shared.token)
      fetch('/api/app/session', { headers: { Authorization: `Bearer ${shared.token}` }, cache: 'no-store' })
        .then((res) => checkRevoked(res, shared.token))
        .catch(() => undefined)
    }
    const timer = setInterval(ping, HEARTBEAT_MS)
    document.addEventListener('visibilitychange', ping)
    window.addEventListener('focus', ping)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', ping)
      window.removeEventListener('focus', ping)
    }
  }, [shared, checkRevoked, endShared])

  const reload = useCallback(async () => {
    if (!token) {
      setWorkspaces([])
      setLoaded(true)
      return
    }
    setError(null)
    const res = await fetch('/api/app/workspaces', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (res?.status === 401 && data?.code === 'shared_revoked' && token.startsWith('fvs1.')) {
      endShared(endReason(data.reason), token)
    } else if (!res?.ok) {
      setError(data.error || 'Connessione non riuscita, riprova.')
    } else {
      setWorkspaces(data.workspaces || [])
      setEmail(data.email || null)
      setAssistant(typeof data.assistant === 'boolean' ? data.assistant : null)
      setAutomations(typeof data.automations === 'boolean' ? data.automations : null)
      setVideoReplies(typeof data.videoReplies === 'boolean' ? data.videoReplies : null)
    }
    setLoaded(true)
  }, [token, endShared])

  useEffect(() => {
    if (!sessionReady) return
    setLoaded(false)
    reload()
  }, [sessionReady, reload])

  const refreshAssistant = useCallback(async (): Promise<boolean | null> => {
    if (!token) return null
    const res = await fetch('/api/app/workspaces', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }).catch(() => null)
    checkRevoked(res, token)
    const data = res?.ok ? await res.json().catch(() => null) : null
    if (typeof data?.assistant !== 'boolean') return null
    setAssistant(data.assistant)
    if (typeof data.automations === 'boolean') setAutomations(data.automations)
    return data.assistant
  }, [token, checkRevoked])

  const refreshAutomations = useCallback(async (): Promise<boolean | null> => {
    if (!token) return null
    const res = await fetch('/api/app/workspaces', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }).catch(() => null)
    checkRevoked(res, token)
    const data = res?.ok ? await res.json().catch(() => null) : null
    if (typeof data?.automations !== 'boolean') return null
    setAutomations(data.automations)
    if (typeof data.assistant === 'boolean') setAssistant(data.assistant)
    if (typeof data.videoReplies === 'boolean') setVideoReplies(data.videoReplies)
    return data.automations
  }, [token, checkRevoked])

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
      }).then((res) => {
        // 401 shared_revoked: la password dei collaboratori e' cambiata o spenta, si esce subito.
        checkRevoked(res, token)
        // 402: AI del piano finita. I gettoni e l'avviso in alto si aggiornano subito.
        if (res.status === 402) {
          try {
            window.dispatchEvent(new Event(USAGE_REFRESH_EVENT))
          } catch {}
        }
        // 403 assistant_disabled / automations_disabled: Facevoice ha spento l'Assistente o le Automazioni per questa persona.
        if (res.status === 403) {
          res
            .clone()
            .json()
            .then((data) => {
              if (data?.code === 'assistant_disabled') setAssistant(false)
              if (data?.code === 'automations_disabled') setAutomations(false)
              if (data?.code === 'video_replies_disabled') setVideoReplies(false)
              // Termini in vigore non accettati (per esempio aggiornati mentre l'app era aperta): torna il blocco.
              if (data?.code === 'terms_required') window.dispatchEvent(new Event(TERMS_REQUIRED_EVENT))
            })
            .catch(() => undefined)
        }
        return res
      }),
    [token, workspace, checkRevoked]
  )

  /**
   * Esci: solo da questo dispositivo. Con la password condivisa, «Esci» globale farebbe uscire
   * anche il titolare e tutti gli altri. Se Supabase non chiude la sessione (rete assente o
   * sessione gia' chiusa altrove) la si toglie comunque da questo browser.
   */
  const signOut = useCallback(async () => {
    if (shared) {
      storage((ls) => ls.removeItem(SHARED_KEY))
      setShared(null)
    } else {
      const { error: outError } = await supabase.auth.signOut({ scope: 'local' }).catch((e: unknown) => ({ error: e }))
      if (outError) {
        const key = supabaseStorageKey()
        if (key) storage((ls) => [key, `${key}-user`, `${key}-code-verifier`].forEach((k) => ls.removeItem(k)))
        setSession(null)
      }
    }
    setSessionNotice(null)
    setWorkspaces([])
    setAssistant(null)
    setAutomations(null)
    setVideoReplies(null)
  }, [supabase, shared])

  const startSharedSession = useCallback((next: SharedSession) => {
    storage((ls) => {
      ls.setItem(SHARED_KEY, JSON.stringify(next))
      ls.setItem(LAST_EMAIL_KEY, next.email)
      ls.setItem(LAST_KIND_KEY, 'shared')
    })
    setLastEmail(next.email)
    setSessionNotice(null)
    setLoaded(false)
    setShared(next)
  }, [])

  const clearSessionNotice = useCallback(() => setSessionNotice(null), [])

  const value: State = {
    ready: sessionReady && (loaded || !(session || shared)),
    session,
    email: email || session?.user.email || shared?.email || null,
    workspaces,
    workspace,
    error,
    assistant,
    refreshAssistant,
    automations,
    refreshAutomations,
    videoReplies,
    selectWorkspace,
    reload,
    signOut,
    appFetch,
    userId: session?.user.id ?? shared?.userId ?? null,
    isShared: !session && Boolean(shared),
    sessionNotice,
    clearSessionNotice,
    lastEmail,
    startSharedSession,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useWorkspace(): State {
  const value = useContext(Ctx)
  if (!value) throw new Error('useWorkspace va usato dentro WorkspaceProvider')
  return value
}
