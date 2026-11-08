'use client'

import { useEffect, useState } from 'react'
import { BookPlus, Check, GraduationCap, Loader2, Trash2 } from 'lucide-react'

// "Correzioni imparate": nate da «Correggi» nella casella Messaggi o da una bozza dell'AI
// modificata prima dell'invio (lib/corrections.ts). Restano qui, non tra le voci di
// Memoria, finche' non le trasformi in voce.

type Rule = {
  id: string
  rule: string
  example: { incoming: string; corrected: string; wrong?: string }
  feedback?: string
  learnedOn?: string | null
  createdAt: string
  updatedAt: string
  source: 'manual' | 'edited_draft'
  byAdmin?: boolean
  count?: number
  weight?: number
  active?: boolean
  knowledgeId?: string
}

const CHANNELS: Record<string, string> = { email: 'Email', instagram: 'Instagram', facebook: 'Messenger', whatsapp: 'WhatsApp', web: 'Chat sito' }
const day = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })
const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text)

export default function CorrectionsPanel({
  authFetch,
  readOnly,
  onPromoted,
}: {
  authFetch: (url: string, init?: RequestInit) => Promise<Response>
  readOnly: boolean
  /** Voce di Memoria appena creata da una correzione. */
  onPromoted: (item: unknown) => void
}) {
  const [rules, setRules] = useState<Rule[] | null>(null)
  const [strongWeight, setStrongWeight] = useState(3)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    authFetch('/api/admin/reply-rules')
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Correzioni non caricate')
        setRules(data.rules || [])
        if (typeof data.strongWeight === 'number') setStrongWeight(data.strongWeight)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Correzioni non caricate'))
  }, [authFetch])

  const call = async (r: Rule, init: RequestInit, method = 'PATCH') => {
    setBusy(r.id)
    setError(null)
    setDone(null)
    const res = await authFetch('/api/admin/reply-rules', { method, ...init }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setBusy(null)
    if (!res?.ok) {
      setError(data.error || 'Operazione non riuscita, riprova.')
      return null
    }
    return data
  }

  const replace = (rule: Rule) => setRules((list) => (list || []).map((x) => (x.id === rule.id ? rule : x)))

  const saveText = async (r: Rule) => {
    const data = await call(r, { body: JSON.stringify({ id: r.id, rule: edits[r.id] }) })
    if (!data?.rule) return
    replace(data.rule)
    setEdits((all) => {
      const next = { ...all }
      delete next[r.id]
      return next
    })
    setDone(r.id)
  }

  const toggle = async (r: Rule) => {
    const data = await call(r, { body: JSON.stringify({ id: r.id, active: r.active === false }) })
    if (data?.rule) replace(data.rule)
  }

  const promote = async (r: Rule) => {
    const data = await call(r, { body: JSON.stringify({ id: r.id, action: 'promote' }) })
    if (!data?.rule) return
    replace(data.rule)
    if (data.item) onPromoted(data.item)
  }

  const remove = async (r: Rule) => {
    if (!confirm('Eliminare questa correzione? L’AI non la seguirà più.')) return
    const data = await call(r, { body: JSON.stringify({ id: r.id }) }, 'DELETE')
    if (data) setRules((list) => (list || []).filter((x) => x.id !== r.id))
  }

  const badge = 'rounded-full border border-[var(--border-color)] px-2 py-0.5'

  return (
    <section className="mt-10">
      <h2 className="flex items-center gap-2 text-lg font-bold text-[var(--text-primary)]">
        <GraduationCap className="h-5 w-5 text-[var(--accent-blue)]" /> Correzioni imparate
      </h2>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">
        Nate quando correggi una risposta dell’AI in Messaggi («Correggi») o modifichi una bozza prima di inviarla. L’AI le usa come esempio nei messaggi
        simili, su tutti i canali. Le correzioni simili si sommano: da {strongWeight} (tue) la regola vale più della Memoria su quel punto. Le correzioni del
        team e le bozze modificate contano la metà.
      </p>
      {error && <p className="mt-3 text-sm text-[#FF3B30]">{error}</p>}
      {!rules ? (
        !error && <Loader2 className="mt-4 h-5 w-5 animate-spin text-[var(--text-secondary)]" />
      ) : !rules.length ? (
        <p className="mt-4 rounded-2xl border border-dashed border-[var(--border-color)] p-4 text-sm text-[var(--text-secondary)]">
          Nessuna correzione per ora. In Messaggi tocca «Correggi» su una bozza o su una risposta dell’AI.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rules.map((r) => {
            const value = edits[r.id] ?? r.rule
            const changed = value.trim() !== r.rule
            const strong = (r.weight || 0) >= strongWeight
            const off = r.active === false
            return (
              <li key={r.id} className={`rounded-2xl border border-[var(--border-color)] bg-[var(--card-background)] p-4 ${off ? 'opacity-60' : ''}`}>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                  <span>{day(r.updatedAt)}</span>
                  {r.learnedOn && <span>· da {CHANNELS[r.learnedOn] || r.learnedOn}</span>}
                  {r.source === 'edited_draft' && <span className={badge}>da una bozza modificata</span>}
                  {r.source === 'manual' && !r.byAdmin && <span className={badge}>corretta dal team</span>}
                  {(r.count || 1) > 1 && <span className={badge}>corretta {r.count} volte</span>}
                  {strong && (
                    <span className="rounded-full border border-[var(--accent-blue)] px-2 py-0.5 font-semibold text-[var(--accent-blue)]">vale più della Memoria</span>
                  )}
                  {off && <span className={badge}>disattivata</span>}
                  {r.knowledgeId && <span className={badge}>copiata in Memoria</span>}
                </div>
                <textarea
                  value={value}
                  onChange={(e) => setEdits((all) => ({ ...all, [r.id]: e.target.value }))}
                  readOnly={readOnly}
                  maxLength={400}
                  rows={2}
                  aria-label="Regola"
                  className="mt-2 w-full rounded-xl border border-[var(--border-color)] bg-[var(--background)] p-3 text-[16px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)] md:text-sm"
                />
                <div className="mt-2 space-y-1 text-xs text-[var(--text-secondary)]">
                  {r.example.incoming && (
                    <p>
                      Messaggio: <span translate="no" className="text-[var(--text-primary)]">«{cut(r.example.incoming, 200)}»</span>
                    </p>
                  )}
                  {r.example.wrong && (
                    <p>
                      Risposta dell’AI: <span translate="no" className="line-through">«{cut(r.example.wrong, 200)}»</span>
                    </p>
                  )}
                  {r.feedback && (
                    <p>
                      Cosa non andava: <span className="text-[var(--text-primary)]">«{cut(r.feedback, 200)}»</span>
                    </p>
                  )}
                  {r.example.corrected && (
                    <p>
                      Risposta giusta: <span translate="no" className="text-[var(--text-primary)]">«{cut(r.example.corrected, 300)}»</span>
                    </p>
                  )}
                </div>
                {!readOnly && (
                  <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                    {done === r.id && (
                      <span className="mr-auto flex items-center gap-1 text-sm text-[#34C759]">
                        <Check className="h-4 w-4" /> Salvata
                      </span>
                    )}
                    {!r.knowledgeId && (
                      <button
                        onClick={() => promote(r)}
                        disabled={busy === r.id}
                        title="Copia la regola (con l’esempio) tra le voci di Memoria"
                        className="flex items-center gap-1.5 rounded-full border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-primary)] disabled:opacity-40"
                      >
                        <BookPlus className="h-3.5 w-3.5" /> Trasforma in voce di Memoria
                      </button>
                    )}
                    <button
                      onClick={() => toggle(r)}
                      disabled={busy === r.id}
                      className="rounded-full border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-primary)] disabled:opacity-40"
                    >
                      {off ? 'Attiva' : 'Disattiva'}
                    </button>
                    <button
                      onClick={() => remove(r)}
                      disabled={busy === r.id}
                      aria-label="Elimina"
                      title="Elimina"
                      className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-secondary)] disabled:opacity-40"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    {changed && (
                      <button
                        onClick={() => saveText(r)}
                        disabled={busy === r.id || !value.trim()}
                        className="flex items-center gap-2 rounded-full bg-[var(--accent-blue)] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
                      >
                        {busy === r.id && <Loader2 className="h-4 w-4 animate-spin" />} Salva
                      </button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {readOnly && rules?.length ? <p className="mt-2 text-xs text-[var(--text-secondary)]">Per modificarle chiedi il permesso all’amministratore.</p> : null}
    </section>
  )
}
