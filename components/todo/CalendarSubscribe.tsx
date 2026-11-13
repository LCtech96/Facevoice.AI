'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarPlus, Check, Copy, Loader2, RefreshCw, X } from 'lucide-react'

// «Aggiungi al calendario»: le scadenze dei progetti nel calendario dell'iPhone (o di
// Google Calendar / Outlook). Sull'iPhone basta toccare «Apri nel Calendario» e poi
// «Iscriviti»; il calendario poi si aggiorna da solo. Il link e' personale.

export type CalendarLinkResult = { ok: boolean; status: number; data: Record<string, any> }

export default function CalendarSubscribe({
  load,
  rotate,
  onLocked,
}: {
  load: () => Promise<CalendarLinkResult>
  /** Solo l'admin: nuovo link (quello di prima smette di funzionare). */
  rotate?: () => Promise<CalendarLinkResult>
  onLocked?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [link, setLink] = useState<{ url: string; webcal: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const take = (r: CalendarLinkResult) => {
    if (r.status === 401) {
      onLocked?.()
      return
    }
    if (r.ok && typeof r.data.url === 'string') {
      setLink({ url: r.data.url, webcal: r.data.webcal })
      setError(null)
    } else setError(r.data.error || 'Connessione assente: riprova.')
  }

  const show = async () => {
    setOpen(true)
    if (link) return
    setBusy(true)
    take(await load())
    setBusy(false)
  }

  const renew = async () => {
    if (!rotate || !window.confirm('Creare un link nuovo? Il link di prima smette di funzionare e va aggiunto di nuovo sui dispositivi.')) return
    setBusy(true)
    take(await rotate())
    setBusy(false)
  }

  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copia il link del calendario:', link.url)
    }
  }

  const close = () => {
    setOpen(false)
    buttonRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={show}
        className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-[var(--border-color)] px-3 text-xs font-semibold text-[var(--text-primary)] hover:border-[var(--accent-blue)]"
      >
        <CalendarPlus className="h-4 w-4 text-[var(--accent-blue)]" /> Aggiungi all’iPhone
      </button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/60 sm:items-center sm:p-6" onClick={close}>
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Calendario sul telefono"
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-t-2xl border border-[var(--border-color)] bg-[var(--card-background)] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-2xl"
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--text-primary)]">
                  <CalendarPlus className="h-5 w-5 text-[var(--accent-blue)]" /> Scadenze nel tuo calendario
                </h2>
                <button type="button" onClick={close} className="-mr-2 -mt-2 inline-flex h-10 w-10 items-center justify-center rounded-full text-[var(--text-secondary)]" aria-label="Chiudi">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">Le attività con una scadenza dei tuoi progetti compaiono nel Calendario dell’iPhone e si aggiornano da sole.</p>

              {busy && !link && (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-6 w-6 animate-spin text-[var(--accent-blue)]" />
                </div>
              )}
              {error && <p className="mt-3 rounded-xl border border-[#FF3B30]/40 bg-[#FF3B30]/10 px-3 py-2 text-sm text-[var(--text-primary)]">{error}</p>}

              {link && (
                <>
                  <a
                    href={link.webcal}
                    className="mt-4 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full bg-[var(--accent-blue)] px-5 text-base font-semibold text-white"
                  >
                    <CalendarPlus className="h-5 w-5" /> Apri nel Calendario
                  </a>
                  <p className="mt-2 text-center text-xs text-[var(--text-secondary)]">Sull’iPhone si apre il Calendario: tocca «Iscriviti» e poi «Fine».</p>

                  <div className="mt-4 rounded-xl border border-[var(--border-color)] p-3">
                    <p className="text-xs font-medium text-[var(--text-secondary)]">Se il pulsante non funziona, copia il link:</p>
                    <div className="mt-2 flex gap-2">
                      <input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} className="min-h-[40px] min-w-0 flex-1 rounded-lg border border-[var(--border-color)] bg-[var(--background)] px-2 font-mono text-xs text-[var(--text-primary)]" aria-label="Link del calendario" />
                      <button type="button" onClick={copy} className="inline-flex min-h-[40px] shrink-0 items-center gap-1 rounded-full border border-[var(--border-color)] px-3 text-xs font-semibold text-[var(--text-primary)]">
                        {copied ? <Check className="h-4 w-4 text-[#34C759]" /> : <Copy className="h-4 w-4" />} {copied ? 'Copiato' : 'Copia'}
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-[var(--text-secondary)]">
                      iPhone: Impostazioni → App → Calendario → Account calendario → Aggiungi account → Altro → Aggiungi calendario sottoscritto, e incolla il link. Google Calendar (da computer): Altri calendari → + → Da URL.
                    </p>
                  </div>

                  <p className="mt-3 text-xs text-[var(--text-secondary)]">Il link è personale: chi lo ha vede le scadenze dei tuoi progetti. Non condividerlo.</p>
                  {rotate && (
                    <button type="button" onClick={renew} disabled={busy} className="mt-2 inline-flex min-h-[36px] items-center gap-1 text-xs font-medium text-[var(--accent-blue)] disabled:opacity-50">
                      <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} /> Nuovo link (quello di prima smette di funzionare)
                    </button>
                  )}
                </>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
