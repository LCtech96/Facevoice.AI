'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, Check, Facebook, Instagram, Loader2, Mail, Plus, Send, Sparkles, X } from 'lucide-react'
import { getAccessToken } from '@/lib/session-token'

// Super chat dell'admin: una sola conversazione a tutto schermo, come una chat
// con Claude. Dietro c'e' l'assistente della Ricerca clienti con tutti i suoi
// strumenti (clienti, email, siti, Instagram, messaggi social). Niente parte da
// solo: email e messaggi social si inviano con un tocco su "Invia".

type Draft = {
  leadId: string
  name: string
  email: string
  kind: 'first' | 'followup'
  subject: string
  body: string
  threadId?: string | null
}

type SocialAction = {
  kind: 'social_message'
  platform: 'instagram' | 'facebook'
  key: string
  name: string
  text: string
  lastIncomingAt: string | null
  state?: 'sending' | 'sent' | 'error'
  error?: string
}

type Turn = { id: string; role: 'user' | 'assistant'; text: string; actions?: SocialAction[] }

const STORAGE_KEY = 'fv_superchat_v1'
const MAX_TURNS = 80

const EXAMPLES = [
  'Quali aziende della lista hanno Instagram e quanti follower hanno?',
  'Analizza il sito di Cantina e Cucina: che pagine ha e se è aggiornato',
  'Chi mi ha scritto su Instagram negli ultimi giorni?',
  'Prepara le controrisposte a chi ha risposto alle email',
  'Trovami 20 ristoranti a Palermo e preparagli la prima email',
]

async function authFetch(url: string, init: RequestInit = {}) {
  const token = await getAccessToken()
  return fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  })
}

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const clean = (text: string) => text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^\s*\*\s+/gm, '- ')

export default function SuperChat() {
  const [turns, setTurns] = useState<Turn[]>([])
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [, setTick] = useState(0)
  const [sending, setSending] = useState<string | null>(null)
  const [draftsOpen, setDraftsOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const loaded = useRef(false)

  const draftsRef = useRef<Draft[]>([])
  draftsRef.current = drafts
  const selectedRef = useRef<Record<string, boolean>>({})
  selectedRef.current = selected
  const turnsRef = useRef<Turn[]>([])
  turnsRef.current = turns

  // Conversazione e bozze restano dopo un ricaricamento della pagina.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
      if (saved?.turns) setTurns(saved.turns)
      if (saved?.drafts) setDrafts(saved.drafts)
    } catch {}
    loaded.current = true
  }, [])
  useEffect(() => {
    if (!loaded.current) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ turns: turns.slice(-MAX_TURNS), drafts }))
    } catch {}
  }, [turns, drafts])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, busy, status])

  useEffect(() => {
    if (!startedAt) return
    const timer = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(timer)
  }, [startedAt])

  // Campo che cresce con il testo, come nelle chat.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [input])

  const say = (turn: Omit<Turn, 'id'>) => setTurns((t) => [...t, { ...turn, id: newId() }].slice(-MAX_TURNS))

  const readStream = async (res: Response) => {
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data.error || (res.status === 504 ? 'Ci ho messo troppo: riprova, riparto da dove mi sono fermato.' : 'Errore dell’assistente'))
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
    if (!final) throw new Error('Connessione interrotta: riprova.')
    if (final.type === 'error') throw new Error(final.error || 'Errore dell’assistente')
    return final
  }

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
    say({
      role: 'assistant',
      text: `Inviate ${ok} email.${failures.length ? ` Non inviate: ${failures.slice(0, 3).join('; ')}${failures.length > 3 ? '…' : ''}` : ''} Le risposte arriveranno in Messaggi.`,
    })
  }, [])

  const ask = async (message: string, round = 0, original = message) => {
    const text = message.trim()
    if (!text || (busy && round === 0)) return
    setInput('')
    const history = turnsRef.current.slice(-8).map((t) => ({ role: t.role, text: t.text }))
    if (round === 0) say({ role: 'user', text })
    setBusy(true)
    setStatus(round === 0 ? 'Ci penso…' : 'Continuo con il resto…')
    setStartedAt((t) => (round === 0 || !t ? Date.now() : t))
    let again = false
    try {
      const res = await authFetch('/api/admin/leads/assistant', {
        method: 'POST',
        body: JSON.stringify({ message: text, history, drafts: draftsRef.current }),
      })
      const data = await readStream(res)
      say({ role: 'assistant', text: clean(String(data.reply || '')), actions: data.actions?.length ? data.actions : undefined })
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
        if (incoming.length) setDraftsOpen(true)
      }
      again = Boolean(data.more) && round < 5
      if (data.confirmSend && !again) await sendAll()
    } catch (err) {
      say({ role: 'assistant', text: err instanceof Error ? err.message : 'Qualcosa è andato storto, riprova.' })
    }
    if (again) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      return ask(`Continua il lavoro richiesto prima (“${original.trim()}”) con quello che resta.`, round + 1, original)
    }
    setBusy(false)
    setStatus(null)
    setStartedAt(null)
  }

  const updateAction = (turnId: string, index: number, patch: Partial<SocialAction>) =>
    setTurns((list) =>
      list.map((t) =>
        t.id === turnId && t.actions ? { ...t, actions: t.actions.map((a, i) => (i === index ? { ...a, ...patch } : a)) } : t
      )
    )

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
    setTurns([])
  }

  const chosen = drafts.filter((d) => selected[d.leadId] !== false).length

  return (
    <div className="fixed inset-x-0 top-14 md:top-16 bottom-[calc(4.25rem+env(safe-area-inset-bottom,0px))] md:bottom-0 flex flex-col bg-[var(--background)]">
      {/* Messaggi */}
      <div ref={listRef} className="flex-1 overflow-y-auto overscroll-contain">
        <div className="max-w-3xl mx-auto px-4 pt-6 pb-4">
          {turns.length === 0 ? (
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
                  <span className="min-w-0 truncate">{status || 'Ci sto lavorando…'}</span>
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
