'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Instagram,
  Facebook,
  Linkedin,
  Twitter,
  MessageCircle,
  Music2,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Calendar,
  BookOpen,
  Link2,
  Mail,
  RefreshCw,
} from 'lucide-react'
import Navigation from '@/components/Navigation'
import { createClient } from '@/lib/supabase-client'
import { getAccessToken } from '@/lib/session-token'

// ---------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------

type KnowledgeItem = {
  id: string
  title: string
  content: string
  category: string | null
  is_active: boolean
  created_at: string
}

type ChannelStatus = 'not_connected' | 'in_progress' | 'connected' | 'error'

type Channel = {
  id: string
  platform: string
  display_name: string | null
  handle: string | null
  status: ChannelStatus
  notes: string | null
  reply_mode?: 'auto' | 'approval'
}

type PostStatus = 'draft' | 'scheduled' | 'published' | 'failed' | 'canceled'

type ScheduledPost = {
  id: string
  platforms: string[]
  caption: string
  media_urls: string[]
  scheduled_at: string | null
  status: PostStatus
  created_at: string
}

type Tab = 'memory' | 'channels' | 'posts'

// ---------------------------------------------------------------------
// Dati statici sui canali: cosa serve davvero per ognuno, non promesse
// ---------------------------------------------------------------------

const PLATFORM_META: Record<
  string,
  { label: string; icon: typeof Instagram; requirement: string }
> = {
  whatsapp: {
    label: 'WhatsApp',
    icon: MessageCircle,
    requirement:
      'Integrato (app Meta FVoiceAI). Finché l’app non è pubblicata risponde solo ai numeri di test; per i clienti veri servono numero dedicato e verifica aziendale.',
  },
  instagram: {
    label: 'Instagram',
    icon: Instagram,
    requirement:
      'Integrato: Direct e commenti di @facevoice.ai. Finché l’app Meta non è pubblicata risponde solo agli account con un ruolo sull’app.',
  },
  facebook: {
    label: 'Facebook',
    icon: Facebook,
    requirement:
      'Integrato: Messenger e commenti della Pagina Facevoiceai. Finché l’app Meta non è pubblicata risponde solo agli account con un ruolo sull’app.',
  },
  tiktok: {
    label: 'TikTok',
    icon: Music2,
    requirement:
      'La pubblicazione è possibile (Content Posting API). La lettura/risposta automatica ai messaggi privati non è disponibile per account business normali.',
  },
  linkedin: {
    label: 'LinkedIn',
    icon: Linkedin,
    requirement:
      'Automatizzare un profilo personale viola i termini LinkedIn. Pubblicare su una Pagina Aziendale richiede l’approvazione al Partner Program, selettiva.',
  },
  x: {
    label: 'X (Twitter)',
    icon: Twitter,
    requirement: 'API a pagamento, da ~200$/mese per la sola scrittura; leggere i DM richiede un livello superiore.',
  },
}

// Canali solo di messaggistica: non compaiono tra le piattaforme dei post.
const CHANNEL_ONLY_META: typeof PLATFORM_META = {
  email: {
    label: 'Email',
    icon: Mail,
    requirement: 'Casella Google Workspace collegata: le nuove email arrivano in Messaggi con la risposta AI.',
  },
}

const REPLY_PLATFORMS = ['whatsapp', 'facebook', 'instagram', 'email']

const STATUS_LABEL: Record<ChannelStatus, string> = {
  not_connected: 'Non connesso',
  in_progress: 'In corso',
  connected: 'Connesso',
  error: 'Errore',
}

const STATUS_COLOR: Record<ChannelStatus, string> = {
  not_connected: 'var(--text-secondary)',
  in_progress: '#FF9500',
  connected: '#34C759',
  error: '#FF3B30',
}

const POST_STATUS_LABEL: Record<PostStatus, string> = {
  draft: 'Bozza',
  scheduled: 'Programmato',
  published: 'Pubblicato',
  failed: 'Fallito',
  canceled: 'Annullato',
}

export default function AdminControlPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('memory')
  const supabase = createClient()

  // Ritorno dal collegamento Gmail: /admin/control?tab=channels
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('tab')
    if (requested === 'channels' || requested === 'posts' || requested === 'memory') setTab(requested)
  }, [])

  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [posts, setPosts] = useState<ScheduledPost[]>([])

  const authFetch = useCallback(async (url: string, init: RequestInit = {}) => {
    const token = await getAccessToken()
    if (!token) throw new Error('Sessione scaduta')
    return fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.headers || {}),
      },
    })
  }, [])

  const loadAll = useCallback(async () => {
    try {
      const [kRes, cRes, pRes] = await Promise.all([
        authFetch('/api/admin/ai-knowledge'),
        authFetch('/api/admin/channels'),
        authFetch('/api/admin/posts'),
      ])

      if (!kRes.ok || !cRes.ok || !pRes.ok) {
        setError('Accesso non consentito.')
        return
      }

      const [kData, cData, pData] = await Promise.all([kRes.json(), cRes.json(), pRes.json()])
      setKnowledge(kData.items || [])
      setChannels(cData.channels || [])
      setPosts(pData.posts || [])
      setError(null)
    } catch {
      setError('Impossibile caricare i dati.')
    } finally {
      setLoading(false)
    }
  }, [authFetch])

  useEffect(() => {
    const check = async () => {
      const { data } = await supabase.auth.getUser()
      if (!data.user) {
        router.push('/auth')
        return
      }
      loadAll()
    }
    check()
  }, [router, supabase, loadAll])

  if (loading) {
    return (
      <main className="min-h-screen bg-[var(--background)] flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-[var(--accent-blue)]/30 border-t-[var(--accent-blue)] rounded-full animate-spin" />
      </main>
    )
  }

  if (error) {
    return (
      <main className="min-h-screen bg-[var(--background)] flex flex-col">
        <Navigation />
        <div className="flex-1 flex items-center justify-center p-6">
          <p className="text-[var(--text-secondary)] text-center max-w-md">{error}</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[var(--background)]">
      <Navigation />

      <div className="max-w-4xl mx-auto px-4 pt-24 pb-16">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
            Centro di controllo AI
          </h1>
          <p className="text-[var(--text-secondary)] mt-1">
            Memoria dell&apos;assistente, canali social e calendario dei contenuti.
          </p>
        </header>

        <div className="flex gap-2 mb-6 border-b border-[var(--border-color)]">
          {([
            { id: 'memory', label: 'Memoria AI', icon: BookOpen },
            { id: 'channels', label: 'Canali', icon: Link2 },
            { id: 'posts', label: 'Post programmati', icon: Calendar },
          ] as const).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-[var(--accent-blue)] text-[var(--accent-blue)]'
                  : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'memory' && (
          <MemoryTab items={knowledge} authFetch={authFetch} onChange={setKnowledge} />
        )}
        {tab === 'channels' && (
          <ChannelsTab channels={channels} authFetch={authFetch} onChange={setChannels} />
        )}
        {tab === 'posts' && (
          <PostsTab posts={posts} channels={channels} authFetch={authFetch} onChange={setPosts} />
        )}
      </div>
    </main>
  )
}

// =======================================================================
// Tab: Memoria AI
// =======================================================================

function MemoryTab({
  items,
  authFetch,
  onChange,
}: {
  items: KnowledgeItem[]
  authFetch: (url: string, init?: RequestInit) => Promise<Response>
  onChange: (items: KnowledgeItem[]) => void
}) {
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [category, setCategory] = useState('')
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)

  const categories = Array.from(new Set(items.map((i) => i.category).filter(Boolean))) as string[]

  const filtered = items.filter((item) => {
    const q = search.toLowerCase()
    return (
      !q ||
      item.title.toLowerCase().includes(q) ||
      item.content.toLowerCase().includes(q) ||
      item.category?.toLowerCase().includes(q)
    )
  })

  const resetForm = () => {
    setShowForm(false)
    setEditingId(null)
    setTitle('')
    setContent('')
    setCategory('')
  }

  const startEdit = (item: KnowledgeItem) => {
    setEditingId(item.id)
    setTitle(item.title)
    setContent(item.content)
    setCategory(item.category || '')
    setShowForm(true)
  }

  const save = async () => {
    if (!title.trim() || !content.trim()) return
    setSaving(true)
    try {
      if (editingId) {
        const res = await authFetch(`/api/admin/ai-knowledge/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify({ title, content, category }),
        })
        const data = await res.json()
        if (res.ok) {
          onChange(items.map((i) => (i.id === editingId ? data.item : i)))
        }
      } else {
        const res = await authFetch('/api/admin/ai-knowledge', {
          method: 'POST',
          body: JSON.stringify({ title, content, category }),
        })
        const data = await res.json()
        if (res.ok) {
          onChange([data.item, ...items])
        }
      }
      resetForm()
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (item: KnowledgeItem) => {
    const res = await authFetch(`/api/admin/ai-knowledge/${item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_active: !item.is_active }),
    })
    const data = await res.json()
    if (res.ok) {
      onChange(items.map((i) => (i.id === item.id ? data.item : i)))
    }
  }

  const remove = async (id: string) => {
    if (!confirm('Eliminare questa voce di memoria?')) return
    const res = await authFetch(`/api/admin/ai-knowledge/${id}`, { method: 'DELETE' })
    if (res.ok) {
      onChange(items.filter((i) => i.id !== id))
    }
  }

  return (
    <div>
      <p className="text-sm text-[var(--text-secondary)] mb-4">
        Queste informazioni vengono lette dal widget pubblico del sito a ogni
        conversazione. Scrivi qui ciò che l&apos;assistente deve sapere su
        prezzi, servizi, tono di voce, politiche — solo voci attive
        (&ldquo;Attiva&rdquo;) vengono usate.
      </p>

      <div className="flex flex-wrap gap-2 mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cerca per titolo, contenuto o categoria..."
          className="flex-1 min-w-[200px] px-3 py-2 bg-[var(--background-secondary)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
        />
        <button
          onClick={() => {
            resetForm()
            setShowForm(true)
          }}
          className="flex items-center gap-1.5 px-4 py-2 bg-[var(--accent-blue)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <Plus className="w-4 h-4" /> Nuova voce
        </button>
      </div>

      {categories.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setSearch(c)}
              className="px-2.5 py-1 text-xs rounded-full border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--accent-blue)] hover:border-[var(--accent-blue)] transition-colors"
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {showForm && (
        <div className="mb-4 p-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-background)] space-y-3">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Titolo (es. Orari di apertura)"
            className="w-full px-3 py-2 bg-[var(--background-secondary)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
          />
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Categoria (facoltativa, es. Prezzi, FAQ, Tono di voce)"
            className="w-full px-3 py-2 bg-[var(--background-secondary)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={5}
            placeholder="Contenuto: scrivi l'informazione come la spiegheresti a un nuovo collaboratore."
            className="w-full px-3 py-2 bg-[var(--background-secondary)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)] resize-y"
          />
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={saving || !title.trim() || !content.trim()}
              className="px-4 py-2 bg-[var(--accent-blue)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? 'Salvo...' : editingId ? 'Salva modifiche' : 'Crea'}
            </button>
            <button
              onClick={resetForm}
              className="px-4 py-2 border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] hover:bg-[var(--background-secondary)] transition-colors"
            >
              Annulla
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((item) => (
          <div
            key={item.id}
            className="p-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-background)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-[var(--text-primary)]">{item.title}</p>
                  {item.category && (
                    <span className="px-2 py-0.5 text-xs rounded-full border border-[var(--border-color)] text-[var(--text-secondary)]">
                      {item.category}
                    </span>
                  )}
                  <span
                    className={`px-2 py-0.5 text-xs rounded-full ${
                      item.is_active
                        ? 'bg-green-500/10 text-green-500'
                        : 'bg-[var(--background-secondary)] text-[var(--text-secondary)]'
                    }`}
                  >
                    {item.is_active ? 'Attiva' : 'Disattiva'}
                  </span>
                </div>
                <p className="text-sm text-[var(--text-secondary)] mt-1 whitespace-pre-wrap">
                  {item.content}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => toggleActive(item)}
                  title={item.is_active ? 'Disattiva' : 'Attiva'}
                  className="p-1.5 hover:bg-[var(--background-secondary)] rounded-lg transition-colors"
                >
                  {item.is_active ? (
                    <Check className="w-4 h-4 text-green-500" />
                  ) : (
                    <X className="w-4 h-4 text-[var(--text-secondary)]" />
                  )}
                </button>
                <button
                  onClick={() => startEdit(item)}
                  className="p-1.5 hover:bg-[var(--background-secondary)] rounded-lg transition-colors"
                >
                  <Pencil className="w-4 h-4 text-[var(--text-secondary)]" />
                </button>
                <button
                  onClick={() => remove(item.id)}
                  className="p-1.5 hover:bg-[var(--background-secondary)] rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4 text-[var(--text-secondary)]" />
                </button>
              </div>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <p className="text-center text-[var(--text-secondary)] py-10">
            {items.length === 0
              ? 'Nessuna voce ancora. Aggiungine una per dare contesto all’assistente.'
              : 'Nessun risultato per questa ricerca.'}
          </p>
        )}
      </div>
    </div>
  )
}

// =======================================================================
// Tab: Canali
// =======================================================================

type EmailStatus = {
  configured: boolean
  cron: boolean
  connected: boolean
  email: string | null
}

const EMAIL_RESULT: Record<string, string> = {
  connected: 'Casella collegata. Le nuove email arriveranno in Messaggi entro un paio di minuti.',
  denied: 'Collegamento annullato su Google.',
  invalid: 'Link di collegamento scaduto: riprova.',
  error: 'Google non ha completato il collegamento: riprova.',
}

function EmailConnect({ authFetch }: { authFetch: (url: string, init?: RequestInit) => Promise<Response> }) {
  const [status, setStatus] = useState<EmailStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await authFetch('/api/admin/email')
    if (res.ok) setStatus(await res.json())
  }, [authFetch])

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('email')
    if (result && EMAIL_RESULT[result]) setMessage(EMAIL_RESULT[result])
    load().catch(() => undefined)
  }, [load])

  const run = async (init: RequestInit) => {
    setBusy(true)
    setMessage(null)
    try {
      const res = await authFetch('/api/admin/email', init)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Operazione non riuscita')
      return data
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Errore')
      return null
    } finally {
      setBusy(false)
    }
  }

  const connect = async () => {
    const data = await run({ method: 'POST', body: JSON.stringify({ action: 'connect' }) })
    if (data?.url) window.location.href = data.url
  }

  const sync = async () => {
    const data = await run({ method: 'POST', body: JSON.stringify({ action: 'sync' }) })
    if (data) {
      setMessage(
        data.error
          ? `Errore: ${data.error}`
          : `Controllo fatto: ${data.processed} nuove email in Messaggi${data.skipped ? `, ${data.skipped} ignorate (newsletter, notifiche, posta interna)` : ''}.`
      )
    }
  }

  const disconnect = async () => {
    if (!window.confirm('Scollegare la casella? L’agente smetterà di leggere e rispondere alle email.')) return
    if (await run({ method: 'DELETE' })) window.location.reload()
  }

  if (!status) return null

  return (
    <div className="mb-6 p-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-background)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-[#EA4335]/10 flex items-center justify-center shrink-0">
            <Mail className="w-4.5 h-4.5 text-[#EA4335]" />
          </div>
          <div className="min-w-0">
            <p className="font-medium text-[var(--text-primary)]">Email (Google Workspace)</p>
            <p className="text-sm text-[var(--text-secondary)] break-words">
              {status.connected
                ? `Collegata: ${status.email}. Le email dei clienti arrivano in Messaggi; newsletter, notifiche e posta interna @facevoice.ai vengono ignorate.`
                : status.configured
                  ? 'Collega la casella per ricevere le email in Messaggi con la risposta AI pronta.'
                  : 'Mancano GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET nelle variabili di Vercel.'}
            </p>
            {status.connected && !status.cron && (
              <p className="text-xs text-[#FF9500] mt-1">
                Controllo automatico spento: manca CRON_SECRET su Vercel. Intanto usa «Controlla ora».
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {status.connected ? (
            <>
              <button
                onClick={sync}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-[var(--border-color)] text-[var(--text-primary)] disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} /> Controlla ora
              </button>
              <button
                onClick={disconnect}
                disabled={busy}
                className="px-3 py-1.5 rounded-lg text-sm text-[#FF3B30] border border-[var(--border-color)] disabled:opacity-50"
              >
                Scollega
              </button>
            </>
          ) : (
            <button
              onClick={connect}
              disabled={busy || !status.configured}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--accent-blue)] text-white disabled:opacity-50"
            >
              Collega casella Gmail
            </button>
          )}
        </div>
      </div>
      {message && <p className="text-sm text-[var(--text-secondary)] mt-3">{message}</p>}
    </div>
  )
}

function ChannelsTab({
  channels,
  authFetch,
  onChange,
}: {
  channels: Channel[]
  authFetch: (url: string, init?: RequestInit) => Promise<Response>
  onChange: (channels: Channel[]) => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Partial<Channel>>({})

  const startEdit = (channel: Channel) => {
    setEditingId(channel.id)
    setDraft({ ...channel })
  }

  const save = async (id: string) => {
    const res = await authFetch(`/api/admin/channels/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        display_name: draft.display_name,
        handle: draft.handle,
        status: draft.status,
        notes: draft.notes,
        reply_mode: draft.reply_mode,
      }),
    })
    const data = await res.json()
    if (res.ok) {
      onChange(channels.map((c) => (c.id === id ? data.channel : c)))
      setEditingId(null)
    }
  }

  return (
    <div>
      <EmailConnect authFetch={authFetch} />

      <p className="text-sm text-[var(--text-secondary)] mb-5">
        Lo stato <strong className="text-[var(--text-primary)]">Connesso</strong> è
        l&apos;interruttore dell&apos;agente AI su WhatsApp, Facebook (Messenger e
        commenti) e Instagram (Direct e commenti): prepara le risposte con la Memoria
        AI e, a seconda della modalità, le invia da solo o le lascia da approvare in{' '}
        <a href="/admin/inbox" className="text-[var(--accent-blue)] hover:underline">Messaggi</a>.
        Con qualsiasi altro stato i messaggi vengono solo salvati. LinkedIn, TikTok e X
        non sono ancora integrati.
      </p>

      <div className="space-y-3">
        {channels.map((channel) => {
          const meta = PLATFORM_META[channel.platform] || CHANNEL_ONLY_META[channel.platform]
          const Icon = meta?.icon || Link2
          const isEditing = editingId === channel.id

          return (
            <div
              key={channel.id}
              className="p-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-background)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-[var(--background-secondary)] flex items-center justify-center shrink-0">
                    <Icon className="w-4.5 h-4.5 text-[var(--text-primary)]" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-[var(--text-primary)]">
                        {meta?.label || channel.platform}
                      </p>
                      <span
                        className="px-2 py-0.5 text-xs rounded-full"
                        style={{
                          backgroundColor: `${STATUS_COLOR[channel.status]}1A`,
                          color: STATUS_COLOR[channel.status],
                        }}
                      >
                        {STATUS_LABEL[channel.status]}
                      </span>
                      {channel.status === 'connected' && REPLY_PLATFORMS.includes(channel.platform) && (
                        <span className="px-2 py-0.5 text-xs rounded-full bg-[var(--background-secondary)] text-[var(--text-secondary)]">
                          {channel.reply_mode === 'auto' ? 'Risposte AI automatiche' : 'Risposte AI da approvare'}
                        </span>
                      )}
                    </div>
                    {!isEditing && (channel.display_name || channel.handle) && (
                      <p className="text-sm text-[var(--text-secondary)] mt-0.5">
                        {channel.display_name}
                        {channel.handle ? ` · ${channel.handle}` : ''}
                      </p>
                    )}
                    <p className="text-xs text-[var(--text-secondary)] mt-1.5 leading-relaxed">
                      {meta?.requirement}
                    </p>
                    {!isEditing && channel.notes && (
                      <p className="text-sm text-[var(--text-primary)] mt-2 p-2 rounded-lg bg-[var(--background-secondary)]">
                        {channel.notes}
                      </p>
                    )}
                  </div>
                </div>
                {!isEditing && (
                  <button
                    onClick={() => startEdit(channel)}
                    className="p-1.5 hover:bg-[var(--background-secondary)] rounded-lg transition-colors shrink-0"
                  >
                    <Pencil className="w-4 h-4 text-[var(--text-secondary)]" />
                  </button>
                )}
              </div>

              {isEditing && (
                <div className="mt-3 space-y-2 pl-12">
                  <select
                    value={draft.status}
                    onChange={(e) => setDraft({ ...draft, status: e.target.value as ChannelStatus })}
                    className="w-full px-3 py-2 bg-[var(--background-secondary)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
                  >
                    {Object.entries(STATUS_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  {REPLY_PLATFORMS.includes(channel.platform) && (
                    <select
                      value={draft.reply_mode || 'approval'}
                      onChange={(e) => setDraft({ ...draft, reply_mode: e.target.value as 'auto' | 'approval' })}
                      className="w-full px-3 py-2 bg-[var(--background-secondary)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
                    >
                      <option value="approval">Risposte AI da approvare (le trovi nella casella Messaggi)</option>
                      <option value="auto">Risposte AI inviate in automatico</option>
                    </select>
                  )}
                  <input
                    type="text"
                    value={draft.display_name || ''}
                    onChange={(e) => setDraft({ ...draft, display_name: e.target.value })}
                    placeholder="Nome pagina/account (facoltativo)"
                    className="w-full px-3 py-2 bg-[var(--background-secondary)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
                  />
                  <input
                    type="text"
                    value={draft.handle || ''}
                    onChange={(e) => setDraft({ ...draft, handle: e.target.value })}
                    placeholder="@handle (facoltativo)"
                    className="w-full px-3 py-2 bg-[var(--background-secondary)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
                  />
                  <textarea
                    value={draft.notes || ''}
                    onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                    rows={2}
                    placeholder="Promemoria: a che punto è la richiesta, cosa manca..."
                    className="w-full px-3 py-2 bg-[var(--background-secondary)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)] resize-y"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => save(channel.id)}
                      className="px-4 py-2 bg-[var(--accent-blue)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
                    >
                      Salva
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-4 py-2 border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] hover:bg-[var(--background-secondary)] transition-colors"
                    >
                      Annulla
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// =======================================================================
// Tab: Post programmati
// =======================================================================

function PostsTab({
  posts,
  channels,
  authFetch,
  onChange,
}: {
  posts: ScheduledPost[]
  channels: Channel[]
  authFetch: (url: string, init?: RequestInit) => Promise<Response>
  onChange: (posts: ScheduledPost[]) => void
}) {
  const [showForm, setShowForm] = useState(false)
  const [caption, setCaption] = useState('')
  const [mediaUrl, setMediaUrl] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const togglePlatform = (platform: string) => {
    setSelectedPlatforms((prev) =>
      prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform]
    )
  }

  const create = async () => {
    if (!caption.trim() && !mediaUrl.trim()) return
    if (selectedPlatforms.length === 0) return

    setSaving(true)
    try {
      const res = await authFetch('/api/admin/posts', {
        method: 'POST',
        body: JSON.stringify({
          caption,
          platforms: selectedPlatforms,
          media_urls: mediaUrl.trim() ? [mediaUrl.trim()] : [],
          scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        onChange([data.post, ...posts])
        setShowForm(false)
        setCaption('')
        setMediaUrl('')
        setScheduledAt('')
        setSelectedPlatforms([])
      }
    } finally {
      setSaving(false)
    }
  }

  const cancelPost = async (post: ScheduledPost) => {
    const res = await authFetch(`/api/admin/posts/${post.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'canceled' }),
    })
    const data = await res.json()
    if (res.ok) {
      onChange(posts.map((p) => (p.id === post.id ? data.post : p)))
    }
  }

  const remove = async (id: string) => {
    if (!confirm('Eliminare questo post?')) return
    const res = await authFetch(`/api/admin/posts/${id}`, { method: 'DELETE' })
    if (res.ok) {
      onChange(posts.filter((p) => p.id !== id))
    }
  }

  const connectedPlatforms = channels.filter((c) => c.status === 'connected').map((c) => c.platform)

  return (
    <div>
      <p className="text-sm text-[var(--text-secondary)] mb-4">
        {connectedPlatforms.length === 0 ? (
          <>
            Nessun canale è ancora connesso: i post restano in bozza o
            programmati, pronti da pubblicare non appena un canale sarà
            collegato. Non partono da soli.
          </>
        ) : (
          <>
            Canali connessi: {connectedPlatforms.map((p) => PLATFORM_META[p]?.label).join(', ')}.
          </>
        )}
      </p>

      <button
        onClick={() => setShowForm(!showForm)}
        className="flex items-center gap-1.5 px-4 py-2 bg-[var(--accent-blue)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity mb-4"
      >
        <Plus className="w-4 h-4" /> Nuovo post
      </button>

      {showForm && (
        <div className="mb-4 p-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-background)] space-y-3">
          <div className="flex flex-wrap gap-2">
            {Object.entries(PLATFORM_META).map(([key, meta]) => (
              <button
                key={key}
                onClick={() => togglePlatform(key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                  selectedPlatforms.includes(key)
                    ? 'bg-[var(--accent-blue)] text-white border-[var(--accent-blue)]'
                    : 'border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--background-secondary)]'
                }`}
              >
                <meta.icon className="w-3.5 h-3.5" />
                {meta.label}
              </button>
            ))}
          </div>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={4}
            placeholder="Testo del post..."
            className="w-full px-3 py-2 bg-[var(--background-secondary)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)] resize-y"
          />
          <input
            type="text"
            value={mediaUrl}
            onChange={(e) => setMediaUrl(e.target.value)}
            placeholder="URL immagine o video (facoltativo)"
            className="w-full px-3 py-2 bg-[var(--background-secondary)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
          />
          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-1">
              Data e ora di pubblicazione (vuoto = resta in bozza)
            </label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--background-secondary)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={create}
              disabled={saving || selectedPlatforms.length === 0 || (!caption.trim() && !mediaUrl.trim())}
              className="px-4 py-2 bg-[var(--accent-blue)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? 'Salvo...' : 'Crea'}
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] hover:bg-[var(--background-secondary)] transition-colors"
            >
              Annulla
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {posts.map((post) => (
          <div
            key={post.id}
            className="p-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-background)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  {post.platforms.map((p) => {
                    const meta = PLATFORM_META[p]
                    const Icon = meta?.icon || Link2
                    return (
                      <span
                        key={p}
                        className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border border-[var(--border-color)] text-[var(--text-secondary)]"
                      >
                        <Icon className="w-3 h-3" />
                        {meta?.label || p}
                      </span>
                    )
                  })}
                  <span
                    className={`px-2 py-0.5 text-xs rounded-full ${
                      post.status === 'published'
                        ? 'bg-green-500/10 text-green-500'
                        : post.status === 'failed'
                          ? 'bg-red-500/10 text-red-500'
                          : post.status === 'canceled'
                            ? 'bg-[var(--background-secondary)] text-[var(--text-secondary)]'
                            : 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]'
                    }`}
                  >
                    {POST_STATUS_LABEL[post.status]}
                  </span>
                </div>
                <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap">{post.caption}</p>
                {post.scheduled_at && (
                  <p className="text-xs text-[var(--text-secondary)] mt-1.5">
                    {new Date(post.scheduled_at).toLocaleString('it-IT', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {!['published', 'canceled'].includes(post.status) && (
                  <button
                    onClick={() => cancelPost(post)}
                    title="Annulla"
                    className="p-1.5 hover:bg-[var(--background-secondary)] rounded-lg transition-colors"
                  >
                    <X className="w-4 h-4 text-[var(--text-secondary)]" />
                  </button>
                )}
                <button
                  onClick={() => remove(post.id)}
                  className="p-1.5 hover:bg-[var(--background-secondary)] rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4 text-[var(--text-secondary)]" />
                </button>
              </div>
            </div>
          </div>
        ))}

        {posts.length === 0 && (
          <p className="text-center text-[var(--text-secondary)] py-10">
            Nessun post ancora. Prepara i contenuti qui: partiranno appena un
            canale sarà collegato.
          </p>
        )}
      </div>
    </div>
  )
}
