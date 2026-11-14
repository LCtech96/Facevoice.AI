'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { isAuthRetryableFetchError } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase-client'
import GoogleSignIn from './GoogleSignIn'
import LanguageSwitch from './LanguageSwitch'
import TermsChecks, { NO_TICKS, allTicked, clearPendingTerms, savePendingTerms, type TermsTicks } from './TermsChecks'
import { TERMS_VERSION } from '@/lib/terms'
import { LAST_KIND_KEY, useWorkspace } from './WorkspaceContext'

// Accesso e registrazione all'area clienti con email e password (Supabase Auth).
// Alla registrazione Supabase manda un'email di conferma che riporta qui.
// Per registrarsi (con email o con Google) servono le tre caselle dei termini, vuote all'inizio:
// con l'email l'accettazione si registra sul server subito dopo la creazione dell'account
// (/api/app/terms/signup); con Google la registra il blocco dei termini appena entrati.
// Accedi con email e password vale anche per i collaboratori: se l'accesso normale non
// riesce, si prova la password dei collaboratori del titolare di quell'email.
// Password dimenticata: un'email con il link e un codice di 6 cifre (/api/app/auth/reset).
// ?accesso=password&email=... (link dato dal titolare ai collaboratori): accesso con l'email gia' scritta.

type Mode = 'signin' | 'signup' | 'reset'

const input =
  'w-full rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)] px-4 py-3 text-[16px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]'

export default function AppAuth({ notice: endedNotice = null, initialEmail = null }: { notice?: string | null; initialEmail?: string | null } = {}) {
  const supabase = createClient()
  const { startSharedSession, clearSessionNotice } = useWorkspace()
  const [mode, setMode] = useState<Mode>(endedNotice || initialEmail ? 'signin' : 'signup')
  const [email, setEmail] = useState(initialEmail || '')
  const [invited, setInvited] = useState(false)
  /** Su questo dispositivo si era entrati con la password dei collaboratori (o se ne e' appena usciti). */
  const [wasCollaborator, setWasCollaborator] = useState(Boolean(endedNotice))
  const [codeEmail, setCodeEmail] = useState<string | null>(null)
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

  // Link dei collaboratori (?accesso=password&email=) o «richiedi un nuovo link» (?accesso=recupero).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const wanted = q.get('accesso')
    const fromLink = (q.get('email') || '').trim().toLowerCase()
    if (wanted === 'password') {
      setMode('signin')
      setInvited(true)
      if (fromLink) setEmail(fromLink)
    } else if (wanted === 'recupero') {
      setMode('reset')
      if (fromLink) setEmail(fromLink)
    }
    try {
      if (localStorage.getItem(LAST_KIND_KEY) === 'shared') setWasCollaborator(true)
    } catch {}
  }, [])

  const remember = (value: string) => {
    try {
      localStorage.setItem('fv_last_email', value)
    } catch {}
  }

  /**
   * Accesso dei collaboratori (email del titolare + password dei collaboratori): true se entrato,
   * false se email o password non vanno; 'offline' se il server non risponde o ha un problema.
   */
  const sharedSignIn = async (cleanEmail: string): Promise<boolean | 'offline'> => {
    const res = await fetch('/api/app/auth/shared-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail, password }),
    }).catch(() => null)
    if (!res) return 'offline'
    const data = await res.json().catch(() => ({}))
    if (res.ok && typeof data.token === 'string') {
      startSharedSession({ token: data.token, exp: data.exp, userId: data.userId, email: data.email })
      return true
    }
    if (res.status === 429) throw new Error(data.error || 'Troppi tentativi: riprova tra qualche minuto.')
    if (res.status >= 500) return 'offline'
    return false
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setNotice(null)
    setCodeEmail(null)
    const cleanEmail = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return setError('Scrivi un indirizzo email valido.')
    if (mode !== 'reset' && password.length < 8) return setError('La password deve avere almeno 8 caratteri.')
    if (mode === 'signup' && !ticked) return setError('Per registrarti spunta tutte e tre le caselle.')

    setBusy(true)
    try {
      if (mode === 'signin') {
        const { error: err } = await supabase.auth.signInWithPassword({ email: cleanEmail, password })
        if (err && /confirm/i.test(err.message)) throw new Error('Conferma prima la tua email: cerca il messaggio che ti abbiamo mandato.')
        if (err) {
          // Non e' la password dell'account (o Supabase non ha risposto): forse e' quella dei collaboratori.
          const status = (err as { status?: number }).status ?? 0
          const limited = status === 429
          const unreachable = isAuthRetryableFetchError(err) || status === 0 || status >= 500
          const shared = await sharedSignIn(cleanEmail)
          if (shared !== true) {
            // «Password sbagliata» solo quando lo sappiamo davvero: non per un problema di rete o un limite.
            if (limited) throw new Error('Troppi tentativi: aspetta qualche minuto e riprova.')
            if (unreachable || shared === 'offline') throw new Error('Non riesco a collegarmi in questo momento: controlla la connessione e riprova.')
            throw new Error('Email o password non corretti.')
          }
        }
        remember(cleanEmail)
        clearSessionNotice()
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
        const res = await fetch('/api/app/auth/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: cleanEmail }),
        }).catch(() => null)
        const data = res ? await res.json().catch(() => ({})) : {}
        if (!res?.ok) throw new Error(data.error || 'Connessione non riuscita, riprova.')
        setNotice('Se l’email è registrata, ti arriva un’email con un link e un codice di 6 cifre per scegliere una nuova password (è la password con cui entri tu: quella dei collaboratori si cambia da Account). Se non la vedi entro qualche minuto, guarda nello Spam.')
        setCodeEmail(cleanEmail)
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
        {mode === 'signup' ? 'Tutti i tuoi messaggi, un solo posto.' : mode === 'signin' ? (invited ? 'Entra nell’account' : 'Bentornato.') : 'Nuova password'}
      </h1>
      <p className="mt-3 text-[var(--text-secondary)]">
        {mode === 'signup'
          ? 'Collega Instagram, Facebook, WhatsApp ed email: l’AI risponde per te come le dici tu, e ti racconta cosa succede.'
          : mode === 'signin'
            ? invited
              ? 'Usa l’email dell’account e la password che ti ha dato il titolare.'
              : 'Accedi al tuo spazio di lavoro.'
            : 'Ti mandiamo un’email con un link e un codice per sceglierne una nuova.'}
      </p>
      {endedNotice && (
        <p className="mt-5 rounded-xl border border-[#FF9500]/40 bg-[#FF9500]/10 px-4 py-3 text-sm text-[var(--text-primary)]" role="status">
          {endedNotice}
        </p>
      )}

      {mode === 'signup' && (
        <div className="mt-8">
          <TermsChecks value={ticks} onChange={setTicks} disabled={busy} />
        </div>
      )}

      {/* Dal link dei collaboratori: solo email e password (Google e' l'accesso del titolare). */}
      {mode !== 'reset' && !invited && (
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
        {mode === 'reset' && (
          <a
            href={`/auth/reset-password?da=app${(codeEmail || email.trim()) ? `&email=${encodeURIComponent((codeEmail || email.trim()).toLowerCase())}` : ''}`}
            className={`block text-sm ${codeEmail ? 'font-semibold text-[var(--accent-blue)]' : 'text-[var(--text-secondary)]'}`}
          >
            {codeEmail ? 'Ho ricevuto il codice: scrivilo qui' : 'Ho già un codice'}
          </a>
        )}
        <button
          type="submit"
          disabled={busy || (mode === 'signup' && !ticked)}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--accent-blue)] px-6 py-3 font-bold text-white disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {mode === 'signup' ? 'Crea il tuo account' : mode === 'signin' ? 'Accedi' : 'Mandami link e codice'}
        </button>
      </form>

      <div className="mt-6 space-y-2 text-sm text-[var(--text-secondary)]">
        {invited && mode === 'signin' && (
          <button className="block text-[var(--accent-blue)]" onClick={() => setInvited(false)}>
            Sei il titolare? Entra con il tuo accesso
          </button>
        )}
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
        {mode === 'signin' && invited && <p>Non ricordi la password? Chiedila al titolare dell’account.</p>}
        {mode === 'signin' && !invited && (
          <>
            <button className="block" onClick={() => { setMode('reset'); setError(null); setNotice(null) }}>
              Password dimenticata?
            </button>
            {wasCollaborator && (
              <p className="text-xs">Entri con la password che ti ha dato il titolare? «Password dimenticata» cambia la sua password: chiedi a lui quella nuova.</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
