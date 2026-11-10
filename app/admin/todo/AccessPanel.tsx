'use client'

import { useState } from 'react'
import { AlertTriangle, Copy, Eye, EyeOff, KeyRound, Loader2, Mail, Plus, Trash2, UserPlus, Users, Wand2, X } from 'lucide-react'
import { adminTodoFetch, copyText, generatePassword, looksLikeEmail, type AdminAccess, type AdminBoard } from './todo-admin-api'

// Accessi delle persone ai progetti: chi vede cosa. Nome e password li sceglie l'admin
// (pulsante «Genera» per una password casuale) e li comunica lui: non partono email
// con la password. L'email della persona e' obbligatoria: a ogni entrata le arriva un
// codice di 6 cifre (senza email non puo' entrare) e i solleciti le portano il link
// diretto all'attivita'.

const input =
  'min-h-[44px] w-full rounded-xl border border-[var(--border-color)] bg-[var(--background)] px-3 text-base text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)] md:text-sm'
const pill = 'inline-flex min-h-[36px] items-center gap-1 rounded-full border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-primary)] disabled:opacity-50'

export function PasswordField({ value, onChange, id, placeholder }: { value: string; onChange: (v: string) => void; id: string; placeholder?: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="flex items-center gap-1 rounded-xl border border-[var(--border-color)] bg-[var(--background)] pr-1 focus-within:border-[var(--accent-blue)]">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="new-password"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={128}
        placeholder={placeholder}
        className="min-h-[44px] w-full bg-transparent px-3 text-base text-[var(--text-primary)] outline-none md:text-sm"
      />
      <button type="button" onClick={() => setShow(!show)} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--text-secondary)]" aria-label={show ? 'Nascondi password' : 'Mostra password'}>
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
      <button
        type="button"
        onClick={() => {
          onChange(generatePassword())
          setShow(true)
        }}
        className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-[var(--accent-blue)]"
      >
        <Wand2 className="h-3.5 w-3.5" /> Genera
      </button>
    </div>
  )
}

/** Riquadro con i dati da comunicare alla persona (a voce o in chat: non per email). */
export function Credentials({ name, password, portal, onClose }: { name: string; password: string; portal: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const text = `Progetti Facevoice\nIndirizzo: ${portal}\nNome: ${name}\nPassword: ${password}`
  return (
    <div className="rounded-2xl border border-[var(--accent-blue)]/50 bg-[var(--accent-blue)]/10 p-4">
      <p className="text-sm font-semibold text-[var(--text-primary)]">Accesso pronto per «{name}»</p>
      <pre className="mt-2 whitespace-pre-wrap break-all rounded-lg bg-[var(--background)] px-3 py-2 font-mono text-xs text-[var(--text-primary)]">{text}</pre>
      <p className="mt-2 text-xs text-[var(--text-secondary)]">Comunicalo tu (a voce o in chat): non viene mandato per email e la password non si potrà più rivedere. Quando entra, le arriva per email un codice di 6 cifre.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={async () => {
            if (await copyText(text)) {
              setCopied(true)
              setTimeout(() => setCopied(false), 2500)
            }
          }}
          className="inline-flex min-h-[36px] items-center gap-1 rounded-full bg-[var(--accent-blue)] px-3 text-xs font-semibold text-white"
        >
          <Copy className="h-3.5 w-3.5" /> {copied ? 'Copiato' : 'Copia'}
        </button>
        <button type="button" onClick={onClose} className={pill}>
          Chiudi
        </button>
      </div>
    </div>
  )
}

/** Avviso: accesso senza email (non puo' entrare finche' non la si aggiunge). */
function MissingEmail() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#FF9500]/15 px-2 py-0.5 text-[11px] font-semibold text-[#FF9500]" title="Senza email non può entrare: aggiungila.">
      <AlertTriangle className="h-3 w-3" /> Email mancante
    </span>
  )
}

/** Finestra «Dai accesso» per i progetti selezionati: persona esistente o nuova. */
export function GrantDialog({
  boards,
  accesses,
  selected,
  onClose,
  onDone,
}: {
  boards: AdminBoard[]
  accesses: AdminAccess[]
  selected: string[]
  onClose: () => void
  onDone: (message: string, credentials?: { name: string; password: string }) => void
}) {
  const [who, setWho] = useState<string>(accesses[0]?.id || 'new')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const names = selected.map((id) => boards.find((b) => b.id === id)?.name).filter(Boolean) as string[]

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (who === 'new') {
      if (!name.trim()) return setError('Scrivi il nome della persona.')
      if (!looksLikeEmail(email)) return setError('Scrivi un’email valida: serve per il codice di entrata.')
      if (password.length < 6) return setError('La password deve avere almeno 6 caratteri.')
    }
    setBusy(true)
    const r =
      who === 'new'
        ? await adminTodoFetch('/api/admin/todo/accessi', { method: 'POST', body: JSON.stringify({ name, email, password, boardIds: selected }) })
        : await adminTodoFetch(`/api/admin/todo/accessi/${encodeURIComponent(who)}`, { method: 'PATCH', body: JSON.stringify({ action: 'grant', boardIds: selected }) })
    setBusy(false)
    if (!r.ok) return setError(r.data.error || 'Operazione non riuscita.')
    const person = r.data.access?.name || name
    const msg = `Fatto: ${person} ora vede ${names.length === 1 ? `«${names[0]}»` : `${names.length} progetti in più`}.`
    onDone(msg, who === 'new' ? { name: person, password } : undefined)
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-[var(--border-color)] bg-[var(--card-background)] p-4 shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Dai accesso</h2>
          <button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[var(--text-secondary)]" aria-label="Chiudi">
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          {names.length === 1 ? 'Progetto:' : `${names.length} progetti:`} <span className="text-[var(--text-primary)]">{names.join(', ')}</span>
        </p>
        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">A chi</p>
        <div className="mt-1 space-y-1">
          {accesses.map((a) => (
            <label key={a.id} className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border px-3 ${who === a.id ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)]/10' : 'border-[var(--border-color)]'}`}>
              <input type="radio" name="who" checked={who === a.id} onChange={() => setWho(a.id)} />
              <span className="text-sm font-medium text-[var(--text-primary)]">{a.name}</span>
              {!a.email && <MissingEmail />}
              <span className="ml-auto text-xs text-[var(--text-secondary)]">{a.boardIds.length} progetti</span>
            </label>
          ))}
          <label className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border px-3 ${who === 'new' ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)]/10' : 'border-[var(--border-color)]'}`}>
            <input type="radio" name="who" checked={who === 'new'} onChange={() => setWho('new')} />
            <UserPlus className="h-4 w-4 text-[var(--accent-blue)]" />
            <span className="text-sm font-medium text-[var(--text-primary)]">Nuova persona</span>
          </label>
        </div>
        {who === 'new' && (
          <div className="mt-3 space-y-2">
            <div>
              <label className="mb-1 block text-xs text-[var(--text-secondary)]" htmlFor="grant-name">
                Nome (con questo entra)
              </label>
              <input id="grant-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Es. Monia" className={input} autoFocus />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--text-secondary)]" htmlFor="grant-email">
                Email (obbligatoria: le arriva il codice per entrare)
              </label>
              <input id="grant-email" type="email" inputMode="email" autoComplete="off" required value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} placeholder="Es. monia@gmail.com" className={input} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--text-secondary)]" htmlFor="grant-pw">
                Password (almeno 6 caratteri)
              </label>
              <PasswordField id="grant-pw" value={password} onChange={setPassword} />
            </div>
          </div>
        )}
        {error && <p className="mt-3 text-sm text-[#FF3B30]">{error}</p>}
        <button type="submit" disabled={busy || !selected.length} className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full bg-[var(--accent-blue)] px-5 text-sm font-semibold text-white disabled:opacity-50">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Dai accesso
        </button>
      </form>
    </div>
  )
}

/** Elenco degli accessi: progetti di ognuno, aggiungi/togli, password nuova, elimina. */
export default function AccessPanel({ boards, accesses, portal, reload }: { boards: AdminBoard[]; accesses: AdminAccess[]; portal: string; reload: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pwFor, setPwFor] = useState<string | null>(null)
  const [newPw, setNewPw] = useState('')
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailFor, setEmailFor] = useState<string | null>(null)
  const [newEmail, setNewEmail] = useState('')
  const [credentials, setCredentials] = useState<{ name: string; password: string } | null>(null)
  const boardName = new Map(boards.map((b) => [b.id, b.name]))

  const call = async (key: string, url: string, init: RequestInit, done: string) => {
    setBusy(key)
    setError(null)
    const r = await adminTodoFetch(url, init)
    setBusy(null)
    if (!r.ok) {
      setError(r.data.error || 'Operazione non riuscita.')
      return null
    }
    setNotice(done)
    setTimeout(() => setNotice(null), 4000)
    reload()
    return r
  }

  const patch = (a: AdminAccess, body: Record<string, unknown>, done: string) => call(`${body.action}:${a.id}`, `/api/admin/todo/accessi/${encodeURIComponent(a.id)}`, { method: 'PATCH', body: JSON.stringify(body) }, done)

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setError('Scrivi il nome della persona.')
    if (!looksLikeEmail(email)) return setError('Scrivi un’email valida: serve per il codice di entrata.')
    if (password.length < 6) return setError('La password deve avere almeno 6 caratteri.')
    const r = await call('create', '/api/admin/todo/accessi', { method: 'POST', body: JSON.stringify({ name, email, password, boardIds: [] }) }, 'Accesso creato: ora aggiungi i progetti.')
    if (r) {
      setCredentials({ name: r.data.access?.name || name, password })
      setName('')
      setEmail('')
      setPassword('')
      setAdding(false)
    }
  }

  return (
    <section className="rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--text-primary)]">
          <Users className="h-5 w-5" /> Accessi
        </h2>
        <button type="button" onClick={() => setAdding(!adding)} className={pill}>
          <UserPlus className="h-3.5 w-3.5" /> Nuova persona
        </button>
      </div>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">
        Chi ha un accesso entra da <span className="font-mono">{portal}</span> con nome, password e un codice che gli arriva per email, e vede solo i suoi progetti. Per darne altri: seleziona le cartelle e premi «Dai accesso».
      </p>
      {error && <p className="mt-3 rounded-xl border border-[#FF3B30]/40 bg-[#FF3B30]/10 px-3 py-2 text-sm text-[var(--text-primary)]">{error}</p>}
      {notice && <p className="mt-3 rounded-xl border border-[#34C759]/40 bg-[#34C759]/10 px-3 py-2 text-sm text-[var(--text-primary)]">{notice}</p>}
      {credentials && (
        <div className="mt-3">
          <Credentials name={credentials.name} password={credentials.password} portal={portal} onClose={() => setCredentials(null)} />
        </div>
      )}
      {adding && (
        <form onSubmit={create} className="mt-3 grid gap-2 rounded-xl border border-[var(--border-color)] p-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto]">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Nome (es. Monia)" className={input} aria-label="Nome" />
          <input type="email" inputMode="email" autoComplete="off" required value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} placeholder="Email (obbligatoria)" className={input} aria-label="Email (obbligatoria: le arriva il codice per entrare)" />
          <PasswordField id="new-access-pw" value={password} onChange={setPassword} placeholder="Password" />
          <button type="submit" disabled={busy === 'create'} className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-full bg-[var(--accent-blue)] px-4 text-sm font-semibold text-white disabled:opacity-50">
            {busy === 'create' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Crea
          </button>
        </form>
      )}

      <div className="mt-3 space-y-2">
        {accesses.length === 0 && <p className="rounded-xl border border-dashed border-[var(--border-color)] p-4 text-center text-sm text-[var(--text-secondary)]">Ancora nessun accesso.</p>}
        {accesses.map((a) => {
          const missing = boards.filter((b) => !a.boardIds.includes(b.id))
          return (
            <div key={a.id} className="rounded-xl border border-[var(--border-color)] bg-[var(--background)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                    {a.name} {!a.email && <MissingEmail />}
                  </p>
                  {a.email && <p className="truncate text-xs text-[var(--text-secondary)]">{a.email}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => (setEmailFor(emailFor === a.id ? null : a.id), setNewEmail(a.email || ''))} className={pill}>
                    <Mail className="h-3.5 w-3.5" /> {a.email ? 'Cambia email' : 'Aggiungi email'}
                  </button>
                  <button type="button" onClick={() => (setPwFor(pwFor === a.id ? null : a.id), setNewPw(''))} className={pill}>
                    <KeyRound className="h-3.5 w-3.5" /> Cambia password
                  </button>
                  <button
                    type="button"
                    disabled={busy === `del:${a.id}`}
                    onClick={() => {
                      if (window.confirm(`Eliminare l’accesso di «${a.name}»? Esce subito e non vedrà più nessun progetto.`))
                        call(`del:${a.id}`, `/api/admin/todo/accessi/${encodeURIComponent(a.id)}`, { method: 'DELETE' }, 'Accesso eliminato.')
                    }}
                    className="inline-flex min-h-[36px] items-center gap-1 rounded-full border border-[#FF3B30]/40 px-3 py-1.5 text-xs text-[#FF3B30] disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Elimina
                  </button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {a.boardIds.length === 0 && <span className="text-xs text-[var(--text-secondary)]">Nessun progetto.</span>}
                {a.boardIds.map((id) => (
                  <span key={id} className="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] py-0.5 pl-2.5 pr-1 text-xs text-[var(--text-primary)]">
                    {boardName.get(id) || 'Progetto'}
                    <button
                      type="button"
                      onClick={() => patch(a, { action: 'revoke', boardIds: [id] }, `Tolto «${boardName.get(id) || 'progetto'}» a ${a.name}.`)}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[var(--text-secondary)] hover:text-[#FF3B30]"
                      aria-label={`Togli «${boardName.get(id) || 'progetto'}» a ${a.name}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                ))}
                {missing.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => e.target.value && patch(a, { action: 'grant', boardIds: [e.target.value] }, `Aggiunto «${boardName.get(e.target.value)}» a ${a.name}.`)}
                    className="min-h-[30px] rounded-full border border-dashed border-[var(--border-color)] bg-transparent px-2 text-xs text-[var(--accent-blue)]"
                    aria-label={`Aggiungi un progetto a ${a.name}`}
                  >
                    <option value="">+ Aggiungi progetto</option>
                    {missing.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {emailFor === a.id && (
                <form
                  className="mt-3 flex flex-col gap-2 sm:flex-row"
                  onSubmit={async (e) => {
                    e.preventDefault()
                    if (!looksLikeEmail(newEmail)) return setError('Scrivi un’email valida: serve per il codice di entrata.')
                    if (await patch(a, { action: 'email', email: newEmail }, `Email di ${a.name} salvata.`)) {
                      setEmailFor(null)
                      setNewEmail('')
                    }
                  }}
                >
                  <input type="email" inputMode="email" autoComplete="off" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} maxLength={200} placeholder="Email (es. monia@gmail.com)" className={`${input} flex-1`} aria-label={`Email di ${a.name}`} autoFocus />
                  <button type="submit" disabled={busy === `email:${a.id}`} className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-full bg-[var(--accent-blue)] px-4 text-sm font-semibold text-white disabled:opacity-50">
                    {busy === `email:${a.id}` && <Loader2 className="h-4 w-4 animate-spin" />} Salva email
                  </button>
                </form>
              )}
              {pwFor === a.id && (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <div className="flex-1">
                    <PasswordField id={`apw-${a.id}`} value={newPw} onChange={setNewPw} placeholder="Nuova password (almeno 6 caratteri)" />
                  </div>
                  <button
                    type="button"
                    disabled={busy === `password:${a.id}`}
                    onClick={async () => {
                      if (newPw.length < 6) return setError('La password deve avere almeno 6 caratteri.')
                      const pw = newPw
                      if (await patch(a, { action: 'password', password: pw }, `Password cambiata: ${a.name} deve rientrare con quella nuova.`)) {
                        setCredentials({ name: a.name, password: pw })
                        setPwFor(null)
                        setNewPw('')
                      }
                    }}
                    className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-full bg-[var(--accent-blue)] px-4 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {busy === `password:${a.id}` && <Loader2 className="h-4 w-4 animate-spin" />} Salva password
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
