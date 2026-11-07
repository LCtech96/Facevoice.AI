'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase-client'
import GoogleSignIn from './GoogleSignIn'
import LanguageSwitch from './LanguageSwitch'
import TermsChecks, { NO_TICKS, allTicked, clearPendingTerms, savePendingTerms, type TermsTicks } from './TermsChecks'
import { TERMS_VERSION } from '@/lib/terms'

// Accesso e registrazione all'area clienti con email e password (Supabase Auth).
// Alla registrazione Supabase manda un'email di conferma che riporta qui.
// Per registrarsi (con email o con Google) servono le tre caselle dei termini, vuote all'inizio:
// con l'email l'accettazione si registra sul server subito dopo la creazione dell'account
// (/api/app/terms/signup); con Google la registra il blocco dei termini appena entrati.

type Mode = 'signin' | 'signup' | 'reset'

const input =
  'w-full rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)] px-4 py-3 text-[16px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]'

export default function AppAuth() {
  const supabase = createClient()
  const [mode, setMode] = useState<Mode>('signup')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [ticks, setTicks] = useState<TermsTicks>(NO_TICKS)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const ticked = allTicked(ticks)

  // Caselle spuntate alla registrazione: le ricorda per pochi minuti su questo dispositivo
  // (per l'accesso con Google). Fuori dalla registrazione, o tolta una spunta, si dimenticano.
  useEffect(() => {
    if (mode === 'signup' && ticked) savePendingTerms()
    else clearPendingTerms()
  }, [mode, ticked])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setNotice(null)
    const cleanEmail = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return setError('Scrivi un indirizzo email valido.')
    if (mode !== 'reset' && password.length < 8) return setError('La password deve avere almeno 8 caratteri.')
    if (mode === 'signup' && !ticked) return setError('Per registrarti spunta tutte e tre le caselle.')

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
        // Accettazione dei termini sul server (data, IP e browser li prende il server).
        // Se non riesce, il blocco dei termini la chiede di nuovo al primo accesso.
        if (data.user) {
          await fetch('/api/app/terms/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: data.user.id, email: cleanEmail, version: TERMS_VERSION, accept: { a: true, b: true, c: true } }),
          }).catch(() => null)
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
      <LanguageSwitch className="mb-8 self-end" />
      <p translate="no" className="text-sm font-semibold tracking-widest text-[var(--accent-blue)]">FACEVOICE AI</p>
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

      {mode === 'signup' && (
        <div className="mt-8">
          <TermsChecks value={ticks} onChange={setTicks} disabled={busy} />
        </div>
      )}

      {mode !== 'reset' && (
        <>
          <GoogleSignIn disabled={busy || (mode === 'signup' && !ticked)} onBusy={setBusy} onError={(message) => { setNotice(null); setError(message) }} />
          {mode === 'signup' && !ticked && (
            <p className="mt-2 text-center text-xs text-[var(--text-secondary)]">Spunta le tre caselle per registrarti con Google o con l’email.</p>
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
        {error && <p className="text-sm text-[#ff6b6b]">{error}</p>}
        {notice && <p className="text-sm text-[var(--text-primary)]">{notice}</p>}
        <button
          type="submit"
          disabled={busy || (mode === 'signup' && !ticked)}
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
