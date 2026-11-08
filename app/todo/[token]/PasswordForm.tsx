'use client'

import { useState } from 'react'
import { Eye, EyeOff, ListTodo, Loader2 } from 'lucide-react'

// Password della todo list: va solo al server, che la confronta con l'hash.

export default function PasswordForm({ token, revoked = false }: { token: string; revoked?: boolean }) {
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy || !password) return
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/todo/${encodeURIComponent(token)}/access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ password }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (res?.ok) {
      window.location.reload()
      return
    }
    setPassword('')
    setBusy(false)
    setError(data?.error || 'Connessione assente: riprova.')
  }

  return (
    <div className="px-4 pt-16">
      <form onSubmit={submit} className="mx-auto max-w-sm rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-6">
        <ListTodo className="mx-auto h-9 w-9 text-[var(--accent-blue)]" />
        <h1 className="mt-3 text-center text-lg font-semibold text-[var(--text-primary)]">Todo list condivisa</h1>
        <p className="mt-1 text-center text-sm text-[var(--text-secondary)]">Per aprirla scrivi la password che ti è stata data.</p>
        <label className="mt-5 block text-sm font-medium text-[var(--text-primary)]" htmlFor="todo-password">
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
            className="min-h-[48px] w-full bg-transparent px-4 text-base text-[var(--text-primary)] outline-none"
            autoFocus
          />
          <button type="button" onClick={() => setShow(!show)} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[var(--text-secondary)]" aria-label={show ? 'Nascondi password' : 'Mostra password'}>
            {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>
        {revoked && !error && (
          <p className="mt-4 rounded-xl border border-[#FF9500]/40 bg-[#FF9500]/10 px-3 py-2 text-sm text-[var(--text-primary)]" role="status">
            La password è stata cambiata: chiedi la nuova password all’admin.
          </p>
        )}
        {error && (
          <p className="mt-2 text-sm text-[#FF3B30]" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={busy || !password} className="mt-4 inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full bg-[var(--accent-blue)] px-5 text-base font-semibold text-white disabled:opacity-40">
          {busy && <Loader2 className="h-5 w-5 animate-spin" />} Apri la todo list
        </button>
      </form>
    </div>
  )
}
