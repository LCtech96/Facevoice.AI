'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Flag, X } from 'lucide-react'
import { getAccessToken } from '@/lib/session-token'

const TYPES = [
  { value: 'bug', label: 'Bug' },
  { value: 'problem', label: 'Problema' },
  { value: 'change', label: 'Richiesta di modifica' },
] as const

export default function ChatReportButton() {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<(typeof TYPES)[number]['value']>('bug')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null)

  const close = () => {
    setOpen(false)
    setStatus(null)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!message.trim()) return

    setSending(true)
    setStatus(null)
    try {
      const token = await getAccessToken()
      if (!token) {
        setStatus({ ok: false, text: 'Sessione scaduta: effettua di nuovo l’accesso.' })
        return
      }

      const response = await fetch('/api/chat/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          type,
          subject,
          message,
          context: typeof window !== 'undefined' ? window.location.pathname : '',
        }),
      })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        setStatus({ ok: false, text: data.error || 'Invio non riuscito.' })
        return
      }

      setSubject('')
      setMessage('')
      setStatus({ ok: true, text: 'Segnalazione inviata. Grazie!' })
    } catch {
      setStatus({ ok: false, text: 'Errore di rete. Riprova.' })
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--background)] rounded-lg transition-colors"
      >
        <Flag className="w-3.5 h-3.5" />
        Segnala un problema
      </button>

      {open && createPortal(
        <div
          className="fixed inset-0 z-[100] bg-black/60 flex items-end sm:items-center justify-center p-4"
          onClick={close}
        >
          <form
            onSubmit={submit}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md bg-[var(--background-secondary)] border border-[var(--border-color)] rounded-2xl p-5 shadow-2xl space-y-3"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">Segnala un problema</h2>
              <button
                type="button"
                onClick={close}
                className="p-1 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--background)]"
                aria-label="Chiudi"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              {TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setType(t.value)}
                  className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                    type === t.value
                      ? 'bg-[var(--accent-blue)] border-[var(--accent-blue)] text-white'
                      : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={150}
              placeholder="Oggetto (facoltativo)"
              className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--background)] border border-[var(--border-color)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
            />
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={5000}
              rows={5}
              required
              placeholder="Descrivi cosa è successo o cosa vorresti cambiare…"
              className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--background)] border border-[var(--border-color)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)] resize-none"
            />

            {status && (
              <p className={`text-xs ${status.ok ? 'text-green-500' : 'text-[#FF3B30]'}`}>{status.text}</p>
            )}

            <button
              type="submit"
              disabled={sending || !message.trim()}
              className="w-full py-2 rounded-lg bg-[var(--accent-blue)] text-white text-sm font-medium disabled:opacity-50"
            >
              {sending ? 'Invio…' : 'Invia all’amministratore'}
            </button>
          </form>
        </div>,
        document.body
      )}
    </>
  )
}
