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
} from 'lucide-react'
import Navigation from '@/components/Navigation'
import { createClient } from '@/lib/supabase-client'
import { getAccessToken } from '@/lib/session-token'

type Platform = 'whatsapp' | 'facebook' | 'instagram'

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
  created_at: string
}

const PLATFORM: Record<Platform, { label: string; icon: typeof Instagram; color: string }> = {
  whatsapp: { label: 'WhatsApp', icon: MessageCircle, color: '#25D366' },
  facebook: { label: 'Messenger', icon: Facebook, color: '#0866FF' },
  instagram: { label: 'Instagram', icon: Instagram, color: '#E1306C' },
}

const POLL_MS = 15_000

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
        body: JSON.stringify({ subscription: sub.toJSON(), test: true }),
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
      <p className="text-xs text-[var(--text-secondary)] max-w-xs">
        Per le notifiche su iPhone: in Safari tocca Condividi → «Aggiungi alla schermata Home», poi apri
        l&apos;app dalla Home e torna qui.
      </p>
    )
  }
  if (state === 'unsupported') return <p className="text-xs text-[var(--text-secondary)]">Notifiche non supportate</p>
  if (state === 'denied')
    return <p className="text-xs text-[#FF3B30]">Notifiche bloccate: riattivale dalle impostazioni del dispositivo.</p>

  return (
    <div className="flex flex-col items-end gap-1">
      {state === 'on' ? (
        <button onClick={disable} className={`${base} text-[var(--text-secondary)]`}>
          <BellOff className="w-3.5 h-3.5" /> Disattiva notifiche
        </button>
      ) : (
        <button
          onClick={enable}
          disabled={state === 'busy'}
          className={`${base} bg-[var(--accent-blue)] border-transparent text-white disabled:opacity-50`}
        >
          <Bell className="w-3.5 h-3.5" /> Attiva notifiche su questo dispositivo
        </button>
      )}
      {error && <p className="text-xs text-[#FF3B30]">{error}</p>}
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

function InboxPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  const [authorized, setAuthorized] = useState<boolean | null>(null)
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
    if (res.status === 401) return setAuthorized(false)
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

  // Scorre solo l'area messaggi: scrollIntoView spostava l'intera pagina su mobile.
  useEffect(() => {
    const el = threadRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length])

  const select = (key: string | null) => {
    setSelectedKey(key)
    router.replace(key ? `/admin/inbox?c=${encodeURIComponent(key)}` : '/admin/inbox', { scroll: false })
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
        <p className="pt-32 text-center text-[var(--text-secondary)]">Area riservata agli amministratori.</p>
      </main>
    )
  }

  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-xs border transition-colors whitespace-nowrap ${
      active
        ? 'bg-[var(--accent-blue)] border-[var(--accent-blue)] text-white'
        : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
    }`

  const linkCandidates = conversations
    .filter((c) => c.key !== selectedKey)
    .filter((c) => !linkQuery.trim() || (c.contactName || '').toLowerCase().includes(linkQuery.trim().toLowerCase()))
    .slice(0, 30)

  return (
    <main className="min-h-screen bg-[var(--background)] overflow-x-hidden">
      <Navigation />

      <div className="max-w-6xl mx-auto px-4 pt-20 md:pt-24 pb-24 md:pb-6">
        <div className={`flex-wrap items-start justify-between gap-3 mb-4 ${selectedKey ? 'hidden md:flex' : 'flex'}`}>
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">Messaggi</h1>
            <p className="text-sm text-[var(--text-secondary)]">
              WhatsApp, Messenger e Instagram in un posto solo.
              {totals.pending > 0 && (
                <span className="ml-1 text-[#FF9500] font-medium">
                  {totals.pending === 1 ? '1 risposta AI da approvare.' : `${totals.pending} risposte AI da approvare.`}
                </span>
              )}
            </p>
          </div>
          <PushToggle />
        </div>

        {notice && (
          <div className="mb-3 px-3 py-2 rounded-lg bg-[#FF3B30]/10 text-[#FF3B30] text-sm flex justify-between gap-2">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} aria-label="Chiudi">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div
          className={`grid grid-cols-1 md:grid-cols-[340px_1fr] gap-4 md:h-[calc(100dvh-11rem)] min-h-[380px] ${
            selectedKey ? 'h-[calc(100dvh-10.5rem)]' : 'h-[calc(100dvh-18rem)]'
          }`}
        >
          {/* Elenco conversazioni */}
          <section
            className={`flex-col min-h-0 min-w-0 rounded-xl border border-[var(--border-color)] bg-[var(--card-background)] ${
              selectedKey ? 'hidden md:flex' : 'flex'
            }`}
          >
            <div className="p-3 space-y-2 border-b border-[var(--border-color)]">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Cerca nome o testo…"
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg bg-[var(--background-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
                />
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                <button className={chip(platformFilter === 'all')} onClick={() => setPlatformFilter('all')}>
                  Tutti
                </button>
                {(Object.keys(PLATFORM) as Platform[]).map((p) => (
                  <button key={p} className={chip(platformFilter === p)} onClick={() => setPlatformFilter(p)}>
                    {PLATFORM[p].label}
                  </button>
                ))}
              </div>
              <div className="flex gap-1.5">
                <button className={chip(statusFilter === 'all')} onClick={() => setStatusFilter('all')}>
                  Tutte
                </button>
                <button className={chip(statusFilter === 'pending')} onClick={() => setStatusFilter('pending')}>
                  Da approvare
                </button>
                <button className={chip(statusFilter === 'unread')} onClick={() => setStatusFilter('unread')}>
                  Non lette
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {authorized === null && (
                <p className="p-6 text-center text-sm text-[var(--text-secondary)]">Caricamento…</p>
              )}
              {authorized && conversations.length === 0 && (
                <p className="p-6 text-center text-sm text-[var(--text-secondary)]">Nessuna conversazione.</p>
              )}
              {conversations.map((c) => {
                const active = c.key === selectedKey
                return (
                  <button
                    key={c.key}
                    onClick={() => select(c.key)}
                    className={`w-full text-left px-3 py-3 flex gap-3 border-b border-[var(--border-color)] transition-colors ${
                      active ? 'bg-[var(--background-secondary)]' : 'hover:bg-[var(--background-secondary)]'
                    }`}
                  >
                    <div className="flex -space-x-2 shrink-0">
                      {c.platforms.map((p) => {
                        const meta = PLATFORM[p as Platform]
                        if (!meta) return null
                        const Icon = meta.icon
                        return (
                          <div
                            key={p}
                            className="w-8 h-8 rounded-full flex items-center justify-center ring-2 ring-[var(--card-background)]"
                            style={{ backgroundColor: `${meta.color}33`, color: meta.color }}
                          >
                            <Icon className="w-3.5 h-3.5" />
                          </div>
                        )
                      })}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p
                          className={`text-sm truncate text-[var(--text-primary)] ${c.unread ? 'font-semibold' : ''}`}
                        >
                          {c.contactName || c.members[0]?.contactId}
                        </p>
                        <span className="text-[11px] text-[var(--text-secondary)] shrink-0">{formatTime(c.lastAt)}</span>
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] truncate">
                        {c.lastStatus === 'pending' ? 'Bozza AI: ' : c.lastDirection === 'out' ? 'Tu: ' : ''}
                        {c.lastMessage}
                      </p>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {c.pending > 0 && (
                          <span className="px-1.5 py-0.5 text-[10px] rounded bg-[#FF9500]/15 text-[#FF9500]">
                            {c.pending} da approvare
                          </span>
                        )}
                        {c.unread > 0 && (
                          <span className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]">
                            {c.unread} nuovi
                          </span>
                        )}
                        {c.linked && c.platforms.length > 1 && (
                          <span className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--background-secondary)] text-[var(--text-secondary)]">
                            stessa persona su {c.platforms.length} canali
                          </span>
                        )}
                        {c.suggestion && (
                          <span className="px-1.5 py-0.5 text-[10px] rounded bg-[#AF52DE]/15 text-[#AF52DE]">
                            possibile doppione
                          </span>
                        )}
                        {c.hasComments && (
                          <span className="px-1.5 py-0.5 text-[10px] rounded bg-[var(--background-secondary)] text-[var(--text-secondary)]">
                            commenti
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </section>

          {/* Conversazione */}
          <section
            className={`flex-col min-h-0 min-w-0 rounded-xl border border-[var(--border-color)] bg-[var(--card-background)] ${
              selectedKey ? 'flex' : 'hidden md:flex'
            }`}
          >
            {!selectedKey ? (
              <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-secondary)] gap-2">
                <MessageSquareText className="w-8 h-8" />
                <p className="text-sm">Seleziona una conversazione</p>
              </div>
            ) : (
              <>
                <div className="px-3 py-2.5 border-b border-[var(--border-color)] space-y-2">
                  <div className="flex items-center gap-3">
                    <button
                      className="md:hidden p-1 -ml-1 text-[var(--text-secondary)]"
                      onClick={() => select(null)}
                      aria-label="Indietro"
                    >
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                        {current?.contactName || current?.members[0]?.contactId || 'Conversazione'}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {(current?.members || []).map((m) => (
                          <span key={`${m.platform}:${m.contactId}`} className="inline-flex items-center gap-1">
                            <PlatformBadge platform={m.platform} size="xs" />
                            {current?.linked && current.members.length > 1 && (
                              <button
                                onClick={() => unlink(m.platform, m.contactId)}
                                className="text-[10px] text-[var(--text-secondary)] hover:text-[#FF3B30]"
                                title="Separa questo account"
                              >
                                <Unlink className="w-3 h-3" />
                              </button>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={() => setLinking((v) => !v)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      title="Collega a un altro canale della stessa persona"
                    >
                      <Link2 className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Stessa persona</span>
                    </button>
                    <button
                      onClick={() => {
                        loadThread()
                        loadConversations()
                      }}
                      className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--background-secondary)]"
                      aria-label="Aggiorna"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </div>

                  {current?.suggestion && !linking && (
                    <div className="flex flex-wrap items-center gap-2 px-2.5 py-2 rounded-lg bg-[#AF52DE]/10 text-xs text-[var(--text-primary)]">
                      <span>
                        Potrebbe essere la stessa persona di <strong>{current.suggestion.name}</strong> su{' '}
                        {current.suggestion.platforms.map((p) => PLATFORM[p as Platform]?.label || p).join(', ')}.
                      </span>
                      <button
                        onClick={() => link(current.suggestion!.key)}
                        className="px-2 py-1 rounded-md bg-[#AF52DE] text-white font-medium"
                      >
                        Collega
                      </button>
                    </div>
                  )}

                  {linking && (
                    <div className="rounded-lg border border-[var(--border-color)] p-2 space-y-2">
                      <p className="text-xs text-[var(--text-secondary)]">
                        Scegli la conversazione della stessa persona su un altro canale: verranno unite qui e l&apos;AI
                        terrà conto di entrambe.
                      </p>
                      <input
                        value={linkQuery}
                        onChange={(e) => setLinkQuery(e.target.value)}
                        placeholder="Cerca per nome…"
                        className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-[var(--background-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] focus:outline-none"
                      />
                      <div className="max-h-40 overflow-y-auto space-y-1">
                        {linkCandidates.map((c) => (
                          <button
                            key={c.key}
                            onClick={() => link(c.key)}
                            className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-left text-xs hover:bg-[var(--background-secondary)]"
                          >
                            <span className="truncate text-[var(--text-primary)]">
                              {c.contactName || c.members[0]?.contactId}
                            </span>
                            <span className="flex gap-1 shrink-0">
                              {c.platforms.map((p) => (
                                <PlatformBadge key={p} platform={p} size="xs" />
                              ))}
                            </span>
                          </button>
                        ))}
                        {linkCandidates.length === 0 && (
                          <p className="text-xs text-[var(--text-secondary)] px-2">Nessuna altra conversazione.</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div ref={threadRef} className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-2">
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
                    return (
                      <div key={m.id} className={`flex flex-col ${isIn ? 'items-start' : 'items-end'}`}>
                        <div className="flex items-center gap-1 mb-0.5 px-1">
                          <PlatformBadge platform={m.platform} size="xs" />
                          {m.kind === 'comment' && (
                            <span className="text-[10px] text-[var(--text-secondary)]">
                              {isIn ? 'commento pubblico' : 'risposta al commento'}
                            </span>
                          )}
                        </div>
                        <div
                          className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                            isIn
                              ? 'bg-[var(--background-secondary)] text-[var(--text-primary)]'
                              : isPending
                                ? 'border-2 border-dashed border-[#FF9500] bg-[#FF9500]/5 text-[var(--text-primary)]'
                                : 'bg-[var(--accent-blue)] text-white'
                          }`}
                        >
                          {isPending ? (
                            <div className="space-y-2 min-w-[min(240px,70vw)]">
                              <p className="text-[11px] font-medium text-[#FF9500]">
                                {m.status === 'failed' ? `Invio fallito: ${m.error_message}` : 'Bozza AI · da approvare'}
                              </p>
                              <textarea
                                value={drafts[m.id] ?? m.body}
                                onChange={(e) => setDrafts((d) => ({ ...d, [m.id]: e.target.value }))}
                                rows={Math.min(10, Math.max(3, Math.ceil((drafts[m.id] ?? m.body).length / 32)))}
                                className="w-full px-2 py-1.5 text-sm rounded-lg bg-[var(--background)] border border-[var(--border-color)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)] resize-y"
                              />
                              <div className="flex gap-2 justify-end">
                                <button
                                  onClick={() => act(m, 'reject')}
                                  disabled={busyId === m.id}
                                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs border border-[var(--border-color)] text-[var(--text-secondary)] disabled:opacity-50"
                                >
                                  <X className="w-3.5 h-3.5" /> Scarta
                                </button>
                                <button
                                  onClick={() => act(m, 'approve')}
                                  disabled={busyId === m.id}
                                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-[#34C759] text-white font-medium disabled:opacity-50"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                  {busyId === m.id ? 'Invio…' : m.status === 'failed' ? 'Riprova' : 'Approva e invia'}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="whitespace-pre-wrap break-words">{m.body}</p>
                          )}
                          {!isPending && (
                            <p className={`text-[10px] mt-1 ${isIn ? 'text-[var(--text-secondary)]' : 'text-white/70'}`}>
                              {formatTime(m.created_at)}
                              {m.status === 'sending' ? ' · invio…' : ''}
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    sendManual()
                  }}
                  className="flex gap-2 p-3 border-t border-[var(--border-color)]"
                >
                  {privatePlatforms.length > 1 && (
                    <select
                      value={activeReplyPlatform}
                      onChange={(e) => setReplyPlatform(e.target.value)}
                      className="px-2 text-xs rounded-lg bg-[var(--background-secondary)] border border-[var(--border-color)] text-[var(--text-primary)]"
                      aria-label="Canale di risposta"
                    >
                      {privatePlatforms.map((p) => (
                        <option key={p} value={p}>
                          {PLATFORM[p as Platform]?.label || p}
                        </option>
                      ))}
                    </select>
                  )}
                  <input
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder={
                      activeReplyPlatform
                        ? `Rispondi su ${PLATFORM[activeReplyPlatform as Platform]?.label || activeReplyPlatform}…`
                        : 'Scrivi una risposta…'
                    }
                    className="flex-1 min-w-0 px-3 py-2 text-sm rounded-lg bg-[var(--background-secondary)] border border-[var(--border-color)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
                  />
                  <button
                    type="submit"
                    disabled={!reply.trim() || busyId === 'manual'}
                    className="px-3 rounded-lg bg-[var(--accent-blue)] text-white disabled:opacity-50"
                    aria-label="Invia"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </form>
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
