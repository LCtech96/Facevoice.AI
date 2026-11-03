'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Facebook, Globe, Instagram, Loader2, Mail, MessageCircle, RefreshCw, Send, Sparkles, X } from 'lucide-react'
import { useWorkspace } from '@/components/app/WorkspaceContext'

// Omnichat: tutte le conversazioni dei canali collegati, la risposta a mano o
// con le bozze dell'AI, e l'automazione di ogni canale.

type Mode = 'off' | 'approval' | 'auto'
type Channel = { platform: string; status: string; handle: string | null; mode: Mode }
type Conversation = {
  platform: string
  contactId: string
  name: string | null
  subject: string | null
  last: { body: string; direction: 'in' | 'out'; at: string; status: string | null }
  unread: number
  pending: number
}
type Message = {
  id: string
  direction: 'in' | 'out'
  body: string
  subject: string | null
  status: string | null
  origin: string | null
  error_message: string | null
  created_at: string
}

const ICONS: Record<string, typeof Mail> = { email: Mail, instagram: Instagram, facebook: Facebook, whatsapp: MessageCircle, web: Globe }
const LABELS: Record<string, string> = { email: 'Email', instagram: 'Instagram', facebook: 'Facebook', whatsapp: 'WhatsApp', web: 'Chat del sito' }
const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'off', label: 'Spenta', hint: 'L’AI non risponde: i messaggi arrivano qui e rispondi tu.' },
  { id: 'approval', label: 'Bozze', hint: 'L’AI prepara la risposta, tu la controlli e la invii.' },
  { id: 'auto', label: 'Automatica', hint: 'L’AI risponde da sola. I messaggi dubbi restano in bozza.' },
]

const when = (iso: string) => {
  const d = new Date(iso)
  const today = new Date().toDateString() === d.toDateString()
  return today ? d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })
}

export default function OmnichatPage() {
  const { appFetch, workspace } = useWorkspace()
  const [channels, setChannels] = useState<Channel[]>([])
  const [conversations, setConversations] = useState<Conversation[] | null>(null)
  const [filter, setFilter] = useState<string>('all')
  const [open, setOpen] = useState<{ platform: string; contactId: string } | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const canManage = workspace?.role !== 'member'

  const loadChannels = useCallback(async () => {
    const res = await appFetch('/api/app/channels').catch(() => null)
    if (res?.ok) setChannels(((await res.json()).channels || []).filter((c: Channel) => c.status === 'connected'))
  }, [appFetch])

  const loadInbox = useCallback(async () => {
    const res = await appFetch('/api/app/inbox').catch(() => null)
    if (res?.ok) setConversations((await res.json()).conversations || [])
    else setConversations((prev) => prev ?? [])
  }, [appFetch])

  const sync = useCallback(
    async (force = false) => {
      setSyncing(true)
      const res = await appFetch(`/api/app/sync${force ? '?force=1' : ''}`, { method: 'POST' }).catch(() => null)
      const data = res ? await res.json().catch(() => ({})) : {}
      setSyncing(false)
      if (data.errors?.length) setNotice(data.errors[0])
      else if (force) setNotice(data.inserted ? `${data.inserted} messaggi nuovi.` : 'Nessun messaggio nuovo.')
      if (data.inserted || data.replies) loadInbox()
    },
    [appFetch, loadInbox]
  )

  useEffect(() => {
    loadChannels()
    loadInbox()
    sync()
    const inbox = setInterval(() => document.visibilityState === 'visible' && loadInbox(), 20_000)
    const mail = setInterval(() => document.visibilityState === 'visible' && sync(), 60_000)
    return () => {
      clearInterval(inbox)
      clearInterval(mail)
    }
  }, [loadChannels, loadInbox, sync])

  const setMode = async (platform: string, mode: Mode) => {
    setChannels((list) => list.map((c) => (c.platform === platform ? { ...c, mode } : c)))
    const res = await appFetch('/api/app/channels', { method: 'PATCH', body: JSON.stringify({ platform, mode }) }).catch(() => null)
    if (!res?.ok) {
      setNotice('Automazione non salvata, riprova.')
      loadChannels()
    }
  }

  const visible = useMemo(() => (conversations || []).filter((c) => filter === 'all' || c.platform === filter), [conversations, filter])

  if (!channels.length && conversations && !conversations.length) {
    return (
      <div>
        <h1 className="text-3xl font-extrabold">Omnichat</h1>
        <p className="mt-3 max-w-xl text-[var(--text-secondary)]">Qui arrivano i messaggi di tutti i canali collegati. Inizia collegando la tua casella email.</p>
        <Link href="/app/canali/email" className="mt-6 inline-block rounded-full bg-[var(--accent-blue)] px-5 py-2.5 font-semibold text-white">
          Collega l’email
        </Link>
      </div>
    )
  }

  return (
    <div className="-mx-4 -my-6 md:-mx-8 md:-my-10">
      {/* Automazione per canale */}
      {(
        <div className={`border-b border-[var(--border-color)] px-4 py-4 md:px-8 ${open ? 'hidden md:block' : ''}`}>
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl font-extrabold">Omnichat</h1>
            <button onClick={() => sync(true)} disabled={syncing} className="flex items-center gap-2 text-sm text-[var(--text-secondary)]" aria-label="Controlla nuovi messaggi">
              <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} /> <span className="hidden sm:inline">Aggiorna</span>
            </button>
          </div>
          {notice && (
            <p className="mt-2 flex items-start gap-2 text-sm text-[var(--text-secondary)]">
              {notice}
              <button onClick={() => setNotice(null)} aria-label="Chiudi">
                <X className="h-4 w-4" />
              </button>
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-3">
            {channels.map((c) => {
              const Icon = ICONS[c.platform] || Mail
              return (
                <div key={c.platform} className="rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-3">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <Icon className="h-4 w-4 text-[var(--accent-blue)]" /> {LABELS[c.platform] || c.platform}
                    <span className="truncate text-xs font-normal text-[var(--text-secondary)]">{c.handle}</span>
                  </p>
                  <div className="mt-2 flex rounded-full bg-[var(--background)] p-0.5" role="radiogroup" aria-label={`Automazione ${LABELS[c.platform]}`}>
                    {MODES.map((m) => (
                      <button
                        key={m.id}
                        role="radio"
                        aria-checked={c.mode === m.id}
                        title={m.hint}
                        disabled={!canManage}
                        onClick={() => setMode(c.platform, m.id)}
                        className={`rounded-full px-3 py-1 text-xs ${c.mode === m.id ? 'bg-[var(--accent-blue)] text-white' : 'text-[var(--text-secondary)]'}`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 max-w-[16rem] text-[11px] text-[var(--text-secondary)]">{MODES.find((m) => m.id === c.mode)?.hint}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="flex min-h-[60vh]">
        {/* Elenco conversazioni */}
        <div className={`w-full border-r border-[var(--border-color)] md:block md:w-80 md:shrink-0 ${open ? 'hidden' : 'block'}`}>
          <div className="flex gap-1 overflow-x-auto px-4 py-3">
            {['all', ...channels.map((c) => c.platform)].map((p) => (
              <button
                key={p}
                onClick={() => setFilter(p)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs ${filter === p ? 'bg-[var(--text-primary)] text-[var(--background)]' : 'text-[var(--text-secondary)]'}`}
              >
                {p === 'all' ? 'Tutti' : LABELS[p] || p}
              </button>
            ))}
          </div>
          {conversations === null ? (
            <div className="p-6 text-center">
              <Loader2 className="mx-auto h-5 w-5 animate-spin text-[var(--text-secondary)]" />
            </div>
          ) : !visible.length ? (
            <p className="px-4 py-6 text-sm text-[var(--text-secondary)]">Nessun messaggio per ora. Le email nuove arrivano qui entro un minuto.</p>
          ) : (
            <ul>
              {visible.map((c) => {
                const Icon = ICONS[c.platform] || Mail
                const active = open?.platform === c.platform && open.contactId === c.contactId
                return (
                  <li key={`${c.platform}:${c.contactId}`}>
                    <button
                      onClick={() => setOpen({ platform: c.platform, contactId: c.contactId })}
                      className={`flex w-full gap-3 border-b border-[var(--border-color)] px-4 py-3 text-left ${active ? 'bg-[var(--background-secondary)]' : ''}`}
                    >
                      <Icon className="mt-1 h-4 w-4 shrink-0 text-[var(--accent-blue)]" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className={`truncate ${c.unread ? 'font-bold' : 'font-medium'}`}>{c.name || c.contactId}</span>
                          <span className="ml-auto shrink-0 text-[11px] text-[var(--text-secondary)]">{when(c.last.at)}</span>
                        </span>
                        {c.subject && <span className="block truncate text-xs text-[var(--text-primary)]">{c.subject}</span>}
                        <span className="block truncate text-xs text-[var(--text-secondary)]">
                          {c.last.direction === 'out' ? (c.last.status === 'pending' ? 'Bozza: ' : 'Tu: ') : ''}
                          {c.last.body}
                        </span>
                        <span className="mt-1 flex gap-2">
                          {c.unread > 0 && <span className="rounded-full bg-[var(--accent-blue)] px-2 text-[10px] text-white">{c.unread} nuovi</span>}
                          {c.pending > 0 && <span className="rounded-full bg-[#FF9500] px-2 text-[10px] text-white">bozza da approvare</span>}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Conversazione */}
        <div className={`min-w-0 flex-1 ${open ? 'block' : 'hidden md:block'}`}>
          {open ? (
            <Thread
              key={`${open.platform}:${open.contactId}`}
              platform={open.platform}
              contactId={open.contactId}
              conversation={(conversations || []).find((c) => c.platform === open.platform && c.contactId === open.contactId)}
              onBack={() => setOpen(null)}
              onChanged={loadInbox}
            />
          ) : (
            <p className="p-8 text-sm text-[var(--text-secondary)]">Scegli una conversazione.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function Thread({
  platform,
  contactId,
  conversation,
  onBack,
  onChanged,
}: {
  platform: string
  contactId: string
  conversation?: Conversation
  onBack: () => void
  onChanged: () => void
}) {
  const { appFetch } = useWorkspace()
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [text, setText] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const bottom = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const res = await appFetch(`/api/app/inbox/thread?platform=${encodeURIComponent(platform)}&contact=${encodeURIComponent(contactId)}`).catch(() => null)
    if (res?.ok) setMessages((await res.json()).messages || [])
  }, [appFetch, platform, contactId])

  useEffect(() => {
    load().then(onChanged)
    const timer = setInterval(() => document.visibilityState === 'visible' && load(), 15_000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages?.length])

  const post = async (url: string, body: unknown, key: string) => {
    setBusy(key)
    setError(null)
    const res = await appFetch(url, { method: 'POST', body: JSON.stringify(body) }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setBusy(null)
    if (!res?.ok) {
      setError(data.error || 'Connessione non riuscita, riprova.')
      return false
    }
    await load()
    onChanged()
    return true
  }

  const send = async () => {
    if (await post('/api/app/inbox/reply', { platform, contactId, body: text }, 'send')) setText('')
  }

  const subject = messages?.find((m) => m.subject)?.subject || conversation?.subject

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-[var(--border-color)] px-4 py-3">
        <button onClick={onBack} className="md:hidden" aria-label="Indietro">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <p className="truncate font-semibold">{conversation?.name || contactId}</p>
          <p className="truncate text-xs text-[var(--text-secondary)]">
            {LABELS[platform] || platform} · {contactId}
            {subject ? ` · ${subject}` : ''}
          </p>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages === null && <Loader2 className="mx-auto h-5 w-5 animate-spin text-[var(--text-secondary)]" />}
        {messages?.map((m) => {
          const pending = m.direction === 'out' && (m.status === 'pending' || m.status === 'failed')
          if (pending) {
            const value = drafts[m.id] ?? m.body
            return (
              <div key={m.id} className="ml-auto max-w-[92%] rounded-2xl border border-[#FF9500] bg-[var(--background-secondary)] p-3">
                <p className="text-xs font-semibold text-[#FF9500]">
                  {m.status === 'failed' ? 'Invio non riuscito' : m.origin === 'manual' ? 'Da inviare' : 'Bozza dell’AI: controllala e inviala'}
                </p>
                {m.error_message && <p className="mt-1 text-xs text-[var(--text-secondary)]">{m.error_message}</p>}
                <textarea
                  value={value}
                  onChange={(e) => setDrafts((d) => ({ ...d, [m.id]: e.target.value }))}
                  rows={Math.min(14, Math.max(4, value.split('\n').length + 1))}
                  className="mt-2 w-full rounded-xl border border-[var(--border-color)] bg-[var(--background)] p-3 text-[16px] text-[var(--text-primary)] md:text-sm"
                />
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    onClick={() => post('/api/app/inbox/draft', { action: 'reject', id: m.id }, `reject:${m.id}`)}
                    disabled={Boolean(busy)}
                    className="rounded-full px-3 py-1.5 text-sm text-[var(--text-secondary)]"
                  >
                    Scarta
                  </button>
                  <button
                    onClick={() => post('/api/app/inbox/reply', { draftId: m.id, body: value }, `send:${m.id}`)}
                    disabled={Boolean(busy) || !value.trim()}
                    className="flex items-center gap-2 rounded-full bg-[var(--accent-blue)] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {busy === `send:${m.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Invia
                  </button>
                </div>
              </div>
            )
          }
          const mine = m.direction === 'out'
          return (
            <div key={m.id} className={`max-w-[85%] ${mine ? 'ml-auto' : ''}`}>
              <div
                className={`whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm ${
                  mine ? 'bg-[var(--accent-blue)] text-white' : 'bg-[var(--background-secondary)] text-[var(--text-primary)]'
                }`}
              >
                {m.body}
              </div>
              <p className={`mt-1 text-[11px] text-[var(--text-secondary)] ${mine ? 'text-right' : ''}`}>
                {when(m.created_at)}
                {mine && m.origin?.startsWith('ai') ? ' · AI' : ''}
                {mine && m.origin === 'mailbox' ? ' · inviata dalla casella' : ''}
                {m.status === 'sending' ? ' · invio…' : ''}
              </p>
            </div>
          )
        })}
        <div ref={bottom} />
      </div>

      <div className="border-t border-[var(--border-color)] p-3">
        {error && <p className="mb-2 text-sm text-[#ff6b6b]">{error}</p>}
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Scrivi una risposta…"
            rows={2}
            className="min-h-[44px] flex-1 resize-none rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] px-4 py-2.5 text-[16px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)] md:text-sm"
          />
          <button
            onClick={() => post('/api/app/inbox/draft', { action: 'suggest', platform, contactId }, 'suggest')}
            disabled={Boolean(busy)}
            title="Chiedi all’AI una bozza di risposta"
            aria-label="Chiedi all’AI una bozza"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border-color)] text-[var(--accent-blue)] disabled:opacity-50"
          >
            {busy === 'suggest' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          </button>
          <button
            onClick={send}
            disabled={Boolean(busy) || !text.trim()}
            aria-label="Invia"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--accent-blue)] text-white disabled:opacity-50"
          >
            {busy === 'send' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  )
}
