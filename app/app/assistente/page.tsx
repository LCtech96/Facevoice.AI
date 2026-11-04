'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowUp, CalendarClock, Check, Facebook, ImagePlus, Instagram, Loader2, Mic, Plus, Send, Sparkles, Trash2, X } from 'lucide-react'
import { useWorkspace } from '@/components/app/WorkspaceContext'
import { useDictation } from '@/components/useDictation'
import { prepareImage } from '@/lib/client-image'

// Assistente AI dell'area clienti: chat (anche a voce) con le foto allegate.
// Crea i post, modifica le immagini, li programma a giorno e ora o li pubblica
// subito su Instagram e Facebook, e risponde su messaggi e commenti ricevuti.

type Post = {
  id: string
  status: 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled'
  kind: 'photos' | 'carousel'
  title: string | null
  caption: string
  facebook_text: string | null
  media: string[]
  platforms: ('instagram' | 'facebook')[]
  publish_at: string | null
  results: { instagram?: string; facebook?: string; errors?: string[] }
  error_message: string | null
}
type Action = { kind: 'post'; post: Post } | { kind: 'image'; url: string; note: string }
type Turn = { role: 'user' | 'assistant'; text: string; images?: string[]; actions?: Action[]; at: string }
type Attachment = { id: string; thumb: string; url: string | null; error?: string }
type Connection = { platform: string; status: string; canPublish?: boolean }

const EXAMPLES = [
  'Crea un post con queste foto per il pranzo di domenica',
  'Rendi più luminosa questa foto e mettila in un post',
  'Programma il post per giovedì alle 18:30',
  'Che proposte di collaborazione abbiamo ricevuto oggi?',
]

const STATUS: Record<Post['status'], string> = {
  draft: 'Bozza',
  scheduled: 'Programmato',
  publishing: 'In pubblicazione…',
  published: 'Pubblicato',
  failed: 'Non pubblicato',
  cancelled: 'Eliminato',
}

/** "2026-11-07T18:30" nell'ora del telefono, per il campo data e ora. */
const toLocalInput = (iso: string | null) => {
  const d = iso ? new Date(iso) : new Date(Date.now() + 60 * 60_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const whenLabel = (iso: string) => new Date(iso).toLocaleString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })

export default function AssistantPage() {
  const { appFetch, workspace } = useWorkspace()
  const [turns, setTurns] = useState<Turn[] | null>(null)
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [connections, setConnections] = useState<Connection[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const canManage = workspace?.role !== 'member'
  const dictation = useDictation((text) => setInput((v) => (v ? `${v} ${text}` : text)))

  const load = useCallback(async () => {
    const res = await appFetch('/api/app/assistant').catch(() => null)
    const data = res?.ok ? await res.json() : null
    if (data) setTurns(data.turns || [])
    else setTurns((t) => t ?? [])
    return (data?.turns || []) as Turn[]
  }, [appFetch])

  useEffect(() => {
    load()
    appFetch('/api/app/channels')
      .then((r) => (r.ok ? r.json() : { connections: [] }))
      .then((d) => setConnections(d.connections || []))
      .catch(() => undefined)
  }, [load, appFetch])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns, busy])

  // Richiesta ancora in corso (es. pagina riaperta): si aspetta la risposta.
  useEffect(() => {
    const last = turns?.[turns.length - 1]
    if (!last || last.role !== 'user' || busy || Date.now() - new Date(last.at).getTime() > 5 * 60_000) return
    const timer = setTimeout(load, 5000)
    return () => clearTimeout(timer)
  }, [turns, busy, load])

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return
    const list = Array.from(files).filter((f) => f.type.startsWith('image/')).slice(0, 10 - attachments.length)
    for (const file of list) {
      let prepared
      try {
        prepared = await prepareImage(file)
      } catch {
        continue
      }
      const item: Attachment = { id: prepared.id, thumb: prepared.thumb, url: null }
      setAttachments((a) => [...a, item])
      const res = await appFetch('/api/app/media', { method: 'POST', body: JSON.stringify({ data: prepared.data }) }).catch(() => null)
      const data = res ? await res.json().catch(() => ({})) : {}
      setAttachments((a) => a.map((x) => (x.id === item.id ? { ...x, url: res?.ok ? data.url : null, error: res?.ok ? undefined : data.error || 'non caricata' } : x)))
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  const uploading = attachments.some((a) => !a.url && !a.error)
  const ready = attachments.filter((a) => a.url).map((a) => a.url!)

  const send = async (text = input) => {
    const message = text.trim()
    if ((!message && !ready.length) || busy || uploading) return
    if (dictation.listening) dictation.stop()
    setBusy(true)
    setError(null)
    setInput('')
    const sentAttachments = attachments
    setAttachments([])
    setTurns((t) => [...(t || []), { role: 'user', text: message, images: ready, at: new Date().toISOString() }])
    const res = await appFetch('/api/app/assistant', { method: 'POST', body: JSON.stringify({ message, images: ready }) }).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    setBusy(false)
    if (res?.ok && data?.turns) return setTurns(data.turns)
    if (res?.status === 409 || !res) {
      // Connessione caduta o lavoro gia' in corso: la risposta arriva salvata sul server.
      setError(data?.error || 'Sto ancora lavorando: la risposta compare qui tra poco.')
      return load()
    }
    setError(data?.error || 'Richiesta non riuscita, riprova.')
    setAttachments(sentAttachments)
    load()
  }

  const newChat = async () => {
    if (busy || !turns?.length || !confirm('Iniziare una nuova conversazione? I post creati restano.')) return
    await appFetch('/api/app/assistant', { method: 'DELETE' }).catch(() => null)
    setTurns([])
  }

  const updatePost = (post: Post) =>
    setTurns((list) => (list || []).map((t) => ({ ...t, actions: t.actions?.map((a) => (a.kind === 'post' && a.post.id === post.id ? { ...a, post } : a)) })))

  const instagram = connections.find((c) => c.platform === 'instagram' && c.status === 'connected')
  const needsPublish = instagram && !instagram.canPublish

  return (
    <div className="-mx-4 -my-6 flex min-h-[calc(100dvh-8.5rem)] flex-col md:-mx-8 md:-my-10 md:min-h-[100dvh]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border-color)] px-4 py-3 md:px-8">
        <h1 translate="no" className="flex items-center gap-2 text-2xl font-extrabold">
          <Sparkles className="h-5 w-5 text-[var(--accent-blue)]" /> FacevoiceAI
        </h1>
        <button onClick={newChat} disabled={busy || !turns?.length} className="flex items-center gap-1.5 text-sm text-[var(--text-secondary)] disabled:opacity-40">
          <Plus className="h-4 w-4" /> Nuova chat
        </button>
      </div>

      {needsPublish && (
        <p className="mx-4 mt-3 rounded-xl border border-[#FF9500] p-3 text-sm md:mx-8">
          Per pubblicare su Instagram da qui, consenti la pubblicazione dei contenuti:{' '}
          <Link href="/app/canali/meta?canale=instagram&publish=1" className="font-semibold text-[var(--accent-blue)]">
            ricollega Instagram
          </Link>{' '}
          e lascia attivo il permesso di pubblicare.
        </p>
      )}

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5 md:px-8">
        {turns === null ? (
          <Loader2 className="h-5 w-5 animate-spin text-[var(--text-secondary)]" />
        ) : !turns.length ? (
          <div className="max-w-xl">
            <p className="text-[var(--text-secondary)]">
              Scrivimi o dettami cosa vuoi fare. Allega le foto con il pulsante <ImagePlus className="inline h-4 w-4" />: creo il post, sistemo le immagini e lo pubblico quando vuoi tu.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {EXAMPLES.map((e) => (
                <button key={e} onClick={() => setInput(e)} className="rounded-xl border border-[var(--border-color)] px-3 py-2 text-left text-sm text-[var(--text-primary)] hover:border-[var(--accent-blue)]">
                  {e}
                </button>
              ))}
            </div>
          </div>
        ) : (
          turns.map((turn, i) =>
            turn.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl bg-[var(--background-secondary)] px-4 py-2.5">
                  {turn.images?.length ? (
                    <div className="mb-2 flex flex-wrap justify-end gap-1.5">
                      {turn.images.map((url) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={url} src={url} alt="" className="h-20 w-20 rounded-lg object-cover" />
                      ))}
                    </div>
                  ) : null}
                  {turn.text && <p className="whitespace-pre-wrap break-words text-[15px]">{turn.text}</p>}
                </div>
              </div>
            ) : (
              <div key={i} className="flex gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent-blue)]/15">
                  <Sparkles className="h-3.5 w-3.5 text-[var(--accent-blue)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{turn.text}</p>
                  {turn.actions?.map((action, k) =>
                    action.kind === 'post' ? (
                      <PostCard key={action.post.id} post={action.post} canManage={canManage} onChange={updatePost} />
                    ) : (
                      <a key={k} href={action.url} target="_blank" rel="noopener noreferrer" className="mt-3 block w-full max-w-xs">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={action.url} alt={action.note} className="w-full rounded-2xl border border-[var(--border-color)]" />
                        <span className="mt-1 block text-xs text-[var(--text-secondary)]">{action.note}</span>
                      </a>
                    )
                  )}
                </div>
              </div>
            )
          )
        )}
        {(busy || (turns?.length && turns[turns.length - 1].role === 'user')) && (
          <div className="flex items-center gap-3 text-sm text-[var(--text-secondary)]">
            <Loader2 className="h-4 w-4 animate-spin text-[var(--accent-blue)]" /> Ci sto lavorando… (per i post con immagini serve fino a un paio di minuti)
          </div>
        )}
        {error && <p className="text-sm text-[#FF9500]">{error}</p>}
        <div ref={endRef} />
      </div>

      {canManage ? (
        <div className="sticky bottom-20 border-t border-[var(--border-color)] bg-[var(--background)] px-4 py-3 md:bottom-0 md:px-8">
          {attachments.length > 0 && (
            <div className="mb-2 flex gap-2 overflow-x-auto">
              {attachments.map((a) => (
                <div key={a.id} className="relative shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.thumb} alt="" className={`h-16 w-16 rounded-lg object-cover ${a.url ? '' : 'opacity-50'}`} />
                  {!a.url && !a.error && <Loader2 className="absolute inset-0 m-auto h-5 w-5 animate-spin text-white" />}
                  {a.error && <span className="absolute inset-x-0 bottom-0 rounded-b-lg bg-[#FF3B30] px-1 text-[10px] text-white">{a.error}</span>}
                  <button
                    onClick={() => setAttachments((list) => list.filter((x) => x.id !== a.id))}
                    aria-label="Togli la foto"
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-[var(--background)] p-0.5 shadow"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2 rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-2">
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
            <button onClick={() => fileRef.current?.click()} disabled={attachments.length >= 10} aria-label="Allega foto" className="p-2 text-[var(--text-secondary)] disabled:opacity-40">
              <ImagePlus className="h-5 w-5" />
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(min-width: 768px)').matches) {
                  e.preventDefault()
                  send()
                }
              }}
              rows={1}
              placeholder="Chiedi qualcosa o descrivi il post…"
              className="max-h-40 min-h-[40px] flex-1 resize-none bg-transparent px-1 py-2 text-[15px] outline-none"
            />
            {dictation.supported && (
              <button
                onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}
                aria-label="Detta"
                className={`p-2 ${dictation.listening ? 'text-[#FF3B30]' : 'text-[var(--text-secondary)]'}`}
              >
                <Mic className="h-5 w-5" />
              </button>
            )}
            <button
              onClick={() => send()}
              disabled={busy || uploading || (!input.trim() && !ready.length)}
              aria-label="Invia"
              className="rounded-full bg-[var(--accent-blue)] p-2.5 text-white disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
            </button>
          </div>
        </div>
      ) : (
        <p className="px-4 py-3 text-sm text-[var(--text-secondary)] md:px-8">Solo gli amministratori dello spazio possono usare l’assistente.</p>
      )}
    </div>
  )
}

/** Anteprima di un post: immagini, testi modificabili, social, giorno e ora, Programma / Pubblica ora. */
function PostCard({ post, canManage, onChange }: { post: Post; canManage: boolean; onChange: (post: Post) => void }) {
  const { appFetch } = useWorkspace()
  const [caption, setCaption] = useState(post.caption)
  const [platforms, setPlatforms] = useState(post.platforms)
  const [when, setWhen] = useState(toLocalInput(post.publish_at))
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const done = post.status === 'published' || post.status === 'publishing' || post.status === 'cancelled'

  useEffect(() => {
    setCaption(post.caption)
    setPlatforms(post.platforms)
  }, [post.caption, post.platforms])

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action)
    setError(null)
    const res = await appFetch('/api/app/posts', {
      method: 'PATCH',
      body: JSON.stringify({ id: post.id, action, caption: caption !== post.caption ? caption : undefined, platforms, ...extra }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setBusy(null)
    if (data.post) onChange(data.post)
    if (!res?.ok) setError(data.error || 'Operazione non riuscita, riprova.')
    else if (action === 'delete') onChange({ ...post, status: 'cancelled' })
  }

  const toggle = (p: 'instagram' | 'facebook') => setPlatforms((list) => (list.includes(p) ? list.filter((x) => x !== p) : [...list, p]))

  return (
    <div className="mt-3 max-w-xl rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-3">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="truncate font-semibold">{post.title || 'Post'}</span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
            post.status === 'published' ? 'bg-[#34C759]/15 text-[#34C759]' : post.status === 'failed' ? 'bg-[#FF3B30]/15 text-[#FF3B30]' : post.status === 'scheduled' ? 'bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]' : 'bg-[var(--background)] text-[var(--text-secondary)]'
          }`}
        >
          {STATUS[post.status]}
          {post.status === 'scheduled' && post.publish_at ? ` · ${whenLabel(post.publish_at)}` : ''}
        </span>
      </div>
      <div className="mt-2 flex snap-x gap-2 overflow-x-auto pb-1">
        {post.media.map((url, i) => (
          <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="shrink-0 snap-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`Immagine ${i + 1}`} loading="lazy" className="h-52 w-[166px] rounded-lg border border-[var(--border-color)] object-cover" />
          </a>
        ))}
      </div>
      <textarea
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        disabled={done || !canManage}
        rows={5}
        className="mt-2 w-full rounded-lg border border-[var(--border-color)] bg-[var(--background)] px-3 py-2 text-sm"
      />
      {post.results?.errors?.length ? <p className="mt-1 text-xs text-[#FF3B30]">{post.results.errors.join(' · ')}</p> : null}
      {error && <p className="mt-1 text-xs text-[#FF3B30]">{error}</p>}

      {!done && canManage && (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            {(['instagram', 'facebook'] as const).map((p) => {
              const Icon = p === 'instagram' ? Instagram : Facebook
              return (
                <label key={p} className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={platforms.includes(p)} onChange={() => toggle(p)} />
                  <Icon className="h-4 w-4" />
                </label>
              )
            })}
            <label className="ml-auto inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
              <CalendarClock className="h-4 w-4" />
              <input
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                className="rounded-lg border border-[var(--border-color)] bg-[var(--background)] px-2 py-1 text-sm text-[var(--text-primary)]"
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            <button onClick={() => confirm('Eliminare questo post?') && act('delete')} disabled={busy !== null} aria-label="Elimina" className="mr-auto p-2 text-[var(--text-secondary)]">
              <Trash2 className="h-4 w-4" />
            </button>
            {post.status === 'scheduled' && (
              <button onClick={() => act('unschedule')} disabled={busy !== null} className="px-3 py-2 text-sm text-[var(--text-secondary)]">
                Annulla programmazione
              </button>
            )}
            <button
              onClick={() => act('schedule', { publishAt: new Date(when).toISOString() })}
              disabled={busy !== null || !platforms.length || !caption.trim()}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-color)] px-3 py-2 text-sm disabled:opacity-50"
            >
              {busy === 'schedule' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />} {post.status === 'scheduled' ? 'Cambia orario' : 'Programma'}
            </button>
            <button
              onClick={() => confirm('Pubblicare adesso?') && act('publish')}
              disabled={busy !== null || !platforms.length || !caption.trim()}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-blue)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy === 'publish' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Pubblica ora
            </button>
          </div>
        </>
      )}
      {post.status === 'published' && (
        <p className="mt-2 inline-flex items-center gap-1 text-xs text-[#34C759]">
          <Check className="h-3.5 w-3.5" /> Pubblicato su {[post.results?.instagram && 'Instagram', post.results?.facebook && 'Facebook'].filter(Boolean).join(' e ')}
        </p>
      )}
    </div>
  )
}
