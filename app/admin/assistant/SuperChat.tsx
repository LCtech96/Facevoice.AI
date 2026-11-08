'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, Coins, ImagePlus, Loader2, Mic, Plus, Sparkles, X } from 'lucide-react'
import { prepareUploadPhoto, uploadToSignedUrl, type UploadPhoto } from '@/lib/client-image'
import { authFetch, useAssistantChat, type Job, type SocialAction, type Usage } from '@/components/useAssistantChat'
import { useStaffAccess } from '@/components/useStaffAccess'
import { useDictation } from '@/components/useDictation'
import { AI_MODEL_CHOICES, asModelChoice } from '@/lib/ai-models'
import UsageButton from './UsageButton'
import ChatMenu from './ChatMenu'
import DraftsPanel from './DraftsPanel'
import MessageCard from './MessageCard'
import ConfirmCard from './ConfirmCard'
import DocumentCard from './DocumentCard'
import { PostCard, SnapshotCard } from './PostCard'
import { flushSyncedTexts } from './useSyncedText'
import { fmtCost, fmtTokens, usageLine } from './format'

// Super chat dell'admin, con la stessa pagina dell'Assistente della beta: titolo con
// il consumo AI, "Nuova chat" (le chat di prima restano salvate e si riaprono), messaggi,
// schede dei caroselli da correggere slide per slide e campo di scrittura in fondo.
// Dietro c'e' l'assistente della Ricerca clienti con tutti i suoi strumenti (clienti,
// email, siti, Instagram, messaggi social, caroselli). Il lavoro gira sul server: si puo'
// chiudere o cambiare pagina e ritrovare tutto com'era.
// Doppia conferma: email, messaggi, post e cancellazioni preparati dall'assistente
// partono solo con "Accetta e invia" (o "Conferma") sulla scheda. I documenti
// (contratti, preventivi, lettere) si aprono in PDF con un tocco.

const MODEL_KEY = 'fv_superchat_model'
const MAX_IMAGES = 10

/** Foto allegata al prossimo messaggio: caricata subito nello spazio delle immagini (path quando ha finito). */
type Attached = { id: string; thumb: string; path?: string; uploading?: boolean }

const EXAMPLES = [
  'Quali aziende della lista hanno Instagram e quanti follower hanno?',
  'Analizza il sito di Cantina e Cucina: che pagine ha e se è aggiornato',
  'Chi mi ha scritto su Instagram negli ultimi giorni?',
  'Prepara le controrisposte a chi ha risposto alle email',
  'Trovami 20 ristoranti a Palermo e preparagli la prima email',
  'Crea un carosello di 3 slide con questa foto e una call to action finale',
  'Crea un carosello con queste foto, testi sul nostro ultimo progetto, e pubblicalo domani alle 18',
  'Sviluppami il contratto per il lavoro di cui ho parlato con Giusy su Instagram',
]

type PostPreview = Extract<SocialAction, { kind: 'post_preview' }>
type Platform = NonNullable<PostPreview['platforms']>[number]

/** Social scelti da Luca su una scheda di prima, solo tra quelli dove il carosello manca ancora. */
function keepPlatforms(mine?: Platform[], missing?: Platform[]) {
  if (!mine?.length) return missing
  if (!missing?.length) return mine
  const both = mine.filter((p) => missing.includes(p))
  return both.length ? both : missing
}

export default function SuperChat() {
  // Solo lettura per chi non ha il permesso di scrivere alla super chat.
  const staff = useStaffAccess()
  const canUse = staff.can('assistant', 'use')
  const canWrite = staff.loading || canUse
  // Caroselli: modifiche e pubblicazione solo per l'amministratore (come il server).
  const isAdmin = staff.isAdmin
  const viewOnly = !staff.loading && !isAdmin

  const [choice, setChoice] = useState<Record<string, boolean>>({})
  const [input, setInput] = useState('')
  // Immagini allegate al prossimo messaggio (scelte o incollate).
  const [images, setImages] = useState<Attached[]>([])
  const [dragging, setDragging] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const [chatError, setChatError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [model, setModel] = useState<string>('auto')

  // Il modello scelto resta per le prossime volte.
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
  const [, setTick] = useState(0)
  const [sending, setSending] = useState<string | null>(null)
  // Comando vocale: quello che detti si aggiunge al messaggio, poi lo invii.
  const dictation = useDictation((text) => setInput((current) => (current.trim() ? `${current.trim()} ${text}` : text)))
  const sendAllRef = useRef<() => Promise<void>>(async () => {})

  // "Invia le bozze" chiesto in chat non apre piu' la conferma del browser: arriva una scheda di conferma.
  const onJobDone = useCallback((_job: Job) => undefined, [])
  const {
    turns,
    drafts,
    job,
    running: busy,
    loaded,
    error,
    chatId,
    ask: askServer,
    setDrafts,
    appendTurn,
    patchAction,
    newChat: startNewChat,
    openChat,
    listChats,
  } = useAssistantChat('super', onJobDone)

  const draftsRef = useRef(drafts)
  draftsRef.current = drafts
  const choiceRef = useRef<Record<string, boolean>>({})
  choiceRef.current = choice
  const startedAt = busy && job ? new Date(job.startedAt).getTime() : null
  const status = busy ? job?.statusText : null

  // In fondo quando arriva un messaggio, quando inizia o finisce un lavoro e quando si cambia chat.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns.length, busy, chatId])
  // Avanzamento del lavoro: si segue solo chi e' gia' in fondo (chi guarda piu' su resta li').
  useEffect(() => {
    const el = listRef.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [status])

  useEffect(() => {
    if (!busy) return
    const timer = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(timer)
  }, [busy])

  // Campo che cresce con il testo, come nelle chat.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    if (input) el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [input])

  const sendAll = useCallback(async () => {
    const queue = draftsRef.current.filter((d) => choiceRef.current[d.leadId] !== false)
    if (!queue.length) return
    if (!window.confirm(`Inviare ${queue.length} email? Partono una alla volta da luca@facevoice.ai.`)) return
    let ok = 0
    const failures: string[] = []
    for (const draft of queue) {
      setSending(`${ok + failures.length + 1}/${queue.length}`)
      const url = draft.kind === 'first' ? `/api/admin/leads/${draft.leadId}/send` : `/api/admin/leads/${draft.leadId}/followup`
      const res = await authFetch(url, {
        method: 'POST',
        body: JSON.stringify({ subject: draft.subject, body: draft.body, threadId: draft.threadId }),
      }).catch(() => null)
      const data = res ? await res.json().catch(() => ({})) : {}
      if (res?.ok) {
        ok++
        setDrafts((list) => list.filter((d) => d.leadId !== draft.leadId))
      } else {
        failures.push(`${draft.name}: ${data.error || 'errore'}`)
        if (res?.status === 429) break
      }
    }
    setSending(null)
    await appendTurn(
      'assistant',
      `Inviate ${ok} email.${failures.length ? ` Non inviate: ${failures.slice(0, 3).join('; ')}${failures.length > 3 ? '…' : ''}` : ''} Le risposte arriveranno in Messaggi.`
    )
  }, [setDrafts, appendTurn])
  sendAllRef.current = sendAll

  const addImages = async (files: File[]) => {
    const list = files.filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name))
    if (!list.length) return
    setImageError(null)
    const room = MAX_IMAGES - images.length
    if (room <= 0) return setImageError(`Al massimo ${MAX_IMAGES} foto per messaggio.`)
    // Ridotte nel browser (lato lungo max 2048 px, JPEG), poi caricate direttamente: Vercel non accetta richieste grandi.
    const ready: UploadPhoto[] = []
    for (const file of list.slice(0, room)) {
      try {
        ready.push(await prepareUploadPhoto(file))
      } catch (e) {
        setImageError(e instanceof Error ? e.message : 'Questa immagine non si apre: prova con una foto JPG o PNG.')
      }
    }
    if (list.length > room) setImageError(`Al massimo ${MAX_IMAGES} foto per messaggio.`)
    if (!ready.length) return
    setImages((current) => [...current, ...ready.map((p) => ({ id: p.id, thumb: p.thumb, uploading: true }))].slice(0, MAX_IMAGES))
    const drop = (ids: string[], message: string) => {
      setImages((current) => current.filter((x) => !ids.includes(x.id)))
      setImageError(message)
    }
    try {
      const res = await authFetch('/api/admin/leads/assistant/upload', { method: 'POST', body: JSON.stringify({ scope: 'super', count: ready.length }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !Array.isArray(data.uploads)) throw new Error(data.error || 'Caricamento non disponibile, riprova.')
      await Promise.all(
        ready.map(async (photo, i) => {
          const slot = data.uploads[i] as { path: string; signedUrl: string }
          try {
            await uploadToSignedUrl(slot.signedUrl, photo.blob, photo.name)
            setImages((current) => current.map((x) => (x.id === photo.id ? { ...x, path: slot.path, uploading: false } : x)))
          } catch {
            drop([photo.id], 'Una foto non si è caricata: riprova.')
          }
        })
      )
    } catch (e) {
      drop(
        ready.map((p) => p.id),
        e instanceof Error ? e.message : 'Caricamento non riuscito, riprova.'
      )
    }
  }

  const uploading = images.some((img) => img.uploading)

  const ask = async (message: string) => {
    if ((!message.trim() && !images.length) || busy) return
    if (uploading) return setImageError('Aspetta che le foto finiscano di caricarsi.')
    if (dictation.listening) dictation.stop()
    setChatError(null)
    const attached = images.filter((img) => img.path)
    setInput('')
    setImages([])
    const ok = await askServer(
      message,
      model,
      attached.map((img) => ({ path: img.path, thumb: img.thumb }))
    )
    // Invio non riuscito: le immagini tornano nel campo, cosi' non vanno perse.
    if (!ok && attached.length) setImages(attached)
  }

  // Esempio: riempie il campo (come nella beta), poi lo si controlla e si invia.
  const pickExample = (text: string) => {
    setInput(text)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const updateAction = (turnId: string, index: number, patch: Partial<SocialAction> | ((current: SocialAction) => Partial<SocialAction>)) =>
    patchAction(turnId, index, patch)

  const sendMessage = async (turnId: string, index: number, action: Extract<SocialAction, { kind: 'social_message' }>, text: string) => {
    updateAction(turnId, index, { state: 'sending', error: undefined })
    const res = await authFetch(`/api/admin/inbox/thread?c=${encodeURIComponent(action.key)}`, {
      method: 'POST',
      body: JSON.stringify({ text, platform: action.platform }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (res?.ok) updateAction(turnId, index, { state: 'sent' })
    else updateAction(turnId, index, { state: 'error', error: data.error || 'Invio non riuscito' })
  }

  // Richiesta mandata da una scheda (es. "Rifallo modificabile"): non tocca il campo di scrittura.
  const askFromCard = (text: string) => {
    if (busy) return
    setChatError(null)
    void askServer(text, model)
  }

  const newChat = async () => {
    if (busy || !turns.length) return
    if (!window.confirm('Iniziare una nuova conversazione? Questa resta salvata: la riapri dal pulsante con l’orologio. Le bozze email non inviate restano.')) return
    setChatError(null)
    // Prima si salvano i testi appena scritti nelle schede: dopo il cambio non ci sono piu'.
    await flushSyncedTexts()
    const result = await startNewChat()
    if (!result.ok) setChatError(result.error || 'Nuova chat non riuscita, riprova.')
  }

  const switchChat = async (id: string) => {
    setChatError(null)
    await flushSyncedTexts()
    return openChat(id)
  }

  // Lo stesso carosello puo' comparire piu' volte: l'ultima scheda e' quella viva,
  // le precedenti sono versioni di prima (come nella beta). La scheda viva riprende
  // didascalia, testo Facebook e social cambiati da Luca su quelle di prima (carry:
  // si salvano nella scheda viva alla sua prima modifica, poi sono suoi).
  // Documenti: la scheda piu' recente di ogni documento e' l'ultima versione.
  const latestDocs = new Map<string, string>()
  for (const t of turns) t.actions?.forEach((a, i) => a.kind === 'document' && latestDocs.set(a.docId, `${t.id}:${i}`))
  const cards = new Map<string, { turnId: string; index: number; action: PostPreview }[]>()
  for (const t of turns)
    t.actions?.forEach((a, i) => {
      if (a.kind === 'post_preview') cards.set(a.draftId, [...(cards.get(a.draftId) ?? []), { turnId: t.id, index: i, action: a }])
    })
  const live = new Map<string, { turnId: string; index: number; urls: string[]; carry: Partial<PostPreview> | null }>()
  for (const [draftId, list] of cards) {
    const last = list[list.length - 1]
    let carry: Partial<PostPreview> | null = null
    if (!last.action.edited && last.action.state !== 'sent') {
      // La scheda di prima piu' vicina con i testi di Luca (non prima di una pubblicazione).
      for (let k = list.length - 2; k >= 0; k--) {
        const before = list[k].action
        if (before.state === 'sent') break
        if (!before.edited) continue
        carry = { caption: before.caption, facebook: before.facebook, platforms: keepPlatforms(before.platforms, last.action.platforms), edited: true }
        break
      }
    }
    live.set(draftId, { turnId: last.turnId, index: last.index, urls: last.action.urls, carry })
  }
  // I testi ripresi si salvano una volta sola: dopo (scheda gia' edited) vale solo la modifica.
  const patchLive = (turnId: string, index: number, carry: Partial<PostPreview> | null, patch: Partial<PostPreview>) =>
    updateAction(turnId, index, (current) => (carry && current.kind === 'post_preview' && !current.edited ? { ...carry, ...patch } : patch))
  // Versione ripresa da una scheda di prima: la scheda viva lo dice e si porta in vista.
  const [restored, setRestored] = useState<{ draftId: string; at: number } | null>(null)
  const restoreLive = (draftId: string, urls: string[], ok: boolean) => {
    const target = live.get(draftId)
    if (target) patchLive(target.turnId, target.index, target.carry, { urls })
    if (!ok) return
    setRestored({ draftId, at: Date.now() })
    requestAnimationFrame(() =>
      listRef.current?.querySelector(`[data-live-post="${CSS.escape(draftId)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    )
  }

  // Totale della conversazione: risposte gia' date + lavoro in corso.
  const totalUsage = turns.reduce<Usage>(
    (sum, t) =>
      t.usage ? { calls: sum.calls + t.usage.calls, input: sum.input + t.usage.input, output: sum.output + t.usage.output, cost: sum.cost + t.usage.cost, models: sum.models } : sum,
    { calls: 0, input: 0, output: 0, cost: 0, models: {} }
  )
  // Lavoro in corso: solo la parte non ancora scritta nelle risposte (i giri gia' finiti sono gia' sopra).
  if (busy && job?.usage) {
    const done = turns.filter((t) => t.job === job.id && t.usage)
    totalUsage.calls += Math.max(0, job.usage.calls - done.reduce((n, t) => n + t.usage!.calls, 0))
    totalUsage.input += Math.max(0, job.usage.input - done.reduce((n, t) => n + t.usage!.input, 0))
    totalUsage.output += Math.max(0, job.usage.output - done.reduce((n, t) => n + t.usage!.output, 0))
    totalUsage.cost += Math.max(0, job.usage.cost - done.reduce((n, t) => n + t.usage!.cost, 0))
  }
  // Costo della conversazione: lo vede anche chi puo' solo leggere.
  const chatCost =
    totalUsage.calls > 0 ? (
      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] tabular-nums text-[var(--text-secondary)]">
        <Coins className="h-3 w-3" /> Chat: {fmtTokens(totalUsage.input + totalUsage.output)} token · {fmtCost(totalUsage.cost)}
      </span>
    ) : null
  const budgetLine = job?.budget
    ? ` · limite ${[job.budget.tokens ? `${fmtTokens(job.budget.tokens)} token` : '', job.budget.usd ? `$${job.budget.usd}` : ''].filter(Boolean).join(' o ')}`
    : ''

  return (
    // Tra la barra in alto e quella in basso del telefono (che ha due volte lo spazio sicuro di iPhone).
    <div className="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom,0px)+max(0px,env(safe-area-inset-bottom,0px)-0.5rem))] top-[calc(3.5rem+env(safe-area-inset-top,0px))] flex flex-col bg-[var(--background)] text-[var(--text-primary)] md:bottom-0 md:top-16">
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-5xl">
          {/* Titolo con consumo AI, chat salvate e "Nuova chat": resta in alto mentre si scorre. */}
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[var(--border-color)] bg-[var(--background)] px-4 py-3 md:px-8">
            <div className="flex min-w-0 items-center gap-2">
              <h1 translate="no" className="flex shrink-0 items-center gap-2 text-xl font-extrabold md:text-2xl">
                <Sparkles className="h-5 w-5 text-[var(--accent-blue)]" /> Super chat
              </h1>
              <UsageButton />
            </div>
            {canWrite && (
              <div className="flex shrink-0 items-center gap-2 sm:gap-4">
                <ChatMenu busy={busy} onList={listChats} onOpen={switchChat} />
                <button
                  type="button"
                  onClick={newChat}
                  disabled={busy || !turns.length}
                  aria-label="Nuova chat"
                  title="Nuova chat"
                  className="flex items-center gap-1.5 p-1 text-sm text-[var(--text-secondary)] disabled:opacity-40 sm:p-0"
                >
                  <Plus className="h-5 w-5 sm:h-4 sm:w-4" /> <span className="hidden sm:inline">Nuova chat</span>
                </button>
              </div>
            )}
          </div>

          <div className="space-y-5 px-4 py-5 md:px-8">
            {!loaded ? (
              <Loader2 className="h-5 w-5 animate-spin text-[var(--text-secondary)]" />
            ) : !turns.length ? (
              <div className="max-w-xl">
                <p className="text-[var(--text-secondary)]">
                  Scrivimi o dettami cosa vuoi fare: clienti, email, siti, Instagram, messaggi, caroselli e documenti in PDF (contratti, preventivi, lettere). Allega le immagini con il pulsante{' '}
                  <ImagePlus className="inline h-4 w-4" />. Email, messaggi e post partono solo quando premi «Accetta e invia» sulla scheda.
                </p>
                {canWrite && (
                  <div className="mt-4 flex flex-col gap-2">
                    {EXAMPLES.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => pickExample(e)}
                        className="rounded-xl border border-[var(--border-color)] px-3 py-2 text-left text-sm text-[var(--text-primary)] hover:border-[var(--accent-blue)]"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              turns.map((turn) =>
                turn.role === 'user' ? (
                  <div key={turn.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl bg-[var(--background-secondary)] px-4 py-2.5">
                      {turn.images?.some(Boolean) ? (
                        <div className="mb-2 flex flex-wrap justify-end gap-1.5">
                          {turn.images.filter(Boolean).map((src, i) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={i} src={src} alt="Immagine allegata" className="h-20 w-20 rounded-lg object-cover" />
                          ))}
                        </div>
                      ) : null}
                      {turn.text && <p className="whitespace-pre-wrap break-words text-[15px]">{turn.text}</p>}
                    </div>
                  </div>
                ) : (
                  <div key={turn.id} className="flex gap-3">
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent-blue)]/15">
                      <Sparkles className="h-3.5 w-3.5 text-[var(--accent-blue)]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{turn.text}</p>
                      {usageLine(turn.usage) && (
                        <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
                          <Coins className="h-3 w-3 shrink-0" /> {usageLine(turn.usage)}
                        </p>
                      )}
                      {turn.actions?.map((action, i) => {
                        if (action.kind === 'confirm')
                          return (
                            <ConfirmCard
                              key={i}
                              action={action}
                              canConfirm={isAdmin}
                              onUpdate={(patch) => updateAction(turn.id, i, patch)}
                              onDiscarded={canWrite ? (title) => askFromCard(`Ho scartato: ${title}.`) : undefined}
                            />
                          )
                        if (action.kind === 'document')
                          return <DocumentCard key={i} action={action} canOpen={isAdmin} latest={latestDocs.get(action.docId) === `${turn.id}:${i}`} />
                        if (action.kind === 'social_message')
                          return (
                            <MessageCard
                              key={i}
                              action={action}
                              onChange={(text) => updateAction(turn.id, i, { text })}
                              onSend={(text) => sendMessage(turn.id, i, action, text)}
                            />
                          )
                        const current = live.get(action.draftId)
                        const carry = current?.carry ?? null
                        return current && (current.turnId !== turn.id || current.index !== i) ? (
                          <SnapshotCard
                            key={i}
                            action={action}
                            liveUrls={current.urls}
                            canEdit={isAdmin}
                            chatBusy={busy}
                            onRestored={(urls, ok) => restoreLive(action.draftId, urls, ok)}
                          />
                        ) : (
                          <PostCard
                            key={i}
                            action={carry ? { ...action, ...carry } : action}
                            canEdit={isAdmin}
                            viewOnly={viewOnly}
                            chatBusy={busy}
                            restoredAt={restored?.draftId === action.draftId ? restored.at : undefined}
                            onChange={(patch) => patchLive(turn.id, i, carry, patch)}
                            onAsk={canWrite ? askFromCard : undefined}
                          />
                        )
                      })}
                    </div>
                  </div>
                )
              )
            )}
            {busy && (
              <div className="flex items-start gap-3 text-sm text-[var(--text-secondary)]">
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-[var(--accent-blue)]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate">{status || 'Ci sto lavorando…'}</p>
                  {(usageLine(job?.usage) || budgetLine) && (
                    <p className="text-[11px] tabular-nums">
                      {usageLine(job?.usage)}
                      {budgetLine}
                    </p>
                  )}
                </div>
                {startedAt && <span className="shrink-0 text-xs tabular-nums">{Math.floor((Date.now() - startedAt) / 1000)}s</span>}
              </div>
            )}
            {error && <p className="text-sm text-[#FF9500]">{error}</p>}
            {chatError && <p className="text-sm text-[#FF9500]">{chatError}</p>}
          </div>
        </div>
      </div>

      {/* Bozze email e campo di scrittura */}
      <div className="mx-auto w-full max-w-5xl shrink-0 border-t border-[var(--border-color)] bg-[var(--background)] px-4 py-3 md:px-8">
        {drafts.length > 0 && (
          <DraftsPanel
            drafts={drafts}
            choice={choice}
            onChoice={(leadId, on) => setChoice((c) => ({ ...c, [leadId]: on }))}
            setDrafts={setDrafts}
            sending={sending}
            onSend={sendAll}
          />
        )}
        {!canWrite ? (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1">
            <p className="text-sm text-[var(--text-secondary)]">Puoi vedere la conversazione, ma non scrivere alla super chat.</p>
            {chatCost}
          </div>
        ) : (
          <>
            {images.length > 0 && (
              <div className="mb-2 flex gap-2 overflow-x-auto pt-1.5">
                {images.map((img) => (
                  <div key={img.id} className="relative shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.thumb} alt="Anteprima" className={`h-16 w-16 rounded-lg object-cover ${img.uploading ? 'opacity-50' : ''}`} />
                    {img.uploading && <Loader2 className="absolute left-5 top-5 h-6 w-6 animate-spin text-white drop-shadow" />}
                    <button
                      type="button"
                      onClick={() => setImages((list) => list.filter((x) => x.id !== img.id))}
                      aria-label="Togli immagine"
                      className="absolute -right-1.5 -top-1.5 rounded-full bg-[var(--background)] p-0.5 text-[var(--text-primary)] shadow"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="mb-1.5 flex items-center justify-between gap-3 px-1 text-[11px] text-[var(--text-secondary)]">
              {/* Testo piccolo come nella beta; sopra c'e' il menu vero a 16px, trasparente, cosi' iPhone non ingrandisce la pagina. */}
              <label className={`relative flex min-w-0 flex-1 items-center gap-1 ${busy ? 'opacity-60' : ''}`}>
                <Sparkles className="h-3 w-3 shrink-0" />
                <span className="min-w-0 flex-1 truncate pr-4 font-medium text-[var(--text-primary)]" aria-hidden="true">
                  {(() => {
                    const m = AI_MODEL_CHOICES.find((c) => c.id === model) ?? AI_MODEL_CHOICES[0]
                    return `${m.label} · ${m.hint}`
                  })()}
                </span>
                <span className="pointer-events-none absolute right-1" aria-hidden="true">
                  ▾
                </span>
                <select
                  value={model}
                  onChange={(e) => chooseModel(e.target.value)}
                  disabled={busy}
                  aria-label="Modello AI"
                  className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent text-base opacity-0 disabled:cursor-default"
                >
                  {AI_MODEL_CHOICES.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} · {m.hint}
                    </option>
                  ))}
                </select>
              </label>
              {chatCost}
            </div>
            {dictation.error && <p className="mb-1.5 px-1 text-xs text-[#FF3B30]">{dictation.error}</p>}
            {imageError && <p className="mb-1.5 px-1 text-xs text-[#FF3B30]">{imageError}</p>}
            {dictation.listening && <p className="mb-1.5 px-1 text-xs text-[var(--text-secondary)]">Ti ascolto… parla, poi tocca il microfono rosso per fermare e invia.</p>}
            <div
              onDragOver={(e) => {
                if (Array.from(e.dataTransfer?.types || []).includes('Files')) {
                  e.preventDefault()
                  setDragging(true)
                }
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                const files = Array.from(e.dataTransfer?.files || [])
                setDragging(false)
                if (files.length) {
                  e.preventDefault()
                  addImages(files)
                }
              }}
              className={`flex items-end gap-2 rounded-2xl border bg-[var(--background-secondary)] p-2 ${dragging ? 'border-[var(--accent-blue)] ring-2 ring-[var(--accent-blue)]/40' : 'border-[var(--border-color)]'}`}
            >
              <input
                ref={fileRef}
                type="file"
                accept="image/*,.heic,.heif"
                multiple
                className="hidden"
                onChange={(e) => {
                  addImages(Array.from(e.target.files || []))
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={images.length >= MAX_IMAGES}
                aria-label="Allega foto"
                title="Allega fino a 10 foto (puoi anche incollarle o trascinarle qui)"
                className="p-2 text-[var(--text-secondary)] disabled:opacity-40"
              >
                <ImagePlus className="h-5 w-5" />
              </button>
              <textarea
                ref={inputRef}
                value={input}
                rows={1}
                onChange={(e) => setInput(e.target.value)}
                onPaste={(e) => {
                  // Screenshot incollato (Cmd/Ctrl+V o "Incolla" sul telefono): diventa un allegato.
                  const files = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith('image/'))
                  if (files.length) {
                    e.preventDefault()
                    addImages(files)
                  }
                }}
                onKeyDown={(e) => {
                  // Invio manda solo da computer; sul telefono va a capo (si invia con la freccia).
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(min-width: 768px)').matches) {
                    e.preventDefault()
                    ask(input)
                  }
                }}
                placeholder="Chiedi qualcosa…"
                className="max-h-40 min-h-[40px] min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-base text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] md:text-[15px]"
              />
              {dictation.supported && (
                <button
                  type="button"
                  onClick={dictation.toggle}
                  aria-label={dictation.listening ? 'Ferma la dettatura' : 'Detta il messaggio'}
                  title={dictation.listening ? 'Ferma la dettatura' : 'Detta il messaggio'}
                  className={`p-2 ${dictation.listening ? 'animate-pulse text-[#FF3B30]' : 'text-[var(--text-secondary)]'}`}
                >
                  <Mic className="h-5 w-5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => ask(input)}
                disabled={busy || uploading || (!input.trim() && !images.length)}
                aria-label="Invia"
                className="rounded-full bg-[var(--accent-blue)] p-2.5 text-white disabled:opacity-40"
              >
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
