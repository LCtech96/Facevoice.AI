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

  const google = async () => {
    setError(null)
    setNotice(null)
    setBusy(true)
    // Google riporta qui con la sessione nell'indirizzo; supabase-js la legge da solo.
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/app`, queryParams: { prompt: 'select_account' } },
    })
    if (err) {
      setError(/not enabled|unsupported provider/i.test(err.message) ? 'L’accesso con Google non è ancora attivo: usa email e password.' : 'Accesso con Google non riuscito, riprova.')
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

      {mode !== 'reset' && (
        <>
          <button
            type="button"
            onClick={google}
            disabled={busy}
            className="mt-8 flex w-full items-center justify-center gap-3 rounded-full bg-white px-6 py-3 font-semibold text-[#1f1f1f] disabled:opacity-50"
          >
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
              <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
            </svg>
            Continua con Google
          </button>
          {mode === 'signup' && (
            <p className="mt-2 text-center text-xs text-[var(--text-secondary)]">
              Continuando con Google accetti i termini del servizio e l’
              <a href="/privacy" target="_blank" className="underline">
                informativa sulla privacy
              </a>
              .
            </p>
          )}
          <div className="my-6 flex items-center gap-3 text-xs text-[var(--text-secondary)]">
            <span className="h-px flex-1 bg-[var(--border-color)]" /> oppure con email <span className="h-px flex-1 bg-[var(--border-color)]" />
          </div>
        </>
      )}

      <form onSubmit={submit} className={mode === 'reset' ? 'mt-8 space-y-3' : 'space-y-3'}>
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
