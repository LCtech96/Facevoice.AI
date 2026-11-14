'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowRight, CheckCircle, Eye, EyeOff, KeyRound, Loader2, Lock, XCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase-client'

// Nuova password dopo «Password dimenticata». Tre modi per arrivarci:
// 1. il pulsante dell'email dell'area clienti (?token_hash=…&type=recovery): si usa solo
//    quando la persona tocca «Continua», cosi' i filtri delle email che aprono i link da
//    soli non lo consumano;
// 2. il codice di 6 cifre della stessa email (email + codice);
// 3. i link di recupero di Supabase (#access_token… o ?code=…) delle email del sito.
// Il modulo della nuova password compare SOLO dopo uno di questi passaggi, mai per una
// sessione gia' aperta. Dopo si torna all'area clienti (/app), anche dai link vecchi.
// La nuova password non puo' essere quella dei collaboratori (controllo sul server prima di
// salvarla); dopo il salvataggio la password dei collaboratori si spegne, e se non ci si
// riesce lo si dice chiaramente (niente uscita automatica dalla pagina).

type Step = 'checking' | 'link' | 'code' | 'ready' | 'done' | 'invalid'
/** Password dei collaboratori dopo il salvataggio: spenta adesso, non c'era, oppure non si e' riusciti a spegnerla. */
type SharedAfter = 'off' | 'none' | 'failed'

const APP_HOME = '/app'

const field =
  'w-full rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)] px-4 py-3 text-[16px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]'

/** La sessione di questo browser viene da un recupero appena fatto (link o codice, entro 15 minuti)? */
function isFreshRecovery(accessToken: string | undefined): boolean {
  try {
    const payload = JSON.parse(atob((accessToken || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    const amr: { method?: string; timestamp?: number }[] = Array.isArray(payload?.amr) ? payload.amr : []
    return amr.some((a) => (a.method === 'otp' || a.method === 'recovery') && Number(a.timestamp) * 1000 > Date.now() - 15 * 60_000)
  } catch {
    return false
  }
}

function passwordError(message: string, code?: string): string {
  if (code === 'same_password' || /same|different from the old/i.test(message)) return 'La nuova password deve essere diversa da quella di prima.'
  if (code === 'weak_password' || /weak|at least|characters/i.test(message)) return 'Password troppo debole: almeno 8 caratteri, con lettere e numeri.'
  if (/rate|too many/i.test(message)) return 'Troppi tentativi: aspetta qualche minuto e riprova.'
  return 'Non riesco a salvare la password, riprova.'
}

export default function ResetPasswordPage() {
  const router = useRouter()
  const supabase = createClient()
  const [step, setStep] = useState<Step>('checking')
  const [tokenHash, setTokenHash] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sharedAfter, setSharedAfter] = useState<SharedAfter>('none')
  const recovering = useRef(false)

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams(window.location.search)
    const hash = window.location.hash
    setEmail((params.get('email') || '').trim().toLowerCase())

    // Link di Supabase (#access_token&type=recovery): quando la sessione di recupero e' pronta arriva PASSWORD_RECOVERY.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' && !cancelled) {
        recovering.current = true
        setStep('ready')
      }
    })

    const start = async () => {
      if (hash.includes('error_description') || params.get('error_description')) return setStep('invalid')
      const th = params.get('token_hash')
      if (th && params.get('type') === 'recovery') {
        setTokenHash(th)
        return setStep('link')
      }
      const pkce = params.get('code')
      if (pkce) {
        const { error: err } = await supabase.auth.exchangeCodeForSession(pkce)
        if (cancelled) return
        if (err) return setStep('invalid')
        recovering.current = true
        return setStep('ready')
      }
      // Recupero gia' aperto altrove nel sito (RecoveryRedirect): vale solo se la sessione e' davvero di recupero.
      if (params.get('recovered') === '1') {
        await new Promise((r) => setTimeout(r, 300))
        if (cancelled || recovering.current) return
        const { data } = await supabase.auth.getSession()
        if (cancelled) return
        if (isFreshRecovery(data.session?.access_token)) {
          recovering.current = true
          return setStep('ready')
        }
        return setStep('code')
      }
      if (hash.includes('type=recovery') && hash.includes('access_token')) {
        // La sessione dal link arriva un attimo dopo: se l'evento non e' gia' arrivato, si controlla.
        await new Promise((r) => setTimeout(r, 400))
        if (cancelled || recovering.current) return
        const { data } = await supabase.auth.getSession()
        if (cancelled) return
        if (data.session) {
          recovering.current = true
          return setStep('ready')
        }
        return setStep('invalid')
      }
      setStep('code')
    }
    start()
    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [supabase])

  const openLink = async () => {
    if (!tokenHash) return
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
    setBusy(false)
    if (err) return setStep('invalid')
    recovering.current = true
    setStep('ready')
  }

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const cleanEmail = email.trim().toLowerCase()
    const cleanCode = code.replace(/\D/g, '')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return setError('Scrivi l’email del tuo account.')
    if (cleanCode.length < 6) return setError('Scrivi il codice di 6 cifre che ti abbiamo mandato.')
    setBusy(true)
    const { error: err } = await supabase.auth.verifyOtp({ email: cleanEmail, token: cleanCode, type: 'recovery' })
    setBusy(false)
    if (err) return setError(/rate|too many/i.test(err.message) ? 'Troppi tentativi: aspetta qualche minuto e riprova.' : 'Codice non corretto o scaduto. Controlla l’ultima email che ti abbiamo mandato, oppure chiedine una nuova.')
    recovering.current = true
    setStep('ready')
  }

  /** Spegne la password dei collaboratori dopo il cambio (un secondo tentativo se il primo non riesce). */
  const switchOffShared = async (token: string): Promise<SharedAfter> => {
    for (let round = 0; round < 2; round++) {
      if (round) await new Promise((r) => setTimeout(r, 1200))
      const res = await fetch('/api/app/auth/after-reset', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }).catch(() => null)
      if (res?.ok) {
        const data = await res.json().catch(() => null)
        if (typeof data?.sharedDisabled === 'boolean') return data.sharedDisabled ? 'off' : 'none'
      }
    }
    return 'failed'
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!recovering.current) return setStep('code')
    if (password.length < 8) return setError('La password deve avere almeno 8 caratteri.')
    if (password !== confirm) return setError('Le due password non sono uguali.')
    setBusy(true)
    const before = (await supabase.auth.getSession()).data.session?.access_token
    if (!before) {
      setBusy(false)
      return setStep('invalid')
    }
    // Non puo' essere la password dei collaboratori (chi la conosce entrerebbe come titolare).
    const check = await fetch('/api/app/auth/reset-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${before}` },
      body: JSON.stringify({ password }),
      cache: 'no-store',
    }).catch(() => null)
    if (!check?.ok) {
      const data = check ? await check.json().catch(() => null) : null
      setBusy(false)
      if (check?.status === 401) return setStep('invalid')
      return setError(typeof data?.error === 'string' ? data.error : 'Non riesco a controllare la password in questo momento, riprova tra poco.')
    }
    const { error: err } = await supabase.auth.updateUser({ password })
    if (err) {
      setBusy(false)
      return setError(passwordError(err.message, (err as { code?: string }).code))
    }
    // Per sicurezza si spegne anche la password dei collaboratori (se era attiva).
    const token = (await supabase.auth.getSession()).data.session?.access_token || before
    const after = await switchOffShared(token)
    setBusy(false)
    setSharedAfter(after)
    setStep('done')
    // Se non si e' riusciti a spegnerla si resta qui: la persona deve leggere l'avviso.
    if (after !== 'failed') setTimeout(() => router.replace(APP_HOME), after === 'off' ? 4500 : 1500)
  }

  const askAgain = () => router.push(`${APP_HOME}?accesso=recupero${email ? `&email=${encodeURIComponent(email)}` : ''}`)

  const primary = 'flex w-full items-center justify-center gap-2 rounded-full bg-[var(--accent-blue)] px-6 py-3 font-bold text-white disabled:opacity-50'

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border-color)] bg-[var(--card-background)] p-7 shadow-xl">
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Nuova password</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          {step === 'checking' && 'Un attimo…'}
          {step === 'link' && 'Tocca «Continua» per scegliere la nuova password.'}
          {step === 'code' && 'Scrivi l’email del tuo account e il codice di 6 cifre che ti abbiamo mandato.'}
          {step === 'ready' && 'Scegli la nuova password del tuo account.'}
          {step === 'invalid' && 'Questo link non vale più.'}
          {step === 'done' && 'Password aggiornata.'}
        </p>

        {step === 'checking' && (
          <div className="flex justify-center py-8">
            <Loader2 className="h-7 w-7 animate-spin text-[var(--accent-blue)]" />
          </div>
        )}

        {step === 'link' && (
          <div className="mt-6 space-y-3">
            <button type="button" onClick={openLink} disabled={busy} className={primary}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />} Continua
            </button>
            <button type="button" onClick={() => setStep('code')} className="block w-full text-center text-sm text-[var(--accent-blue)]">
              Ho il codice di 6 cifre
            </button>
          </div>
        )}

        {step === 'code' && (
          <form onSubmit={submitCode} className="mt-6 space-y-3">
            <input className={field} type="email" autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <div className="relative">
              <KeyRound className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--text-secondary)]" />
              <input
                className={`${field} pl-12 text-center font-mono text-2xl tracking-[0.4em]`}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={12}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
                aria-label="Codice"
              />
            </div>
            {error && <p className="text-sm text-[#ff6b6b]">{error}</p>}
            <button type="submit" disabled={busy} className={primary}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Continua
            </button>
            <button type="button" onClick={askAgain} className="block w-full text-center text-sm text-[var(--text-secondary)]">
              Non ho ricevuto niente: chiedi una nuova email
            </button>
          </form>
        )}

        {step === 'ready' && (
          <form onSubmit={save} className="mt-6 space-y-3">
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--text-secondary)]" />
              <input
                className={`${field} pl-12 pr-12`}
                type={show ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="Nuova password (almeno 8 caratteri)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
              <button type="button" onClick={() => setShow(!show)} className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" aria-label={show ? 'Nascondi la password' : 'Mostra la password'}>
                {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
            <input className={field} type={show ? 'text' : 'password'} autoComplete="new-password" placeholder="Ripeti la password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            {error && <p className="text-sm text-[#ff6b6b]">{error}</p>}
            <button type="submit" disabled={busy} className={primary}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Salva la nuova password
            </button>
          </form>
        )}

        {step === 'invalid' && (
          <div className="mt-6 space-y-3">
            <p className="flex items-start gap-2 rounded-xl border border-[#ff6b6b]/30 bg-[#ff6b6b]/10 p-3 text-sm text-[var(--text-primary)]">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#ff6b6b]" />
              <span>Il link è scaduto o è già stato usato: link e codice valgono una volta sola e per poco tempo.</span>
            </p>
            <button type="button" onClick={askAgain} className={primary}>
              Chiedi una nuova email
            </button>
            <button type="button" onClick={() => setStep('code')} className="block w-full text-center text-sm text-[var(--accent-blue)]">
              Ho un codice più recente
            </button>
          </div>
        )}

        {step === 'done' && (
          <p className="mt-6 flex items-center gap-2 rounded-xl border border-[#34C759]/30 bg-[#34C759]/10 p-3 text-sm text-[var(--text-primary)]">
            <CheckCircle className="h-4 w-4 shrink-0 text-[#34C759]" />
            {sharedAfter === 'failed' ? 'Password aggiornata.' : 'Password aggiornata. Ti stiamo portando dentro…'}
          </p>
        )}
        {step === 'done' && sharedAfter === 'off' && (
          <p className="mt-3 rounded-xl border border-[#FF9500]/40 bg-[#FF9500]/10 p-3 text-sm text-[var(--text-primary)]">
            Per sicurezza abbiamo spento anche la password dei collaboratori: se ti serve, riattivala da Account con una password nuova.
          </p>
        )}
        {step === 'done' && sharedAfter === 'failed' && (
          <div className="mt-3 space-y-3">
            <p className="flex items-start gap-2 rounded-xl border border-[#ff6b6b]/40 bg-[#ff6b6b]/10 p-3 text-sm text-[var(--text-primary)]" role="alert">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#ff6b6b]" />
              <span>
                Non sono riuscito a spegnere la password dei collaboratori. Se era attiva, è ancora attiva: apri Account e spegnila (o cambiala), soprattutto se
                pensi che qualcuno sia entrato nel tuo account.
              </span>
            </p>
            <button type="button" onClick={() => router.replace(`${APP_HOME}/account`)} className={primary}>
              Apri Account
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
