'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Eye, EyeOff, KeyRound, Loader2, ShieldCheck, Users } from 'lucide-react'
import { useWorkspace } from '@/components/app/WorkspaceContext'

// Account: «Accesso con password per i collaboratori». Il titolare (entrato con Google o
// con la sua email e password) puo' attivare una password da dare ad altre persone insieme
// alla sua email; cambiarla (chi era entrato con quella di prima esce subito) o spegnerla.
// Le sue sessioni non si toccano mai. Chi e' entrato con la password dei collaboratori qui
// vede solo com'e' impostato.

type Info = { email: string; enabled: boolean; changedAt: string | null; shared: boolean; providers: string[]; link: string }

const input =
  'w-full rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)] px-4 py-3 text-[16px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]'

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''

function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${on ? 'bg-[var(--accent-blue)]' : 'bg-[var(--border-color)]'}`}
    >
      <span className={`inline-block h-6 w-6 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-7' : 'translate-x-1'}`} />
    </button>
  )
}

export default function AccountPage() {
  const { appFetch, isShared, email: accountEmail } = useWorkspace()
  const [info, setInfo] = useState<Info | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Modulo della password: per attivarla o per cambiarla.
  const [form, setForm] = useState<'enable' | 'change' | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await appFetch('/api/app/account/password-access').catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (!res?.ok) return setLoadError(data.error || 'Connessione non riuscita, riprova.')
    setLoadError(null)
    setInfo(data as Info)
  }, [appFetch])

  useEffect(() => {
    load()
  }, [load])

  const openForm = (kind: 'enable' | 'change') => {
    setForm(kind)
    setPassword('')
    setConfirm('')
    setError(null)
    setNotice(null)
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form) return
    setError(null)
    if (password.length < 8) return setError('La password deve avere almeno 8 caratteri.')
    if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) return setError('Usa almeno una lettera e un numero.')
    if (password !== confirm) return setError('Le due password non sono uguali.')
    if (form === 'change' && !window.confirm('Chi è entrato con la password di adesso esce subito e dovrà usare quella nuova. Continuare?')) return
    setBusy(true)
    const res = await appFetch('/api/app/account/password-access', { method: 'POST', body: JSON.stringify({ action: form, password }) }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setBusy(false)
    if (!res?.ok) return setError(data.error || 'Connessione non riuscita, riprova.')
    setInfo(data as Info)
    setNotice(
      form === 'enable'
        ? 'Accesso con password attivo. Dai ai collaboratori l’email dell’account e questa password (o il link qui sopra).'
        : 'Password cambiata: chi era entrato con quella di prima è uscito. Dai la nuova password ai collaboratori.'
    )
    setForm(null)
    setPassword('')
    setConfirm('')
  }

  const disable = async () => {
    if (!window.confirm('Spegnere l’accesso con password? Chi è entrato con la password dei collaboratori esce subito e non potrà più entrare. Tu continui a entrare come sempre.')) return
    setBusy(true)
    setError(null)
    setNotice(null)
    const res = await appFetch('/api/app/account/password-access', { method: 'POST', body: JSON.stringify({ action: 'disable' }) }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setBusy(false)
    if (!res?.ok) return setError(data.error || 'Connessione non riuscita, riprova.')
    setInfo(data as Info)
    setForm(null)
    setNotice('Accesso con password spento: sono usciti tutti quelli entrati con la password dei collaboratori.')
  }

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      window.prompt('Copia:', text)
    }
  }

  const card = 'rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-5'
  const pill = 'inline-flex min-h-[40px] items-center gap-2 rounded-full border border-[var(--border-color)] px-4 text-sm font-medium text-[var(--text-primary)] disabled:opacity-50'

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="flex items-center gap-2 text-2xl font-extrabold text-[var(--text-primary)]">
        <KeyRound className="h-6 w-6 text-[var(--accent-blue)]" /> Account
      </h1>
      <p className="mt-1 text-sm text-[var(--text-secondary)]" translate="no">
        {info?.email || accountEmail}
      </p>

      {loadError && <p className="mt-6 rounded-xl border border-[#ff6b6b]/40 bg-[#ff6b6b]/10 px-4 py-3 text-sm text-[var(--text-primary)]">{loadError}</p>}
      {!info && !loadError && (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--text-secondary)]" />
        </div>
      )}

      {info && (
        <section className={`${card} mt-6`}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--text-primary)]">
                <Users className="h-5 w-5 text-[var(--accent-blue)]" /> Accesso con password per i collaboratori
              </h2>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                Fai entrare altre persone nel tuo account con la tua email e una password scelta da te, senza darle{' '}
                {info.providers.includes('google') ? 'il tuo accesso con Google' : 'la tua password'}.
              </p>
            </div>
            <Toggle
              on={info.enabled}
              disabled={busy || isShared || info.shared}
              label="Accesso con password per i collaboratori"
              onChange={(v) => (v ? openForm('enable') : disable())}
            />
          </div>

          {(isShared || info.shared) && (
            <p className="mt-4 rounded-xl border border-[var(--border-color)] px-4 py-3 text-sm text-[var(--text-secondary)]">
              Sei entrato con la password dei collaboratori: solo il titolare dell’account può cambiarla o spegnerla, entrando con il suo accesso.
            </p>
          )}

          {!isShared && !info.shared && (
            <>
              <p className="mt-4 flex gap-2 rounded-xl border border-[#FF9500]/40 bg-[#FF9500]/10 px-4 py-3 text-sm text-[var(--text-primary)]">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#FF9500]" />
                <span>
                  Chi entra con questa password entra nel tuo account: vede tutti i tuoi spazi di lavoro e può fare quasi tutto quello che fai tu (messaggi, canali,
                  contenuti). Solo tu puoi cambiare questa password, accettare i termini e gestire piano e pagamenti. Dalla solo a persone di fiducia.
                </span>
              </p>

              {info.enabled && form === null && (
                <div className="mt-4 space-y-3">
                  <div className="rounded-xl border border-[var(--border-color)] p-4">
                    <p className="text-xs font-medium text-[var(--text-secondary)]">Per entrare i collaboratori usano</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="min-w-0 truncate font-mono text-sm text-[var(--text-primary)]" translate="no">
                        {info.email}
                      </span>
                      <button type="button" onClick={() => copy(info.email, 'email')} className={pill}>
                        {copied === 'email' ? <Check className="h-4 w-4 text-[#34C759]" /> : <Copy className="h-4 w-4" />} Copia email
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-[var(--text-secondary)]">+ la password che hai scelto (non possiamo mostrartela di nuovo: se non la ricordi, cambiala).</p>
                    <button type="button" onClick={() => copy(info.link, 'link')} className={`${pill} mt-3`}>
                      {copied === 'link' ? <Check className="h-4 w-4 text-[#34C759]" /> : <Copy className="h-4 w-4" />} Copia il link per i collaboratori
                    </button>
                  </div>
                  {info.changedAt && <p className="text-xs text-[var(--text-secondary)]">Ultima modifica: {when(info.changedAt)}</p>}
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => openForm('change')} disabled={busy} className={pill}>
                      <KeyRound className="h-4 w-4" /> Cambia password
                    </button>
                    <button type="button" onClick={disable} disabled={busy} className={`${pill} text-[#ff6b6b]`}>
                      Spegni l’accesso con password
                    </button>
                  </div>
                </div>
              )}

              {form && (
                <form onSubmit={save} className="mt-4 space-y-3">
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    {form === 'enable' ? 'Scegli la password per i collaboratori' : 'Nuova password per i collaboratori'}
                  </p>
                  <div className="relative">
                    <input
                      className={`${input} pr-12`}
                      type={show ? 'text' : 'password'}
                      autoComplete="new-password"
                      placeholder="Almeno 8 caratteri, con lettere e numeri"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setShow(!show)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]"
                      aria-label={show ? 'Nascondi la password' : 'Mostra la password'}
                    >
                      {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                  <input
                    className={input}
                    type={show ? 'text' : 'password'}
                    autoComplete="new-password"
                    placeholder="Ripeti la password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                  <p className="text-xs text-[var(--text-secondary)]">
                    Usa una password diversa da quella con cui entri tu.{form === 'change' ? ' Chi è entrato con la password di adesso esce subito.' : ''}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button type="submit" disabled={busy} className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-[var(--accent-blue)] px-5 font-semibold text-white disabled:opacity-50">
                      {busy && <Loader2 className="h-4 w-4 animate-spin" />} {form === 'enable' ? 'Attiva' : 'Cambia password'}
                    </button>
                    <button type="button" onClick={() => setForm(null)} disabled={busy} className={pill}>
                      Annulla
                    </button>
                  </div>
                </form>
              )}

              {!info.enabled && form === null && (
                <p className="mt-4 text-sm text-[var(--text-secondary)]">Spento: si entra solo con il tuo accesso{info.providers.includes('google') ? ' (Google)' : ''}.</p>
              )}
            </>
          )}

          {error && <p className="mt-4 text-sm text-[#ff6b6b]">{error}</p>}
          {notice && <p className="mt-4 text-sm text-[#34C759]">{notice}</p>}
        </section>
      )}
    </div>
  )
}
