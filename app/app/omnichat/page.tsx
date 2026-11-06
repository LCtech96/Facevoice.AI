'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, ChevronDown, Clock, Facebook, Globe, Instagram, Loader2, Mail, Megaphone, MessageCircle, Mic, PencilLine, RefreshCw, Send, Sparkles, X } from 'lucide-react'
import { useWorkspace } from '@/components/app/WorkspaceContext'
import { useDictation } from '@/components/useDictation'
import { useTranslation } from '@/lib/i18n/LanguageContext'

// Omnichat: tutte le conversazioni dei canali collegati, la risposta a mano o
// con le bozze dell'AI, e l'automazione di ogni canale. "Correggi" sotto ogni
// risposta dell'AI: come avrebbe dovuto rispondere, solo in questa chat o sempre.
// "Campagna": informazioni di una campagna marketing che, accese, prendono il posto
// delle Istruzioni nei canali scelti (lib/saas/campaign.ts).

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
  /** Scritta dall'AI con la Campagna: nome della campagna ('' senza nome), altrimenti null. */
  campaign?: string | null
}
type CampaignScope = 'email' | 'instagram_dm' | 'instagram_comments' | 'facebook_messenger' | 'facebook_comments'
type CampaignScopes = Record<CampaignScope, boolean>
type Campaign = { active: boolean; name: string; text: string; scopes: CampaignScopes; activeSince: string | null; updatedAt: string | null; updatedBy: string | null }
type CampaignForm = { name: string; text: string; scopes: CampaignScopes }
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

const CAMPAIGN_MAX = 6000
/** Superfici della campagna per ogni canale, nell'ordine delle caselle. */
const CAMPAIGN_GROUPS: { platform: 'email' | 'instagram' | 'facebook'; options: { id: CampaignScope; label: string }[] }[] = [
  { platform: 'email', options: [{ id: 'email', label: 'Risposte email' }] },
  {
    platform: 'instagram',
    options: [
      { id: 'instagram_dm', label: 'DM' },
      { id: 'instagram_comments', label: 'Commenti' },
    ],
  },
  {
    platform: 'facebook',
    options: [
      { id: 'facebook_messenger', label: 'Messenger' },
      { id: 'facebook_comments', label: 'Commenti' },
    ],
  },
]
const CAMPAIGN_SCOPES = CAMPAIGN_GROUPS.flatMap((g) => g.options)
const SCOPE_LABELS: Record<CampaignScope, string> = {
  email: 'Email',
  instagram_dm: 'Instagram DM',
  instagram_comments: 'commenti Instagram',
  facebook_messenger: 'Messenger',
  facebook_comments: 'commenti Facebook',
}
/** Superfici accese della campagna attiva per un canale (vuoto = la campagna non vale li'). */
const campaignOn = (c: Campaign | null, platform: string) =>
  c?.active ? (CAMPAIGN_GROUPS.find((g) => g.platform === platform)?.options || []).filter((o) => c.scopes[o.id]) : []
const formOf = (c: Campaign): CampaignForm => ({ name: c.name, text: c.text, scopes: { ...c.scopes } })
const sameForm = (a: CampaignForm, b: CampaignForm) =>
  a.name.trim() === b.name.trim() && a.text === b.text && CAMPAIGN_SCOPES.every((o) => a.scopes[o.id] === b.scopes[o.id])

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
  const [campaign, setCampaign] = useState<Campaign | null>(null)
  /** Spazio a cui appartiene la campagna letta (cambiando spazio la scheda riparte da zero). */
  const [campaignWs, setCampaignWs] = useState<string | null>(null)
  const [campaignChannels, setCampaignChannels] = useState<string[]>([])
  const [campaignOpen, setCampaignOpen] = useState(false)
  const canManage = workspace?.role !== 'member'

  const workspaceId = workspace?.id ?? null
  const loadCampaign = useCallback(async () => {
    const res = await appFetch('/api/app/campaign').catch(() => null)
    if (!res?.ok) return
    const data = await res.json().catch(() => null)
    if (!data?.campaign) return
    setCampaign(data.campaign)
    setCampaignWs(workspaceId)
    setCampaignChannels(data.connected || [])
  }, [appFetch, workspaceId])
  const currentCampaign = campaign && campaignWs === workspaceId ? campaign : null

  /** Dalle schede dei canali (e da Istruzioni, #campagna): apre la scheda Campagna e ci porta lì. */
  const showCampaign = useCallback(() => {
    setCampaignOpen(true)
    setTimeout(() => document.getElementById('campagna')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  }, [])

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

  // Link "Campagna" dalla pagina Istruzioni: si apre la scheda quando e' pronta.
  useEffect(() => {
    if (currentCampaign && window.location.hash === '#campagna') showCampaign()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(currentCampaign)])

  useEffect(() => {
    loadCampaign()
  }, [loadCampaign])

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
                  {campaignOn(currentCampaign, c.platform).length > 0 && (
                    <button
                      onClick={showCampaign}
                      title={`Qui l’AI usa la campagna per: ${campaignOn(currentCampaign, c.platform).map((o) => SCOPE_LABELS[o.id]).join(', ')}`}
                      className="mt-2 flex max-w-[16rem] items-center gap-1.5 rounded-full bg-[#AF52DE]/15 px-2.5 py-1 text-left text-[11px] font-medium text-[#BF5AF2]"
                    >
                      <Megaphone className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">
                        Campagna attiva{currentCampaign?.name ? ': ' : ''}
                        {currentCampaign?.name ? <span translate="no">{currentCampaign.name}</span> : null}
                      </span>
                    </button>
                  )}
                </div>
              )
            })}
            {currentCampaign && campaignWs && campaignChannels.length > 0 && (
              <CampaignCard
                key={campaignWs}
                workspaceId={campaignWs}
                campaign={currentCampaign}
                connected={campaignChannels}
                canManage={canManage}
                open={campaignOpen}
                hidden={open !== null}
                onOpenChange={setCampaignOpen}
                onSaved={(c, connected) => {
                  setCampaign(c)
                  if (connected) setCampaignChannels(connected)
                }}
              />
            )}
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
                  {m.campaign != null && <CampaignChip name={m.campaign} />}
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
                {mine && m.campaign != null && <CampaignChip name={m.campaign} />}
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
        {scope === 'always' && message.campaign != null && (
          <p className="mt-1 text-[11px] text-[#BF5AF2]">È una risposta della campagna: la regola resta anche quando spegni la campagna.</p>
        )}

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

/** Risposta scritta dall'AI con la Campagna invece che con le Istruzioni. */
function CampaignChip({ name }: { name: string }) {
  return (
    <span
      title={name ? `Scritta con la campagna «${name}»` : 'Scritta con la campagna'}
      className="ml-1.5 inline-block rounded-full bg-[#AF52DE]/15 px-1.5 align-middle text-[10px] font-medium text-[#BF5AF2]"
    >
      Campagna
    </span>
  )
}

const CAMPAIGN_PLACEHOLDER = `Esempio:
Dal 10 al 30 novembre: menù degustazione a 35 € a persona, bevande escluse.
Solo su prenotazione, da giovedì a domenica. Link per prenotare: www.esempio.it/prenota
Obiettivo: far prenotare un tavolo.`

/** Modifiche non salvate della scheda Campagna, in questo browser (una per spazio). */
const campaignDraftKey = (workspaceId: string) => `fv_app_campaign_draft:${workspaceId}`
type CampaignDraft = CampaignForm & { base: string | null }

/** Bozza salvata nel browser → modifiche da rimettere nella scheda (rotta o assente: null). */
function readCampaignDraft(workspaceId: string, campaign: Campaign): { form: CampaignForm; base: string | null } | null {
  try {
    const raw = localStorage.getItem(campaignDraftKey(workspaceId))
    const draft = raw ? (JSON.parse(raw) as Partial<CampaignDraft> | null) : null
    if (!draft || typeof draft.name !== 'string' || typeof draft.text !== 'string') return null
    const scopes = draft.scopes && CAMPAIGN_SCOPES.every((o) => typeof draft.scopes?.[o.id] === 'boolean') ? { ...draft.scopes } : { ...campaign.scopes }
    return { form: { name: draft.name.slice(0, 80), text: draft.text.slice(0, CAMPAIGN_MAX), scopes }, base: typeof draft.base === 'string' ? draft.base : null }
  } catch {
    return null
  }
}

/**
 * Campagna (una per spazio): informazioni che, accese, l'AI usa al posto delle
 * Istruzioni nei canali scelti. L'interruttore salva subito: accendendo si salva
 * anche quello che e' scritto nella scheda (si accende quello che si vede);
 * spegnendo, il testo non salvato resta nella scheda. Nome, testo e canali: Salva.
 * Le modifiche non salvate restano nel browser (localStorage) finche' non si salvano
 * o si annullano: cambiando pagina o chiudendo l'app si ritrovano qui. Il microfono
 * si ferma quando la scheda si chiude o si nasconde (chat aperta sul telefono).
 */
function CampaignCard({
  workspaceId,
  campaign,
  connected,
  canManage,
  open,
  hidden,
  onOpenChange,
  onSaved,
}: {
  workspaceId: string
  campaign: Campaign
  /** Canali collegati tra email, instagram, facebook. */
  connected: string[]
  canManage: boolean
  open: boolean
  /** Una chat e' aperta: sul telefono la parte alta della pagina (con questa scheda) e' nascosta. */
  hidden: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (campaign: Campaign, connected?: string[]) => void
}) {
  const { appFetch } = useWorkspace()
  const { language } = useTranslation()
  const [form, setForm] = useState<CampaignForm>(() => formOf(campaign))
  const [busy, setBusy] = useState<'toggle' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const dirty = !sameForm(form, formOf(campaign))
  const groups = CAMPAIGN_GROUPS.filter((g) => connected.includes(g.platform))
  const chosen = groups.flatMap((g) => g.options).filter((o) => campaign.scopes[o.id])
  const dictation = useDictation(
    (said) => setForm((f) => ({ ...f, text: (f.text && !/\s$/.test(f.text) ? `${f.text} ${said}` : `${f.text}${said}`).slice(0, CAMPAIGN_MAX) })),
    language === 'it' ? 'it-IT' : 'en-US'
  )
  const stopDictation = dictation.stop

  // Il microfono resta acceso solo con la scheda in vista: chiusa, o nascosta dalla chat aperta sul telefono, si ferma.
  useEffect(() => {
    if (!open || (hidden && window.matchMedia('(max-width: 767px)').matches)) stopDictation()
  }, [open, hidden, stopDictation])

  // Modifiche non salvate di prima (altra pagina dell'app, app chiusa): tornano nella scheda, aperta.
  const [draftReady, setDraftReady] = useState(false)
  useEffect(() => {
    const draft = canManage ? readCampaignDraft(workspaceId, campaign) : null
    if (draft && !sameForm(draft.form, formOf(campaign))) {
      setForm(draft.form)
      onOpenChange(true)
      if (draft.base !== campaign.updatedAt) setError('Hai modifiche non salvate, ma intanto la campagna è cambiata: controllale prima di salvare.')
    }
    setDraftReady(true)
    // Solo all'apertura della scheda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!draftReady || !canManage) return
    try {
      if (dirty) localStorage.setItem(campaignDraftKey(workspaceId), JSON.stringify({ ...form, base: campaign.updatedAt } satisfies CampaignDraft))
      else localStorage.removeItem(campaignDraftKey(workspaceId))
    } catch {
      // Spazio del browser non disponibile (navigazione privata): resta solo l'avviso "modifiche non salvate".
    }
  }, [draftReady, canManage, dirty, form, campaign.updatedAt, workspaceId])

  // Testo scritto e non salvato: il browser chiede conferma prima di chiudere la pagina.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  /** sent: la scheda com'era quando si e' mandata la richiesta. */
  const put = async (body: Record<string, unknown>, sent: CampaignForm): Promise<{ campaign: Campaign; connected?: string[] } | null> => {
    const res = await appFetch('/api/app/campaign', { method: 'PUT', body: JSON.stringify(body) }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (res?.ok && data.campaign) return { campaign: data.campaign as Campaign, connected: data.connected as string[] | undefined }
    if (res?.status === 409 && data.campaign) {
      // Cambiata da un'altra persona: si aggiorna la versione salvata.
      const fresh = data.campaign as Campaign
      onSaved(fresh)
      if (!sameForm(sent, formOf(campaign))) {
        // C'erano modifiche fatte qui: restano, da controllare.
        setError('Un’altra persona ha appena cambiato la campagna. Quello che hai scritto è ancora qui: controllalo e salva di nuovo.')
      } else {
        // Niente scritto qui: la scheda mostra la versione nuova (mai quella vecchia come se fosse da salvare).
        setForm((f) => (sameForm(f, sent) ? formOf(fresh) : f))
        setError('La campagna è stata cambiata da un’altra persona: controlla e riattiva.')
      }
    } else setError(data.error || 'Connessione non riuscita, riprova.')
    return null
  }

  const flash = () => {
    setDone(true)
    setTimeout(() => setDone(false), 2500)
  }

  const toggle = async () => {
    if (!canManage || busy) return
    const turnOn = !campaign.active
    dictation.stop()
    setBusy('toggle')
    setError(null)
    const sent = form
    const result = await put(turnOn ? { active: true, ...sent, baseUpdatedAt: campaign.updatedAt } : { active: false }, sent)
    setBusy(null)
    if (!result) {
      // Non si accende (testo vuoto, nessun canale…): si apre la scheda per sistemarla.
      if (turnOn) onOpenChange(true)
      return
    }
    onSaved(result.campaign, result.connected)
    if (turnOn) setForm((f) => (sameForm(f, sent) ? formOf(result.campaign) : f))
    flash()
  }

  const save = async () => {
    if (!canManage || busy) return
    dictation.stop()
    setBusy('save')
    setError(null)
    const sent = form
    const result = await put({ ...sent, baseUpdatedAt: campaign.updatedAt }, sent)
    setBusy(null)
    if (!result) return
    onSaved(result.campaign, result.connected)
    // Scritto altro mentre si salvava: resta (e resta da salvare).
    setForm((f) => (sameForm(f, sent) ? formOf(result.campaign) : f))
    flash()
  }

  /** Torna alla versione salvata (anche una bozza ritrovata che non serve piu'). */
  const discard = () => {
    stopDictation()
    setForm(formOf(campaign))
    setError(null)
  }

  return (
    <div
      id="campagna"
      className={`scroll-mt-4 rounded-2xl border bg-[var(--background-secondary)] p-3 ${open ? 'w-full md:max-w-2xl' : ''} ${
        campaign.active ? 'border-[#AF52DE]/60' : 'border-[var(--border-color)]'
      }`}
    >
      <div className="flex items-center gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Megaphone className="h-4 w-4 text-[var(--accent-blue)]" /> Campagna
        </p>
        <span className="ml-auto text-xs text-[var(--text-secondary)]">Attiva</span>
        <button
          role="switch"
          aria-checked={campaign.active}
          aria-label="Attiva la campagna"
          disabled={!canManage || busy !== null}
          onClick={toggle}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${campaign.active ? 'bg-[#34C759]' : 'bg-[var(--border-color)]'}`}
        >
          <span
            className={`absolute left-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow transition-transform ${
              campaign.active ? 'translate-x-5' : ''
            }`}
          >
            {busy === 'toggle' && <Loader2 className="h-3 w-3 animate-spin text-[#8e8e93]" />}
          </span>
        </button>
      </div>
      <p className={`mt-1.5 text-[11px] text-[var(--text-secondary)] ${open ? '' : 'max-w-[18rem]'}`}>
        {campaign.active ? (
          <>
            <span className="font-medium text-[#BF5AF2]">Attiva</span>
            {campaign.name ? (
              <>
                : <span translate="no">{campaign.name}</span>
              </>
            ) : null}
            {chosen.length ? ` · ${chosen.map((o) => SCOPE_LABELS[o.id]).join(', ')}` : ''}
          </>
        ) : (
          'Spenta: l’AI usa le Istruzioni.'
        )}
        {dirty && <span className="text-[#FF9500]"> · modifiche non salvate</span>}
      </p>
      {error && <p className={`mt-1.5 text-[11px] text-[#ff6b6b] ${open ? '' : 'max-w-[18rem]'}`}>{error}</p>}
      <button
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-controls="campagna-scheda"
        className="mt-1.5 flex items-center gap-1 text-xs font-medium text-[var(--accent-blue)]"
      >
        {open ? 'Chiudi' : canManage ? 'Modifica' : 'Vedi'}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div id="campagna-scheda" className="mt-3 space-y-4 border-t border-[var(--border-color)] pt-3">
          <p className="text-xs text-[var(--text-secondary)]">
            Quando è attiva, l’AI risponde solo con queste informazioni nei canali scelti. Quando la spegni torna a usare le Istruzioni.
          </p>

          <div>
            <label htmlFor="campagna-nome" className="text-xs font-semibold">
              Nome <span className="font-normal text-[var(--text-secondary)]">(facoltativo)</span>
            </label>
            <input
              id="campagna-nome"
              translate="no"
              value={form.name}
              maxLength={80}
              readOnly={!canManage}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Es. Saldi di novembre"
              className="mt-1 w-full rounded-xl border border-[var(--border-color)] bg-[var(--background)] px-3 py-2 text-[16px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)] md:text-sm"
            />
          </div>

          <div>
            <label htmlFor="campagna-testo" className="text-xs font-semibold">
              Informazioni della campagna
            </label>
            <div className="relative mt-1">
              <textarea
                id="campagna-testo"
                translate="no"
                value={form.text}
                maxLength={CAMPAIGN_MAX}
                readOnly={!canManage}
                onChange={(e) => setForm((f) => ({ ...f, text: e.target.value }))}
                placeholder={CAMPAIGN_PLACEHOLDER}
                rows={8}
                className="block w-full rounded-xl border border-[var(--border-color)] bg-[var(--background)] p-3 pb-12 text-[16px] leading-relaxed text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)] md:text-sm"
              />
              {canManage && dictation.supported && (
                <button
                  type="button"
                  onClick={dictation.toggle}
                  aria-label={dictation.listening ? 'Ferma la dettatura' : 'Detta il testo'}
                  aria-pressed={dictation.listening}
                  title={dictation.listening ? 'Ferma la dettatura' : 'Detta il testo'}
                  className={`absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full border ${
                    dictation.listening
                      ? 'border-[#FF3B30] bg-[#FF3B30]/10 text-[#FF3B30]'
                      : 'border-[var(--border-color)] bg-[var(--background-secondary)] text-[var(--text-secondary)]'
                  }`}
                >
                  <Mic className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="mt-1 flex justify-between gap-3 text-[11px] text-[var(--text-secondary)]">
              <span className={dictation.error ? 'text-[#ff6b6b]' : ''}>
                {dictation.error || (dictation.listening ? 'Ti ascolto… tocca di nuovo il microfono per fermare.' : '')}
              </span>
              {form.text.length > CAMPAIGN_MAX - 600 && (
                <span className="shrink-0">
                  {form.text.length}/{CAMPAIGN_MAX}
                </span>
              )}
            </div>
          </div>

          <fieldset>
            <legend className="text-xs font-semibold">Usa la campagna per</legend>
            <div className="mt-1 space-y-1">
              {groups.map((g) => {
                const Icon = ICONS[g.platform] || Mail
                return (
                  <div key={g.platform} className="flex flex-wrap items-center gap-x-4">
                    <span className="flex w-24 items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                      <Icon className="h-3.5 w-3.5" /> {LABELS[g.platform]}
                    </span>
                    {g.options.map((o) => (
                      <label key={o.id} className={`flex items-center gap-2 py-1.5 text-sm ${canManage ? '' : 'opacity-70'}`}>
                        <input
                          type="checkbox"
                          checked={form.scopes[o.id]}
                          disabled={!canManage}
                          onChange={(e) => setForm((f) => ({ ...f, scopes: { ...f.scopes, [o.id]: e.target.checked } }))}
                          className="h-4 w-4 accent-[var(--accent-blue)]"
                        />
                        {o.label}
                      </label>
                    ))}
                  </div>
                )
              })}
            </div>
          </fieldset>

          {canManage ? (
            <div className="flex flex-wrap items-center justify-end gap-3">
              <span className="mr-auto text-[11px] text-[var(--text-secondary)]">L’interruttore vale subito; accendendo salva anche questa scheda.</span>
              {done && (
                <span className="flex items-center gap-1 text-sm text-[#34C759]">
                  <Check className="h-4 w-4" /> Salvato
                </span>
              )}
              {dirty && (
                <button onClick={discard} disabled={busy !== null} className="text-sm text-[var(--text-secondary)] disabled:opacity-40">
                  Annulla modifiche
                </button>
              )}
              <button
                onClick={save}
                disabled={!dirty || busy !== null}
                className="flex items-center gap-2 rounded-full bg-[var(--accent-blue)] px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                {busy === 'save' && <Loader2 className="h-4 w-4 animate-spin" />} Salva
              </button>
            </div>
          ) : (
            <p className="text-[11px] text-[var(--text-secondary)]">La cambiano il titolare o un amministratore.</p>
          )}
        </div>
      )}
    </div>
  )
}
