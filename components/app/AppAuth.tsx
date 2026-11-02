'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase-client'

// Accesso e registrazione all'area clienti con email e password (Supabase Auth).
// Alla registrazione Supabase manda un'email di conferma che riporta qui.

type Mode = 'signin' | 'signup' | 'reset'

const input =
  'w-full rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)] px-4 py-3 text-[16px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]'

export default function AppAuth() {
  const supabase = createClient()
  const [mode, setMode] = useState<Mode>('signup')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setNotice(null)
    const cleanEmail = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return setError('Scrivi un indirizzo email valido.')
    if (mode !== 'reset' && password.length < 8) return setError('La password deve avere almeno 8 caratteri.')
    if (mode === 'signup' && !accepted) return setError('Per registrarti devi accettare termini e privacy.')

    setBusy(true)
    try {
      if (mode === 'signin') {
        const { error: err } = await supabase.auth.signInWithPassword({ email: cleanEmail, password })
        if (err) throw new Error(/confirm/i.test(err.message) ? 'Conferma prima la tua email: cerca il messaggio che ti abbiamo mandato.' : 'Email o password non corretti.')
      } else if (mode === 'signup') {
        const { data, error: err } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: { emailRedirectTo: `${window.location.origin}/app` },
        })
        if (err) throw new Error(/registered|exists/i.test(err.message) ? 'Esiste già un account con questa email: accedi.' : err.message)
        // Supabase non rivela se l'email e' gia' registrata: in quel caso l'utente non ha identita'.
        if (data.user && !data.user.identities?.length) {
          setMode('signin')
          throw new Error('Esiste già un account con questa email: accedi.')
        }
        if (!data.session) setNotice(`Ti abbiamo mandato un'email a ${cleanEmail}: apri il link per confermare l'account e tornerai qui.`)
      } else {
        const { error: err } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
          redirectTo: `${window.location.origin}/auth/reset-password`,
        })
        if (err) throw new Error(err.message)
        setNotice('Se l’email è registrata, ti arriva un link per scegliere una nuova password.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Qualcosa non ha funzionato, riprova.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center px-4 py-10">
      <p className="text-sm font-semibold tracking-widest text-[var(--accent-blue)]">FACEVOICE AI</p>
      <h1 className="mt-3 text-3xl font-extrabold leading-tight text-[var(--text-primary)]">
        {mode === 'signup' ? 'Tutti i tuoi messaggi, un solo posto.' : mode === 'signin' ? 'Bentornato.' : 'Nuova password'}
      </h1>
      <p className="mt-3 text-[var(--text-secondary)]">
        {mode === 'signup'
          ? 'Collega Instagram, Facebook, WhatsApp ed email: l’AI risponde per te come le dici tu, e ti racconta cosa succede.'
          : mode === 'signin'
            ? 'Accedi al tuo spazio di lavoro.'
            : 'Ti mandiamo un link per sceglierne una nuova.'}
      </p>

      <form onSubmit={submit} className="mt-8 space-y-3">
        <input className={input} type="email" autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        {mode !== 'reset' && (
          <input
            className={input}
            type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            placeholder={mode === 'signup' ? 'Password (almeno 8 caratteri)' : 'Password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
        {mode === 'signup' && (
          <label className="flex items-start gap-2 text-sm text-[var(--text-secondary)]">
            <input type="checkbox" className="mt-1" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
            <span>
              Accetto i termini del servizio e l’
              <a href="/privacy" target="_blank" className="text-[var(--accent-blue)] underline">
                informativa sulla privacy
              </a>
              .
            </span>
          </label>
        )}
        {error && <p className="text-sm text-[#ff6b6b]">{error}</p>}
        {notice && <p className="text-sm text-[var(--text-primary)]">{notice}</p>}
        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--accent-blue)] px-6 py-3 font-bold text-white disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {mode === 'signup' ? 'Crea il tuo account' : mode === 'signin' ? 'Accedi' : 'Mandami il link'}
        </button>
      </form>

      <div className="mt-6 space-y-2 text-sm text-[var(--text-secondary)]">
        {mode !== 'signin' && (
          <button className="block text-[var(--accent-blue)]" onClick={() => { setMode('signin'); setError(null); setNotice(null) }}>
            Hai già un account? Accedi
          </button>
        )}
        {mode !== 'signup' && (
          <button className="block text-[var(--accent-blue)]" onClick={() => { setMode('signup'); setError(null); setNotice(null) }}>
            Non hai un account? Registrati
          </button>
        )}
        {mode === 'signin' && (
          <button className="block" onClick={() => { setMode('reset'); setError(null); setNotice(null) }}>
            Password dimenticata?
          </button>
        )}
      </div>
    </div>
  )
}
