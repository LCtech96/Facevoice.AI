'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, Pencil, RotateCcw, Save, X } from 'lucide-react'

// Tutto quello che l'AI usa per rispondere, in chiaro: i blocchi di istruzioni
// (modificabili, disattivabili, ripristinabili) e il contesto che si aggiunge da solo.

type Section = {
  id: string
  title: string
  usedFor: string
  group: 'social' | 'email' | 'contatti' | 'sito'
  defaultText: string
  text: string
  custom: boolean
  disabled: boolean
  mustContain: string[]
}
type Automatic = { title: string; where: string; text: string; how: string }

const GROUPS: { id: Section['group']; label: string }[] = [
  { id: 'social', label: 'Messaggi e commenti (Instagram, Messenger, WhatsApp)' },
  { id: 'email', label: 'Email ricevute' },
  { id: 'contatti', label: 'Motore clienti: prime email, controrisposte e appuntamenti' },
  { id: 'sito', label: 'Chat del sito' },
]

export default function AIContextPanel({
  authFetch,
  readOnly,
}: {
  authFetch: (url: string, init?: RequestInit) => Promise<Response>
  readOnly: boolean
}) {
  const [sections, setSections] = useState<Section[]>([])
  const [automatic, setAutomatic] = useState<Automatic[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ id: string; text: string; error?: boolean } | null>(null)

  const load = useCallback(async () => {
    const res = await authFetch('/api/admin/ai-context').catch(() => null)
    if (!res?.ok) return
    const data = await res.json()
    setSections(data.sections || [])
    setAutomatic(data.automatic || [])
  }, [authFetch])

  useEffect(() => {
    load()
  }, [load])

  const save = async (id: string, text: string | null, message: string) => {
    setBusy(true)
    setNotice(null)
    const res = await authFetch('/api/admin/ai-context', { method: 'PUT', body: JSON.stringify({ id, text }) }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setBusy(false)
    if (!res?.ok) return setNotice({ id, text: data.error || 'Non salvato, riprova.', error: true })
    setEditing(null)
    setNotice({ id, text: message })
    load()
  }

  const badge = (s: Section) =>
    s.disabled
      ? { label: 'disattivato', color: '#FF3B30' }
      : s.custom
      ? { label: 'modificato da te', color: '#FF9500' }
      : { label: 'originale', color: '#8E8E93' }

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold text-[var(--text-primary)]">Istruzioni dell’AI</h2>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">
        Questo è tutto quello che l’AI legge prima di rispondere, oltre alle voci della Memoria qui sopra. Puoi modificare ogni blocco,
        svuotarlo per disattivarlo o rimetterlo com’era. Le modifiche valgono entro mezzo minuto per tutte le risposte. I testi tra
        doppie graffe (es. {'{{CHI}}'}) li riempie il sito da solo.
      </p>

      {GROUPS.map((group) => {
        const list = sections.filter((s) => s.group === group.id)
        if (!list.length) return null
        return (
          <div key={group.id} className="mt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)] mb-2">{group.label}</p>
            <div className="space-y-2">
              {list.map((s) => {
                const b = badge(s)
                const isOpen = open === s.id
                return (
                  <div key={s.id} className="rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)]">
                    <button
                      type="button"
                      onClick={() => setOpen(isOpen ? null : s.id)}
                      className="w-full flex items-start justify-between gap-3 p-3 text-left"
                    >
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-[var(--text-primary)]">{s.title}</span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ background: `${b.color}22`, color: b.color }}>
                            {b.label}
                          </span>
                        </span>
                        <span className="block mt-0.5 text-xs text-[var(--text-secondary)]">Usato per: {s.usedFor}</span>
                      </span>
                      <ChevronDown className={`w-4 h-4 shrink-0 mt-1 text-[var(--text-secondary)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {isOpen && (
                      <div className="px-3 pb-3 space-y-2">
                        {editing === s.id ? (
                          <textarea
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            rows={Math.min(24, Math.max(6, draft.split('\n').length + 1))}
                            className="w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border-color)] text-[16px] sm:text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)] font-mono"
                          />
                        ) : (
                          <pre className="whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--text-primary)] bg-[var(--background)] border border-[var(--border-color)] rounded-lg p-3 max-h-[50vh] overflow-y-auto font-sans">
                            {s.text.trim() || '(disattivato: l’AI non riceve questo blocco)'}
                          </pre>
                        )}
                        {s.mustContain.length > 0 && (
                          <p className="text-[11px] text-[var(--text-secondary)]">
                            Non togliere: {s.mustContain.join(', ')} (servono al sito per funzionare).
                          </p>
                        )}
                        {!readOnly && (
                          <div className="flex flex-wrap gap-2">
                            {editing === s.id ? (
                              <>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => save(s.id, draft, 'Salvato.')}
                                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs bg-[var(--accent-blue)] text-white disabled:opacity-50"
                                >
                                  <Save className="w-3.5 h-3.5" /> Salva
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditing(null)}
                                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs border border-[var(--border-color)] text-[var(--text-secondary)]"
                                >
                                  <X className="w-3.5 h-3.5" /> Annulla
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDraft(s.text)
                                    setEditing(s.id)
                                  }}
                                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs border border-[var(--border-color)] text-[var(--text-primary)]"
                                >
                                  <Pencil className="w-3.5 h-3.5" /> Modifica
                                </button>
                                {!s.disabled && s.mustContain.length === 0 && (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => window.confirm(`Disattivare "${s.title}"? L’AI non lo leggerà più.`) && save(s.id, '', 'Disattivato.')}
                                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs border border-[var(--border-color)] text-[#FF3B30] disabled:opacity-50"
                                  >
                                    <X className="w-3.5 h-3.5" /> Disattiva
                                  </button>
                                )}
                                {s.custom && (
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => window.confirm('Rimettere il testo originale? La tua versione verrà persa.') && save(s.id, null, 'Ripristinato il testo originale.')}
                                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs border border-[var(--border-color)] text-[var(--text-secondary)] disabled:opacity-50"
                                  >
                                    <RotateCcw className="w-3.5 h-3.5" /> Testo originale
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        )}
                        {notice?.id === s.id && (
                          <p className={`text-xs ${notice.error ? 'text-[#FF3B30]' : 'text-[var(--text-secondary)]'}`}>{notice.text}</p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      <h2 className="mt-10 text-lg font-semibold text-[var(--text-primary)]">Contesto aggiunto in automatico</h2>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">Non si scrive qui: si aggiorna da solo. Ecco cosa contiene adesso e da dove viene.</p>
      <div className="mt-3 space-y-2">
        {automatic.map((a) => (
          <details key={a.title} className="rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-3">
            <summary className="cursor-pointer">
              <span className="font-medium text-[var(--text-primary)]">{a.title}</span>
              <span className="block text-xs text-[var(--text-secondary)]">Usato per: {a.where}</span>
            </summary>
            <pre className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--text-primary)] bg-[var(--background)] border border-[var(--border-color)] rounded-lg p-3 max-h-[50vh] overflow-y-auto font-sans">
              {a.text}
            </pre>
            <p className="mt-1 text-[11px] text-[var(--text-secondary)]">{a.how}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
