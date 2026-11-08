'use client'

import { useCallback, useEffect, useState } from 'react'
import { Eye, EyeOff, KeyRound, Loader2, Mail, Plus, Trash2, Users } from 'lucide-react'
import { adminTodoFetch } from '../todo-admin-api'

// Persone della todo list (solo l'admin): nome, email (per i solleciti delle attivita'
// assegnate a loro) e password personale. Tutti usano lo stesso link; ognuno entra con
// il suo nome e la sua password. Password cambiata o persona tolta: esce solo lei.

type Person = { id: string; name: string; email: string | null; createdAt: string }

const input =
  'min-h-[44px] w-full rounded-xl border border-[var(--border-color)] bg-[var(--background)] px-3 text-base text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)] md:text-sm'
const pill = 'inline-flex min-h-[36px] items-center gap-1 rounded-full border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-primary)] disabled:opacity-50'

function PasswordInput({ value, onChange, id, placeholder }: { value: string; onChange: (v: string) => void; id: string; placeholder?: string }) {
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
    </div>
  )
}

export default function PeoplePanel({ boardId, startOpen }: { boardId: string; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen)
  const [people, setPeople] = useState<Person[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pwFor, setPwFor] = useState<string | null>(null)
  const [newPw, setNewPw] = useState('')

  const url = `/api/admin/todo/${encodeURIComponent(boardId)}`

  const load = useCallback(async () => {
    const r = await adminTodoFetch(url)
    if (r.ok) setPeople(r.data.members || [])
    else setError(r.data.error || 'Non riesco a caricare le persone.')
  }, [url])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(t)
  }, [notice])

  const act = async (key: string, body: Record<string, unknown>, done: string) => {
    setBusy(key)
    const r = await adminTodoFetch(url, { method: 'PATCH', body: JSON.stringify(body) })
    setBusy(null)
    if (!r.ok) {
      setError(r.data.error || 'Operazione non riuscita.')
      return false
    }
    setError(null)
    setNotice(done)
    setPeople(r.data.members || [])
    return true
  }

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setError('Scrivi il nome della persona.')
    if (password.length < 6) return setError('La password deve avere almeno 6 caratteri.')
    if (await act('add', { action: 'addMember', name, email, password }, `${name.trim()} aggiunta. Mandale il link e, a parte, la sua password.`)) {
      setName('')
      setEmail('')
      setPassword('')
    }
  }

  const changeEmail = (p: Person) => {
    const next = window.prompt(`Email di ${p.name} (per i solleciti; vuota per toglierla):`, p.email || '')
    if (next === null) return
    act(`mail:${p.id}`, { action: 'memberEmail', memberId: p.id, email: next }, 'Email salvata.')
  }

  const changePw = async (p: Person) => {
    if (newPw.length < 6) return setError('La password deve avere almeno 6 caratteri.')
    if (await act(`pw:${p.id}`, { action: 'memberPassword', memberId: p.id, password: newPw }, `Password di ${p.name} cambiata: deve rientrare con quella nuova.`)) {
      setPwFor(null)
      setNewPw('')
    }
  }

  const remove = (p: Person) => {
    if (!window.confirm(`Togliere ${p.name}? Non potrà più entrare. Le sue attività restano e le vedi solo tu.`)) return
    act(`del:${p.id}`, { action: 'removeMember', memberId: p.id }, `${p.name} tolta.`)
  }

  return (
    <div className="mx-auto mb-3 max-w-6xl px-4">
      <button type="button" onClick={() => setOpen(!open)} className={pill} aria-expanded={open}>
        <Users className="h-3.5 w-3.5" /> Persone{people ? ` (${people.length})` : ''}
      </button>
      {open && (
        <div className="mt-2 rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-4">
          <p className="text-xs text-[var(--text-secondary)]">
            Tutti usano lo stesso link ed entrano con il loro nome e la loro password. Ognuno vede solo le attività assegnate a lui, quelle che ha creato e quelle senza persona create da te. Le attività che crei tu le possono solo spostare e segnare come fatte. Di solito non serve passare da qui: apri un’attività e in «Assegna a» scrivi nome, email e password.
          </p>
          {error && <p className="mt-3 rounded-xl border border-[#FF3B30]/40 bg-[#FF3B30]/10 px-3 py-2 text-sm text-[var(--text-primary)]">{error}</p>}
          {notice && <p className="mt-3 rounded-xl border border-[#34C759]/40 bg-[#34C759]/10 px-3 py-2 text-sm text-[var(--text-primary)]">{notice}</p>}

          <div className="mt-3 space-y-2">
            {people === null ? (
              <p className="text-sm text-[var(--text-secondary)]">Caricamento…</p>
            ) : people.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[var(--border-color)] p-3 text-sm text-[var(--text-secondary)]">Ancora nessuna persona: aggiungine una qui sotto.</p>
            ) : (
              people.map((p) => (
                <div key={p.id} className="rounded-xl border border-[var(--border-color)] bg-[var(--background)] p-3">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">{p.name}</p>
                  <p className="text-xs text-[var(--text-secondary)]">{p.email || 'Nessuna email'}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" onClick={() => (setPwFor(pwFor === p.id ? null : p.id), setNewPw(''))} className={pill}>
                      <KeyRound className="h-3.5 w-3.5" /> Cambia password
                    </button>
                    <button type="button" onClick={() => changeEmail(p)} disabled={busy === `mail:${p.id}`} className={pill}>
                      <Mail className="h-3.5 w-3.5" /> Email
                    </button>
                    <button type="button" onClick={() => remove(p)} disabled={busy === `del:${p.id}`} className="inline-flex min-h-[36px] items-center gap-1 rounded-full border border-[#FF3B30]/40 px-3 py-1.5 text-xs text-[#FF3B30] disabled:opacity-50">
                      {busy === `del:${p.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Togli
                    </button>
                  </div>
                  {pwFor === p.id && (
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                      <div className="flex-1">
                        <PasswordInput id={`pw-${p.id}`} value={newPw} onChange={setNewPw} placeholder="Nuova password (almeno 6 caratteri)" />
                      </div>
                      <button type="button" onClick={() => changePw(p)} disabled={busy === `pw:${p.id}`} className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-full bg-[var(--accent-blue)] px-4 text-sm font-semibold text-white disabled:opacity-50">
                        {busy === `pw:${p.id}` && <Loader2 className="h-4 w-4 animate-spin" />} Salva password
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <form onSubmit={add} className="mt-4 border-t border-[var(--border-color)] pt-4">
            <p className="text-sm font-semibold text-[var(--text-primary)]">Aggiungi una persona</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs text-[var(--text-secondary)]" htmlFor="person-name">
                  Nome
                </label>
                <input id="person-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Es. Sevara" className={input} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--text-secondary)]" htmlFor="person-email">
                  Email (facoltativa)
                </label>
                <input id="person-email" type="email" inputMode="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} placeholder="per i solleciti" className={input} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-[var(--text-secondary)]" htmlFor="person-pw">
                  Password (almeno 6 caratteri)
                </label>
                <PasswordInput id="person-pw" value={password} onChange={setPassword} />
              </div>
            </div>
            <button type="submit" disabled={busy === 'add'} className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-full bg-[var(--accent-blue)] px-5 text-sm font-semibold text-white disabled:opacity-50">
              {busy === 'add' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Aggiungi
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
