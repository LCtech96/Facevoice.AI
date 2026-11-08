'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Copy, Eye, EyeOff, KeyRound, ListTodo, Loader2, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useAdminGate } from '../contratti/useAdminGate'
import { adminTodoFetch, copyText } from './todo-admin-api'

// Pagina Todo (solo l'admin): crea una todo list con nome e password, copia il link
// da mandare (la password si manda a parte), cambia password, rigenera il link,
// rinomina, elimina, apri.

type Board = { id: string; name: string; createdAt: string; updatedAt: string; link: string | null }

const day = (iso: string) => new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

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

export default function TodoAdminClient() {
  const allowed = useAdminGate()
  const [boards, setBoards] = useState<Board[] | null>(null)
  const [setup, setSetup] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [created, setCreated] = useState<Board | null>(null)
  const [pwFor, setPwFor] = useState<string | null>(null)
  const [newPw, setNewPw] = useState('')

  const load = useCallback(async () => {
    const r = await adminTodoFetch('/api/admin/todo')
    if (r.ok) {
      setSetup(false)
      setError(null)
      setBoards(r.data.boards || [])
      return
    }
    if (r.data.setup) setSetup(true)
    else setError(r.data.error || 'Non riesco a caricare le todo list.')
    setBoards((b) => b ?? [])
  }, [])

  useEffect(() => {
    if (allowed) load()
  }, [allowed, load])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(t)
  }, [notice])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setError('Dai un nome alla todo list.')
    if (password.length < 6) return setError('La password deve avere almeno 6 caratteri.')
    setBusy('create')
    const r = await adminTodoFetch('/api/admin/todo', { method: 'POST', body: JSON.stringify({ name, password }) })
    setBusy(null)
    if (!r.ok) {
      if (r.data.setup) setSetup(true)
      return setError(r.data.error || 'Non riesco a creare la todo list.')
    }
    setError(null)
    setName('')
    setPassword('')
    setCreated(r.data.board)
    load()
  }

  const patch = async (b: Board, body: Record<string, unknown>, done: string) => {
    setBusy(`${body.action}:${b.id}`)
    const r = await adminTodoFetch(`/api/admin/todo/${encodeURIComponent(b.id)}`, { method: 'PATCH', body: JSON.stringify(body) })
    setBusy(null)
    if (!r.ok) return setError(r.data.error || 'Operazione non riuscita.')
    setError(null)
    setNotice(done)
    if (body.action === 'regenerate' && r.data.board) setCreated(r.data.board)
    load()
    return true
  }

  const copy = async (link: string | null) => {
    if (!link) return setError('Link non leggibile: crea un link nuovo.')
    if (await copyText(link)) setNotice('Link copiato. Ricordati di mandare la password a parte.')
  }

  const rename = (b: Board) => {
    const next = window.prompt('Nuovo nome della todo list:', b.name)
    if (next && next.trim() && next.trim() !== b.name) patch(b, { action: 'rename', name: next }, 'Nome cambiato.')
  }

  const regenerate = (b: Board) => {
    if (!window.confirm(`Creare un link nuovo per «${b.name}»? Il link di prima smette di funzionare e chi era dentro dovrà usare quello nuovo.`)) return
    patch(b, { action: 'regenerate' }, 'Link nuovo creato.')
  }

  const changePw = async (b: Board) => {
    if (newPw.length < 6) return setError('La password deve avere almeno 6 caratteri.')
    if (await patch(b, { action: 'password', password: newPw }, 'Password cambiata: chi era dentro deve mettere quella nuova.')) {
      setPwFor(null)
      setNewPw('')
    }
  }

  const remove = async (b: Board) => {
    if (!window.confirm(`Eliminare «${b.name}» con tutte le tabelle, le attività e le immagini? Non si può annullare.`)) return
    setBusy(`del:${b.id}`)
    const r = await adminTodoFetch(`/api/admin/todo/${encodeURIComponent(b.id)}`, { method: 'DELETE' })
    setBusy(null)
    if (!r.ok) return setError(r.data.error || 'Non riesco a eliminare.')
    if (created?.id === b.id) setCreated(null)
    load()
  }

  if (!allowed) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[var(--accent-blue)]/30 border-t-[var(--accent-blue)]" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-4 pb-28 pt-20 md:pb-16 md:pt-24">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-[var(--text-primary)]">
            <ListTodo className="h-6 w-6" /> Todo
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Todo list da condividere: crei la lista con una password, mandi il link e, a parte, la password. Chi la apre può leggere, scrivere, spostare e creare tabelle.</p>
        </div>
        <button type="button" onClick={load} className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-[var(--accent-blue)] px-3 py-2 text-sm text-white">
          <RefreshCw className="h-4 w-4" /> Aggiorna
        </button>
      </div>

      {setup && (
        <div className="mt-4 rounded-xl border border-[#FF9500]/50 bg-[#FF9500]/10 p-4 text-sm text-[var(--text-primary)]">
          <p className="font-semibold">Esegui prima lo SQL della todo list.</p>
          <p className="mt-1 text-[var(--text-secondary)]">Nel SQL Editor di Supabase esegui il file supabase/migrations/2026-11-08_todo_boards.sql, poi premi Aggiorna.</p>
        </div>
      )}
      {error && <p className="mt-4 rounded-xl border border-[#FF3B30]/40 bg-[#FF3B30]/10 px-3 py-2 text-sm text-[var(--text-primary)]">{error}</p>}
      {notice && <p className="mt-4 rounded-xl border border-[#34C759]/40 bg-[#34C759]/10 px-3 py-2 text-sm text-[var(--text-primary)]">{notice}</p>}

      {!setup && (
        <form onSubmit={create} className="mt-5 rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-4">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Nuova todo list</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-[var(--text-secondary)]" htmlFor="todo-name">
                Nome
              </label>
              <input id="todo-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Es. Lancio sito cliente" className={input} />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--text-secondary)]" htmlFor="todo-pw">
                Password (almeno 6 caratteri)
              </label>
              <PasswordInput id="todo-pw" value={password} onChange={setPassword} />
            </div>
          </div>
          <button type="submit" disabled={busy === 'create'} className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-full bg-[var(--accent-blue)] px-5 text-sm font-semibold text-white disabled:opacity-50">
            {busy === 'create' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Crea todo list
          </button>
        </form>
      )}

      {created?.link && (
        <div className="mt-4 rounded-2xl border border-[var(--accent-blue)]/50 bg-[var(--accent-blue)]/10 p-4">
          <p className="text-sm font-semibold text-[var(--text-primary)]">Link di «{created.name}»</p>
          <p className="mt-1 break-all rounded-lg bg-[var(--background)] px-3 py-2 font-mono text-xs text-[var(--text-primary)]">{created.link}</p>
          <p className="mt-2 text-xs text-[var(--text-secondary)]">Manda il link alla persona e, in un messaggio separato, la password.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => copy(created.link)} className="inline-flex min-h-[36px] items-center gap-1 rounded-full bg-[var(--accent-blue)] px-3 text-xs font-semibold text-white">
              <Copy className="h-3.5 w-3.5" /> Copia link
            </button>
            <Link href={`/admin/todo/${encodeURIComponent(created.id)}`} className={pill}>
              Apri
            </Link>
            <button type="button" onClick={() => setCreated(null)} className={pill}>
              Chiudi
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 space-y-2">
        {boards === null ? (
          <p className="py-8 text-center text-sm text-[var(--text-secondary)]">Caricamento…</p>
        ) : boards.length === 0 ? (
          !setup && <p className="rounded-xl border border-dashed border-[var(--border-color)] p-6 text-center text-sm text-[var(--text-secondary)]">Ancora nessuna todo list.</p>
        ) : (
          boards.map((b) => (
            <div key={b.id} className="rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-3">
              <Link href={`/admin/todo/${encodeURIComponent(b.id)}`} className="block min-w-0">
                <span className="block break-words text-sm font-semibold text-[var(--text-primary)]">{b.name}</span>
                <span className="block text-xs text-[var(--text-secondary)]">Creata il {day(b.createdAt)}</span>
              </Link>
              <div className="mt-2 flex flex-wrap gap-2">
                <Link href={`/admin/todo/${encodeURIComponent(b.id)}`} className="inline-flex min-h-[36px] items-center gap-1 rounded-full bg-[var(--accent-blue)] px-3 py-1.5 text-xs font-semibold text-white">
                  Apri
                </Link>
                <button type="button" onClick={() => copy(b.link)} className={pill}>
                  <Copy className="h-3.5 w-3.5" /> Copia link
                </button>
                <button type="button" onClick={() => (setPwFor(pwFor === b.id ? null : b.id), setNewPw(''))} className={pill}>
                  <KeyRound className="h-3.5 w-3.5" /> Cambia password
                </button>
                <button type="button" onClick={() => regenerate(b)} disabled={busy === `regenerate:${b.id}`} className={pill}>
                  {busy === `regenerate:${b.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Nuovo link
                </button>
                <button type="button" onClick={() => rename(b)} className={pill}>
                  <Pencil className="h-3.5 w-3.5" /> Rinomina
                </button>
                <button type="button" onClick={() => remove(b)} disabled={busy === `del:${b.id}`} className="inline-flex min-h-[36px] items-center gap-1 rounded-full border border-[#FF3B30]/40 px-3 py-1.5 text-xs text-[#FF3B30] disabled:opacity-50">
                  {busy === `del:${b.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Elimina
                </button>
              </div>
              {pwFor === b.id && (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <div className="flex-1">
                    <PasswordInput id={`pw-${b.id}`} value={newPw} onChange={setNewPw} placeholder="Nuova password (almeno 6 caratteri)" />
                  </div>
                  <button type="button" onClick={() => changePw(b)} disabled={busy === `password:${b.id}`} className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-full bg-[var(--accent-blue)] px-4 text-sm font-semibold text-white disabled:opacity-50">
                    {busy === `password:${b.id}` && <Loader2 className="h-4 w-4 animate-spin" />} Salva password
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
