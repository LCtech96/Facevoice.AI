'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowUp, CalendarClock, Check, ChevronLeft, ChevronRight, Coins, Facebook, History, Scissors, ImagePlus, Instagram, Loader2, Mic, Plus, Send, Sparkles, Trash2, X } from 'lucide-react'
import { useWorkspace } from '@/components/app/WorkspaceContext'
import { useDictation } from '@/components/useDictation'
import { prepareImage } from '@/lib/client-image'
import { AI_MODEL_CHOICES } from '@/lib/ai-models'
import { PHOTO_LAYOUTS, TEXT_LAYOUTS } from '@/lib/photo-layouts'

const MODEL_KEY = 'fv_app_assistant_model'

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
  /** Slide spostabili o da togliere: 'closing' = l'ultima e' la slide finale e resta in fondo; null = no. */
  arrange?: 'free' | 'closing' | null
  /** Slide fatte con una grafica vecchia (es. ombra chiara sotto il testo): si possono rifare. */
  restyle?: boolean
  /** Stile e colori del carosello con le foto (null: non si scelgono). */
  design?: { kind: 'photo' | 'text'; layout: string; mix: number } | null
  /** Versione precedente (com'era in quel momento della chat): solo da guardare o riprendere. */
  snapshot?: boolean
  sameAsLive?: boolean
}
type Action = { kind: 'post'; post: Post } | { kind: 'image'; url: string; note: string }
type Target = { postId: string; slide: number; thumb?: string; slides?: number[] }
type Turn = { role: 'user' | 'assistant'; text: string; images?: string[]; target?: Target; actions?: Action[]; usage?: { tokens: number; eur: number }; at: string }
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
  // Modello AI scelto: resta per le prossime volte.
  const [model, setModel] = useState<string>('auto')
  useEffect(() => {
    try {
      const saved = localStorage.getItem(MODEL_KEY)
      if (saved && AI_MODEL_CHOICES.some((m) => m.id === saved)) setModel(saved)
    } catch {}
  }, [])
  const chooseModel = (id: string) => {
    setModel(id)
    try {
      localStorage.setItem(MODEL_KEY, id)
    } catch {}
  }
  const fileRef = useRef<HTMLInputElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const canManage = workspace?.role !== 'member'
  const dictation = useDictation((text) => setInput((v) => (v ? `${v} ${text}` : text)))

  // Chat aperta: ogni chat resta salvata; da "Contenuti programmati" si arriva con
  // ?post=<id> (la chat in cui si e' lavorato a quel post) o ?chat=<id>.
  const [chatId, setChatId] = useState<string | null>(null)
  const chatRef = useRef<string | null>(null)
  const load = useCallback(async () => {
    let query = chatRef.current ? `?chat=${encodeURIComponent(chatRef.current)}` : ''
    if (!chatRef.current && typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      const post = params.get('post')
      const chat = params.get('chat')
      if (post) query = `?post=${encodeURIComponent(post)}`
      else if (chat) query = `?chat=${encodeURIComponent(chat)}`
      if (post || chat) window.history.replaceState(null, '', '/app/assistente')
    }
    const res = await appFetch(`/api/app/assistant${query}`).catch(() => null)
    const data = res?.ok ? await res.json() : null
    if (data?.chatId) {
      chatRef.current = data.chatId
      setChatId(data.chatId)
    }
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

  // In fondo solo quando arriva un messaggio nuovo (non a ogni aggiornamento di un post).
  const turnCount = turns?.length ?? 0
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turnCount, busy])

  // Tornando sulla pagina (es. dopo aver cambiato app) si aggiornano le anteprime dei post:
  // stato, slide e orario devono essere quelli veri, non quelli di prima.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !busy) load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load, busy])

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

  /** target: slide toccata nell'anteprima (la richiesta riguarda solo quella). */
  const send = async (text = input, target?: Target) => {
    const message = text.trim()
    if ((!message && !ready.length) || busy || uploading) return false
    if (dictation.listening) dictation.stop()
    setBusy(true)
    setError(null)
    if (!target) setInput('')
    const sentAttachments = attachments
    setAttachments([])
    setTurns((t) => [...(t || []), { role: 'user', text: message, images: ready, ...(target ? { target } : {}), at: new Date().toISOString() }])
    const res = await appFetch('/api/app/assistant', { method: 'POST', body: JSON.stringify({ message, images: ready, model, chatId: chatRef.current, ...(target ? { target } : {}) }) }).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    setBusy(false)
    if (res?.ok && data?.turns) {
      setTurns(data.turns)
      return true
    }
    if (res?.status === 409 || !res) {
      // Connessione caduta o lavoro gia' in corso: la risposta arriva salvata sul server.
      setError(data?.error || 'Sto ancora lavorando: la risposta compare qui tra poco.')
      load()
      return true
    }
    setError(data?.error || 'Richiesta non riuscita, riprova.')
    setAttachments(sentAttachments)
    load()
  }

  const newChat = async () => {
    if (busy || !turns?.length || !confirm('Iniziare una nuova conversazione? Questa resta salvata: la ritrovi da «Contenuti programmati».')) return
    const res = await appFetch('/api/app/assistant', { method: 'DELETE' }).catch(() => null)
    const data = res?.ok ? await res.json().catch(() => null) : null
    if (data?.chatId) {
      chatRef.current = data.chatId
      setChatId(data.chatId)
    }
    setTurns([])
  }

  // Si aggiorna solo l'anteprima "viva" del post: le versioni precedenti restano com'erano.
  const updatePost = (post: Post) =>
    setTurns((list) =>
      (list || []).map((t) => ({ ...t, actions: t.actions?.map((a) => (a.kind === 'post' && a.post.id === post.id && !a.post.snapshot ? { ...a, post } : a)) }))
    )

  const instagram = connections.find((c) => c.platform === 'instagram' && c.status === 'connected')
  const needsPublish = instagram && !instagram.canPublish

  return (
    <div className="-mx-4 -my-6 flex min-h-[calc(100dvh-8.5rem)] flex-col md:-mx-8 md:-my-10 md:min-h-[100dvh]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border-color)] px-4 py-3 md:px-8">
        <div className="flex min-w-0 items-center gap-2">
          <h1 translate="no" className="flex items-center gap-2 text-2xl font-extrabold">
            <Sparkles className="h-5 w-5 text-[var(--accent-blue)]" /> FacevoiceAI
          </h1>
          <UsageButton />
        </div>
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
                  {turn.target ? (
                    <div className="mb-2 flex items-center justify-end gap-2 text-xs text-[var(--text-secondary)]">
                      {turn.target.thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={turn.target.thumb} alt="" className="h-12 w-10 rounded object-cover" />
                      ) : null}
                      {turn.target.slides && turn.target.slides.length > 1 ? `Slide ${turn.target.slides.join(', ')}` : `Slide ${turn.target.slide}`}
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
                  {turn.usage && (
                    <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
                      <Coins className="h-3 w-3" /> {tokens(turn.usage.tokens)} token · {euro(turn.usage.eur)}
                    </p>
                  )}
                  {turn.actions?.map((action, k) =>
                    action.kind === 'post' ? (
                      action.post.snapshot ? (
                        <SnapshotCard key={action.post.id} post={action.post} at={turn.at} canManage={canManage} busy={busy} model={model} chatId={chatId} onTurns={setTurns} onReload={load} />
                      ) : (
                        <PostCard key={action.post.id} post={action.post} canManage={canManage} busy={busy} model={model} chatId={chatId} onChange={updatePost} onTurns={setTurns} />
                      )
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
        {(busy || Boolean(turns?.length && turns[turns.length - 1].role === 'user')) && (
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
          <label className="relative mb-1.5 flex max-w-full items-center gap-1 px-1 text-[11px] text-[var(--text-secondary)]">
            <Sparkles className="h-3 w-3 shrink-0" />
            <select
              value={model}
              onChange={(e) => chooseModel(e.target.value)}
              disabled={busy}
              aria-label="Modello AI"
              className="w-full min-w-0 appearance-none overflow-hidden text-ellipsis whitespace-nowrap bg-transparent pr-4 font-medium text-[var(--text-primary)] focus:outline-none disabled:opacity-60"
            >
              {AI_MODEL_CHOICES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} · {m.hint}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-1" aria-hidden="true">▾</span>
          </label>
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
function PostCard({
  post,
  canManage,
  busy: chatBusy,
  model,
  chatId,
  onChange,
  onTurns,
}: {
  post: Post
  canManage: boolean
  busy: boolean
  model: string
  chatId: string | null
  onChange: (post: Post) => void
  onTurns: (turns: Turn[]) => void
}) {
  const { appFetch } = useWorkspace()
  // Slide toccate (indici in post.media): la correzione riguarda SOLO queste.
  const [selected, setSelected] = useState<number[]>([])
  // Nuovo ordine non ancora salvato (indici in post.media; quelle tolte mancano).
  const [order, setOrder] = useState<number[] | null>(null)
  const thumbs = useRef(new Map<number, HTMLButtonElement>())
  const [slidePrompt, setSlidePrompt] = useState('')
  const [captionPrompt, setCaptionPrompt] = useState('')
  const [caption, setCaption] = useState(post.caption)
  const [platforms, setPlatforms] = useState(post.platforms)
  const [when, setWhen] = useState(toLocalInput(post.publish_at))
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const done = post.status === 'published' || post.status === 'publishing' || post.status === 'cancelled'

  useEffect(() => {
    setCaption(post.caption)
    setPlatforms(post.platforms)
  }, [post.caption, post.platforms])

  useEffect(() => {
    setWhen(toLocalInput(post.publish_at))
  }, [post.publish_at])

  // Slide rifatte (ordine salvato o slide corrette): si riparte da quelle; dopo un
  // salvataggio o una correzione restano selezionate le stesse slide.
  const mediaKey = post.media.join('|')
  const keepSelected = useRef<number[] | null>(null)
  useEffect(() => {
    setOrder(null)
    setSelected(keepSelected.current ?? [])
    keepSelected.current = null
  }, [mediaKey])

  const arrange = !done && canManage ? post.arrange ?? null : null
  const sequence = order ?? post.media.map((_, i) => i)
  const changed = order !== null
  const closingIndex = arrange === 'closing' ? post.media.length - 1 : -1
  // Posizioni (da 0) delle slide scelte, nell'ordine mostrato.
  const positions = selected.map((i) => sequence.indexOf(i)).filter((p) => p >= 0).sort((a, b) => a - b)
  const single = selected.length === 1 ? selected[0] : null
  const pos = single === null ? -1 : sequence.indexOf(single)
  const isClosing = single !== null && single === closingIndex
  const canMoveLeft = Boolean(arrange) && pos > 0 && !isClosing
  const canMoveRight = Boolean(arrange) && pos >= 0 && pos < sequence.length - 1 && !isClosing && sequence[pos + 1] !== closingIndex
  const canRemove = Boolean(arrange) && selected.length > 0 && sequence.some((k) => !selected.includes(k) && k !== closingIndex)
  const allSelected = sequence.length > 1 && positions.length === sequence.length
  const numbers = positions.map((p) => p + 1)
  const which = allSelected
    ? 'tutte le slide'
    : numbers.length === 1
      ? `la slide ${numbers[0]}`
      : `le slide ${numbers.slice(0, -1).join(', ')} e ${numbers[numbers.length - 1]}`

  const toggleSlide = (i: number) => {
    setNotice(null)
    setSelected((list) => (list.includes(i) ? list.filter((x) => x !== i) : [...list, i]))
  }
  const rearrange = (next: number[]) => setOrder(next.length === post.media.length && next.every((k, j) => k === j) ? null : next)
  const move = (step: -1 | 1) => {
    if (single === null) return
    const next = [...sequence]
    ;[next[pos], next[pos + step]] = [next[pos + step], next[pos]]
    rearrange(next)
    requestAnimationFrame(() => thumbs.current.get(single)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }))
  }
  const remove = () => {
    rearrange(sequence.filter((k) => !selected.includes(k)))
    setSelected([])
  }

  const signature = (p: Post) => `${p.status}|${p.publish_at}|${p.media.join('|')}`

  /** Dopo una connessione caduta: il server puo' aver finito lo stesso, si ricontrolla il post. */
  const recheck = async (message: string): Promise<Post | null> => {
    const before = signature(post)
    setBusy('recheck')
    setError(null)
    let last: Post | null = null
    for (let k = 0; k < 24; k++) {
      await new Promise((r) => setTimeout(r, 5000))
      const res = await appFetch(`/api/app/posts?id=${post.id}`).catch(() => null)
      const data = res?.ok ? await res.json().catch(() => null) : null
      if (data?.post) last = data.post
      if (last && last.status !== 'publishing' && signature(last) !== before) {
        setBusy(null)
        onChange(last)
        return last
      }
      // Dopo mezzo minuto si smette, salvo una pubblicazione ancora in corso.
      if (k >= 5 && last?.status !== 'publishing') break
    }
    setBusy(null)
    if (last) onChange(last)
    setError(message)
    return null
  }

  type Result = { ok: boolean; post?: Post; done?: string[] }
  const act = async (action: string, extra: Record<string, unknown> = {}): Promise<Result> => {
    setBusy(action)
    setError(null)
    setNotice(null)
    const res = await appFetch('/api/app/posts', {
      method: 'PATCH',
      body: JSON.stringify({
        id: post.id,
        action,
        // Le slide che si vedono: il server non tocca un post diverso da questo.
        base: post.media,
        model,
        chatId,
        caption: caption !== post.caption ? caption : undefined,
        platforms: platforms.join() !== post.platforms.join() ? platforms : undefined,
        ...extra,
      }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setBusy(null)
    if (!res?.ok) keepSelected.current = null
    if (data.post) onChange(data.post)
    // La modifica e' entrata in cronologia: la chat mostra la nuova versione in fondo.
    if (data.turns) onTurns(data.turns)
    if (res?.ok) {
      if (action === 'delete') onChange({ ...post, status: 'cancelled' })
      return { ok: true, post: data.post, done: data.done }
    }
    const message = data.error || (res ? `Operazione non riuscita (errore ${res.status}), riprova.` : 'Connessione interrotta, riprova.')
    // Nessuna risposta chiara (connessione caduta o tempo scaduto): si ricontrolla il post.
    if (!data.error && action !== 'delete') {
      const fresh = await recheck(message)
      if (fresh) return { ok: true, post: fresh }
      return { ok: false }
    }
    setError(message)
    return { ok: false }
  }

  /** Salva il nuovo ordine (slide rifatte con i numeri giusti): torna il post aggiornato. */
  const saveOrder = async (): Promise<Post | null> => {
    if (!order) return post
    keepSelected.current = positions
    const result = await act('arrange', { slides: order.map((k) => k + 1) })
    if (result.ok && result.post) return result.post
    keepSelected.current = null
    return null
  }

  /** Correzione delle SOLE slide scelte (le altre restano identiche); se l'ordine non e' salvato, prima si salva. */
  const editSelected = async () => {
    const chosen = positions
    if (!chosen.length || !slidePrompt.trim()) return
    const current = changed ? await saveOrder() : post
    if (!current) return
    keepSelected.current = chosen
    const result = await act('edit_slides', { slides: chosen.map((p) => p + 1), instruction: slidePrompt, base: current.media })
    if (!result.ok) return
    const updated = Boolean(result.post && result.post.media.join('|') !== current.media.join('|'))
    if (!updated) keepSelected.current = null
    setSlidePrompt('')
    setNotice(
      result.done?.length
        ? `Fatto: ${result.done.join(' · ')}. Le altre slide non sono cambiate.`
        : updated
          ? `Fatto: ho corretto solo ${which}.`
          : 'Non ho cambiato niente: scrivi in modo più preciso cosa cambiare.'
    )
  }

  /** Solo la didascalia, con una chiamata breve all'AI (es. "traduci in inglese"). */
  const editCaptionAI = async () => {
    if (!captionPrompt.trim() || busy !== null || chatBusy || caption !== post.caption) return
    if ((await act('edit_caption', { instruction: captionPrompt })).ok) setCaptionPrompt('')
  }

  /** La slide scelta e' uno screenshot con piu' foto: ogni foto diventa una slide a se'. */
  const extract = async () => {
    if (pos < 0 || !confirm('Estrarre le foto da questa slide? Ogni foto dello screenshot diventa una slide; le altre slide restano uguali.')) return
    const n = pos
    const current = changed ? await saveOrder() : post
    if (!current) return
    await act('extract', { slides: [n + 1], base: current.media })
  }

  const toggle = (p: 'instagram' | 'facebook') => setPlatforms((list) => (list.includes(p) ? list.filter((x) => x !== p) : [...list, p]))
  const working = busy !== null || chatBusy

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
        </span>
      </div>
      <div className="mt-2 flex snap-x gap-2 overflow-x-auto pb-1">
        {sequence.map((i, n) => {
          const url = post.media[i]
          const on = selected.includes(i)
          return (
            <button
              key={url}
              ref={(el) => {
                if (el) thumbs.current.set(i, el)
                else thumbs.current.delete(i)
              }}
              type="button"
              onClick={() => !done && canManage && !working && toggleSlide(i)}
              aria-label={`Slide ${n + 1}${on ? ' (selezionata)' : ''}`}
              aria-pressed={on}
              className="relative shrink-0 snap-start"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt={`Immagine ${n + 1}`}
                loading="lazy"
                className={`h-52 w-[166px] rounded-lg object-cover ${on ? 'ring-4 ring-[var(--accent-blue)]' : 'border border-[var(--border-color)]'} ${busy === 'arrange' || (busy === 'edit_slides' && on) ? 'opacity-50' : ''}`}
              />
              <span className={`absolute left-1.5 top-1.5 rounded-full px-1.5 text-[11px] font-semibold ${on ? 'bg-[var(--accent-blue)] text-white' : 'bg-black/55 text-white'}`}>{n + 1}</span>
              {on && <Check className="absolute right-1.5 top-1.5 h-5 w-5 rounded-full bg-[var(--accent-blue)] p-0.5 text-white" />}
            </button>
          )
        })}
      </div>
      {post.design && !done && canManage && (
        <div className="mt-2 space-y-1.5 text-xs">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            <span className="shrink-0 text-[var(--text-secondary)]">Stile</span>
            {(post.design.kind === 'text' ? TEXT_LAYOUTS : PHOTO_LAYOUTS).map((l) => (
              <button
                key={l.id}
                onClick={() => post.design?.layout !== l.id && act('design', post.design?.kind === 'text' ? { textLayout: l.id } : { layout: l.id })}
                disabled={working || changed}
                title={l.hint}
                className={`shrink-0 rounded-full border px-2.5 py-1 disabled:opacity-50 ${
                  post.design?.layout === l.id ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)] font-semibold text-white' : 'border-[var(--border-color)] text-[var(--text-secondary)]'
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            <span className="shrink-0 text-[var(--text-secondary)]">Colori</span>
            {['Scuro', 'Colore', 'Chiaro', 'Profondo'].map((name, m) => (
              <button
                key={name}
                onClick={() => post.design?.mix !== m && act('design', { mix: m })}
                disabled={working || changed}
                className={`shrink-0 rounded-full border px-2.5 py-1 disabled:opacity-50 ${
                  post.design?.mix === m ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)] font-semibold text-white' : 'border-[var(--border-color)] text-[var(--text-secondary)]'
                }`}
              >
                {name}
              </button>
            ))}
            {busy === 'design' && (
              <span className="inline-flex shrink-0 items-center gap-1 text-[var(--text-secondary)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Rifaccio le slide…
              </span>
            )}
          </div>
        </div>
      )}
      {post.restyle && !done && canManage && !changed && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-[var(--accent-blue)]/10 px-3 py-2 text-xs">
          <span className="min-w-0 flex-1 text-[var(--text-secondary)]">
            {busy === 'restyle' ? 'Rifaccio le slide con la grafica nuova…' : 'Grafica migliorata: ombra scura sotto il testo, scritte più leggibili. Testi e foto restano gli stessi.'}
          </span>
          <button
            onClick={() => act('restyle')}
            disabled={working}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-blue)] px-3 py-1.5 font-semibold text-white disabled:opacity-50"
          >
            {busy === 'restyle' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Aggiorna le slide
          </button>
        </div>
      )}
      {changed && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-[var(--accent-blue)]/10 px-3 py-2 text-xs">
          <span className="min-w-0 flex-1 text-[var(--text-secondary)]">
            {busy === 'arrange' ? 'Rifaccio le slide con i numeri giusti…' : `Nuovo ordine, ${sequence.length} slide: salva per aggiornare i numeri sulle slide.`}
          </span>
          <button onClick={() => setOrder(null)} disabled={working} className="px-2 py-1.5 text-[var(--text-secondary)] disabled:opacity-40">
            Annulla
          </button>
          <button onClick={saveOrder} disabled={working} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-blue)] px-3 py-1.5 font-semibold text-white disabled:opacity-50">
            {busy === 'arrange' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Salva
          </button>
        </div>
      )}
      {!done && canManage && !selected.length && !changed && post.media.length > 0 && (
        <p className="mt-1 text-xs text-[var(--text-secondary)]">
          Tocca una o più slide per correggere solo quelle{arrange ? ', spostarle o toglierle' : ''}.
        </p>
      )}
      {notice && <p className="mt-1 text-xs text-[#34C759]">{notice}</p>}
      {selected.length > 0 && !done && canManage && (
        <div className="mt-2 rounded-xl border border-[var(--accent-blue)] bg-[var(--background)] p-2">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            {arrange &&
              (isClosing ? (
                <span className="text-[var(--text-secondary)]">La slide finale resta in fondo.</span>
              ) : (
                <span className={`inline-flex items-center rounded-full border border-[var(--border-color)] ${single === null ? 'opacity-40' : ''}`}>
                  <button onClick={() => move(-1)} disabled={!canMoveLeft || working} aria-label="Sposta prima" className="p-1.5 disabled:opacity-30">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="px-1 text-[var(--text-secondary)]">Sposta</span>
                  <button onClick={() => move(1)} disabled={!canMoveRight || working} aria-label="Sposta dopo" className="p-1.5 disabled:opacity-30">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </span>
              ))}
            {arrange && (
              <button
                onClick={remove}
                disabled={!canRemove || working}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] px-2.5 py-1.5 text-[#FF3B30] disabled:opacity-30"
              >
                <Trash2 className="h-3.5 w-3.5" /> Togli
              </button>
            )}
            {arrange && single !== null && !isClosing && (
              <button
                onClick={extract}
                disabled={working}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] px-2.5 py-1.5 disabled:opacity-30"
              >
                {busy === 'extract' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Scissors className="h-3.5 w-3.5" />} Estrai foto
              </button>
            )}
            {sequence.length > 1 && (
              <button
                onClick={() => setSelected(allSelected ? [] : [...sequence])}
                disabled={working}
                className="rounded-full border border-[var(--border-color)] px-2.5 py-1.5 text-[var(--text-secondary)] disabled:opacity-30"
              >
                {allSelected ? 'Nessuna' : 'Tutte'}
              </button>
            )}
            <button onClick={() => setSelected([])} aria-label="Chiudi" className="ml-auto p-1 text-[var(--text-secondary)]">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mb-1 text-xs text-[var(--text-secondary)]">
            Cosa vuoi cambiare in <b className="text-[var(--text-primary)]">{which}</b>? Il testo, la foto o entrambi.{' '}
            {allSelected ? '' : 'Le altre slide restano identiche.'}
          </p>
          <div className="flex items-end gap-2">
            <textarea
              value={slidePrompt}
              onChange={(e) => setSlidePrompt(e.target.value)}
              rows={2}
              placeholder="Es. «scrivi: Vista mare dal balcone» oppure «rendi la foto più luminosa»"
              className="flex-1 resize-none rounded-lg border border-[var(--border-color)] bg-[var(--background-secondary)] px-2 py-1.5 text-sm"
            />
            <button
              onClick={editSelected}
              disabled={working || !slidePrompt.trim() || !positions.length}
              aria-label="Correggi le slide scelte"
              className="rounded-full bg-[var(--accent-blue)] p-2 text-white disabled:opacity-40"
            >
              {busy === 'edit_slides' || busy === 'arrange' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            </button>
          </div>
          {busy === 'edit_slides' && <p className="mt-1 text-[11px] text-[var(--text-secondary)]">Correggo solo {which}…</p>}
          {busy === 'extract' && <p className="mt-1 text-[11px] text-[var(--text-secondary)]">Cerco le foto nello screenshot e preparo una slide per ognuna (fino a un minuto)…</p>}
          {changed && busy !== 'edit_slides' && <p className="mt-1 text-[11px] text-[var(--text-secondary)]">Se scrivi una correzione, prima salvo il nuovo ordine.</p>}
        </div>
      )}
      <textarea
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        disabled={done || !canManage}
        rows={5}
        className="mt-2 w-full rounded-lg border border-[var(--border-color)] bg-[var(--background)] px-3 py-2 text-sm"
      />
      {!done && canManage && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {caption !== post.caption && (
            <>
              <button
                onClick={async () => {
                  if ((await act('save')).ok) setNotice('Didascalia salvata.')
                }}
                disabled={working || !caption.trim()}
                className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-blue)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {busy === 'save' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Salva testo
              </button>
              <button onClick={() => setCaption(post.caption)} disabled={working} className="text-xs text-[var(--text-secondary)]">
                Annulla
              </button>
            </>
          )}
          {/* Didascalia con l'AI: una chiamata breve, solo sul testo (niente chat, niente slide). */}
          <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--background)] py-1 pl-3 pr-1">
            <input
              value={captionPrompt}
              onChange={(e) => setCaptionPrompt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && editCaptionAI()}
              placeholder="Didascalia con l’AI: «traduci in inglese», «più corta»…"
              className="min-w-0 flex-1 bg-transparent text-xs outline-none"
            />
            <button
              onClick={editCaptionAI}
              disabled={working || !captionPrompt.trim() || caption !== post.caption}
              aria-label="Cambia la didascalia con l’AI"
              className="rounded-full bg-[var(--accent-blue)] p-1.5 text-white disabled:opacity-40"
            >
              {busy === 'edit_caption' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      )}
      {post.results?.errors?.length ? <p className="mt-1 text-xs text-[#FF3B30]">{post.results.errors.join(' · ')}</p> : null}
      {busy === 'recheck' && (
        <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Connessione interrotta: controllo se il server ha finito…
        </p>
      )}
      {error && <p className="mt-1 text-xs text-[#FF3B30]">{error}</p>}

      {!done && canManage && (
        <>
          {post.status === 'scheduled' && post.publish_at && (
            <div className="mt-2 rounded-xl border border-[var(--accent-blue)]/50 bg-[var(--accent-blue)]/10 p-2.5 text-sm">
              <p>
                <CalendarClock className="mr-1 inline h-4 w-4 text-[var(--accent-blue)]" />
                Programmato per <b>{whenLabel(post.publish_at)}</b>.
              </p>
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">Cambia giorno e ora qui sotto, oppure togli solo la programmazione: il post resta in bozza.</p>
              <button
                onClick={async () => {
                  if ((await act('unschedule')).ok) setNotice('Programmazione annullata: il post è in bozza.')
                }}
                disabled={working}
                className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--background)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
              >
                {busy === 'unschedule' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />} Annulla programmazione
              </button>
            </div>
          )}
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
            <button
              onClick={() =>
                confirm(post.status === 'scheduled' ? 'Eliminare il post? Per togliere solo la programmazione usa «Annulla programmazione».' : 'Eliminare questo post?') && act('delete')
              }
              disabled={working}
              aria-label="Elimina il post"
              className="mr-auto inline-flex items-center gap-1 p-2 text-xs text-[var(--text-secondary)]"
            >
              <Trash2 className="h-4 w-4" /> Elimina post
            </button>
            <button
              onClick={async () => {
                if ((await act('schedule', { publishAt: new Date(when).toISOString() })).ok) setNotice(post.status === 'scheduled' ? 'Orario cambiato.' : 'Post programmato.')
              }}
              disabled={working || changed || !platforms.length || !caption.trim()}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-color)] px-3 py-2 text-sm disabled:opacity-50"
            >
              {busy === 'schedule' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />} {post.status === 'scheduled' ? 'Cambia orario' : 'Programma'}
            </button>
            <button
              onClick={() => confirm('Pubblicare adesso?') && act('publish')}
              disabled={working || changed || !platforms.length || !caption.trim()}
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

/** Versione precedente di un post, com'era in quel momento della chat: si guarda o si riprende. */
function SnapshotCard({
  post,
  at,
  canManage,
  busy: chatBusy,
  model,
  chatId,
  onTurns,
  onReload,
}: {
  post: Post
  at: string
  canManage: boolean
  busy: boolean
  model: string
  chatId: string | null
  onTurns: (turns: Turn[]) => void
  onReload: () => Promise<Turn[]>
}) {
  const { appFetch } = useWorkspace()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const label = new Date(at).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  if (post.sameAsLive) {
    return (
      <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[var(--border-color)] px-3 py-1 text-xs text-[var(--text-secondary)]">
        <History className="h-3.5 w-3.5" /> Versione del {label}: uguale a quella attuale (più sotto).
      </p>
    )
  }

  const restore = async () => {
    if (!confirm('Riprendere questa versione? Diventa una nuova bozza; il post attuale resta com’è.')) return
    setBusy(true)
    setError(null)
    const res = await appFetch('/api/app/posts', { method: 'PATCH', body: JSON.stringify({ id: post.id, action: 'restore', media: post.media, caption: post.caption, at, model, chatId }) }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (data.turns) {
      setBusy(false)
      onTurns(data.turns)
      return
    }
    if (data.error) {
      setBusy(false)
      setError(data.error)
      return
    }
    // Connessione caduta: il server finisce lo stesso e scrive la nuova bozza nella chat.
    setError('Connessione interrotta: controllo se la bozza è pronta…')
    const count = (await onReload()).length
    for (let k = 0; k < 8; k++) {
      await new Promise((r) => setTimeout(r, 8000))
      if ((await onReload()).length > count) {
        setBusy(false)
        setError(null)
        return
      }
    }
    setBusy(false)
    setError('La bozza non è arrivata: riprova.')
  }

  return (
    <div className="mt-3 max-w-xl rounded-2xl border border-dashed border-[var(--border-color)] p-3">
      <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
        <span className="inline-flex items-center gap-1.5">
          <History className="h-3.5 w-3.5" /> Versione del {label}
        </span>
        <span>{post.media.length} slide</span>
      </div>
      <div className="mt-2 flex snap-x gap-2 overflow-x-auto pb-1">
        {post.media.map((url, n) => (
          <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="relative shrink-0 snap-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`Slide ${n + 1}`} loading="lazy" className="h-40 w-32 rounded-lg border border-[var(--border-color)] object-cover" />
            <span className="absolute left-1.5 top-1.5 rounded-full bg-black/55 px-1.5 text-[11px] font-semibold text-white">{n + 1}</span>
          </a>
        ))}
      </div>
      <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-[var(--text-secondary)]">{post.caption}</p>
      {error && <p className="mt-1 text-xs text-[#FF3B30]">{error}</p>}
      {canManage && (
        <button
          onClick={restore}
          disabled={busy || chatBusy}
          className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-[var(--border-color)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <History className="h-3.5 w-3.5" />} {busy ? 'Ripristino la versione…' : 'Riprendi questa versione'}
        </button>
      )}
      {busy && <p className="mt-1 text-[11px] text-[var(--text-secondary)]">Per le versioni di prima rileggo i testi delle slide: ci vuole fino a un minuto.</p>}
    </div>
  )
}

type Usage = {
  updatedAt: string
  today: { tokens: number; eur: number; calls: number }
  month: { tokens: number; eur: number; calls: number }
  byFeature: { feature: string; label: string; tokens: number; eur: number }[]
}

const euro = (value: number) =>
  new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: value > 0 && value < 1 ? 3 : 2 }).format(value)
const tokens = (value: number) => new Intl.NumberFormat('it-IT').format(value)

/** Consumo dell'AI dello spazio (token ed euro), aggiornato ogni minuto. */
function UsageButton() {
  const { appFetch, workspace } = useWorkspace()
  const [usage, setUsage] = useState<Usage | null>(null)
  const [open, setOpen] = useState(false)

  const refresh = useCallback(async () => {
    const res = await appFetch('/api/app/usage').catch(() => null)
    const data = res?.ok ? await res.json().catch(() => null) : null
    if (data?.month) setUsage(data)
  }, [appFetch])

  useEffect(() => {
    if (!workspace) return
    refresh()
    const timer = setInterval(() => document.visibilityState === 'visible' && refresh(), 60_000)
    const onVisible = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh, workspace])

  return (
    <div className="relative">
      <button
        onClick={() => {
          setOpen((o) => !o)
          refresh()
        }}
        aria-label="Consumo dell’AI"
        className="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] px-2 py-1 text-xs font-semibold text-[var(--text-secondary)]"
      >
        <Coins className="h-3.5 w-3.5 text-[var(--accent-blue)]" />
        {usage ? euro(usage.month.eur) : '…'}
      </button>
      {open && (
        <div className="fixed inset-x-4 top-16 z-30 rounded-2xl border border-[var(--border-color)] bg-[var(--background)] p-3 text-sm shadow-xl md:absolute md:inset-x-auto md:left-0 md:top-full md:mt-2 md:w-72">
          <div className="flex items-center justify-between">
            <b>Consumo dell’AI</b>
            <button onClick={() => setOpen(false)} aria-label="Chiudi" className="p-1 text-[var(--text-secondary)]">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {usage ? (
            <>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {([['Oggi', usage.today], ['Questo mese', usage.month]] as const).map(([name, t]) => (
                  <div key={name} className="rounded-xl bg-[var(--background-secondary)] p-2">
                    <p className="text-xs text-[var(--text-secondary)]">{name}</p>
                    <p className="text-base font-bold">{euro(t.eur)}</p>
                    <p className="text-xs text-[var(--text-secondary)]">{tokens(t.tokens)} token</p>
                  </div>
                ))}
              </div>
              {usage.byFeature.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs">
                  {usage.byFeature.slice(0, 6).map((f) => (
                    <li key={f.feature} className="flex justify-between gap-2">
                      <span className="truncate text-[var(--text-secondary)]">{f.label}</span>
                      <span className="shrink-0">
                        {tokens(f.tokens)} · {euro(f.eur)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[11px] text-[var(--text-secondary)]">
                Aggiornato alle {new Date(usage.updatedAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}, si aggiorna ogni minuto. Euro al cambio BCE del giorno; le
                modifiche delle immagini con l’AI non sono ancora conteggiate.
              </p>
            </>
          ) : (
            <p className="mt-2 text-xs text-[var(--text-secondary)]">Carico il consumo…</p>
          )}
        </div>
      )}
    </div>
  )
}
