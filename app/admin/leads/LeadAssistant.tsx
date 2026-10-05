'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, Send, Sparkles, X } from 'lucide-react'

// Barra di chat dell'assistente: si scrive cosa fare ("scrivi a chi non abbiamo
// ancora contattato", "follow-up a chi non ha risposto", "trovami 40 dentisti a
// Palermo") e l'assistente prepara il lavoro. Le email partono solo dopo
// che Luca le ha controllate e ha premuto "Invia".

type Draft = {
  leadId: string
  name: string
  email: string
  kind: 'first' | 'followup'
  subject: string
  body: string
  threadId?: string | null
}

type Turn = { role: 'user' | 'assistant'; text: string }

type Props = {
  authFetch: (url: string, init?: RequestInit) => Promise<Response>
  onRefresh: () => Promise<void> | void
}

const EXAMPLES = [
  'Scrivi un’email a tutti quelli che non abbiamo ancora contattato',
  'Follow-up a chi non ha risposto, a tutti',
  'Trovami 20 ditte di traslochi a Palermo e preparagli la prima email',
  'Nella bozza per La Canonica cita la carbonara e accorcia',
  'Chi ha risposto? Leggi le risposte e prepara le controrisposte',
]

export default function LeadAssistant({ authFetch, onRefresh }: Props) {
  const [input, setInput] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sending, setSending] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [, setTick] = useState(0)

  // Contatore dei secondi: si vede che sta lavorando anche tra un aggiornamento e l'altro.
  useEffect(() => {
    if (!startedAt) return
    const timer = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(timer)
  }, [startedAt])

  const say = (role: Turn['role'], text: string) => setTurns((t) => [...t, { role, text }].slice(-8))

  /** Legge la risposta in streaming: righe di stato mentre lavora, poi il risultato. */
  const readStream = async (res: Response) => {
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}))
      throw new Error(
        data.error || (res.status === 504 ? 'Il lavoro ha richiesto troppo tempo: riprova, riparto da dove mi sono fermato.' : 'Errore dell’assistente')
      )
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let final: Record<string, any> | null = null
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        const event = JSON.parse(line)
        if (event.type === 'status') setStatus(event.text)
        else final = event
      }
    }
    if (!final) throw new Error('Connessione interrotta: riprova, riparto da dove mi sono fermato.')
    if (final.type === 'error') throw new Error(final.error || 'Errore dell’assistente')
    return final
  }

  const draftsNow = useRef<Draft[]>([])
  draftsNow.current = drafts

  const ask = async (message: string, round = 0, original = message) => {
    const text = message.trim()
    if (!text || (busy && round === 0)) return
    setInput('')
    const history = turns
    if (round === 0) say('user', text)
    setBusy(true)
    setStatus(round === 0 ? 'Avvio…' : 'Continuo con i rimanenti…')
    setStartedAt((t) => (round === 0 || !t ? Date.now() : t))
    let again = false
    try {
      const res = await authFetch('/api/admin/leads/assistant', {
        method: 'POST',
        body: JSON.stringify({ message: text, history, drafts: draftsNow.current }),
      })
      const data = await readStream(res)
      say('assistant', data.reply)
      const incoming: Draft[] = data.drafts || []
      const removed: string[] = data.removeDrafts || []
      if (incoming.length || removed.length) {
        setDrafts((list) => {
          const map = new Map(list.map((d) => [d.leadId, d]))
          for (const id of removed) map.delete(id)
          for (const d of incoming) map.set(d.leadId, d)
          return [...map.values()]
        })
        setSelected((s) => {
          const next = { ...s }
          for (const id of removed) delete next[id]
          for (const d of incoming) next[d.leadId] = true
          return next
        })
      }
      if (data.refresh) await onRefresh()
      // Tempo della richiesta finito: si riparte da soli (al massimo qualche giro).
      again = Boolean(data.more) && round < 5
      if (data.confirmSend && !again) await sendAll()
    } catch (err) {
      say('assistant', err instanceof Error ? err.message : 'Qualcosa è andato storto, riprova.')
    }
    if (again) {
      // Le bozze appena arrivate devono finire nella richiesta successiva.
      await new Promise((resolve) => setTimeout(resolve, 50))
      return ask(`Continua il lavoro richiesto prima (“${original.trim()}”) con i contatti rimasti.`, round + 1, original)
    }
    setBusy(false)
    setStatus(null)
    setStartedAt(null)
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
    say(
      'assistant',
      `Inviate ${ok} email.${failures.length ? ` Non inviate: ${failures.slice(0, 3).join('; ')}${failures.length > 3 ? '…' : ''}` : ''} Le risposte arriveranno in Messaggi.`
    )
    await onRefresh()
  }

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
