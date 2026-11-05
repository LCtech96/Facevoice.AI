'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  Bell,
  BellOff,
  Check,
  Facebook,
  Instagram,
  MessageCircle,
  MessageSquareText,
  RefreshCw,
  Search,
  Send,
  X,
  Link2,
  Unlink,
  Mail,
  Globe,
  Trash2,
  Sparkles,
} from 'lucide-react'
import Navigation from '@/components/Navigation'
import { createClient } from '@/lib/supabase-client'
import { getAccessToken } from '@/lib/session-token'
import { useStaffAccess } from '@/components/useStaffAccess'
import { DraftTranslate, TranslatableBody } from './Translate'

type Platform = 'whatsapp' | 'facebook' | 'instagram' | 'email' | 'web'

type Conversation = {
  key: string
  members: { platform: string; contactId: string; contactName: string | null }[]
  platforms: string[]
  contactName: string | null
  lastMessage: string
  lastDirection: 'in' | 'out'
  lastStatus: string | null
  lastAt: string
  unread: number
  pending: number
  hasComments: boolean
  linked: boolean
  suggestion?: { key: string; name: string; platforms: string[] }
}

type Message = {
  id: string
  platform: string
  kind: 'message' | 'comment'
  direction: 'in' | 'out'
  body: string
  status: string | null
  error_message: string | null
  reply_to?: string | null
  created_at: string
}

const PLATFORM: Record<Platform, { label: string; icon: typeof Instagram; color: string }> = {
  whatsapp: { label: 'WhatsApp', icon: MessageCircle, color: '#25D366' },
  facebook: { label: 'Messenger', icon: Facebook, color: '#0866FF' },
  instagram: { label: 'Instagram', icon: Instagram, color: '#E1306C' },
  email: { label: 'Email', icon: Mail, color: '#EA4335' },
  web: { label: 'Chat sito', icon: Globe, color: '#FF6A1A' },
}

const POLL_MS = 5_000
// Con la casella aperta le email si controllano piu' spesso del cron (1 minuto).
const EMAIL_SYNC_MS = 20_000

function formatTime(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })
}

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

async function authFetch(url: string, init: RequestInit = {}) {
  const token = await getAccessToken()
  return fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  })
}

// ---------------------------------------------------------------------
// Notifiche push
// ---------------------------------------------------------------------

function PushToggle() {
  const [state, setState] = useState<'unsupported' | 'ios-install' | 'off' | 'on' | 'denied' | 'busy'>('busy')
  const [error, setError] = useState<string | null>(null)
  const [devices, setDevices] = useState<number | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)

  useEffect(() => {
    authFetch('/api/admin/push')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setDevices(typeof data?.devices === 'number' ? data.devices : null))
      .catch(() => undefined)
  }, [state])

  const sendTest = async () => {
    setTestResult('Invio…')
    const res = await authFetch('/api/admin/push', { method: 'POST', body: JSON.stringify({ test: true }) })
    const data = await res.json().catch(() => ({}))
    setTestResult(
      res.ok
        ? `Prova inviata a ${data.sent} dispositiv${data.sent === 1 ? 'o' : 'i'}${data.failed ? `, ${data.failed} non raggiungibili` : ''}.`
        : data.error || 'Prova non riuscita'
    )
  }

  const devicesLabel =
    devices === null ? null : devices === 0 ? 'Nessun dispositivo riceve le notifiche' : `${devices} dispositiv${devices === 1 ? 'o riceve' : 'i ricevono'} le notifiche`

  useEffect(() => {
    const check = async () => {
      const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent)
      const standalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setState(isIos && !standalone ? 'ios-install' : 'unsupported')
        return
      }
      if (Notification.permission === 'denied') return setState('denied')
      const reg = await navigator.serviceWorker.getRegistration('/sw.js')
      const sub = await reg?.pushManager.getSubscription()
      setState(sub ? 'on' : 'off')
      // Aggiorna in silenzio i dati di questo dispositivo (browser, ultimo accesso).
      if (sub) {
        authFetch('/api/admin/push', {
          method: 'POST',
          body: JSON.stringify({ subscription: sub.toJSON(), installed: standalone }),
        }).catch(() => undefined)
      }
    }
    check().catch(() => setState('unsupported'))
  }, [])

  const enable = async () => {
    setError(null)
    setState('busy')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off')
        return
      }
      const reg = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready
      const keyRes = await authFetch('/api/admin/push')
      const { publicKey } = await keyRes.json()
      const sub =
        (await reg.pushManager.getSubscription()) ||
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }))
      const res = await authFetch('/api/admin/push', {
        method: 'POST',
        body: JSON.stringify({
          subscription: sub.toJSON(),
          test: true,
          installed: window.matchMedia('(display-mode: standalone)').matches,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Registrazione non riuscita')
      setState('on')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore')
      setState('off')
    }
  }

  const disable = async () => {
    setState('busy')
    const reg = await navigator.serviceWorker.getRegistration('/sw.js')
    const sub = await reg?.pushManager.getSubscription()
    if (sub) {
      await authFetch('/api/admin/push', { method: 'DELETE', body: JSON.stringify({ endpoint: sub.endpoint }) })
      await sub.unsubscribe()
    }
    setState('off')
  }

  const base =
    'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border-color)]'

  if (state === 'ios-install') {
    return (
      <div className="max-w-xs text-right">
        <p className="text-xs text-[#FF9500]">
          Da Safari l&apos;iPhone non può ricevere notifiche. Tocca Condividi → «Aggiungi alla schermata Home», apri
          l&apos;app Facevoice AI dalla Home e premi qui «Attiva notifiche».
        </p>
        {devicesLabel && <p className="text-xs text-[var(--text-secondary)] mt-1">{devicesLabel}</p>}
      </div>
    )
  }
  if (state === 'unsupported') return <p className="text-xs text-[var(--text-secondary)]">Notifiche non supportate</p>
  if (state === 'denied')
    return <p className="text-xs text-[#FF3B30]">Notifiche bloccate: riattivale dalle impostazioni del dispositivo.</p>

  return (
    <div className="flex flex-col items-end gap-1">
      {state === 'on' ? (
        <div className="flex gap-2">
          <button onClick={sendTest} className={`${base} text-[var(--text-primary)]`}>
            <Bell className="w-3.5 h-3.5" /> Prova
          </button>
          <button onClick={disable} className={`${base} text-[var(--text-secondary)]`}>
            <BellOff className="w-3.5 h-3.5" /> Disattiva notifiche
          </button>
        </div>
      ) : (
        <button
          onClick={enable}
          disabled={state === 'busy'}
          className={`${base} bg-[var(--accent-blue)] border-transparent text-white disabled:opacity-50`}
        >
          <Bell className="w-3.5 h-3.5" /> Attiva notifiche su questo dispositivo
        </button>
      )}
      {devicesLabel && <p className="text-xs text-[var(--text-secondary)]">{devicesLabel}</p>}
      {testResult && <p className="text-xs text-[var(--text-secondary)]">{testResult}</p>}
      {error && <p className="text-xs text-[#FF3B30]">{error}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------
// Risposte automatiche per canale
// ---------------------------------------------------------------------

type ChannelRow = { id: string; platform: string; status: string; reply_mode?: 'auto' | 'approval' }

function AutoReplyToggles() {
  const [channels, setChannels] = useState<ChannelRow[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    authFetch('/api/admin/channels')
      .then((res) => (res.ok ? res.json() : { channels: [] }))
      .then((data) =>
        setChannels(
          (data.channels || []).filter(
            (c: ChannelRow) => c.status === 'connected' && c.platform in PLATFORM
          )
        )
      )
      .catch(() => setChannels([]))
  }, [])

  const toggle = async (channel: ChannelRow) => {
    const next = channel.reply_mode === 'auto' ? 'approval' : 'auto'
    if (
      next === 'auto' &&
      !window.confirm(
        `Le risposte AI su ${PLATFORM[channel.platform as Platform].label} partiranno subito, senza approvazione. Confermi?`
      )
    ) {
      return
    }
    setError(null)
    setBusyId(channel.id)
    try {
      const res = await authFetch(`/api/admin/channels/${channel.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ reply_mode: next }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Modifica non riuscita')
      setChannels((list) => list.map((c) => (c.id === channel.id ? { ...c, reply_mode: next } : c)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Errore')
    } finally {
      setBusyId(null)
    }
  }

  if (!channels.length) return null

  // Come l'Omnichat della piattaforma clienti: un riquadro per canale con la modalita' e cosa vuol dire.
  const MODES = [
    { id: 'approval' as const, label: 'Bozze', hint: 'L’AI prepara la risposta, tu la controlli e la invii.' },
    { id: 'auto' as const, label: 'Automatica', hint: 'L’AI risponde da sola, subito.' },
  ]
  return (
    <div className="mt-3">
      <div className="flex gap-3 overflow-x-auto pb-1">
        {channels.map((channel) => {
          const meta = PLATFORM[channel.platform as Platform]
          const Icon = meta.icon
          const mode = channel.reply_mode === 'auto' ? 'auto' : 'approval'
          return (
            <div key={channel.id} className="shrink-0 rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                <Icon className="h-4 w-4" style={{ color: meta.color }} /> {meta.label}
              </p>
              <div className="mt-2 flex rounded-full bg-[var(--background)] p-0.5" role="radiogroup" aria-label={`Risposte AI ${meta.label}`}>
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    role="radio"
                    aria-checked={mode === m.id}
                    title={m.hint}
                    disabled={busyId === channel.id}
                    onClick={() => mode !== m.id && toggle(channel)}
                    className={`rounded-full px-3 py-1 text-xs disabled:opacity-50 ${mode === m.id ? 'bg-[var(--accent-blue)] text-white' : 'text-[var(--text-secondary)]'}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 max-w-[15rem] text-[11px] text-[var(--text-secondary)]">{MODES.find((m) => m.id === mode)?.hint}</p>
            </div>
          )
        })}
      </div>
      {channels.some((c) => c.platform === 'email') && (
        <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
          Email: in automatico solo per chi ci scrive per primo. Le risposte dei contatti della Ricerca clienti hanno sempre la controrisposta da approvare.
        </p>
      )}
      {error && <p className="mt-1 text-xs text-[#FF3B30]">{error}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------
// Pagina
// ---------------------------------------------------------------------

function PlatformBadge({ platform, size = 'sm' }: { platform: string; size?: 'sm' | 'xs' }) {
  const meta = PLATFORM[platform as Platform]
  if (!meta) return null
  const Icon = meta.icon
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${
        size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]'
      }`}
      style={{ backgroundColor: `${meta.color}22`, color: meta.color }}
    >
      <Icon className={size === 'xs' ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
      {meta.label}
    </span>
  )
}

const SWIPE_ACTION = 88
const LONG_PRESS_MS = 550

/**
 * Riga con swipe a sinistra come su WhatsApp: scopre il pulsante rosso
 * "Elimina"; uno swipe lungo elimina subito. Anche una pressione lunga scopre
 * il pulsante. Col mouse si trascina.
 *
 * I gesti touch usano listener nativi non passivi: cosi' appena il movimento
 * e' orizzontale il browser non puo' prenderselo (scroll, gesti di sistema).
 */
function SwipeRow({
  open,
  onOpenChange,
  onDelete,
  disabled = false,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDelete: () => void
  /** Senza permesso di eliminare: riga normale, senza swipe. */
  disabled?: boolean
  children: React.ReactNode
}) {
  const rowRef = useRef<HTMLDivElement>(null)
  const fgRef = useRef<HTMLDivElement>(null)
  const [dx, setDx] = useState<number | null>(null)
  const suppressClick = useRef(false)
  // Valori sempre aggiornati per i listener nativi (registrati una volta sola).
  const live = useRef({ open, onOpenChange, onDelete })
  live.current = { open, onOpenChange, onDelete }

  useEffect(() => {
    const fg = fgRef.current
    if (!fg || disabled) return
    let start: { x: number; y: number; base: number } | null = null
    let mode: 'idle' | 'swipe' | 'scroll' = 'idle'
    let current = 0
    let pressTimer: ReturnType<typeof setTimeout> | null = null
    const width = () => rowRef.current?.offsetWidth || 320
    const clearPress = () => {
      if (pressTimer) clearTimeout(pressTimer)
      pressTimer = null
    }

    const begin = (x: number, y: number) => {
      start = { x, y, base: live.current.open ? -SWIPE_ACTION : 0 }
      mode = 'idle'
      suppressClick.current = false
      current = start.base
    }
    // true = gesto orizzontale in corso (va bloccato lo scroll del browser)
    const move = (x: number, y: number) => {
      if (!start) return false
      const mx = x - start.x
      const my = y - start.y
      if (mode === 'idle') {
        if (Math.abs(mx) < 6 && Math.abs(my) < 6) return false
        clearPress()
        mode = Math.abs(mx) > Math.abs(my) ? 'swipe' : 'scroll'
      }
      if (mode !== 'swipe') return false
      current = Math.min(0, Math.max(-width(), start.base + mx))
      setDx(current)
      return true
    }
    const end = () => {
      clearPress()
      const wasSwipe = mode === 'swipe'
      start = null
      mode = 'idle'
      if (!wasSwipe) return
      suppressClick.current = true
      setDx(null)
      if (-current > width() * 0.55) {
        live.current.onOpenChange(false)
        live.current.onDelete()
      } else {
        live.current.onOpenChange(-current > SWIPE_ACTION / 3)
      }
    }

    // Dopo un tocco i telefoni mandano anche eventi mouse "di compatibilita'": vanno ignorati.
    let lastTouchAt = 0
    const onTouchStart = (e: TouchEvent) => {
      lastTouchAt = Date.now()
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      begin(t.clientX, t.clientY)
      clearPress()
      pressTimer = setTimeout(() => {
        // Pressione lunga senza movimento: scopre "Elimina".
        if (start && mode === 'idle') {
          suppressClick.current = true
          start = null
          live.current.onOpenChange(true)
          navigator.vibrate?.(15)
        }
      }, LONG_PRESS_MS)
    }
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0]
      if (t && move(t.clientX, t.clientY) && e.cancelable) e.preventDefault()
    }
    const onTouchEnd = () => {
      lastTouchAt = Date.now()
      end()
    }

    let mouseDown = false
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0 || Date.now() - lastTouchAt < 1000) return
      mouseDown = true
      begin(e.clientX, e.clientY)
    }
    const onMouseMove = (e: MouseEvent) => {
      if (mouseDown) move(e.clientX, e.clientY)
    }
    const onMouseUp = () => {
      if (!mouseDown) return
      mouseDown = false
      end()
    }

    fg.addEventListener('touchstart', onTouchStart, { passive: true })
    fg.addEventListener('touchmove', onTouchMove, { passive: false })
    fg.addEventListener('touchend', onTouchEnd)
    fg.addEventListener('touchcancel', onTouchEnd)
    fg.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      clearPress()
      fg.removeEventListener('touchstart', onTouchStart)
      fg.removeEventListener('touchmove', onTouchMove)
      fg.removeEventListener('touchend', onTouchEnd)
      fg.removeEventListener('touchcancel', onTouchEnd)
      fg.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [disabled])

  const offset = dx ?? (open ? -SWIPE_ACTION : 0)

  if (disabled) return <div className="border-b border-[var(--border-color)]">{children}</div>

  return (
    <div ref={rowRef} className="relative overflow-hidden border-b border-[var(--border-color)]">
      <button
        type="button"
        onClick={() => {
          onOpenChange(false)
          onDelete()
        }}
        className="absolute inset-y-0 right-0 flex flex-col items-center justify-center gap-1 bg-[#FF3B30] text-white text-xs font-medium"
        style={{ width: Math.max(SWIPE_ACTION, -offset) }}
        tabIndex={open ? 0 : -1}
        aria-label="Elimina conversazione"
      >
        <Trash2 className="w-5 h-5" />
        Elimina
      </button>
      <div
        ref={fgRef}
        className="relative bg-[var(--card-background)] select-none"
        style={{
          transform: `translateX(${offset}px)`,
          transition: dx === null ? 'transform 0.2s ease' : 'none',
          touchAction: 'pan-y',
          WebkitTouchCallout: 'none',
        }}
        onContextMenu={(e) => e.preventDefault()}
        onClickCapture={(e) => {
          // Il click che chiude uno swipe o una pressione lunga non apre la chat.
          if (suppressClick.current) {
            e.preventDefault()
            e.stopPropagation()
            suppressClick.current = false
            return
          }
          // Riga aperta: un tocco la richiude soltanto.
          if (open) {
            e.preventDefault()
            e.stopPropagation()
            onOpenChange(false)
          }
        }}
      >
        {children}
      </div>
    </div>
  )
}

function InboxPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const [authorized, setAuthorized] = useState<boolean | null>(null)
  // Permessi del dipendente (l'admin li ha tutti).
  const staff = useStaffAccess()
  const canReply = staff.can('inbox', 'reply')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [totals, setTotals] = useState({ pending: 0, unread: 0 })
  const [platformFilter, setPlatformFilter] = useState<Platform | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'unread'>('all')
  const [query, setQuery] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [replyPlatform, setReplyPlatform] = useState<string>('')
  const [notice, setNotice] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)
  const [linkQuery, setLinkQuery] = useState('')
  const threadRef = useRef<HTMLDivElement>(null)
  const [swipeOpen, setSwipeOpen] = useState<string | null>(null)
  const [removed, setRemoved] = useState<{ name: string; previous: Record<string, string | null> } | null>(null)
  const removedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const key = searchParams.get('c')
    const platform = searchParams.get('platform')
    const contact = searchParams.get('contact')
    if (key) setSelectedKey(key)
    else if (platform && contact) setSelectedKey(`${platform}:${contact}`)
  }, [searchParams])

  const loadConversations = useCallback(async () => {
    const params = new URLSearchParams()
    if (platformFilter !== 'all') params.set('platform', platformFilter)
    if (statusFilter !== 'all') params.set('filter', statusFilter)
    if (query.trim()) params.set('q', query.trim())
    const res = await authFetch(`/api/admin/inbox?${params}`)
    if (res.status === 401 || res.status === 403) return setAuthorized(false)
    const data = await res.json()
    if (!res.ok) return setNotice(data.error || 'Errore nel caricare i messaggi')
    setAuthorized(true)
    setConversations(data.conversations || [])
    setTotals(data.totals || { pending: 0, unread: 0 })
  }, [platformFilter, statusFilter, query])

  const loadThread = useCallback(async () => {
    if (!selectedKey) return
    const res = await authFetch(`/api/admin/inbox/thread?c=${encodeURIComponent(selectedKey)}`)
    const data = await res.json()
    if (res.ok) setMessages(data.messages || [])
  }, [selectedKey])

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.push('/auth')
    })
  }, [router, supabase])

  useEffect(() => {
    const t = setTimeout(loadConversations, query ? 300 : 0)
    return () => clearTimeout(t)
  }, [loadConversations, query])

  useEffect(() => {
    setMessages([])
    setReplyPlatform('')
    setLinking(false)
    loadThread()
  }, [loadThread])

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      loadConversations()
      loadThread()
    }, POLL_MS)
    return () => clearInterval(id)
  }, [loadConversations, loadThread])

  useEffect(() => {
    let stopped = false
    const sync = async () => {
      if (document.visibilityState !== 'visible') return
      const res = await authFetch('/api/admin/email', {
        method: 'POST',
        body: JSON.stringify({ action: 'sync' }),
      }).catch(() => null)
      const data = res?.ok ? await res.json().catch(() => null) : null
      // Casella non collegata: inutile continuare a chiedere.
      if (data?.error === 'Casella non collegata') stopped = true
      if (data?.processed) loadConversations()
    }
    sync()
    const id = setInterval(() => {
      if (!stopped) sync()
    }, EMAIL_SYNC_MS)
    return () => clearInterval(id)
  }, [loadConversations])

  // Scorre solo l'area messaggi: scrollIntoView spostava l'intera pagina su mobile.
  useEffect(() => {
    const el = threadRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length])

  const select = (key: string | null) => {
    setSelectedKey(key)
    router.replace(key ? `/admin/inbox?c=${encodeURIComponent(key)}` : '/admin/inbox', { scroll: false })
  }

  // Swipe "Elimina": la conversazione sparisce subito; per qualche secondo si puo' annullare.
  const removeConversation = async (c: Conversation) => {
    setConversations((list) => list.filter((x) => x.key !== c.key))
    if (selectedKey === c.key) select(null)
    const res = await authFetch('/api/admin/inbox/hide', { method: 'POST', body: JSON.stringify({ key: c.key }) }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (!res?.ok) {
      setNotice(data.error || 'Eliminazione non riuscita')
      loadConversations()
      return
    }
    if (removedTimer.current) clearTimeout(removedTimer.current)
    setRemoved({ name: c.contactName || c.members[0]?.contactId || 'Conversazione', previous: data.previous || {} })
    removedTimer.current = setTimeout(() => setRemoved(null), 6000)
  }

  const undoRemove = async () => {
    if (!removed) return
    if (removedTimer.current) clearTimeout(removedTimer.current)
    const previous = removed.previous
    setRemoved(null)
    await authFetch('/api/admin/inbox/hide', { method: 'POST', body: JSON.stringify({ undo: previous }) }).catch(() => null)
    loadConversations()
  }

  const act = async (message: Message, action: 'approve' | 'reject') => {
    setBusyId(message.id)
    setNotice(null)
    try {
      const res = await authFetch(`/api/admin/inbox/messages/${message.id}`, {
        method: 'POST',
        body: JSON.stringify({ action, text: drafts[message.id] ?? message.body }),
      })
      const data = await res.json()
      if (data.message) setMessages((list) => list.map((m) => (m.id === message.id ? data.message : m)))
      if (!res.ok) setNotice(data.error || 'Operazione non riuscita')
      loadConversations()
    } finally {
      setBusyId(null)
    }
  }

  const current = selectedKey ? conversations.find((c) => c.key === selectedKey) : undefined
  const privatePlatforms = Array.from(
    new Set(messages.filter((m) => m.direction === 'in' && m.kind === 'message').map((m) => m.platform))
  )
  const lastPrivate = [...messages].reverse().find((m) => m.direction === 'in' && m.kind === 'message')
  const activeReplyPlatform = replyPlatform || lastPrivate?.platform || ''

  const sendManual = async () => {
    if (!selectedKey || !reply.trim()) return
    setBusyId('manual')
    setNotice(null)
    try {
      const res = await authFetch(`/api/admin/inbox/thread?c=${encodeURIComponent(selectedKey)}`, {
        method: 'POST',
        body: JSON.stringify({ text: reply, platform: activeReplyPlatform || undefined }),
      })
      const data = await res.json()
      if (data.message) setMessages((list) => [...list, data.message])
      if (res.ok) setReply('')
      else setNotice(data.error || 'Invio non riuscito')
      loadConversations()
    } finally {
      setBusyId(null)
    }
  }

  const link = async (otherKey: string) => {
    if (!selectedKey) return
    const res = await authFetch('/api/admin/inbox/link', {
      method: 'POST',
      body: JSON.stringify({ a: selectedKey, b: otherKey }),
    })
    const data = await res.json()
    if (!res.ok) return setNotice(data.error || 'Collegamento non riuscito')
    setLinking(false)
    select(data.key)
    loadConversations()
  }

  const unlink = async (platform: string, contactId: string) => {
    const res = await authFetch('/api/admin/inbox/link', {
      method: 'DELETE',
      body: JSON.stringify({ platform, contactId }),
    })
    if (!res.ok) return setNotice('Separazione non riuscita')
    select(null)
    loadConversations()
  }

  if (authorized === false) {
    return (
      <main className="min-h-screen bg-[var(--background)]">
        <Navigation />
        <p className="pt-32 text-center text-[var(--text-secondary)]">Non hai accesso a questa pagina: chiedilo all’amministratore.</p>
      </main>
    )
  }

  const linkCandidates = conversations
    .filter((c) => c.key !== selectedKey)
    .filter((c) => !linkQuery.trim() || (c.contactName || '').toLowerCase().includes(linkQuery.trim().toLowerCase()))
    .slice(0, 30)

  // Bozza AI a richiesta (✨): resta in bozza da approvare, come nell'Omnichat.
  const suggest = async () => {
    if (!selectedKey) return
    setBusyId('suggest')
    setNotice(null)
    try {
      const res = await authFetch('/api/admin/inbox/suggest', {
        method: 'POST',
        body: JSON.stringify({ c: selectedKey, platform: activeReplyPlatform || undefined, instructions: reply.trim() || undefined }),
      }).catch(() => null)
      const data = res ? await res.json().catch(() => ({})) : {}
      if (!res?.ok) setNotice(data.error || 'Bozza non preparata, riprova')
      else {
        if (data.warning) setNotice(data.warning)
        setReply('')
      }
      await loadThread()
      loadConversations()
    } finally {
      setBusyId(null)
    }
  }

  // Un'unica fila di filtri: stato (tutte, da approvare, non lette) e canali.
  const filters: { id: string; label: string; active: boolean; onClick: () => void }[] = [
    { id: 'all', label: 'Tutti', active: statusFilter === 'all' && platformFilter === 'all', onClick: () => { setStatusFilter('all'); setPlatformFilter('all') } },
    { id: 'pending', label: totals.pending ? `Da approvare (${totals.pending})` : 'Da approvare', active: statusFilter === 'pending', onClick: () => setStatusFilter(statusFilter === 'pending' ? 'all' : 'pending') },
    { id: 'unread', label: totals.unread ? `Non lette (${totals.unread})` : 'Non lette', active: statusFilter === 'unread', onClick: () => setStatusFilter(statusFilter === 'unread' ? 'all' : 'unread') },
    ...(Object.keys(PLATFORM) as Platform[]).map((p) => ({
      id: p,
      label: PLATFORM[p].label,
      active: platformFilter === p,
      onClick: () => setPlatformFilter(platformFilter === p ? 'all' : p),
    })),
  ]

  return (
    <main className="min-h-screen bg-[var(--background)] overflow-x-hidden">
      <Navigation />

      <div className="mx-auto max-w-6xl pt-16 md:pt-20 pb-20 md:pb-4">
        {/* Intestazione e risposte AI per canale (nascoste su telefono con una chat aperta) */}
        <div className={`border-b border-[var(--border-color)] px-4 py-4 ${selectedKey ? 'hidden md:block' : ''}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-extrabold text-[var(--text-primary)]">Messaggi</h1>
              {totals.pending > 0 && (
                <p className="text-sm text-[#FF9500]">{totals.pending === 1 ? '1 risposta AI da approvare' : `${totals.pending} risposte AI da approvare`}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {staff.isAdmin && <PushToggle />}
              <button
                onClick={() => {
                  loadConversations()
                  loadThread()
                }}
                className="flex items-center gap-2 text-sm text-[var(--text-secondary)]"
                aria-label="Aggiorna"
              >
                <RefreshCw className="h-4 w-4" /> <span className="hidden sm:inline">Aggiorna</span>
              </button>
            </div>
          </div>
          {staff.can('control', 'edit') && <AutoReplyToggles />}
        </div>

        {removed && (
          <div className="fixed left-1/2 -translate-x-1/2 bottom-24 md:bottom-6 z-50 flex items-center gap-4 px-4 py-3 rounded-xl bg-[#1c1c1e] text-white text-sm shadow-lg max-w-[calc(100vw-32px)]">
            <span className="truncate">Eliminata: {removed.name}</span>
            <button onClick={undoRemove} className="font-semibold text-[#0A84FF] shrink-0">
              Annulla
            </button>
          </div>
        )}

        {notice && (
          <div className="mx-4 mt-3 flex justify-between gap-2 rounded-lg bg-[#FF9500]/10 px-3 py-2 text-sm text-[var(--text-primary)]">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} aria-label="Chiudi">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className={`flex min-h-[380px] ${selectedKey ? 'h-[calc(100dvh-8.5rem)] md:h-[calc(100dvh-13rem)]' : 'h-[calc(100dvh-15rem)] md:h-[calc(100dvh-13rem)]'}`}>
          {/* Elenco conversazioni */}
          <section className={`min-h-0 w-full flex-col border-r border-[var(--border-color)] md:flex md:w-80 md:shrink-0 ${selectedKey ? 'hidden' : 'flex'}`}>
            <div className="space-y-2 px-4 pt-3 pb-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-secondary)]" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Cerca nome o testo…"
                  className="w-full rounded-full border border-[var(--border-color)] bg-[var(--background-secondary)] py-2 pl-9 pr-3 text-[16px] text-[var(--text-primary)] focus:border-[var(--accent-blue)] focus:outline-none md:text-sm"
                />
              </div>
              <div className="flex gap-1 overflow-x-auto pb-0.5">
                {filters.map((f) => (
                  <button
                    key={f.id}
                    onClick={f.onClick}
                    className={`shrink-0 rounded-full px-3 py-1 text-xs ${f.active ? 'bg-[var(--text-primary)] text-[var(--background)]' : 'text-[var(--text-secondary)]'}`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {authorized === null && <p className="p-6 text-center text-sm text-[var(--text-secondary)]">Caricamento…</p>}
              {authorized && conversations.length === 0 && <p className="px-4 py-6 text-sm text-[var(--text-secondary)]">Nessun messaggio per ora.</p>}
              {conversations.map((c) => {
                const active = c.key === selectedKey
                const first = PLATFORM[c.platforms[0] as Platform]
                const Icon = first?.icon || MessageSquareText
                return (
                  <SwipeRow
                    key={c.key}
                    open={swipeOpen === c.key}
                    onOpenChange={(open) => setSwipeOpen(open ? c.key : null)}
                    onDelete={() => removeConversation(c)}
                    disabled={!canReply}
                  >
                    <button
                      onClick={() => select(c.key)}
                      className={`flex w-full gap-3 border-b border-[var(--border-color)] px-4 py-3 text-left ${active ? 'bg-[var(--background-secondary)]' : ''}`}
                    >
                      <span className="relative mt-0.5 shrink-0">
                        <Icon className="h-4 w-4" style={{ color: first?.color }} />
                        {c.platforms.length > 1 && (
                          <span className="absolute -bottom-2 -right-2 rounded-full bg-[var(--background-secondary)] px-1 text-[9px] text-[var(--text-secondary)]">+{c.platforms.length - 1}</span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className={`truncate text-[var(--text-primary)] ${c.unread ? 'font-bold' : 'font-medium'}`}>{c.contactName || c.members[0]?.contactId}</span>
                          <span className="ml-auto shrink-0 text-[11px] text-[var(--text-secondary)]">{formatTime(c.lastAt)}</span>
                        </span>
                        <span className="block truncate text-xs text-[var(--text-secondary)]">
                          {c.lastStatus === 'pending' ? 'Bozza: ' : c.lastDirection === 'out' ? 'Tu: ' : ''}
                          {c.lastMessage}
                        </span>
                        {(c.unread > 0 || c.pending > 0 || c.suggestion || c.hasComments || (c.linked && c.platforms.length > 1)) && (
                          <span className="mt-1 flex flex-wrap gap-1.5">
                            {c.unread > 0 && <span className="rounded-full bg-[var(--accent-blue)] px-2 text-[10px] text-white">{c.unread} nuovi</span>}
                            {c.pending > 0 && <span className="rounded-full bg-[#FF9500] px-2 text-[10px] text-white">bozza da approvare</span>}
                            {c.linked && c.platforms.length > 1 && <span className="rounded-full bg-[var(--background-secondary)] px-2 text-[10px] text-[var(--text-secondary)]">su {c.platforms.length} canali</span>}
                            {c.suggestion && <span className="rounded-full bg-[#AF52DE]/15 px-2 text-[10px] text-[#AF52DE]">possibile doppione</span>}
                            {c.hasComments && <span className="rounded-full bg-[var(--background-secondary)] px-2 text-[10px] text-[var(--text-secondary)]">commenti</span>}
                          </span>
                        )}
                      </span>
                    </button>
                  </SwipeRow>
                )
              })}
              {canReply && conversations.length > 0 && (
                <p className="px-4 py-3 text-[11px] text-[var(--text-secondary)]">Per eliminare una chat scorrila verso sinistra o tienila premuta.</p>
              )}
            </div>
          </section>

          {/* Conversazione */}
          <section className={`min-h-0 min-w-0 flex-1 flex-col md:flex ${selectedKey ? 'flex' : 'hidden'}`}>
            {!selectedKey ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-[var(--text-secondary)]">
                <MessageSquareText className="h-8 w-8" />
                <p className="text-sm">Scegli una conversazione.</p>
              </div>
            ) : (
              <>
                <div className="space-y-2 border-b border-[var(--border-color)] px-4 py-3">
                  <div className="flex items-center gap-3">
                    <button className="-ml-1 p-1 text-[var(--text-secondary)] md:hidden" onClick={() => select(null)} aria-label="Indietro">
                      <ArrowLeft className="h-5 w-5" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold text-[var(--text-primary)]">{current?.contactName || current?.members[0]?.contactId || 'Conversazione'}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        {(current?.members || []).map((m) => (
                          <span key={`${m.platform}:${m.contactId}`} className="inline-flex items-center gap-1">
                            <PlatformBadge platform={m.platform} size="xs" />
                            {canReply && current?.linked && current.members.length > 1 && (
                              <button onClick={() => unlink(m.platform, m.contactId)} className="text-[var(--text-secondary)] hover:text-[#FF3B30]" title="Separa questo account" aria-label="Separa questo account">
                                <Unlink className="h-3 w-3" />
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                    {canReply && (
                      <>
                        <button
                          onClick={() => setLinking((v) => !v)}
                          className="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] px-2.5 py-1 text-xs text-[var(--text-secondary)]"
                          title="Collega a un altro canale della stessa persona"
                        >
                          <Link2 className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Stessa persona</span>
                        </button>
                        <button onClick={() => current && removeConversation(current)} className="p-1.5 text-[var(--text-secondary)] hover:text-[#FF3B30]" aria-label="Elimina conversazione" title="Elimina conversazione">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>

                  {canReply && current?.suggestion && !linking && (
                    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-[#AF52DE]/10 px-3 py-2 text-xs text-[var(--text-primary)]">
                      <span>
                        Potrebbe essere la stessa persona di <strong>{current.suggestion.name}</strong> su{' '}
                        {current.suggestion.platforms.map((p) => PLATFORM[p as Platform]?.label || p).join(', ')}.
                      </span>
                      <button onClick={() => link(current.suggestion!.key)} className="rounded-full bg-[#AF52DE] px-3 py-1 font-medium text-white">
                        Collega
                      </button>
                    </div>
                  )}

                  {canReply && linking && (
                    <div className="space-y-2 rounded-xl border border-[var(--border-color)] p-2">
                      <p className="text-xs text-[var(--text-secondary)]">
                        Scegli la conversazione della stessa persona su un altro canale: verranno unite qui e l&apos;AI terrà conto di entrambe.
                      </p>
                      <input
                        value={linkQuery}
                        onChange={(e) => setLinkQuery(e.target.value)}
                        placeholder="Cerca per nome…"
                        className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--background-secondary)] px-2.5 py-1.5 text-[16px] text-[var(--text-primary)] focus:outline-none md:text-xs"
                      />
                      <div className="max-h-40 space-y-1 overflow-y-auto">
                        {linkCandidates.map((c) => (
                          <button key={c.key} onClick={() => link(c.key)} className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-[var(--background-secondary)]">
                            <span className="truncate text-[var(--text-primary)]">{c.contactName || c.members[0]?.contactId}</span>
                            <span className="flex shrink-0 gap-1">
                              {c.platforms.map((p) => (
                                <PlatformBadge key={p} platform={p} size="xs" />
                              ))}
                            </span>
                          </button>
                        ))}
                        {linkCandidates.length === 0 && <p className="px-2 text-xs text-[var(--text-secondary)]">Nessuna altra conversazione.</p>}
                      </div>
                    </div>
                  )}
                </div>

                <div ref={threadRef} className="flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-4 py-4">
                  {messages.map((m) => {
                    const isIn = m.direction === 'in'
                    const isPending = m.status === 'pending' || m.status === 'failed'
                    if (m.status === 'rejected') {
                      return (
                        <p key={m.id} className="text-center text-[11px] text-[var(--text-secondary)] line-through">
                          Bozza AI scartata
                        </p>
                      )
                    }
                    // Bozza da approvare: riquadro arancione con il testo modificabile, come nell'Omnichat.
                    if (isPending && canReply) {
                      const value = drafts[m.id] ?? m.body
                      return (
                        <div key={m.id} className="ml-auto max-w-[92%] rounded-2xl border border-[#FF9500] bg-[var(--background-secondary)] p-3">
                          <p className="flex items-center gap-1.5 text-xs font-semibold text-[#FF9500]">
                            <PlatformBadge platform={m.platform} size="xs" />
                            {m.status === 'failed' ? `Invio non riuscito: ${m.error_message || 'riprova'}` : 'Bozza dell’AI: controllala e inviala'}
                          </p>
                          <textarea
                            value={value}
                            onChange={(e) => setDrafts((d) => ({ ...d, [m.id]: e.target.value }))}
                            rows={Math.min(14, Math.max(4, value.split('\n').length + 1))}
                            className="mt-2 w-full rounded-xl border border-[var(--border-color)] bg-[var(--background)] p-3 text-[16px] text-[var(--text-primary)] focus:border-[var(--accent-blue)] focus:outline-none md:text-sm"
                          />
                          <DraftTranslate text={value} />
                          <div className="mt-2 flex justify-end gap-2">
                            <button onClick={() => act(m, 'reject')} disabled={busyId === m.id} className="rounded-full px-3 py-1.5 text-sm text-[var(--text-secondary)] disabled:opacity-50">
                              Scarta
                            </button>
                            <button
                              onClick={() => act(m, 'approve')}
                              disabled={busyId === m.id || !value.trim()}
                              className="flex items-center gap-2 rounded-full bg-[var(--accent-blue)] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                            >
                              <Send className="h-4 w-4" /> {busyId === m.id ? 'Invio…' : m.status === 'failed' ? 'Riprova' : 'Invia'}
                            </button>
                          </div>
                        </div>
                      )
                    }
                    return (
                      <div key={m.id} className={`max-w-[85%] ${isIn ? '' : 'ml-auto'}`}>
                        <div
                          className={`break-words rounded-2xl px-4 py-2.5 text-sm ${
                            isIn ? 'bg-[var(--background-secondary)] text-[var(--text-primary)]' : isPending ? 'border border-dashed border-[#FF9500] text-[var(--text-primary)]' : 'bg-[var(--accent-blue)] text-white'
                          }`}
                        >
                          <TranslatableBody text={m.body} tone={isIn ? 'in' : 'out'} />
                        </div>
                        <p className={`mt-1 flex flex-wrap items-center gap-1 text-[11px] text-[var(--text-secondary)] ${isIn ? '' : 'justify-end'}`}>
                          <PlatformBadge platform={m.platform} size="xs" />
                          {formatTime(m.created_at)}
                          {m.kind === 'comment' ? (isIn ? ' · commento pubblico' : ' · risposta pubblica al commento') : ''}
                          {m.kind === 'message' && !isIn && m.reply_to && m.platform !== 'email' ? ' · privato dal commento' : ''}
                          {m.status === 'sending' ? ' · invio…' : ''}
                          {isPending ? ' · bozza' : ''}
                        </p>
                      </div>
                    )
                  })}
                </div>

                {canReply && (
                  <div className="border-t border-[var(--border-color)] p-3">
                    {privatePlatforms.length > 1 && (
                      <div className="mb-2 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                        Rispondi su
                        <select
                          value={activeReplyPlatform}
                          onChange={(e) => setReplyPlatform(e.target.value)}
                          className="rounded-full border border-[var(--border-color)] bg-[var(--background-secondary)] px-2 py-1 text-xs text-[var(--text-primary)]"
                          aria-label="Canale di risposta"
                        >
                          {privatePlatforms.map((p) => (
                            <option key={p} value={p}>
                              {PLATFORM[p as Platform]?.label || p}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="flex items-end gap-2">
                      <textarea
                        value={reply}
                        onChange={(e) => setReply(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(min-width: 768px)').matches) {
                            e.preventDefault()
                            sendManual()
                          }
                        }}
                        placeholder={activeReplyPlatform ? `Rispondi su ${PLATFORM[activeReplyPlatform as Platform]?.label || activeReplyPlatform}…` : 'Scrivi una risposta…'}
                        rows={2}
                        className="min-h-[44px] flex-1 resize-none rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] px-4 py-2.5 text-[16px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)] md:text-sm"
                      />
                      <button
                        onClick={suggest}
                        disabled={Boolean(busyId)}
                        title="Chiedi all’AI una bozza (se scrivi qualcosa, l’AI lo usa come indicazione)"
                        aria-label="Chiedi all’AI una bozza"
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--border-color)] text-[var(--accent-blue)] disabled:opacity-50"
                      >
                        {busyId === 'suggest' ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      </button>
                      <button
                        onClick={sendManual}
                        disabled={!reply.trim() || Boolean(busyId)}
                        aria-label="Invia"
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--accent-blue)] text-white disabled:opacity-50"
                      >
                        <Send className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}

export default function InboxPageWrapper() {
  return (
    <Suspense>
      <InboxPage />
    </Suspense>
  )
}
