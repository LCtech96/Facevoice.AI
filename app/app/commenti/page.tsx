'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Facebook, Instagram, Loader2, Lock, RefreshCw, Send, Sparkles, X } from 'lucide-react'
import { useWorkspace } from '@/components/app/WorkspaceContext'
import { useTranslation } from '@/lib/i18n/LanguageContext'

// Commenti ricevuti sotto i post di Instagram e Facebook: risposta pubblica
// (a mano o con la bozza dell'AI), risposta in privato e modalità delle risposte
// per ogni canale, separata da quella dei messaggi.

type Mode = 'off' | 'approval' | 'auto'
type Channel = { platform: 'instagram' | 'facebook'; mode: Mode; handle: string; needsReconnect: boolean }
type Reply = { id: string; text: string; status: string | null; origin: string | null; note: string | null; at: string }
type Comment = {
  id: string
  platform: 'instagram' | 'facebook'
  author: string | null
  text: string
  post: string | null
  skipped: boolean
  unread: boolean
  at: string
  replies: Reply[]
}

const ICONS = { instagram: Instagram, facebook: Facebook }
const LABELS = { instagram: 'Instagram', facebook: 'Facebook' }
const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'off', label: 'Spenta', hint: 'L’AI non risponde ai commenti: rispondi tu da qui.' },
  { id: 'approval', label: 'Bozze', hint: 'L’AI prepara la risposta, tu la controlli e la pubblichi.' },
  { id: 'auto', label: 'Automatica', hint: 'L’AI risponde da sola sotto i commenti. Quelli dubbi restano in bozza.' },
]

const when = (iso: string, language = 'it') => {
  const d = new Date(iso)
  const locale = language === 'it' ? 'it-IT' : 'en-GB'
  const today = new Date().toDateString() === d.toDateString()
  return today ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
}

export default function CommentsPage() {
  const { appFetch, workspace } = useWorkspace()
  const { language } = useTranslation()
  const [channels, setChannels] = useState<Channel[] | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [filter, setFilter] = useState<'all' | 'todo' | 'instagram' | 'facebook'>('all')
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const canManage = workspace?.role !== 'member'

  const load = useCallback(async () => {
    setLoading(true)
    const res = await appFetch('/api/app/comments').catch(() => null)
    const data = res?.ok ? await res.json() : null
    setLoading(false)
    if (!data) return setChannels((prev) => prev ?? [])
    setChannels(data.channels || [])
    setComments(data.comments || [])
  }, [appFetch])

  useEffect(() => {
    load()
    const timer = setInterval(() => document.visibilityState === 'visible' && load(), 20_000)
    return () => clearInterval(timer)
  }, [load])

  const setMode = async (platform: Channel['platform'], mode: Mode) => {
    setChannels((list) => (list || []).map((c) => (c.platform === platform ? { ...c, mode } : c)))
    const res = await appFetch('/api/app/comments', { method: 'PATCH', body: JSON.stringify({ platform, mode }) }).catch(() => null)
    if (!res?.ok) {
      setNotice('Modalità non salvata, riprova.')
      load()
    }
  }

  const answered = (c: Comment) => c.replies.some((r) => r.status === 'sent')
  const visible = useMemo(
    () =>
      comments.filter((c) =>
        filter === 'all' ? true : filter === 'todo' ? !answered(c) && !c.skipped : c.platform === filter
      ),
    [comments, filter]
  )
  const todo = comments.filter((c) => !answered(c) && !c.skipped).length

  if (channels && !channels.length && !comments.length) {
    return (
      <div>
        <h1 className="text-3xl font-extrabold">Commenti</h1>
        <p className="mt-3 max-w-xl text-[var(--text-secondary)]">
          Qui arrivano i commenti sotto i tuoi post di Instagram e Facebook, con le risposte dell’AI. Collega prima il tuo account.
        </p>
        <Link href="/app/canali/meta?canale=instagram" className="mt-6 inline-block rounded-full bg-[var(--accent-blue)] px-5 py-2.5 font-semibold text-white">
          Collega Instagram
        </Link>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-3xl font-extrabold">Commenti</h1>
        <button onClick={load} disabled={loading} className="flex items-center gap-2 text-sm text-[var(--text-secondary)]" aria-label="Aggiorna i commenti">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> <span className="hidden sm:inline">Aggiorna</span>
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

      <div className="mt-4 flex flex-wrap gap-3">
        {(channels || []).map((c) => {
          const Icon = ICONS[c.platform]
          const hint = MODES.find((m) => m.id === c.mode)?.hint
          return (
            <div key={c.platform} className="w-full max-w-md rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-4">
              <p className="flex items-center gap-2 font-semibold">
                <Icon className="h-5 w-5 text-[var(--accent-blue)]" /> {LABELS[c.platform]}
                <span translate="no" className="truncate text-sm font-normal text-[var(--text-secondary)]">
                  {c.handle}
                </span>
              </p>
              <div className="mt-3 flex rounded-full bg-[var(--background)] p-1">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => canManage && setMode(c.platform, m.id)}
                    disabled={!canManage}
                    className={`flex-1 rounded-full px-3 py-1.5 text-sm ${c.mode === m.id ? 'bg-[var(--accent-blue)] text-white' : 'text-[var(--text-secondary)]'}`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-[var(--text-secondary)]">{hint}</p>
              {c.needsReconnect && (
                <p className="mt-3 rounded-xl border border-[#FF9500] p-2 text-xs">
                  Per ricevere i commenti ricollega l’account e consenti anche “Gestire i commenti”:{' '}
                  <Link href="/app/canali/meta?canale=instagram" className="font-semibold text-[var(--accent-blue)]">
                    ricollega Instagram
                  </Link>
                  .
                </p>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {(
          [
            ['all', 'Tutti'],
            ['todo', `Da rispondere${todo ? ` (${todo})` : ''}`],
            ...(channels || []).map((c) => [c.platform, LABELS[c.platform]]),
          ] as [typeof filter, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setFilter(id)}
            className={`rounded-full px-4 py-1.5 text-sm ${filter === id ? 'bg-[var(--text-primary)] text-[var(--background)]' : 'text-[var(--text-secondary)]'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {!visible.length ? (
        <p className="mt-8 text-[var(--text-secondary)]">
          {comments.length ? 'Nessun commento in questa vista.' : 'Nessun commento per ora. I nuovi commenti sotto i tuoi post arrivano qui in pochi secondi.'}
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {visible.map((c) => (
            <CommentCard key={c.id} comment={c} language={language} onChange={load} onNotice={setNotice} />
          ))}
        </div>
      )}
    </div>
  )
}

function CommentCard({ comment, language, onChange, onNotice }: { comment: Comment; language: string; onChange: () => void; onNotice: (text: string) => void }) {
  const { appFetch } = useWorkspace()
  const Icon = ICONS[comment.platform]
  const draft = comment.replies.find((r) => r.status === 'pending' || r.status === 'failed')
  const sent = comment.replies.filter((r) => r.status === 'sent' || r.status === 'sending')
  const [text, setText] = useState(draft?.text ?? '')
  const [privateOpen, setPrivateOpen] = useState(false)
  const [privateText, setPrivateText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setText(draft?.text ?? '')
  }, [draft?.id, draft?.text])

  const call = async (url: string, body: unknown, key: string) => {
    setBusy(key)
    setError(null)
    const res = await appFetch(url, { method: 'POST', body: JSON.stringify(body) }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setBusy(null)
    if (!res?.ok) {
      setError(data.error || 'Operazione non riuscita, riprova.')
      return false
    }
    if (data.notice) onNotice(data.notice)
    onChange()
    return true
  }

  const publish = async () => {
    if (!text.trim()) return
    if (await call('/api/app/comments/reply', { commentId: comment.id, draftId: draft?.id, body: text }, 'publish')) setText('')
  }

  const sendPrivate = async () => {
    if (!privateText.trim()) return
    if (await call('/api/app/comments/reply', { commentId: comment.id, body: privateText, private: true }, 'private')) {
      setPrivateText('')
      setPrivateOpen(false)
      onNotice('Messaggio privato inviato: lo trovi anche nell’Omnichat.')
    }
  }

  return (
    <article className={`rounded-2xl border bg-[var(--background-secondary)] p-4 ${comment.unread ? 'border-[var(--accent-blue)]' : 'border-[var(--border-color)]'}`}>
      <div className="flex items-center gap-2 text-sm">
        <Icon className="h-4 w-4 shrink-0 text-[var(--accent-blue)]" />
        <span translate="no" className="truncate font-semibold">
          {comment.author || 'Utente'}
        </span>
        <span className="ml-auto shrink-0 text-xs text-[var(--text-secondary)]">{when(comment.at, language)}</span>
      </div>
      {comment.post && (
        <p translate="no" className="mt-1 line-clamp-1 text-xs text-[var(--text-secondary)]">
          Sul post: «{comment.post}»
        </p>
      )}
      <p translate="no" className="mt-2 whitespace-pre-wrap">
        {comment.text}
      </p>

      {sent.map((r) => (
        <div key={r.id} className="ml-4 mt-3 rounded-xl bg-[var(--background)] p-3 text-sm">
          <p className="text-xs text-[var(--text-secondary)]">
            {r.status === 'sending' ? 'Pubblicazione…' : 'Risposta pubblicata'} · {when(r.at, language)}
            {r.origin?.startsWith('ai') ? ' · AI' : ''}
          </p>
          <p translate="no" className="mt-1 whitespace-pre-wrap">
            {r.text}
          </p>
        </div>
      ))}

      {comment.skipped && !sent.length && !draft && (
        <p className="mt-3 text-xs text-[var(--text-secondary)]">L’AI non risponde a questo commento (tag, spam o simili). Puoi rispondere tu qui sotto.</p>
      )}

      {!sent.length && (
        <div className="mt-3">
          {draft && (
            <p className={`mb-1 text-xs ${draft.status === 'failed' ? 'text-[#ff6b6b]' : 'text-[#FF9500]'}`}>
              {draft.status === 'failed' ? `Non pubblicata: ${draft.note || 'riprova'}` : draft.note || 'Bozza dell’AI: controllala e pubblicala'}
            </p>
          )}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            placeholder="Rispondi sotto il commento…"
            className="w-full resize-y rounded-xl border border-[var(--border-color)] bg-[var(--background)] p-3 text-sm"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              onClick={publish}
              disabled={busy !== null || !text.trim()}
              className="flex items-center gap-2 rounded-full bg-[var(--accent-blue)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy === 'publish' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Pubblica risposta
            </button>
            {draft ? (
              <button onClick={() => call('/api/app/comments/draft', { action: 'reject', id: draft.id }, 'reject')} disabled={busy !== null} className="px-3 py-2 text-sm text-[var(--text-secondary)]">
                Scarta
              </button>
            ) : (
              <button
                onClick={() => call('/api/app/comments/draft', { action: 'suggest', commentId: comment.id }, 'suggest')}
                disabled={busy !== null}
                className="flex items-center gap-1.5 rounded-full border border-[var(--border-color)] px-3 py-2 text-sm"
                title="Fai preparare la risposta all’AI"
              >
                {busy === 'suggest' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-[var(--accent-blue)]" />} Bozza AI
              </button>
            )}
          </div>
        </div>
      )}

      <div className="mt-3">
        {privateOpen ? (
          <div className="rounded-xl border border-[var(--border-color)] p-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              <Lock className="h-3.5 w-3.5" /> Messaggio privato a {comment.author || 'questa persona'} ({comment.platform === 'instagram' ? 'Direct' : 'Messenger'}). Uno per commento, entro 7 giorni.
            </p>
            <textarea
              value={privateText}
              onChange={(e) => setPrivateText(e.target.value)}
              rows={2}
              placeholder="Scrivi il messaggio privato…"
              className="w-full resize-y rounded-xl border border-[var(--border-color)] bg-[var(--background)] p-3 text-sm"
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={sendPrivate}
                disabled={busy !== null || !privateText.trim()}
                className="flex items-center gap-2 rounded-full bg-[var(--accent-blue)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy === 'private' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />} Invia in privato
              </button>
              <button onClick={() => setPrivateOpen(false)} className="px-3 py-2 text-sm text-[var(--text-secondary)]">
                Annulla
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setPrivateOpen(true)} className="flex items-center gap-1.5 text-sm font-semibold text-[var(--accent-blue)]">
            <Lock className="h-4 w-4" /> Rispondi in privato
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-[#ff6b6b]">{error}</p>}
    </article>
  )
}
