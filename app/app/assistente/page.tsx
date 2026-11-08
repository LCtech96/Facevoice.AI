'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowUp, CalendarClock, Check, ChevronLeft, ChevronRight, Download, ExternalLink, Facebook, FileText, History, Lock, Mail, MessageCircle, Pause, Pencil, Scissors, ImagePlus, Instagram, Loader2, Mic, Plus, Search, Send, ShieldCheck, Sparkles, Trash2, X, Zap } from 'lucide-react'
import { useWorkspace } from '@/components/app/WorkspaceContext'
import { UsageTokens, refreshUsage } from '@/components/app/UsageLights'
import { useDictation } from '@/components/useDictation'
import { looksLikeImage, prepareImage } from '@/lib/client-image'
import { AI_MODEL_CHOICES, asModelChoice } from '@/lib/ai-models'
import { PHOTO_LAYOUTS, TEXT_LAYOUTS } from '@/lib/photo-layouts'
import { looksLikeVideo } from '@/lib/saas/video-shared'

const MODEL_KEY = 'fv_app_assistant_model'

// Assistente AI dell'area clienti: chat (anche a voce) con le foto allegate.
// Crea i post, modifica le immagini, li programma a giorno e ora o li pubblica
// subito su Instagram e Facebook, e risponde su messaggi e commenti ricevuti.
// Scrive documenti (contratti, preventivi, lettere) dalla conversazione con una persona:
// scheda con «Apri PDF» e «Scarica». Doppia autorizzazione: tutto quello che esce dalla
// chat (messaggi, pubblicazioni, email programmate…) compare in una scheda e parte solo
// con «Accetta e invia» (o «Conferma»); «Scarta» non manda niente. La condivisione di un
// contratto chiede nella scheda il PIN (mascherato): va solo al server con il clic, mai in chat.
// Solo per chi ce l'ha attivo (lo accende Facevoice dal suo pannello): agli altri
// la pagina dice come chiederlo, su WhatsApp.

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
  /** Pagine da cui vengono le immagini prese dal web (avviso sotto l'anteprima). */
  webSources?: WebSource[]
}
type WebSource = { url: string; site: string }
/** Messaggio inviato dall'assistente a chi ci aveva scritto (send_message). */
type SentAction = { kind: 'message'; platform: string; contactId: string; name: string; text: string; subject?: string; via: 'dm' | 'comment' | 'email'; at: string }
/** Eventi e immagini trovati sul web dall'assistente (find_event_images). */
type WebItem = { kind: 'event' | 'generic'; title: string; dates: string | null; place: string | null; image_url: string; image_source_url: string; image_source_domain: string; credit: string }
type WebImagesAction = { kind: 'web_images'; items: WebItem[]; at: string }
/** Email programmata (Automazioni) creata, cambiata, in pausa, ripresa o eliminata dall'assistente. */
type AutomationAction = {
  kind: 'automation'
  op: 'created' | 'updated' | 'paused' | 'resumed' | 'deleted'
  at: string
  automation: { id: string; name: string; recipients: string[]; subject: string; mode: 'fixed' | 'ai'; when: string; nextRun: string | null; active: boolean; from: string }
}
/** Trova clienti: impostazioni salvate, ricerca avviata, prima email approvata, inviata o scartata dall'assistente. */
type ProspectAction = {
  kind: 'prospect'
  op: 'settings' | 'search' | 'approved' | 'sent' | 'discarded' | 'blocked'
  at: string
  prospect: { name: string; id?: string; email?: string | null; subject?: string | null; count?: number; note?: string }
}
/** Documento scritto dall'assistente (contratto, preventivo, lettera…): PDF da aprire o scaricare. */
type DocumentAction = {
  kind: 'document'
  at: string
  document: {
    id: string
    kind: 'contratto' | 'preventivo' | 'accordo' | 'lettera' | 'altro'
    title: string
    about: { platform: string; contactId: string; name: string } | null
    version: number
    pages: number
    placeholders: string[]
    versions?: { n: number; at: string; pages: number }[]
    missing?: boolean
    /** Contratti: termini della collaborazione scelti (in parole) e da scegliere nella pagina del contratto. */
    terms?: { lines: string[]; missing: string[] }
  }
}
/** Azione preparata dall'assistente che parte solo con il clic (doppia autorizzazione). */
type PendingAction = {
  kind: 'pending'
  at: string
  pending: {
    id: string
    kind: string
    title: string
    lines: string[]
    text?: string
    subject?: string
    editable?: boolean
    confirmLabel: string
    doneLabel: string
    contact?: { platform: string; contactId: string; name: string }
    document?: { id: string; version: number; title: string; pages: number }
    /** Condivisione del contratto: il PIN si sceglie qui (mai in chat). */
    pin?: { min: number; max: number; for: string }
    status: 'pending' | 'running' | 'done' | 'failed' | 'discarded' | 'expired' | 'unconfirmed'
    createdAt: string
    expiresAt: string
    outcome?: string
  }
}
/** Contratto condiviso con link e PIN: il link si copia dalla rotta protetta (non sta nella chat). */
type ContractAction = { kind: 'contract'; at: string; contract: { id: string; title: string; recipient: string; status: string; channel: string } }
type Action = { kind: 'post'; post: Post } | { kind: 'image'; url: string; note: string } | SentAction | WebImagesAction | AutomationAction | ProspectAction | DocumentAction | PendingAction | ContractAction
type Target = { postId: string; slide: number; thumb?: string; slides?: number[] }
type Turn = { role: 'user' | 'assistant'; text: string; images?: string[]; target?: Target; actions?: Action[]; at: string }
type Attachment = { id: string; thumb: string; url: string | null; error?: string }
type Connection = { platform: string; status: string; canPublish?: boolean }

const EXAMPLES = [
  'Crea un post con queste foto per il pranzo di domenica',
  'Rendi più luminosa questa foto e mettila in un post',
  'Programma il post per giovedì alle 18:30',
  'Che proposte di collaborazione abbiamo ricevuto oggi?',
  'Preparami il contratto per la collaborazione di cui ho parlato con Giusy su Instagram',
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

const WHATSAPP_NUMBER = '393514206353'
const activationUrl = (email: string | null) =>
  `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(`Ciao, vorrei attivare l’assistente AI di Facevoice AI per il mio account${email ? ` (${email})` : ''}.`)}`

export default function AssistantPage() {
  const { assistant } = useWorkspace()
  // null: non si sa (lettura non riuscita): decide il server, che risponde 403 se e' spento.
  return assistant === false ? <AssistantLocked /> : <AssistantChat />
}

/** Assistente non attivo per questa persona: come chiederlo. */
function AssistantLocked() {
  const { email, refreshAssistant } = useWorkspace()
  // Tornando sulla pagina (es. dopo aver scritto su WhatsApp) si ricontrolla.
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && refreshAssistant()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refreshAssistant])
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--background-secondary)]">
        <Lock className="h-5 w-5 text-[var(--accent-blue)]" />
      </span>
      <h1 className="mt-5 text-2xl font-extrabold">L’assistente AI non è attivo per il tuo account.</h1>
      <p className="mt-2 text-[var(--text-secondary)]">Scrivici e lo attiviamo per te.</p>
      <a
        href={activationUrl(email)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#25D366] px-5 py-3 font-bold text-white"
      >
        <MessageCircle className="h-5 w-5" /> Scrivici su WhatsApp
      </a>
      <Link href="/app/omnichat" className="mt-4 text-sm font-semibold text-[var(--accent-blue)]">
        Vai all’Omnichat →
      </Link>
    </div>
  )
}

function AssistantChat() {
  const { appFetch, workspace, automations } = useWorkspace()
  // Con le Automazioni attive anche un esempio di email programmata.
  const examples = automations === true ? [...EXAMPLES, 'Ogni lunedì alle 9 manda un’email a mario@esempio.it con le novità della settimana'] : EXAMPLES
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
      if (saved) {
        // Scelta salvata con un modello che non c'e' piu' (es. Claude Haiku 4.5): quello che lo sostituisce.
        const choice = asModelChoice(saved)
        setModel(choice)
        if (choice !== saved) localStorage.setItem(MODEL_KEY, choice)
      }
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

  // Foto allegate con il pulsante, incollate (Ctrl+V) o trascinate nella chat: al massimo 10.
  const addFiles = async (files: FileList | File[] | null) => {
    if (!files || !files.length) return
    const list = Array.from(files).filter(looksLikeImage).slice(0, Math.max(0, 10 - attachments.length))
    for (const file of list) {
      let prepared
      try {
        prepared = await prepareImage(file)
      } catch (e) {
        // Foto che il browser non apre (es. HEIC fuori da Safari): si dice perche', invece di ignorarla.
        setError(e instanceof Error ? e.message : 'Immagine non leggibile')
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
  const [dragging, setDragging] = useState(false)

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
    // La richiesta ha usato l'AI: il gettone del consumo si aggiorna.
    refreshUsage()
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
    <div
      className={`-mx-4 -my-6 flex min-h-[calc(100dvh-8.5rem)] flex-col md:-mx-8 md:-my-10 md:min-h-[100dvh] ${dragging ? 'outline-dashed outline-2 -outline-offset-8 outline-[var(--accent-blue)]' : ''}`}
      onDragOver={(e) => {
        if (!canManage || !Array.from(e.dataTransfer.types).includes('Files')) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false)
      }}
      onDrop={(e) => {
        if (!canManage || !e.dataTransfer.files.length) return
        e.preventDefault()
        setDragging(false)
        addFiles(e.dataTransfer.files)
      }}
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border-color)] px-4 py-3 md:px-8">
        <div className="flex min-w-0 items-center gap-2">
          <h1 translate="no" className="flex items-center gap-2 text-2xl font-extrabold">
            <Sparkles className="h-5 w-5 text-[var(--accent-blue)]" /> FacevoiceAI
          </h1>
          {/* Consumo dell'AI: solo il gettone acceso (mai euro). */}
          <UsageTokens />
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
              {examples.map((e) => (
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
                  {turn.actions?.map((action, k) =>
                    action.kind === 'pending' ? (
                      <ConfirmCard key={`c${action.pending.id}`} action={action} canManage={canManage} chatBusy={busy} onTurns={setTurns} onReload={load} />
                    ) : action.kind === 'document' ? (
                      <DocumentCard key={`d${k}`} action={action} />
                    ) : action.kind === 'contract' ? (
                      <ContractShareCard key={`k${k}`} action={action} />
                    ) : action.kind === 'message' ? (
                      <SentMessageCard key={`m${k}`} action={action} />
                    ) : action.kind === 'automation' ? (
                      <AutomationActionCard key={`a${k}`} action={action} />
                    ) : action.kind === 'prospect' ? (
                      <ProspectActionCard key={`p${k}`} action={action} />
                    ) : action.kind === 'web_images' ? (
                      // Con il post fatto da queste immagini basta l'anteprima (con le fonti sotto).
                      turn.actions?.some((a) => a.kind === 'post') ? null : (
                        <WebImagesCard key={`w${k}`} action={action} />
                      )
                    ) : action.kind === 'post' ? (
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
                  {m.label} · {m.customerHint}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-1" aria-hidden="true">▾</span>
          </label>
          <div className="flex items-end gap-2 rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-2">
            <input ref={fileRef} type="file" accept="image/*,.heic,.heif" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
            <button onClick={() => fileRef.current?.click()} disabled={attachments.length >= 10} aria-label="Allega foto" className="p-2 text-[var(--text-secondary)] disabled:opacity-40">
              <ImagePlus className="h-5 w-5" />
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={(e) => {
                const pasted = Array.from(e.clipboardData.files || []).filter(looksLikeImage)
                if (!pasted.length) return
                e.preventDefault()
                addFiles(pasted)
              }}
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
    if (['edit_slides', 'edit_caption', 'extract', 'restore'].includes(action)) refreshUsage()
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
              onClick={() => !done && canManage && !working && !looksLikeVideo(url) && toggleSlide(i)}
              aria-label={`Slide ${n + 1}${on ? ' (selezionata)' : ''}`}
              aria-pressed={on}
              className="relative shrink-0 snap-start"
            >
              {looksLikeVideo(url) ? (
                <video src={url} muted loop autoPlay playsInline preload="metadata" className="h-52 w-[166px] rounded-lg border border-[var(--border-color)] bg-black object-cover" />
              ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt={`Immagine ${n + 1}`}
                loading="lazy"
                className={`h-52 w-[166px] rounded-lg object-cover ${on ? 'ring-4 ring-[var(--accent-blue)]' : 'border border-[var(--border-color)]'} ${busy === 'arrange' || (busy === 'edit_slides' && on) ? 'opacity-50' : ''}`}
              />
              )}
              <span className={`absolute left-1.5 top-1.5 rounded-full px-1.5 text-[11px] font-semibold ${on ? 'bg-[var(--accent-blue)] text-white' : 'bg-black/55 text-white'}`}>{n + 1}</span>
              {on && <Check className="absolute right-1.5 top-1.5 h-5 w-5 rounded-full bg-[var(--accent-blue)] p-0.5 text-white" />}
            </button>
          )
        })}
      </div>
      {post.webSources?.length ? <WebSourcesNote sources={post.webSources} /> : null}
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

/** Avviso sotto l'anteprima: immagini prese dal web, da verificare, con i link alle pagine da cui vengono. */
function WebSourcesNote({ sources }: { sources: WebSource[] }) {
  return (
    <p className="mt-2 rounded-xl bg-[#FF9500]/10 px-3 py-2 text-xs text-[var(--text-secondary)]">
      Immagini prese dal web: verifica di poterle usare. Fonti:{' '}
      {sources.map((s, k) => (
        <span key={s.url}>
          {k > 0 ? ', ' : ''}
          <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" translate="no" className="font-medium text-[var(--accent-blue)] underline-offset-2 hover:underline">
            {s.site}
          </a>
        </span>
      ))}
    </p>
  )
}

/** Eventi e immagini trovati sul web (quando non ne e' ancora nato un post): immagine, nome, date e credito. */
function WebImagesCard({ action }: { action: WebImagesAction }) {
  const sources = [...new Map(action.items.map((it) => [it.image_source_url, { url: it.image_source_url, site: it.image_source_domain }])).values()]
  return (
    <div className="mt-3 w-full max-w-xl rounded-2xl border border-[var(--border-color)] p-3">
      <p className="text-sm font-semibold">Immagini trovate sul web</p>
      <div className="mt-2 flex snap-x gap-2 overflow-x-auto pb-1">
        {action.items.map((it) => (
          <a key={it.image_url} href={it.image_source_url} target="_blank" rel="noopener noreferrer nofollow" className="w-32 shrink-0 snap-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={it.image_url} alt={it.title} loading="lazy" className="h-40 w-32 rounded-lg border border-[var(--border-color)] object-cover" />
            <span translate="no" className="mt-1 line-clamp-2 block text-xs font-medium text-[var(--text-primary)]">
              {it.title}
            </span>
            {it.dates ? (
              <span translate="no" className="block text-[11px] text-[var(--text-secondary)]">
                {it.dates}
              </span>
            ) : null}
            <span translate="no" className="block truncate text-[10px] text-[var(--text-secondary)]">
              {it.credit}
            </span>
          </a>
        ))}
      </div>
      <WebSourcesNote sources={sources} />
    </div>
  )
}

const CHANNEL_NAMES: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', email: 'email', whatsapp: 'WhatsApp' }
const CHANNEL_ICONS: Record<string, typeof Mail> = { instagram: Instagram, facebook: Facebook, email: Mail, whatsapp: MessageCircle }

/** Messaggio partito dall'assistente: a chi, su quale canale, il testo e il link alla conversazione. */
function SentMessageCard({ action }: { action: SentAction }) {
  const Icon = CHANNEL_ICONS[action.platform] || MessageCircle
  const href = `/app/omnichat?${new URLSearchParams({ platform: action.platform, contact: action.contactId })}`
  return (
    <div className="mt-3 w-full max-w-md rounded-2xl border border-[var(--border-color)] p-3">
      <p className="flex items-start gap-2 text-sm font-semibold">
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#34C759]" />
        <span className="min-w-0">
          Messaggio inviato a <span translate="no">{action.name}</span> su {CHANNEL_NAMES[action.platform] || action.platform}
          {action.via === 'comment' ? <span className="font-normal text-[var(--text-secondary)]"> · risposta privata al commento</span> : null}
        </span>
      </p>
      {action.subject ? (
        <p className="mt-1 truncate text-xs text-[var(--text-secondary)]">
          Oggetto: <span translate="no">{action.subject}</span>
        </p>
      ) : null}
      <p translate="no" className="mt-2 whitespace-pre-wrap break-words rounded-2xl bg-[var(--accent-blue)] px-3 py-2 text-sm text-white">
        {action.text}
      </p>
      <Link href={href} className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--accent-blue)]">
        <Icon className="h-4 w-4" /> Apri la conversazione in Omnichat
      </Link>
    </div>
  )
}

const PROSPECT_TITLES: Record<ProspectAction['op'], string> = {
  settings: 'Trova clienti salvato',
  search: 'Ricerca avviata',
  approved: 'Email approvata',
  sent: 'Email inviata',
  discarded: 'Email scartata',
  blocked: 'Non contattare',
}

function ProspectActionCard({ action }: { action: ProspectAction }) {
  const p = action.prospect
  const good = action.op === 'sent' || action.op === 'approved' || action.op === 'settings'
  return (
    <div className="mt-3 w-full max-w-md rounded-2xl border border-[var(--border-color)] p-3">
      <p className="flex items-start gap-2 text-sm font-semibold">
        {good ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#34C759]" /> : action.op === 'search' ? <Search className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-blue)]" /> : <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-[#ff6b6b]" />}
        <span className="min-w-0">
          {PROSPECT_TITLES[action.op]}
          {p.count ? ` (${p.count})` : ''}: <span translate="no">{p.name}</span>
        </span>
      </p>
      <div className="mt-2 space-y-1 text-xs text-[var(--text-secondary)]">
        {p.email ? (
          <p className="truncate">
            A: <span translate="no" className="text-[var(--text-primary)]">{p.email}</span>
          </p>
        ) : null}
        {p.subject ? (
          <p className="truncate">
            Oggetto: <span translate="no">{p.subject}</span>
          </p>
        ) : null}
        {p.note ? <p>{p.note}</p> : null}
      </div>
      <Link href="/app/automazioni#trova-clienti" className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--accent-blue)]">
        <Zap className="h-4 w-4" /> Apri Trova clienti
      </Link>
    </div>
  )
}

const AUTOMATION_TITLES: Record<AutomationAction['op'], string> = {
  created: 'Email programmata',
  updated: 'Automazione modificata',
  paused: 'Automazione in pausa',
  resumed: 'Automazione ripresa',
  deleted: 'Automazione eliminata',
}

/** Email programmata dall'assistente: i dati salvati (destinatari, quando, da quale casella) e il link alla pagina. */
function AutomationActionCard({ action }: { action: AutomationAction }) {
  const a = action.automation
  const deleted = action.op === 'deleted'
  // Una volta sola: "Quando" dice gia' giorno e ora; ogni giorno: anche il prossimo invio.
  const once = a.when.startsWith('una volta')
  const next = a.nextRun
    ? `${new Date(a.nextRun).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', weekday: 'long', day: 'numeric', month: 'long' })} alle ${new Date(a.nextRun).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' })}`
    : null
  return (
    <div className="mt-3 w-full max-w-md rounded-2xl border border-[var(--border-color)] p-3">
      <p className="flex items-start gap-2 text-sm font-semibold">
        {deleted ? (
          <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-[#ff6b6b]" />
        ) : action.op === 'paused' ? (
          <Pause className="mt-0.5 h-4 w-4 shrink-0 text-[#FF9500]" />
        ) : (
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#34C759]" />
        )}
        <span className="min-w-0">
          {AUTOMATION_TITLES[action.op]}: <span translate="no">{a.name}</span>
        </span>
      </p>
      {!deleted && (
        <div className="mt-2 space-y-1 text-xs text-[var(--text-secondary)]">
          <p className="break-words">
            A: <span translate="no" className="text-[var(--text-primary)]">{a.recipients.join(', ')}</span>
            {a.recipients.length > 1 ? ' · una email per destinatario' : ''}
          </p>
          <p>
            Quando: <span className="text-[var(--text-primary)]">{a.when}</span> (ora italiana)
          </p>
          {!a.active ? (
            <p>In pausa</p>
          ) : next && !once ? (
            <p>
              Prossimo invio: <span className="font-semibold text-[var(--text-primary)]">{next}</span>
            </p>
          ) : null}
          {a.from ? (
            <p className="truncate">
              Invia da: <span translate="no" className="text-[var(--text-primary)]">{a.from}</span>
            </p>
          ) : null}
          {a.subject ? (
            <p className="truncate">
              Oggetto: <span translate="no">{a.subject}</span>
            </p>
          ) : null}
          {a.mode === 'ai' ? <p>Testo scritto dall’AI a ogni invio</p> : null}
        </div>
      )}
      <Link href="/app/automazioni" className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--accent-blue)]">
        <Zap className="h-4 w-4" /> Apri le Automazioni
      </Link>
    </div>
  )
}

const DOC_KIND_NAMES: Record<DocumentAction['document']['kind'], string> = { contratto: 'Contratto', preventivo: 'Preventivo', accordo: 'Accordo', lettera: 'Lettera', altro: 'Documento' }
const DOC_DISCLAIMER = 'Non sono un avvocato e non posso garantire che il documento sia corretto o valido: fallo controllare da un professionista prima di firmarlo o inviarlo.'
const SIGNATURE_NOTE = 'La firma è una firma elettronica semplice: valida per molti accordi privati, non per gli atti che richiedono la firma qualificata o l’atto notarile.'

/** Contratto condiviso: apri la pagina del contratto o copia il link (dalla rotta protetta: mai nella chat). */
function ContractShareCard({ action }: { action: ContractAction }) {
  const { appFetch } = useWorkspace()
  const k = action.contract
  const [note, setNote] = useState<string | null>(null)
  const copy = async () => {
    setNote(null)
    const res = await appFetch(`/api/app/contracts?id=${encodeURIComponent(k.id)}&link=1`).catch(() => null)
    const data = res?.ok ? await res.json().catch(() => null) : null
    if (!data?.link) return setNote('Nessun link attivo: condividilo di nuovo dalla pagina del contratto.')
    try {
      await navigator.clipboard.writeText(data.link)
      setNote('Link copiato. Il PIN mandalo a parte.')
    } catch {
      window.prompt('Copia il link:', data.link)
    }
  }
  return (
    <div className="mt-3 w-full max-w-md rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-3">
      <p className="flex items-start gap-2 text-sm font-semibold">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-blue)]" />
        <span translate="no" className="min-w-0 break-words">{k.title}</span>
      </p>
      <p className="mt-0.5 pl-6 text-xs text-[var(--text-secondary)]">
        Per <span translate="no">{k.recipient}</span> · link protetto da PIN · {k.channel === 'link' || k.channel === 'whatsapp' ? 'da copiare' : CHANNEL_NAMES[k.channel] || k.channel}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href={`/app/contratti/${k.id}`} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-[var(--accent-blue)] px-4 py-2 text-sm font-semibold text-white">
          <ExternalLink className="h-4 w-4" /> Apri contratto
        </Link>
        <button onClick={copy} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--background)] px-4 py-2 text-sm">
          <FileText className="h-4 w-4" /> Copia link
        </button>
      </div>
      {note && <p className="mt-2 text-xs text-[var(--text-secondary)]">{note}</p>}
    </div>
  )
}

/** Nome del file dal server (Content-Disposition), altrimenti dal titolo. */
function fileNameFrom(res: Response, title: string): string {
  const match = (res.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)
  if (match) return match[1]
  return `${title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'documento'}.pdf`
}

/**
 * App aperta dalla schermata Home (iPhone «Aggiungi alla schermata Home»): le schede nuove si aprono
 * fuori dall'app e non vedono i file creati qui (un blob: resterebbe una pagina bianca).
 */
function isStandalone(): boolean {
  try {
    return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
  } catch {
    return false
  }
}

/** Salva il file con il nome giusto (link con download), senza lasciare la pagina. */
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000)
}

/**
 * Foglio di condivisione con il PDF (su iPhone: anteprima, Stampa, Salva su File...). share() parte
 * subito, nel tocco: "blocked" se il telefono vuole un tocco nuovo, "unsupported" se non si puo'.
 */
async function sharePdf(file: File, title: string): Promise<'shared' | 'cancelled' | 'blocked' | 'unsupported'> {
  try {
    if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function' || !navigator.canShare({ files: [file] })) return 'unsupported'
    await navigator.share({ files: [file], title })
    return 'shared'
  } catch (error) {
    const name = (error as Error)?.name
    return name === 'AbortError' ? 'cancelled' : name === 'NotAllowedError' ? 'blocked' : 'unsupported'
  }
}

/**
 * Documento scritto dall'assistente: titolo, tipo, da quale conversazione viene, pagine, parti
 * da completare, «Apri PDF» (nuova scheda: su iPhone il visore PDF con condividi, stampa e salva;
 * nell'app aperta dalla schermata Home il foglio di condivisione con il PDF) e «Scarica».
 * Il PDF arriva dalla rotta protetta (con il token): mai un link pubblico.
 */
function DocumentCard({ action }: { action: DocumentAction }) {
  const { appFetch } = useWorkspace()
  const d = action.document
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** PDF gia' scaricato che il telefono vuole aprire con un tocco nuovo (app dalla schermata Home). */
  const [ready, setReady] = useState<File | null>(null)
  const older = (d.versions || []).filter((v) => v.n !== d.version).sort((a, b) => b.n - a.n)
  const latest = Math.max(d.version, ...(d.versions || []).map((v) => v.n))

  /** Condivide il PDF; se non si puo' lo salva. Mai la pagina dell'app sostituita dal PDF. */
  const shareOrSave = async (file: File) => {
    const shared = await sharePdf(file, d.title)
    if (shared === 'blocked') {
      setReady(file)
      return
    }
    setReady(null)
    if (shared === 'unsupported') saveBlob(file, file.name)
  }

  const openPdf = async (version: number, download: boolean) => {
    if (busy) return
    setError(null)
    setReady(null)
    const standalone = isStandalone()
    // La nuova scheda si apre subito (nel tocco), il PDF ci arriva appena pronto: cosi' il telefono non la blocca.
    const win = download || standalone ? null : window.open('', '_blank')
    setBusy(`${version}:${download ? 'd' : 'o'}`)
    const res = await appFetch(`/api/app/assistant/documents?id=${encodeURIComponent(d.id)}&v=${version}${download ? '&download=1' : ''}`).catch(() => null)
    if (!res?.ok) {
      win?.close()
      setBusy(null)
      const data = res ? await res.json().catch(() => null) : null
      setError(data?.error || 'PDF non disponibile, riprova.')
      return
    }
    const name = fileNameFrom(res, d.title)
    const blob = new Blob([await res.blob()], { type: 'application/pdf' })
    if (standalone) {
      // App dalla schermata Home: foglio di condivisione con il PDF (anteprima, stampa, salva), altrimenti si salva.
      await shareOrSave(new File([blob], name, { type: 'application/pdf' }))
    } else if (download || !win) {
      // Scarica, oppure la nuova scheda e' stata bloccata: si salva il file (la chat resta aperta).
      saveBlob(blob, name)
    } else {
      const url = URL.createObjectURL(blob)
      win.location.href = url
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000)
    }
    setBusy(null)
  }

  const Icon = d.about ? CHANNEL_ICONS[d.about.platform] || MessageCircle : null
  return (
    <div className="mt-3 w-full max-w-md rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-blue)]/15">
          <FileText className="h-5 w-5 text-[var(--accent-blue)]" />
        </span>
        <div className="min-w-0 flex-1">
          <p translate="no" className="break-words text-sm font-semibold">
            {d.title}
          </p>
          <p className="text-xs text-[var(--text-secondary)]">
            {DOC_KIND_NAMES[d.kind] || 'Documento'} · {d.pages} {d.pages === 1 ? 'pagina' : 'pagine'}
            {latest > 1 ? ` · versione ${d.version}` : ''}
          </p>
        </div>
      </div>
      {d.missing ? (
        <p className="mt-2 text-xs text-[var(--text-secondary)]">Documento non più disponibile.</p>
      ) : (
        <>
          {d.about && Icon ? (
            <Link
              href={`/app/omnichat?${new URLSearchParams({ platform: d.about.platform, contact: d.about.contactId })}`}
              className="mt-2 inline-flex max-w-full items-center gap-1.5 text-xs text-[var(--text-secondary)]"
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                Dalla conversazione con <span translate="no" className="font-medium text-[var(--text-primary)]">{d.about.name}</span> su {CHANNEL_NAMES[d.about.platform] || d.about.platform}
              </span>
            </Link>
          ) : null}
          {d.version < latest ? <p className="mt-1 text-xs text-[#FF9500]">C’è una versione più nuova più sotto.</p> : null}
          {d.placeholders.length > 0 && (
            <div className="mt-2 rounded-xl bg-[#FF9500]/10 px-3 py-2 text-xs">
              <p className="font-semibold text-[var(--text-primary)]">Spazi vuoti da compilare (a mano o nella pagina del contratto):</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[var(--text-secondary)]">
                {d.placeholders.slice(0, 6).map((p) => (
                  <li key={p} className="break-words">
                    {p.replace(/^\[DA COMPLETARE:?\s*|\]$/g, '')}
                  </li>
                ))}
                {d.placeholders.length > 6 ? <li>e altre {d.placeholders.length - 6}</li> : null}
              </ul>
            </div>
          )}
          {d.terms && (d.terms.lines.length > 0 || d.terms.missing.length > 0) && (
            <div className={`mt-2 rounded-xl px-3 py-2 text-xs ${d.terms.missing.length ? 'bg-[#FF9500]/10' : 'bg-[var(--background)]'}`}>
              <p className="font-semibold text-[var(--text-primary)]">Termini della collaborazione</p>
              {d.terms.lines.map((l) => (
                <p key={l} className="mt-0.5 break-words text-[var(--text-secondary)]">
                  {l}
                </p>
              ))}
              {d.terms.missing.length > 0 && (
                <p className="mt-0.5 text-[var(--text-secondary)]">
                  Da scegliere nella{' '}
                  <Link href={`/app/contratti/${d.id}`} className="font-medium text-[var(--accent-blue)] underline">
                    pagina del contratto
                  </Link>{' '}
                  prima di condividerlo: {d.terms.missing.map((m) => m.charAt(0).toLowerCase() + m.slice(1)).join(' e ')}.
                </p>
              )}
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => openPdf(d.version, false)}
              disabled={busy !== null}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-[var(--accent-blue)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy === `${d.version}:o` ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />} Apri PDF
            </button>
            <button
              onClick={() => openPdf(d.version, true)}
              disabled={busy !== null}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--background)] px-4 py-2 text-sm disabled:opacity-50"
            >
              {busy === `${d.version}:d` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Scarica
            </button>
          </div>
          {older.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-[var(--text-secondary)]">
              <History className="h-3.5 w-3.5" /> Altre versioni:
              {older.slice(0, 6).map((v) => (
                <button
                  key={v.n}
                  onClick={() => openPdf(v.n, false)}
                  disabled={busy !== null}
                  className="rounded-full border border-[var(--border-color)] px-2 py-0.5 disabled:opacity-50"
                >
                  {busy === `${v.n}:o` ? <Loader2 className="inline h-3 w-3 animate-spin" /> : null} v{v.n}
                </button>
              ))}
            </div>
          )}
          {ready ? (
            <button
              onClick={() => void shareOrSave(ready)}
              className="mt-2 inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-[var(--accent-blue)] px-4 py-2 text-sm font-semibold text-white"
            >
              <FileText className="h-4 w-4" /> PDF pronto: tocca per aprirlo
            </button>
          ) : null}
          <Link href={`/app/contratti/${d.id}`} className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--accent-blue)]">
            <Lock className="h-4 w-4" /> Apri nei Contratti (condividi, modifiche, firme)
          </Link>
          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-[var(--text-secondary)]">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-[#FF9500]" /> {DOC_DISCLAIMER}
          </p>
          <p className="mt-1 flex items-start gap-1.5 text-[11px] text-[var(--text-secondary)]">
            <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" /> {SIGNATURE_NOTE}
          </p>
          {error && <p className="mt-1 text-xs text-[#FF3B30]">{error}</p>}
        </>
      )}
    </div>
  )
}

const PENDING_STATUS: Record<Exclude<PendingAction['pending']['status'], 'pending' | 'done'>, string> = {
  running: 'In corso…',
  failed: 'Non riuscito',
  discarded: 'Scartato: non è partito niente',
  expired: 'Scaduto: non è partito niente. Chiedimelo di nuovo se ti serve.',
  unconfirmed: 'Esito non confermato: controlla prima di riprovare.',
}

/**
 * Scheda di conferma: il contenuto esatto (per chi, canale, testo, orario) e due pulsanti.
 * Solo «Accetta e invia» / «Conferma» fa partire l'azione (una volta sola); «Scarta» non
 * manda niente e l'assistente chiede cosa serve invece. Il testo dei messaggi si può correggere.
 */
function ConfirmCard({
  action,
  canManage,
  chatBusy,
  onTurns,
  onReload,
}: {
  action: PendingAction
  canManage: boolean
  chatBusy: boolean
  onTurns: (turns: Turn[]) => void
  onReload: () => Promise<Turn[]>
}) {
  const { appFetch } = useWorkspace()
  const p = action.pending
  const [text, setText] = useState(p.text || '')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState<'confirm' | 'discard' | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** PIN del contratto: resta solo in questa scheda finche' non si tocca il pulsante (poi si svuota). */
  const [pin, setPin] = useState('')
  const [pinLetters, setPinLetters] = useState(false)
  useEffect(() => {
    setText(p.text || '')
  }, [p.text])
  const open = p.status === 'pending'
  const pinOk = !p.pin || /^[A-Za-z0-9]{4,12}$/.test(pin)

  const act = async (op: 'confirm' | 'discard') => {
    if (busy || chatBusy) return
    if (op === 'confirm' && p.editable && !text.trim()) {
      setError('Il testo è vuoto.')
      return
    }
    if (op === 'confirm' && !pinOk) {
      setError('Scegli un PIN da 4 a 12 caratteri (numeri o lettere).')
      return
    }
    setBusy(op)
    setError(null)
    const typedPin = op === 'confirm' && p.pin ? pin : ''
    setPin('')
    const res = await appFetch('/api/app/assistant/actions', {
      method: 'POST',
      body: JSON.stringify({ id: p.id, op, ...(op === 'confirm' && p.editable && text !== (p.text || '') ? { text } : {}), ...(typedPin ? { pin: typedPin } : {}) }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    setBusy(null)
    if (data?.turns) onTurns(data.turns)
    if (!res) {
      // Connessione caduta: il server puo' aver eseguito lo stesso (mai due volte). Si rilegge la chat.
      setError('Connessione interrotta: controllo l’esito…')
      await onReload()
      setError(null)
      return
    }
    if (!res.ok) setError(data?.error || 'Non riuscito, riprova.')
    else setEditing(false)
  }

  const border = open ? 'border-[var(--accent-blue)]' : p.status === 'done' ? 'border-[#34C759]/50' : p.status === 'failed' ? 'border-[#FF3B30]/50' : 'border-[var(--border-color)]'
  return (
    <div className={`mt-3 w-full max-w-md rounded-2xl border ${border} bg-[var(--background-secondary)] p-3`}>
      <p className="flex items-start gap-2 text-sm font-semibold">
        {p.status === 'done' ? (
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#34C759]" />
        ) : p.status === 'failed' ? (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#FF3B30]" />
        ) : (
          <ShieldCheck className={`mt-0.5 h-4 w-4 shrink-0 ${open ? 'text-[var(--accent-blue)]' : 'text-[var(--text-secondary)]'}`} />
        )}
        <span translate="no" className="min-w-0 break-words">
          {p.title}
        </span>
      </p>
      {open && <p className="mt-0.5 pl-6 text-xs text-[var(--text-secondary)]">Da confermare: non è ancora partito niente.</p>}
      {p.lines.length > 0 && (
        <div className="mt-2 space-y-0.5 text-xs text-[var(--text-secondary)]">
          {p.lines.map((line, k) => (
            <p key={k} className="break-words">
              {line}
            </p>
          ))}
        </div>
      )}
      {p.subject ? (
        <p className="mt-1 truncate text-xs text-[var(--text-secondary)]">
          Oggetto: <span translate="no" className="text-[var(--text-primary)]">{p.subject}</span>
        </p>
      ) : null}
      {p.text !== undefined &&
        (editing && open ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={Math.min(10, Math.max(3, text.split('\n').length + 1))}
            className="mt-2 w-full rounded-xl border border-[var(--accent-blue)] bg-[var(--background)] px-3 py-2 text-sm"
          />
        ) : (
          <p translate="no" className={`mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${p.kind === 'send_message' || p.kind === 'send_document' ? 'bg-[var(--accent-blue)] text-white' : 'bg-[var(--background)]'}`}>
            {open ? text : p.text}
          </p>
        ))}
      {p.document ? (
        <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
          <FileText className="h-3.5 w-3.5" /> PDF allegato: <span translate="no">{p.document.title}</span> (v{p.document.version})
        </p>
      ) : null}
      {open && canManage && p.pin ? (
        <label className="mt-3 block rounded-xl border border-[var(--accent-blue)]/50 bg-[var(--background)] p-3 text-sm">
          <span className="flex items-center gap-1.5 font-semibold">
            <Lock className="h-4 w-4 text-[var(--accent-blue)]" /> PIN per aprire il link
          </span>
          <input
            type="password"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            inputMode={pinLetters ? 'text' : 'numeric'}
            maxLength={p.pin.max}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, p.pin?.max || 12))}
            placeholder={`da ${p.pin.min} a ${p.pin.max} numeri o lettere`}
            className="mt-2 w-full rounded-lg border border-[var(--border-color)] bg-[var(--background-secondary)] px-3 py-2 text-[16px] tracking-widest"
          />
          <button type="button" onClick={() => setPinLetters((l) => !l)} className="mt-1 text-xs text-[var(--accent-blue)]">
            {pinLetters ? 'Solo numeri' : 'Anche lettere'}
          </button>
          <span className="mt-1 block text-[11px] text-[var(--text-secondary)]">
            Non va nel messaggio e non lo salviamo: mandalo a <span translate="no">{p.pin.for}</span> in un altro modo (a voce, SMS, telefonata).
          </span>
        </label>
      ) : null}
      {open && canManage ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => act('confirm')}
              disabled={busy !== null || chatBusy || !pinOk}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-[var(--accent-blue)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy === 'confirm' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {p.confirmLabel}
            </button>
            <button
              onClick={() => act('discard')}
              disabled={busy !== null || chatBusy}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--background)] px-4 py-2 text-sm disabled:opacity-50"
            >
              {busy === 'discard' ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} Scarta
            </button>
            {p.editable && !editing && (
              <button onClick={() => setEditing(true)} disabled={busy !== null} className="ml-auto inline-flex items-center gap-1 p-1 text-xs text-[var(--text-secondary)]">
                <Pencil className="h-3.5 w-3.5" /> Modifica testo
              </button>
            )}
          </div>
          {chatBusy && <p className="mt-1 text-[11px] text-[var(--text-secondary)]">Aspetta la risposta in corso, poi conferma.</p>}
          <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
            Valida fino a {new Date(p.expiresAt).toLocaleString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.
          </p>
        </>
      ) : open ? (
        <p className="mt-2 text-xs text-[var(--text-secondary)]">Può confermarla solo chi l’ha chiesta.</p>
      ) : p.status === 'done' ? (
        <p className="mt-2 text-sm font-semibold text-[#34C759]">
          {p.doneLabel} ✓{p.outcome ? <span className="block text-xs font-normal text-[var(--text-secondary)]">{p.outcome}</span> : null}
        </p>
      ) : (
        <p className={`mt-2 text-xs ${p.status === 'failed' ? 'text-[#FF3B30]' : 'text-[var(--text-secondary)]'}`}>
          {p.status === 'running' ? <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> : null}
          {PENDING_STATUS[p.status as keyof typeof PENDING_STATUS]}
          {p.status === 'failed' && p.outcome ? `: ${p.outcome.replace(/^Non è partito niente:\s*/, '')}` : ''}
        </p>
      )}
      {error && <p className="mt-1 text-xs text-[#FF3B30]">{error}</p>}
    </div>
  )
}
