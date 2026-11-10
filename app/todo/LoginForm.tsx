'use client'

import { useEffect, useRef, useState } from 'react'
import { Eye, EyeOff, FolderOpen, Loader2, MailCheck } from 'lucide-react'

// Entrata nella pagina dei progetti, in due passaggi: nome e password dati dall'admin,
// poi il codice di 6 cifre arrivato per email. La password e il codice vanno solo al
// server. Il link aperto (?p=progetto&t=attivita') resta: dopo l'entrata si va li'.

const field = 'min-h-[48px] w-full bg-transparent px-4 text-base text-[var(--text-primary)] outline-none'
const box = 'mx-auto max-w-sm rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-6'

type Step = { kind: 'password' } | { kind: 'code'; email: string; alreadySent: boolean }

async function post(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null)
  const data = res ? await res.json().catch(() => ({})) : {}
  return { ok: Boolean(res?.ok), status: res?.status || 0, data: (data || {}) as Record<string, any> }
}

/** Progetto e attivita' del link aperto (se ci sono). */
function wanted() {
  const q = new URLSearchParams(window.location.search)
  return { p: q.get('p') || undefined, t: q.get('t') || undefined }
}

export default function LoginForm({ revoked = false, pending = null }: { revoked?: boolean; pending?: { maskedEmail: string; resendIn: number } | null }) {
  const [step, setStep] = useState<Step>(pending ? { kind: 'code', email: pending.maskedEmail, alreadySent: false } : { kind: 'password' })
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(pending?.resendIn || 0)
  const codeRef = useRef<HTMLInputElement>(null)
  const lastTried = useRef('')

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  useEffect(() => {
    if (step.kind === 'code') codeRef.current?.focus()
  }, [step.kind])

  const restart = (message: string | null) => {
    setStep({ kind: 'password' })
    setCode('')
    setPassword('')
    setInfo(null)
    setError(message)
    lastTried.current = ''
  }

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy || !name.trim() || !password) return
    setBusy(true)
    setError(null)
    const r = await post('/api/todo/login', { name, password })
    setBusy(false)
    setPassword('')
    if (r.ok && r.data.step === 'code') {
      setStep({ kind: 'code', email: r.data.email || '', alreadySent: Boolean(r.data.alreadySent) })
      setCooldown(Number(r.data.resendIn) || 60)
      setCode('')
      lastTried.current = ''
      return
    }
    setError(r.data.error || 'Connessione assente: riprova.')
  }

  const submitCode = async (value: string) => {
    if (busy || value.length !== 6) return
    lastTried.current = value
    setBusy(true)
    setError(null)
    setInfo(null)
    const r = await post('/api/todo/login/verify', { code: value, ...wanted() })
    if (r.ok) {
      window.location.replace(typeof r.data.next === 'string' && r.data.next.startsWith('/todo') ? r.data.next : '/todo')
      return
    }
    setBusy(false)
    if (r.data.restart) return restart(r.data.error || 'Rientra con nome e password.')
    setCode('')
    setError(r.data.error || 'Connessione assente: riprova.')
    codeRef.current?.focus()
  }

  const onCode = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 6)
    setCode(digits)
    // Sei cifre (scritte o incollate): si controlla subito, una volta per codice.
    if (digits.length === 6 && digits !== lastTried.current) submitCode(digits)
  }

  const resend = async () => {
    if (busy || cooldown > 0) return
    setBusy(true)
    setError(null)
    setInfo(null)
    const r = await post('/api/todo/login/resend')
    setBusy(false)
    if (r.ok) {
      setCooldown(Number(r.data.resendIn) || 60)
      setCode('')
      lastTried.current = ''
      setInfo('Ti abbiamo mandato un codice nuovo: usa l’ultimo che ricevi.')
      codeRef.current?.focus()
      return
    }
    if (r.data.restart) return restart(r.data.error || 'Rientra con nome e password.')
    if (r.data.resendIn) setCooldown(Number(r.data.resendIn))
    setError(r.data.error || 'Connessione assente: riprova.')
  }

  const backToStart = async () => {
    await fetch('/api/todo/login', { method: 'DELETE', credentials: 'same-origin' }).catch(() => null)
    restart(null)
  }

  if (step.kind === 'code') {
    return (
      <div className="px-4 pt-16">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submitCode(code)
          }}
          className={box}
        >
          <MailCheck className="mx-auto h-9 w-9 text-[var(--accent-blue)]" />
          <h1 className="mt-3 text-center text-lg font-semibold text-[var(--text-primary)]">Controlla l’email</h1>
          <p className="mt-1 text-center text-sm text-[var(--text-secondary)]">
            Abbiamo mandato un codice di 6 cifre a <span className="font-medium text-[var(--text-primary)]">{step.email}</span>. Scade tra 10 minuti.
          </p>
          {step.alreadySent && !info && !error && (
            <p className="mt-3 rounded-xl border border-[var(--accent-blue)]/40 bg-[var(--accent-blue)]/10 px-3 py-2 text-sm text-[var(--text-primary)]" role="status">
              Il codice ti è appena stato mandato: controlla l’email (anche nella posta indesiderata).
            </p>
          )}
          <label className="mt-5 block text-sm font-medium text-[var(--text-primary)]" htmlFor="todo-code">
            Codice
          </label>
          <div className="mt-1 rounded-xl border border-[var(--border-color)] bg-[var(--background)] focus-within:border-[var(--accent-blue)]">
            <input
              id="todo-code"
              ref={codeRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={12}
              placeholder="123456"
              value={code}
              onChange={(e) => onCode(e.target.value)}
              aria-describedby="todo-code-help"
              className={`${field} text-center font-mono text-2xl tracking-[0.4em]`}
            />
          </div>
          <p id="todo-code-help" className="mt-1 text-xs text-[var(--text-secondary)]">
            Puoi anche incollarlo.
          </p>
          {info && (
            <p className="mt-2 text-sm text-[#34C759]" role="status">
              {info}
            </p>
          )}
          {error && (
            <p className="mt-2 text-sm text-[#FF3B30]" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy || code.length !== 6} className="mt-4 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full bg-[var(--accent-blue)] px-5 text-base font-semibold text-white disabled:opacity-40">
            {busy && <Loader2 className="h-5 w-5 animate-spin" />} Entra
          </button>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <button type="button" onClick={resend} disabled={busy || cooldown > 0} className="min-h-[40px] font-medium text-[var(--accent-blue)] disabled:text-[var(--text-secondary)]">
              {cooldown > 0 ? `Invia di nuovo il codice (${cooldown} s)` : 'Invia di nuovo il codice'}
            </button>
            <button type="button" onClick={backToStart} disabled={busy} className="min-h-[40px] text-[var(--text-secondary)] underline-offset-2 hover:underline">
              Ricomincia
            </button>
          </div>
        </form>
      </div>
    )
  }

  return (
    <div className="px-4 pt-16">
      <form onSubmit={submitPassword} className={box}>
        <FolderOpen className="mx-auto h-9 w-9 text-[var(--accent-blue)]" />
        <h1 className="mt-3 text-center text-lg font-semibold text-[var(--text-primary)]">Progetti</h1>
        <p className="mt-1 text-center text-sm text-[var(--text-secondary)]">Entra con il nome e la password che ti sono stati dati. Poi ti mandiamo un codice per email.</p>
        {revoked && !error && (
          <p className="mt-4 rounded-xl border border-[#FF9500]/40 bg-[#FF9500]/10 px-3 py-2 text-sm text-[var(--text-primary)]" role="status">
            La password è stata cambiata: chiedi la nuova password all’admin.
          </p>
        )}
        <label className="mt-5 block text-sm font-medium text-[var(--text-primary)]" htmlFor="todo-name">
          Nome
        </label>
        <div className="mt-1 rounded-xl border border-[var(--border-color)] bg-[var(--background)] focus-within:border-[var(--accent-blue)]">
          <input id="todo-name" autoComplete="username" autoCapitalize="words" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} className={field} autoFocus />
        </div>
        <label className="mt-3 block text-sm font-medium text-[var(--text-primary)]" htmlFor="todo-password">
          Password
        </label>
        <div className="mt-1 flex items-center gap-1 rounded-xl border border-[var(--border-color)] bg-[var(--background)] pr-1 focus-within:border-[var(--accent-blue)]">
          <input
            id="todo-password"
            type={show ? 'text' : 'password'}
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={field}
          />
          <button type="button" onClick={() => setShow(!show)} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[var(--text-secondary)]" aria-label={show ? 'Nascondi password' : 'Mostra password'}>
            {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>
        {error && (
          <p className="mt-2 text-sm text-[#FF3B30]" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || !name.trim() || !password} className="mt-4 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full bg-[var(--accent-blue)] px-5 text-base font-semibold text-white disabled:opacity-40">
          {busy && <Loader2 className="h-5 w-5 animate-spin" />} Continua
        </button>
      </form>
    </div>
  )
}
