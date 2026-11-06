'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Clock, Facebook, Globe, Instagram, Loader2, Mail, MessageCircle, PencilLine, RefreshCw, Send, Sparkles, X } from 'lucide-react'
import { useWorkspace } from '@/components/app/WorkspaceContext'
import { useTranslation } from '@/lib/i18n/LanguageContext'

// Omnichat: tutte le conversazioni dei canali collegati, la risposta a mano o
// con le bozze dell'AI, e l'automazione di ogni canale. "Correggi" sotto ogni
// risposta dell'AI: come avrebbe dovuto rispondere, solo in questa chat o sempre.

type Mode = 'off' | 'approval' | 'auto'
type Channel = { platform: string; status: string; handle: string | null; mode: Mode }
type DelayUnit = 'secondi' | 'minuti'
type ReplyDelay = { seconds: number; unit: DelayUnit }
type Conversation = {
  platform: string
  contactId: string
  name: string | null
  subject: string | null
  last: { body: string; direction: 'in' | 'out'; at: string; status: string | null }
  unread: number
  pending: number
  /** Risposta dell'AI gia' inviata con un dettaglio da confermare alla persona. */
  toConfirm?: boolean
}
type Message = {
  id: string
  direction: 'in' | 'out'
  body: string
  subject: string | null
  status: string | null
  origin: string | null
  error_message: string | null
  external_id?: string | null
  reply_to?: string | null
  created_at: string
}
/** Se ora si puo' scrivere in questa chat (24 ore di Meta, email sempre). */
type SendWindow = { ok: boolean; until?: string; reason?: string }
type CorrectionResult = { scope: 'chat' | 'always'; rule: { rule: string } | null; learned: boolean; sent: boolean; draftUpdated?: boolean; sendError?: string }

/** Risposte scritte dall'AI che si possono correggere: inviate da sola, approvate, o bozze. */
const correctable = (m: Message) =>
  m.direction === 'out' &&
  (m.status === 'pending' || m.status === 'failed' ? String(m.origin || '').startsWith('ai') : m.status === 'sent' && (m.origin === 'ai_auto' || m.origin === 'ai_approved'))
const sameText = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim()

const ICONS: Record<string, typeof Mail> = { email: Mail, instagram: Instagram, facebook: Facebook, whatsapp: MessageCircle, web: Globe }
const LABELS: Record<string, string> = { email: 'Email', instagram: 'Instagram', facebook: 'Facebook', whatsapp: 'WhatsApp', web: 'Chat del sito' }
const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'off', label: 'Spenta', hint: 'L’AI non risponde: i messaggi arrivano qui e rispondi tu.' },
  { id: 'approval', label: 'Bozze', hint: 'L’AI prepara la risposta, tu la controlli e la invii.' },
  { id: 'auto', label: 'Automatica', hint: 'L’AI risponde da sola. I messaggi dubbi restano in bozza.' },
]

const when = (iso: string, language = 'it') => {
  const d = new Date(iso)
  const locale = language === 'it' ? 'it-IT' : 'en-GB'
  const today = new Date().toDateString() === d.toDateString()
  return today ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
}

export default function OmnichatPage() {
  const { appFetch, workspace } = useWorkspace()
  const { language } = useTranslation()
  const [channels, setChannels] = useState<Channel[]>([])
  const [conversations, setConversations] = useState<Conversation[] | null>(null)
  const [filter, setFilter] = useState<string>('all')
  const [open, setOpen] = useState<{ platform: string; contactId: string } | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [delay, setDelay] = useState<ReplyDelay | null>(null)
  const canManage = workspace?.role !== 'member'

  const loadChannels = useCallback(async () => {
    const res = await appFetch('/api/app/channels').catch(() => null)
    if (!res?.ok) return
    const data = await res.json()
    setChannels((data.channels || []).filter((c: Channel) => c.status === 'connected'))
    if (data.replyDelay) setDelay(data.replyDelay)
  }, [appFetch])

  const saveDelay = async (value: number, unit: DelayUnit) => {
    const res = await appFetch('/api/app/channels', { method: 'PATCH', body: JSON.stringify({ replyDelay: { value, unit } }) }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (!res?.ok) {
      setNotice(data.error || 'Ritardo non salvato, riprova.')
      return false
    }
    setDelay(data.replyDelay)
    return true
  }

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

  // Link dall'Assistente AI (?platform=…&contact=…): si apre subito quella conversazione.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const platform = params.get('platform')
    const contactId = params.get('contact')
    if (platform && contactId) setOpen({ platform, contactId })
  }, [])

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
                    <span translate="no" className="truncate text-xs font-normal text-[var(--text-secondary)]">{c.handle}</span>
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
            {channels.length > 0 && delay && <DelayCard delay={delay} canManage={canManage} onSave={saveDelay} />}
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
                          <span translate="no" className={`truncate ${c.unread ? 'font-bold' : 'font-medium'}`}>{c.name || c.contactId}</span>
                          <span className="ml-auto shrink-0 text-[11px] text-[var(--text-secondary)]">{when(c.last.at, language)}</span>
                        </span>
                        {c.subject && <span translate="no" className="block truncate text-xs text-[var(--text-primary)]">{c.subject}</span>}
                        <span className="block truncate text-xs text-[var(--text-secondary)]">
                          {c.last.direction === 'out' ? (c.last.status === 'pending' ? 'Bozza: ' : 'Tu: ') : ''}
                          <span translate="no">{c.last.body}</span>
                        </span>
                        <span className="mt-1 flex gap-2">
                          {c.unread > 0 && <span className="rounded-full bg-[var(--accent-blue)] px-2 text-[10px] text-white">{c.unread} nuovi</span>}
                          {c.pending > 0 && <span className="rounded-full bg-[#FF9500] px-2 text-[10px] text-white">bozza da approvare</span>}
                          {c.toConfirm && <span className="rounded-full border border-[#FF9500] px-2 text-[10px] text-[#FF9500]">da confermare</span>}
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
  const { language } = useTranslation()
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [text, setText] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [sendWindow, setSendWindow] = useState<SendWindow | null>(null)
  const [correcting, setCorrecting] = useState<Message | null>(null)
  const bottom = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const res = await appFetch(`/api/app/inbox/thread?platform=${encodeURIComponent(platform)}&contact=${encodeURIComponent(contactId)}`).catch(() => null)
    if (!res?.ok) return
    const data = await res.json()
    setMessages(data.messages || [])
    setSendWindow(data.sendWindow || null)
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

  /** Il messaggio della persona a cui rispondeva l'AI (quello indicato, se no l'ultimo prima). */
  const answered = (m: Message) => {
    const list = messages || []
    const exact = m.reply_to ? list.find((x) => x.direction === 'in' && x.external_id === m.reply_to) : undefined
    if (exact) return exact.body
    for (let i = list.indexOf(m) - 1; i >= 0; i--) if (list[i].direction === 'in') return list[i].body
    return ''
  }

  const corrected = async (m: Message, result: CorrectionResult) => {
    setCorrecting(null)
    const pending = m.status === 'pending' || m.status === 'failed'
    const parts = [
      result.scope === 'always'
        ? `Regola salvata: «${result.rule?.rule || ''}». La trovi in Istruzioni.${result.learned ? '' : ' L’AI non era disponibile: la regola usa il tuo esempio, puoi riscriverla lì.'}`
        : 'Correzione salvata: l’AI la segue da ora in questa chat.',
    ]
    if (result.sent) parts.push('Messaggio inviato.')
    else if (result.sendError) parts.push(`Invio non riuscito: ${result.sendError}.`)
    else if (pending && result.draftUpdated) {
      // La bozza resta, salvata col testo corretto: si mostra quella (non una modifica locale).
      setDrafts((d) => {
        const next = { ...d }
        delete next[m.id]
        return next
      })
      parts.push('Il testo corretto è nella bozza: controllalo e invialo.')
    }
    setSaved(parts.join(' '))
    await load()
    onChanged()
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-[var(--border-color)] px-4 py-3">
        <button onClick={onBack} className="md:hidden" aria-label="Indietro">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <p translate="no" className="truncate font-semibold">{conversation?.name || contactId}</p>
          <p className="truncate text-xs text-[var(--text-secondary)]">
            {LABELS[platform] || platform} · <span translate="no">{contactId}</span>
            {subject ? <span translate="no">{` · ${subject}`}</span> : null}
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
                <div className="mt-2 flex flex-wrap justify-end gap-2">
                  {correctable(m) && (
                    <button
                      onClick={() => setCorrecting(m)}
                      disabled={Boolean(busy)}
                      className="mr-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-[var(--text-secondary)]"
                      title="Insegna all’AI come avrebbe dovuto rispondere"
                    >
                      <PencilLine className="h-4 w-4" /> Correggi
                    </button>
                  )}
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
                translate="no"
                className={`whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm ${
                  mine ? 'bg-[var(--accent-blue)] text-white' : 'bg-[var(--background-secondary)] text-[var(--text-primary)]'
                }`}
              >
                {m.body}
              </div>
              <p className={`mt-1 text-[11px] text-[var(--text-secondary)] ${mine ? 'text-right' : ''}`}>
                {when(m.created_at, language)}
                {mine && m.origin?.startsWith('ai') ? ' · AI' : ''}
                {mine && m.origin === 'mailbox' ? ' · inviata dalla casella' : ''}
                {mine && m.origin === 'manual_app' ? ' · dall’app' : ''}
                {mine && m.origin === 'assistant' ? ' · dall’Assistente' : ''}
                {m.status === 'sending' ? ' · invio…' : ''}
                {correctable(m) && (
                  <>
                    {' · '}
                    <button onClick={() => setCorrecting(m)} className="font-medium text-[var(--accent-blue)]" title="Insegna all’AI come avrebbe dovuto rispondere">
                      Correggi
                    </button>
                  </>
                )}
              </p>
              {mine && m.status === 'sent' && m.error_message?.startsWith('Da confermare') && (
                <p className="mt-0.5 text-right text-[11px] font-medium text-[#FF9500]">{m.error_message}</p>
              )}
            </div>
          )
        })}
        <div ref={bottom} />
      </div>

      <div className="border-t border-[var(--border-color)] p-3">
        {error && <p className="mb-2 text-sm text-[#ff6b6b]">{error}</p>}
        {saved && (
          <p className="mb-2 flex items-start gap-2 text-sm text-[var(--text-secondary)]">
            <span className="flex-1">{saved}</span>
            <button onClick={() => setSaved(null)} aria-label="Chiudi">
              <X className="h-4 w-4" />
            </button>
          </p>
        )}
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

      {correcting && (
        <CorrectionSheet
          message={correcting}
          initial={drafts[correcting.id] ?? correcting.body}
          incoming={answered(correcting)}
          sendWindow={sendWindow}
          onClose={() => setCorrecting(null)}
          onSaved={(result) => corrected(correcting, result)}
        />
      )}
    </div>
  )
}

/**
 * Correggi: il messaggio della persona e la risposta dell'AI (da leggere), come
 * avrebbe dovuto rispondere, per cosa vale e se mandarla anche ora.
 */
function CorrectionSheet({
  message,
  initial,
  incoming,
  sendWindow,
  onClose,
  onSaved,
}: {
  message: Message
  /** Testo di partenza: quello dell'AI (o la bozza gia' ritoccata). */
  initial: string
  incoming: string
  sendWindow: SendWindow | null
  onClose: () => void
  onSaved: (result: CorrectionResult) => void
}) {
  const { appFetch } = useWorkspace()
  const [text, setText] = useState(initial)
  const [scope, setScope] = useState<'chat' | 'always'>('chat')
  const [sendNow, setSendNow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = message.status === 'pending' || message.status === 'failed'
  const canSend = Boolean(sendWindow?.ok)
  const changed = text.trim() !== '' && !sameText(text, message.body)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saving, onClose])

  const save = async () => {
    setSaving(true)
    setError(null)
    const res = await appFetch('/api/app/corrections', {
      method: 'POST',
      body: JSON.stringify({ messageId: message.id, corrected: text, scope, sendNow: canSend && sendNow }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setSaving(false)
    if (!res?.ok) return setError(data.error || 'Connessione non riuscita, riprova.')
    onSaved(data as CorrectionResult)
  }

  const box = 'mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-[var(--background-secondary)] px-3 py-2 text-sm text-[var(--text-primary)]'
  const scopes: { id: 'chat' | 'always'; label: string; hint: string }[] = [
    { id: 'chat', label: 'Solo in questa chat', hint: 'L’AI la segue da ora in questa conversazione.' },
    { id: 'always', label: 'Sempre, per messaggi così', hint: 'L’AI ne ricava una regola per i messaggi simili, su tutti i canali. La trovi in Istruzioni.' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center" onClick={() => !saving && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Correggi la risposta"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-[var(--background)] p-5 shadow-xl md:max-w-lg md:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Correggi la risposta</h2>
            <p className="text-sm text-[var(--text-secondary)]">L’AI impara da come l’avresti scritta tu.</p>
          </div>
          <button onClick={onClose} disabled={saving} aria-label="Chiudi">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-4 text-xs font-semibold text-[var(--text-secondary)]">Messaggio della persona</p>
        <div translate="no" className={box}>
          {incoming || <span className="text-[var(--text-secondary)]">Nessun messaggio</span>}
        </div>
        <p className="mt-3 text-xs font-semibold text-[var(--text-secondary)]">Risposta dell’AI</p>
        <div translate="no" className={box}>
          {message.body}
        </div>

        <label htmlFor="correction-text" className="mt-4 block text-sm font-semibold">
          Come avrebbe dovuto rispondere
        </label>
        <textarea
          id="correction-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={2000}
          rows={Math.min(10, Math.max(4, text.split('\n').length + 1))}
          className="mt-1 w-full rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-3 text-[16px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)] md:text-sm"
        />
        {text.length > 1800 && <p className="text-right text-[11px] text-[var(--text-secondary)]">{text.length}/2000</p>}

        <p className="mt-3 text-sm font-semibold">Vale per</p>
        <div className="mt-1 flex flex-wrap rounded-full bg-[var(--background-secondary)] p-0.5" role="radiogroup" aria-label="Vale per">
          {scopes.map((s) => (
            <button
              key={s.id}
              role="radio"
              aria-checked={scope === s.id}
              onClick={() => setScope(s.id)}
              className={`flex-1 rounded-full px-3 py-1.5 text-xs ${scope === s.id ? 'bg-[var(--accent-blue)] text-white' : 'text-[var(--text-secondary)]'}`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-[var(--text-secondary)]">{scopes.find((s) => s.id === scope)?.hint}</p>

        <label className={`mt-4 flex items-start gap-2 text-sm ${canSend ? '' : 'opacity-50'}`}>
          <input type="checkbox" checked={canSend && sendNow} disabled={!canSend} onChange={(e) => setSendNow(e.target.checked)} className="mt-0.5 h-4 w-4" />
          <span>
            Mandala anche ora in questa chat
            <span className="block text-[11px] text-[var(--text-secondary)]">
              {!canSend
                ? sendWindow?.reason || 'Ora non si può scrivere in questa chat.'
                : pending
                  ? sendNow
                    ? 'Parte al posto della bozza.'
                    : 'Se non la mandi ora, la trovi nella bozza.'
                  : 'Parte come nuovo messaggio.'}
            </span>
          </span>
        </label>

        {error && <p className="mt-3 text-sm text-[#ff6b6b]">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} disabled={saving} className="rounded-full px-4 py-2 text-sm text-[var(--text-secondary)]">
            Annulla
          </button>
          <button
            onClick={save}
            disabled={saving || !changed}
            title={changed ? undefined : 'Cambia il testo per correggere la risposta'}
            className="flex items-center gap-2 rounded-full bg-[var(--accent-blue)] px-5 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Salva
          </button>
        </div>
      </div>
    </div>
  )
}

const shownDelay = (d: ReplyDelay) => String(d.unit === 'minuti' ? Math.round((d.seconds / 60) * 10) / 10 : d.seconds)

/** Ritardo delle risposte automatiche (uno per spazio): lo cambiano titolare e amministratori. */
function DelayCard({ delay, canManage, onSave }: { delay: ReplyDelay; canManage: boolean; onSave: (value: number, unit: DelayUnit) => Promise<boolean> }) {
  const shown = shownDelay
  const [amount, setAmount] = useState(shown(delay))
  const [unit, setUnit] = useState<DelayUnit>(delay.unit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setAmount(shown(delay))
    setUnit(delay.unit)
  }, [delay])

  const value = Number(amount.replace(',', '.'))
  const seconds = unit === 'minuti' ? value * 60 : value
  const valid = amount.trim() !== '' && Number.isFinite(value) && value >= 0 && seconds <= 30 * 60
  const changed = amount !== shown(delay) || unit !== delay.unit

  const save = async () => {
    if (!valid) {
      setError('Da 0 a 30 minuti.')
      return
    }
    setSaving(true)
    setError(null)
    await onSave(value, unit)
    setSaving(false)
  }

  return (
    <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-3">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Clock className="h-4 w-4 text-[var(--accent-blue)]" /> Ritardo delle risposte automatiche
      </p>
      <div className="mt-2 flex items-center gap-2">
        <input
          type="number"
          inputMode="decimal"
          min={0}
          max={unit === 'minuti' ? 30 : 1800}
          step={unit === 'minuti' ? 0.5 : 5}
          value={amount}
          disabled={!canManage || saving}
          onChange={(e) => setAmount(e.target.value)}
          aria-label="Ritardo"
          className="w-20 rounded-full border border-[var(--border-color)] bg-[var(--background)] px-3 py-1 text-[16px] text-[var(--text-primary)] md:text-xs"
        />
        <select
          value={unit}
          disabled={!canManage || saving}
          onChange={(e) => setUnit(e.target.value as DelayUnit)}
          aria-label="Unità"
          className="rounded-full border border-[var(--border-color)] bg-[var(--background)] px-3 py-1 text-[16px] text-[var(--text-primary)] md:text-xs"
        >
          <option value="secondi">secondi</option>
          <option value="minuti">minuti</option>
        </select>
        {canManage && changed && (
          <button onClick={save} disabled={saving} className="rounded-full bg-[var(--accent-blue)] px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Salva'}
          </button>
        )}
      </div>
      <p className="mt-1.5 max-w-[16rem] text-[11px] text-[var(--text-secondary)]">
        La risposta parte dopo questo tempo, con qualche secondo di variazione, come una persona vera. Vale per i canali in Automatica. 0 = subito, massimo 30 minuti.
      </p>
      {!canManage && <p className="mt-1 max-w-[16rem] text-[11px] text-[var(--text-secondary)]">Lo cambiano il titolare o un amministratore.</p>}
      {error && <p className="mt-1 text-[11px] text-[#ff6b6b]">{error}</p>}
    </div>
  )
}
