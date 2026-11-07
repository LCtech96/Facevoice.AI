'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { TERMS_PATH, TERMS_REQUIRED_EVENT, TERMS_VERSION, versionDateLabel } from '@/lib/terms'
import LanguageSwitch from './LanguageSwitch'
import TermsChecks, { NO_TICKS, allTicked, clearPendingTerms, hasPendingTerms, type TermsTicks } from './TermsChecks'
import { useWorkspace } from './WorkspaceContext'

// Blocco all'ingresso dell'area clienti: chi non ha accettato i termini in vigore vede solo
// le tre caselle (e "Esci") finche' non le spunta tutte. Se le ha spuntate alla registrazione
// su questo dispositivo pochi minuti fa (accesso con Google), si registrano da sole.
// Senza sessione, o mentre la sessione si carica, decide la cornice dell'area clienti.

type Status = 'checking' | 'ok' | 'needed' | 'error'

export default function TermsGate({ children }: { children: ReactNode }) {
  const { ready, session, appFetch, signOut, email } = useWorkspace()
  const userId = session?.user.id ?? null
  // Esito valido solo per la persona per cui si e' controllato (cambio di account: si ricontrolla).
  const [result, setResult] = useState<{ user: string | null; status: Status }>({ user: null, status: 'checking' })
  const status: Status = result.user === userId ? result.status : 'checking'
  const setStatus = useCallback((next: Status) => setResult({ user: userId, status: next }), [userId])
  const [previous, setPrevious] = useState<string | null>(null)
  const [ticks, setTicks] = useState<TermsTicks>(NO_TICKS)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const accept = useCallback(
    async (source: 'signup' | 'gate') => {
      const res = await appFetch('/api/app/terms', {
        method: 'POST',
        body: JSON.stringify({ version: TERMS_VERSION, accept: { a: true, b: true, c: true }, source }),
      }).catch(() => null)
      const data = res ? await res.json().catch(() => ({})) : {}
      return { ok: Boolean(res?.ok), error: typeof data?.error === 'string' ? data.error : null }
    },
    [appFetch]
  )

  const check = useCallback(async () => {
    setStatus('checking')
    setError(null)
    const res = await appFetch('/api/app/terms').catch(() => null)
    const data = res?.ok ? await res.json().catch(() => null) : null
    if (!data || typeof data.accepted !== 'boolean') return setStatus('error')
    if (data.accepted) {
      clearPendingTerms()
      return setStatus('ok')
    }
    setPrevious(typeof data.previousVersion === 'string' ? data.previousVersion : null)
    if (hasPendingTerms()) {
      clearPendingTerms()
      if ((await accept('signup')).ok) return setStatus('ok')
    }
    setTicks(NO_TICKS)
    setStatus('needed')
  }, [appFetch, accept, setStatus])

  useEffect(() => {
    if (!ready || !userId) return
    check()
    // Solo quando cambia la persona collegata.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, userId])

  // Il server risponde "prima accetta i termini" mentre l'app e' aperta: si ricontrolla (torna il blocco).
  useEffect(() => {
    if (status !== 'ok') return
    const onRequired = () => {
      check()
    }
    window.addEventListener(TERMS_REQUIRED_EVENT, onRequired)
    return () => window.removeEventListener(TERMS_REQUIRED_EVENT, onRequired)
  }, [status, check])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!allTicked(ticks)) return setError('Per continuare spunta tutte e tre le caselle.')
    setBusy(true)
    setError(null)
    const saved = await accept('gate')
    setBusy(false)
    if (saved.ok) setStatus('ok')
    else setError(saved.error || 'Connessione non riuscita, riprova.')
  }

  if (!ready || !session) return <>{children}</>
  if (status === 'ok') return <>{children}</>

  if (status === 'checking') {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--text-secondary)]" />
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-[var(--text-secondary)]">Non riesco a controllare i termini e condizioni. Controlla la connessione e riprova.</p>
        <button onClick={check} className="rounded-full bg-[var(--accent-blue)] px-5 py-2 font-semibold text-white">
          Riprova
        </button>
        <button onClick={signOut} className="text-sm text-[var(--text-secondary)]">
          Esci
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center px-4 py-10">
      <LanguageSwitch className="mb-8 self-end" />
      <p translate="no" className="text-sm font-semibold tracking-widest text-[var(--accent-blue)]">FACEVOICE AI</p>
      <h1 className="mt-3 text-3xl font-extrabold leading-tight text-[var(--text-primary)]">
        {previous ? 'Termini aggiornati' : 'Prima di continuare'}
      </h1>
      <p className="mt-3 text-[var(--text-secondary)]">
        {previous
          ? `Abbiamo aggiornato i termini e condizioni (versione del ${versionDateLabel(TERMS_VERSION)}). Per continuare a usare Facevoice AI leggili e accettali.`
          : 'Per usare Facevoice AI leggi e accetta i termini e condizioni.'}{' '}
        <a href={TERMS_PATH} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-blue)] underline">
          Apri i termini
        </a>
      </p>
      <form onSubmit={submit} className="mt-8 space-y-5">
        <TermsChecks value={ticks} onChange={setTicks} disabled={busy} />
        {error && <p className="text-sm text-[#ff6b6b]">{error}</p>}
        <button
          type="submit"
          disabled={busy || !allTicked(ticks)}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--accent-blue)] px-6 py-3 font-bold text-white disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Accetto e continuo
        </button>
      </form>
      <button onClick={signOut} className="mt-6 text-left text-sm text-[var(--text-secondary)]">
        Esci {email ? <span translate="no">({email})</span> : null}
      </button>
    </div>
  )
}
