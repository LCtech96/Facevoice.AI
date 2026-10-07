'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAssistantChat, type Draft, type Job } from '@/components/useAssistantChat'
import { Check, Loader2, Send, Sparkles, X } from 'lucide-react'

// Barra di chat dell'assistente: si scrive cosa fare ("scrivi a chi non abbiamo
// ancora contattato", "follow-up a chi non ha risposto", "trovami 40 dentisti a
// Palermo") e l'assistente prepara il lavoro. Le email partono solo dopo
// che Luca le ha controllate e ha premuto "Invia".



type Props = {
  authFetch: (url: string, init?: RequestInit) => Promise<Response>
  onRefresh: () => Promise<unknown> | void
  /** Mostra nella lista le schede indicate dall'assistente. */
  onFocus?: (focus: { label: string; ids: string[] }) => void
}

const EXAMPLES = [
  'Scrivi un’email a tutti quelli che non abbiamo ancora contattato',
  'Follow-up a chi non ha risposto, a tutti',
  'Trovami 20 ditte di traslochi a Palermo e preparagli la prima email',
  'Nella bozza per La Canonica cita la carbonara e accorcia',
  'Chi ha risposto? Leggi le risposte e prepara le controrisposte',
]

export default function LeadAssistant({ authFetch, onRefresh, onFocus }: Props) {
  const [input, setInput] = useState('')
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [sending, setSending] = useState<string | null>(null)
  const [, setTick] = useState(0)
  const sendAllRef = useRef<() => Promise<void>>(async () => {})

  // Il lavoro gira sul server: chiudendo o cambiando pagina continua, e qui si
  // ritrova la conversazione com'era. A lavoro finito: lista, filtro e conferma invio.
  const onJobDone = useCallback(
    async (job: Job) => {
      if (job.result?.refresh) await onRefresh()
      if (job.result?.focus?.ids?.length) onFocus?.(job.result.focus)
      if (job.result?.confirmSend) await sendAllRef.current()
    },
    [onRefresh, onFocus]
  )
  const { turns: allTurns, drafts, job, running: busy, error, ask: askServer, setDrafts, appendTurn } = useAssistantChat('leads', onJobDone)
  const turns = allTurns.slice(-8)
  const status = busy ? job?.statusText : null
  const startedAt = busy && job ? new Date(job.startedAt).getTime() : null

  // Contatore dei secondi: si vede che sta lavorando anche tra un aggiornamento e l'altro.
  useEffect(() => {
    if (!busy) return
    const timer = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(timer)
  }, [busy])

  // Mentre lavora la lista dei clienti si aggiorna (nuove schede, stati).
  useEffect(() => {
    if (!busy) return
    const timer = setInterval(() => onRefresh(), 10000)
    return () => clearInterval(timer)
  }, [busy, onRefresh])

  const ask = async (message: string) => {
    if (!message.trim() || busy) return
    setInput('')
    await askServer(message)
  }

  const update = (leadId: string, fields: Partial<Draft>) =>
    setDrafts((list) => list.map((d) => (d.leadId === leadId ? { ...d, ...fields } : d)))

  const draftsRef = useRef<Draft[]>([])
  draftsRef.current = drafts
  const selectedRef = useRef<Record<string, boolean>>({})
  selectedRef.current = selected

  const sendAll = async () => {
    // Legge lo stato piu' recente: puo' essere chiamata subito dopo un aggiornamento delle bozze.
    const queue = draftsRef.current.filter((d) => selectedRef.current[d.leadId] !== false)
    if (!queue.length) return
    if (!window.confirm(`Inviare ${queue.length} email? Partono una alla volta da luca@facevoice.ai.`)) return
    let ok = 0
    const failures: string[] = []
    for (const draft of queue) {
      setSending(`${ok + failures.length + 1}/${queue.length}`)
      const url =
        draft.kind === 'first' ? `/api/admin/leads/${draft.leadId}/send` : `/api/admin/leads/${draft.leadId}/followup`
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
        // Limite giornaliero raggiunto: inutile continuare.
        if (res?.status === 429) break
      }
    }
    setSending(null)
    await appendTurn(
      'assistant',
      `Inviate ${ok} email.${failures.length ? ` Non inviate: ${failures.slice(0, 3).join('; ')}${failures.length > 3 ? '…' : ''}` : ''} Le risposte arriveranno in Messaggi.`
    )
    await onRefresh()
  }
  sendAllRef.current = sendAll

  const isOn = (id: string) => selected[id] !== false
  const chosen = drafts.filter((d) => isOn(d.leadId)).length

  return (
    <section className="mb-5 rounded-2xl border border-[var(--border-color)] bg-[var(--card-background)] p-3 sm:p-4">
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="w-4 h-4 text-[var(--accent-blue)]" />
        <p className="text-sm font-medium text-[var(--text-primary)]">Assistente</p>
        <p className="text-xs text-[var(--text-secondary)] hidden sm:block">Dimmi cosa fare, preparo io il lavoro. Le email partono solo quando premi Invia.</p>
      </div>

      {turns.length > 0 && (
        <div className="mb-3 space-y-2 max-h-56 overflow-y-auto">
          {turns.map((turn, i) => (
            <div key={i} className={`flex ${turn.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <p
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                  turn.role === 'user' ? 'bg-[var(--accent-blue)] text-white' : 'bg-[var(--background-secondary)] text-[var(--text-primary)]'
                }`}
              >
                {turn.text}
              </p>
            </div>
          ))}
          {busy && (
            <p className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              <span>{status || 'Ci sto lavorando…'}</span>
              {startedAt && <span className="ml-auto tabular-nums opacity-70">{Math.floor((Date.now() - startedAt) / 1000)}s</span>}
            </p>
          )}
        </div>
      )}

      {turns.length === 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2 mb-1">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              onClick={() => ask(example)}
              className="shrink-0 px-3 py-1.5 rounded-full border border-[var(--border-color)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              {example}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          ask(input)
        }}
        className="flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder='Es. "scrivi un follow-up a chi non ha ancora risposto"'
          className="flex-1 min-w-0 px-3 py-2.5 rounded-lg bg-[var(--background-secondary)] border border-[var(--border-color)] text-[16px] sm:text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]"
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="px-3 rounded-lg bg-[var(--accent-blue)] text-white disabled:opacity-50"
          aria-label="Invia all'assistente"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </form>

      {error && <p className="mt-2 text-xs text-[#FF3B30]">{error}</p>}

      {drafts.length > 0 && (
        <div className="mt-4 border-t border-[var(--border-color)] pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {drafts.length} bozze da controllare · {chosen} selezionate
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setDrafts([])}
                className="px-3 py-1.5 rounded-lg border border-[var(--border-color)] text-xs text-[var(--text-secondary)]"
              >
                Scarta tutte
              </button>
              <button
                onClick={sendAll}
                disabled={!chosen || sending !== null}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent-blue)] text-white text-xs font-medium disabled:opacity-50"
              >
                {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                {sending ? `Invio ${sending}…` : `Invia ${chosen}`}
              </button>
            </div>
          </div>

          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {drafts.map((draft) => {
              const open = expanded === draft.leadId
              return (
                <div key={draft.leadId} className="rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)]">
                  <div className="flex items-center gap-2 p-2.5">
                    <button
                      onClick={() => setSelected((s) => ({ ...s, [draft.leadId]: s[draft.leadId] === false }))}
                      className={`w-5 h-5 shrink-0 rounded border flex items-center justify-center ${
                        isOn(draft.leadId) ? 'bg-[var(--accent-blue)] border-[var(--accent-blue)]' : 'border-[var(--border-color)]'
                      }`}
                      aria-label={isOn(draft.leadId) ? 'Escludi' : 'Includi'}
                    >
                      {isOn(draft.leadId) && <Check className="w-3.5 h-3.5 text-white" />}
                    </button>
                    <button onClick={() => setExpanded(open ? null : draft.leadId)} className="min-w-0 flex-1 text-left">
                      <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                        {draft.name}{' '}
                        <span className="text-xs font-normal text-[var(--text-secondary)]">
                          · {draft.kind === 'first' ? 'primo contatto' : 'follow-up'} · {draft.email}
                        </span>
                      </p>
                      <p className="text-xs text-[var(--text-secondary)] truncate">{draft.subject}</p>
                    </button>
                    <button
                      onClick={() => setDrafts((list) => list.filter((d) => d.leadId !== draft.leadId))}
                      className="p-1 text-[var(--text-secondary)]"
                      aria-label="Togli dalla lista"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  {open && (
                    <div className="px-2.5 pb-2.5 space-y-2">
                      <input
                        value={draft.subject}
                        onChange={(e) => update(draft.leadId, { subject: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border-color)] text-sm text-[var(--text-primary)]"
                      />
                      <textarea
                        value={draft.body}
                        onChange={(e) => update(draft.leadId, { body: e.target.value })}
                        rows={10}
                        className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border-color)] text-sm text-[var(--text-primary)]"
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}
