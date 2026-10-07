'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, Check, Facebook, Instagram, Loader2, Mail, Plus, Send, Sparkles, X } from 'lucide-react'
import { authFetch, useAssistantChat, type Job, type SocialAction, type Usage } from '@/components/useAssistantChat'
import { AI_MODEL_CHOICES, modelLabel } from '@/lib/ai-models'

const MODEL_KEY = 'fv_superchat_model'
const fmtTokens = (n: number) => n.toLocaleString('it-IT')
const fmtCost = (cost: number) => (cost <= 0 ? 'gratis' : `$${cost.toFixed(cost < 0.01 ? 4 : 3)}`)
const usedModels = (u: Usage) => Object.keys(u.models).map(modelLabel).filter((v, i, a) => a.indexOf(v) === i).join(' + ')

/** Riga "Gemini Flash · 4.210 token · gratis" sotto le risposte e durante il lavoro. */
function usageLine(u?: Usage) {
  if (!u || !u.calls) return null
  return `${usedModels(u)} · ${fmtTokens(u.input + u.output)} token · ${fmtCost(u.cost)}`
}

// Super chat dell'admin: una sola conversazione a tutto schermo, come una chat
// con Claude. Dietro c'e' l'assistente della Ricerca clienti con tutti i suoi
// strumenti (clienti, email, siti, Instagram, messaggi social). Il lavoro gira
// sul server: si puo' chiudere o cambiare pagina e ritrovare tutto com'era.
// Niente parte da solo: email e messaggi social si inviano con un tocco su "Invia".

const EXAMPLES = [
  'Quali aziende della lista hanno Instagram e quanti follower hanno?',
  'Analizza il sito di Cantina e Cucina: che pagine ha e se è aggiornato',
  'Chi mi ha scritto su Instagram negli ultimi giorni?',
  'Prepara le controrisposte a chi ha risposto alle email',
  'Trovami 20 ristoranti a Palermo e preparagli la prima email',
]

export default function SuperChat() {
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [input, setInput] = useState('')
  const [model, setModel] = useState<string>('auto')

  // Il modello scelto resta per le prossime volte.
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
  const [, setTick] = useState(0)
  const [sending, setSending] = useState<string | null>(null)
  const [draftsOpen, setDraftsOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const sendAllRef = useRef<() => Promise<void>>(async () => {})

  const onJobDone = useCallback((job: Job) => {
    if (job.result?.confirmSend) sendAllRef.current()
  }, [])
  const { turns, drafts, job, running: busy, loaded, error, ask: askServer, setDrafts, appendTurn, updateActions, clearTurns } =
    useAssistantChat('super', onJobDone)

  const draftsRef = useRef(drafts)
  draftsRef.current = drafts
  const selectedRef = useRef<Record<string, boolean>>({})
  selectedRef.current = selected
  const startedAt = busy && job ? new Date(job.startedAt).getTime() : null
  const status = busy ? job?.statusText : null

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns.length, busy, status])

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
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [input])

  const sendAll = useCallback(async () => {
    const queue = draftsRef.current.filter((d) => selectedRef.current[d.leadId] !== false)
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

  // Le nuove bozze compaiono aperte.
  const draftCount = useRef(0)
  useEffect(() => {
    if (drafts.length > draftCount.current) setDraftsOpen(true)
    draftCount.current = drafts.length
  }, [drafts.length])

  const ask = async (message: string) => {
    if (!message.trim() || busy) return
    setInput('')
    await askServer(message, model)
  }

  const updateAction = (turnId: string, index: number, patch: Partial<SocialAction>) => {
    const turn = turns.find((t) => t.id === turnId)
    if (!turn?.actions) return
    updateActions(turnId, turn.actions.map((a, i) => (i === index ? { ...a, ...patch } : a)))
  }

  const sendAction = async (turnId: string, index: number, action: SocialAction) => {
    updateAction(turnId, index, { state: 'sending', error: undefined })
    const res = await authFetch(`/api/admin/inbox/thread?c=${encodeURIComponent(action.key)}`, {
      method: 'POST',
      body: JSON.stringify({ text: action.text, platform: action.platform }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (res?.ok) updateAction(turnId, index, { state: 'sent' })
    else updateAction(turnId, index, { state: 'error', error: data.error || 'Invio non riuscito' })
  }

  const newChat = () => {
    if (busy) return
    if (turns.length && !window.confirm('Iniziare una nuova conversazione? Le bozze non inviate restano.')) return
    clearTurns()
  }

  const chosen = drafts.filter((d) => selected[d.leadId] !== false).length

  // Totale della conversazione: risposte gia' date + lavoro in corso.
  const totalUsage = turns.reduce<Usage>(
    (sum, t) => (t.usage ? { calls: sum.calls + t.usage.calls, input: sum.input + t.usage.input, output: sum.output + t.usage.output, cost: sum.cost + t.usage.cost, models: sum.models } : sum),
    { calls: 0, input: 0, output: 0, cost: 0, models: {} }
  )
  if (busy && job?.usage) {
    totalUsage.calls += job.usage.calls
    totalUsage.input += job.usage.input
    totalUsage.output += job.usage.output
    totalUsage.cost += job.usage.cost
  }

  return (
    <div className="fixed inset-x-0 top-14 md:top-16 bottom-[calc(4.25rem+env(safe-area-inset-bottom,0px))] md:bottom-0 flex flex-col bg-[var(--background)]">
      {/* Messaggi */}
      <div ref={listRef} className="flex-1 overflow-y-auto overscroll-contain">
        <div className="max-w-3xl mx-auto px-4 pt-6 pb-4">
          {!loaded ? (
            <div className="pt-[20vh] flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-[var(--text-secondary)]" />
            </div>
          ) : turns.length === 0 ? (
            <div className="pt-[8vh] text-center">
              <div className="mx-auto w-12 h-12 rounded-2xl bg-[var(--accent-blue)]/15 flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-[var(--accent-blue)]" />
              </div>
              <h1 className="mt-4 text-2xl font-semibold text-[var(--text-primary)]">Cosa facciamo oggi?</h1>
              <p className="mt-2 text-sm text-[var(--text-secondary)] max-w-md mx-auto">
                Clienti, email, siti, Instagram e messaggi: chiedi quello che vuoi. Email e messaggi partono solo quando premi Invia.
              </p>
              <div className="mt-6 grid gap-2 sm:grid-cols-2 text-left">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    onClick={() => ask(example)}
                    className="px-4 py-3 rounded-2xl border border-[var(--border-color)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent-blue)] transition-colors"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {turns.map((turn) =>
                turn.role === 'user' ? (
                  <div key={turn.id} className="flex justify-end">
                    <p className="max-w-[85%] rounded-3xl rounded-br-lg px-4 py-2.5 bg-[var(--background-secondary)] text-[var(--text-primary)] whitespace-pre-wrap text-[15px] leading-relaxed">
                      {turn.text}
                    </p>
                  </div>
                ) : (
                  <div key={turn.id} className="flex gap-3">
                    <div className="shrink-0 mt-0.5 w-7 h-7 rounded-full bg-[var(--accent-blue)]/15 flex items-center justify-center">
                      <Sparkles className="w-3.5 h-3.5 text-[var(--accent-blue)]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-[var(--text-primary)] break-words">{turn.text}</p>
                      {usageLine(turn.usage) && (
                        <p className="mt-1 text-[11px] text-[var(--text-secondary)] opacity-80">{usageLine(turn.usage)}</p>
                      )}
                      {turn.actions?.map((action, i) => (
                        <ActionCard
                          key={i}
                          action={action}
                          onChange={(text) => updateAction(turn.id, i, { text })}
                          onSend={() => sendAction(turn.id, i, action)}
                        />
                      ))}
                    </div>
                  </div>
                )
              )}
              {busy && (
                <div className="flex gap-3 items-center text-sm text-[var(--text-secondary)]">
                  <div className="shrink-0 w-7 h-7 rounded-full bg-[var(--accent-blue)]/15 flex items-center justify-center">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--accent-blue)]" />
                  </div>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{status || 'Ci sto lavorando…'}</span>
                    {usageLine(job?.usage) && <span className="block text-[11px] opacity-80 tabular-nums">{usageLine(job?.usage)}</span>}
                  </span>
                  {startedAt && <span className="ml-auto tabular-nums opacity-70">{Math.floor((Date.now() - startedAt) / 1000)}s</span>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bozze email in attesa */}
      {drafts.length > 0 && (
        <div className="max-w-3xl w-full mx-auto px-4">
          <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-background)] overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2">
              <button onClick={() => setDraftsOpen((o) => !o)} className="flex items-center gap-2 min-w-0 flex-1 text-left">
                <Mail className="w-4 h-4 shrink-0 text-[var(--accent-blue)]" />
                <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                  {drafts.length} bozze email · {chosen} selezionate
                </span>
              </button>
              <button
                onClick={sendAll}
                disabled={!chosen || sending !== null}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--accent-blue)] text-white text-xs font-medium disabled:opacity-50"
              >
                {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                {sending ? `Invio ${sending}` : `Invia ${chosen}`}
              </button>
            </div>
            {draftsOpen && (
              <div className="max-h-[38vh] overflow-y-auto border-t border-[var(--border-color)] divide-y divide-[var(--border-color)]">
                {drafts.map((d) => {
                  const on = selected[d.leadId] !== false
                  return (
                    <div key={d.leadId} className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setSelected((s) => ({ ...s, [d.leadId]: !on }))}
                          className={`w-5 h-5 shrink-0 rounded-md border flex items-center justify-center ${on ? 'bg-[var(--accent-blue)] border-[var(--accent-blue)]' : 'border-[var(--border-color)]'}`}
                          aria-label={on ? 'Escludi' : 'Includi'}
                        >
                          {on && <Check className="w-3.5 h-3.5 text-white" />}
                        </button>
                        <button onClick={() => setExpanded(expanded === d.leadId ? null : d.leadId)} className="min-w-0 flex-1 text-left">
                          <p className="text-sm text-[var(--text-primary)] truncate">{d.name}</p>
                          <p className="text-xs text-[var(--text-secondary)] truncate">
                            {d.kind === 'first' ? 'primo contatto' : 'follow-up'} · {d.subject}
                          </p>
                        </button>
                        <button
                          onClick={() => setDrafts((list) => list.filter((x) => x.leadId !== d.leadId))}
                          className="p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                          aria-label="Togli bozza"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                      {expanded === d.leadId && (
                        <div className="mt-2 space-y-2">
                          <input
                            value={d.subject}
                            onChange={(e) => setDrafts((list) => list.map((x) => (x.leadId === d.leadId ? { ...x, subject: e.target.value } : x)))}
                            className="w-full px-3 py-2 rounded-lg bg-[var(--background-secondary)] border border-[var(--border-color)] text-sm text-[var(--text-primary)]"
                          />
                          <textarea
                            value={d.body}
                            rows={8}
                            onChange={(e) => setDrafts((list) => list.map((x) => (x.leadId === d.leadId ? { ...x, body: e.target.value } : x)))}
                            className="w-full px-3 py-2 rounded-lg bg-[var(--background-secondary)] border border-[var(--border-color)] text-sm text-[var(--text-primary)]"
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Campo di scrittura */}
      <div className="max-w-3xl w-full mx-auto px-4 pt-2 pb-3">
        <div className="mb-1.5 px-1 flex items-center justify-between gap-3 text-[11px] text-[var(--text-secondary)]">
          <label className="relative flex items-center gap-1 min-w-0 flex-1">
            <Sparkles className="w-3 h-3 shrink-0" />
            <select
              value={model}
              onChange={(e) => chooseModel(e.target.value)}
              disabled={busy}
              className="appearance-none w-full min-w-0 bg-transparent pr-4 font-medium text-[var(--text-primary)] focus:outline-none disabled:opacity-60 overflow-hidden text-ellipsis whitespace-nowrap"
              aria-label="Modello AI"
            >
              {AI_MODEL_CHOICES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} · {m.hint}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-0" aria-hidden="true">▾</span>
          </label>
          {totalUsage.calls > 0 && (
            <span className="shrink-0 tabular-nums">
              Chat: {fmtTokens(totalUsage.input + totalUsage.output)} token · {fmtCost(totalUsage.cost)}
            </span>
          )}
        </div>
        {error && <p className="mb-2 px-2 text-xs text-[#FF3B30]">{error}</p>}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            ask(input)
          }}
          className="flex items-end gap-2 rounded-3xl border border-[var(--border-color)] bg-[var(--card-background)] pl-2 pr-2 py-2 focus-within:border-[var(--accent-blue)] transition-colors"
        >
          <button
            type="button"
            onClick={newChat}
            disabled={busy}
            className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--background-secondary)] disabled:opacity-40"
            aria-label="Nuova conversazione"
            title="Nuova conversazione"
          >
            <Plus className="w-5 h-5" />
          </button>
          <textarea
            ref={inputRef}
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
                e.preventDefault()
                ask(input)
              }
            }}
            placeholder="Chiedi qualsiasi cosa…"
            className="flex-1 min-w-0 resize-none bg-transparent py-2 text-[16px] leading-6 text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="shrink-0 w-9 h-9 rounded-full bg-[var(--accent-blue)] text-white flex items-center justify-center disabled:opacity-40"
            aria-label="Invia"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-5 h-5" />}
          </button>
        </form>
      </div>
    </div>
  )
}

function ActionCard({ action, onChange, onSend }: { action: SocialAction; onChange: (text: string) => void; onSend: () => void }) {
  const Icon = action.platform === 'instagram' ? Instagram : Facebook
  const old = action.lastIncomingAt ? Date.now() - new Date(action.lastIncomingAt).getTime() > 24 * 3600_000 : true
  return (
    <div className="mt-3 rounded-2xl border border-[var(--border-color)] bg-[var(--card-background)] p-3">
      <div className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
        <Icon className="w-4 h-4 shrink-0" />
        <span className="font-medium truncate">Messaggio a {action.name}</span>
      </div>
      <textarea
        value={action.text}
        onChange={(e) => onChange(e.target.value)}
        disabled={action.state === 'sent' || action.state === 'sending'}
        rows={3}
        className="mt-2 w-full px-3 py-2 rounded-lg bg-[var(--background-secondary)] border border-[var(--border-color)] text-sm text-[var(--text-primary)]"
      />
      {old && action.state !== 'sent' && (
        <p className="mt-1 text-xs text-[#FF9500]">
          Ti ha scritto più di 24 ore fa: Meta potrebbe rifiutare l’invio.
        </p>
      )}
      {action.error && <p className="mt-1 text-xs text-[#FF3B30]">{action.error}</p>}
      <div className="mt-2 flex justify-end">
        {action.state === 'sent' ? (
          <span className="inline-flex items-center gap-1 text-xs text-[#34C759]">
            <Check className="w-3.5 h-3.5" /> Inviato
          </span>
        ) : (
          <button
            onClick={onSend}
            disabled={action.state === 'sending' || !action.text.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--accent-blue)] text-white text-xs font-medium disabled:opacity-50"
          >
            {action.state === 'sending' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Invia
          </button>
        )}
      </div>
    </div>
  )
}
