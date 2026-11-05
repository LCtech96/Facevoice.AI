'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, Mail, Send, X } from 'lucide-react'
import type { Draft } from '@/components/useAssistantChat'

// Bozze email preparate dalla super chat (in comune a tutte le chat): si scelgono,
// si correggono e partono tutte insieme con "Invia", una alla volta.

export default function DraftsPanel({
  drafts,
  choice,
  onChoice,
  setDrafts,
  sending,
  onSend,
}: {
  drafts: Draft[]
  /** Bozza esclusa solo se false. */
  choice: Record<string, boolean>
  onChoice: (leadId: string, on: boolean) => void
  setDrafts: (update: (list: Draft[]) => Draft[]) => void
  sending: string | null
  onSend: () => void
}) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const chosen = drafts.filter((d) => choice[d.leadId] !== false).length

  // Le nuove bozze compaiono aperte.
  const count = useRef(0)
  useEffect(() => {
    if (drafts.length > count.current) setOpen(true)
    count.current = drafts.length
  }, [drafts.length])

  const edit = (leadId: string, patch: Partial<Draft>) => setDrafts((list) => list.map((x) => (x.leadId === leadId ? { ...x, ...patch } : x)))
  const field = 'w-full rounded-lg border border-[var(--border-color)] bg-[var(--background-secondary)] px-3 py-2 text-base text-[var(--text-primary)] md:text-sm'

  return (
    <div className="mb-3 overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)]">
      <div className="flex items-center gap-2 px-3 py-2">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <Mail className="h-4 w-4 shrink-0 text-[var(--accent-blue)]" />
          <span className="truncate text-sm font-semibold text-[var(--text-primary)]">
            {drafts.length} bozze email · {chosen} selezionate
          </span>
        </button>
        <button
          type="button"
          onClick={onSend}
          disabled={!chosen || sending !== null}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--accent-blue)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {sending ? `Invio ${sending}` : `Invia ${chosen}`}
        </button>
      </div>
      {open && (
        <div className="max-h-[38vh] divide-y divide-[var(--border-color)] overflow-y-auto border-t border-[var(--border-color)]">
          {drafts.map((d) => {
            const on = choice[d.leadId] !== false
            return (
              <div key={d.leadId} className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onChoice(d.leadId, !on)}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${on ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)]' : 'border-[var(--border-color)]'}`}
                    aria-label={on ? 'Escludi' : 'Includi'}
                  >
                    {on && <Check className="h-3.5 w-3.5 text-white" />}
                  </button>
                  <button type="button" onClick={() => setExpanded(expanded === d.leadId ? null : d.leadId)} className="min-w-0 flex-1 text-left">
                    <p className="truncate text-sm text-[var(--text-primary)]">{d.name}</p>
                    <p className="truncate text-xs text-[var(--text-secondary)]">
                      {d.kind === 'first' ? 'primo contatto' : 'follow-up'} · {d.subject}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrafts((list) => list.filter((x) => x.leadId !== d.leadId))}
                    className="p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    aria-label="Togli bozza"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {expanded === d.leadId && (
                  <div className="mt-2 space-y-2">
                    <input value={d.subject} onChange={(e) => edit(d.leadId, { subject: e.target.value })} aria-label="Oggetto" className={field} />
                    <textarea value={d.body} rows={8} onChange={(e) => edit(d.leadId, { body: e.target.value })} aria-label="Testo dell’email" className={field} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
