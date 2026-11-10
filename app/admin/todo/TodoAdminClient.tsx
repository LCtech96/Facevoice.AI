'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, Copy, FolderPlus, ListTodo, Loader2, Plus, RefreshCw, UserCheck, Users, X } from 'lucide-react'
import TodoHome from '@/components/todo/TodoHome'
import TodoBell from '@/components/todo/TodoBell'
import type { TodoBellItem, TodoHomeData } from '@/lib/todo-shared'
import { useAdminGate } from '../contratti/useAdminGate'
import AccessPanel, { Credentials, GrantDialog, PasswordField } from './AccessPanel'
import { adminBellRequest, adminTodoFetch, copyText, type AdminAccess, type AdminBoard } from './todo-admin-api'

// Schermata generale dei progetti (solo l'admin): cartelle di tutti i progetti e
// calendario delle scadenze; «Nuovo progetto»; selezione di piu' cartelle e «Dai
// accesso» per farle vedere a una persona (nome + password scelti qui, mai per email);
// pannello «Accessi» per vedere e cambiare chi vede cosa; campanella con cosa c'e' da
// fare in tutti i progetti.

const input =
  'min-h-[44px] w-full rounded-xl border border-[var(--border-color)] bg-[var(--background)] px-3 text-base text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)] md:text-sm'
const pill = 'inline-flex min-h-[36px] items-center gap-1 rounded-full border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-primary)] disabled:opacity-50'

export default function TodoAdminClient() {
  const allowed = useAdminGate()
  const router = useRouter()
  const [boards, setBoards] = useState<AdminBoard[] | null>(null)
  const [home, setHome] = useState<TodoHomeData>({ boards: [], tasks: [] })
  const [accesses, setAccesses] = useState<AdminAccess[]>([])
  const [portal, setPortal] = useState('https://www.facevoice.ai/todo')
  const [setup, setSetup] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showAccess, setShowAccess] = useState(false)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<AdminBoard | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [granting, setGranting] = useState(false)
  const [credentials, setCredentials] = useState<{ name: string; password: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await adminTodoFetch('/api/admin/todo')
    setLoading(false)
    if (r.ok) {
      setSetup(false)
      setError(null)
      const list = (r.data.boards || []) as AdminBoard[]
      setBoards(list)
      setHome(r.data.home || { boards: [], tasks: [] })
      setAccesses(r.data.accesses || [])
      if (r.data.portal) setPortal(r.data.portal)
      setSelected((s) => new Set([...s].filter((id) => list.some((b) => b.id === id))))
      return
    }
    if (r.data.setup) setSetup(true)
    else setError(r.data.error || 'Non riesco a caricare i progetti.')
    setBoards((b) => b ?? [])
  }, [])

  useEffect(() => {
    if (allowed) load()
  }, [allowed, load])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 5000)
    return () => clearTimeout(t)
  }, [notice])

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setError('Dai un nome al progetto (es. il nome del cliente).')
    if (password.length < 6) return setError('La password deve avere almeno 6 caratteri.')
    setBusy(true)
    const r = await adminTodoFetch('/api/admin/todo', { method: 'POST', body: JSON.stringify({ name, password }) })
    setBusy(false)
    if (!r.ok) {
      if (r.data.setup) setSetup(true)
      return setError(r.data.error || 'Non riesco a creare il progetto.')
    }
    setError(null)
    setName('')
    setPassword('')
    setShowNew(false)
    setCreated(r.data.board)
    load()
  }

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const open = (boardId: string, taskId?: string) => router.push(`/admin/todo/${encodeURIComponent(boardId)}${taskId ? `?t=${encodeURIComponent(taskId)}` : ''}`)
  const openFromBell = (item: TodoBellItem) => open(item.boardId, item.taskId)

  if (!allowed) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[var(--accent-blue)]/30 border-t-[var(--accent-blue)]" />
      </div>
    )
  }

  const viewers = (boardId: string) => {
    const who = accesses.filter((a) => a.boardIds.includes(boardId)).map((a) => a.name)
    return who.length ? (
      <span className="mt-1 flex items-center gap-1 truncate text-[11px] text-[var(--text-secondary)]">
        <UserCheck className="h-3 w-3 shrink-0" /> <span className="truncate">{who.join(', ')}</span>
      </span>
    ) : null
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-32 pt-20 md:pt-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-[var(--text-primary)]">
            <ListTodo className="h-6 w-6" /> Progetti
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Una cartella per cliente. Apri una cartella per le sue cose da fare; seleziona più cartelle per farle vedere a una persona.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <TodoBell request={adminBellRequest} onOpen={openFromBell} />
          <button type="button" onClick={() => setShowNew(!showNew)} className="inline-flex min-h-[40px] items-center gap-2 rounded-full bg-[var(--accent-blue)] px-4 text-sm font-semibold text-white">
            <FolderPlus className="h-4 w-4" /> Nuovo progetto
          </button>
          <button type="button" onClick={() => setShowAccess(!showAccess)} className={`${pill} min-h-[40px] text-sm`}>
            <Users className="h-4 w-4" /> Accessi ({accesses.length})
            {accesses.some((a) => !a.email) && <AlertTriangle className="h-4 w-4 text-[#FF9500]" aria-label="Qualche accesso senza email" />}
          </button>
          <button type="button" onClick={load} className={`${pill} min-h-[40px]`} aria-label="Aggiorna">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {setup && (
        <div className="mt-4 rounded-xl border border-[#FF9500]/50 bg-[#FF9500]/10 p-4 text-sm text-[var(--text-primary)]">
          <p className="font-semibold">Esegui prima lo SQL della todo list.</p>
          <p className="mt-1 text-[var(--text-secondary)]">Nel SQL Editor di Supabase esegui il file supabase/migrations/2026-11-08_todo_boards.sql, poi premi Aggiorna.</p>
        </div>
      )}
      {error && <p className="mt-4 rounded-xl border border-[#FF3B30]/40 bg-[#FF3B30]/10 px-3 py-2 text-sm text-[var(--text-primary)]">{error}</p>}
      {notice && <p className="mt-4 rounded-xl border border-[#34C759]/40 bg-[#34C759]/10 px-3 py-2 text-sm text-[var(--text-primary)]">{notice}</p>}
      {credentials && (
        <div className="mt-4">
          <Credentials name={credentials.name} password={credentials.password} portal={portal} onClose={() => setCredentials(null)} />
        </div>
      )}

      {showNew && !setup && (
        <form onSubmit={create} className="mt-4 rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-4">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Nuovo progetto</h2>
            <button type="button" onClick={() => setShowNew(false)} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-secondary)]" aria-label="Chiudi">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-[var(--text-secondary)]" htmlFor="todo-name">
                Nome (es. il cliente)
              </label>
              <input id="todo-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Es. Rossi Srl" className={input} autoFocus />
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--text-secondary)]" htmlFor="todo-pw">
                Password del link del progetto (almeno 6 caratteri)
              </label>
              <PasswordField id="todo-pw" value={password} onChange={setPassword} />
            </div>
          </div>
          <button type="submit" disabled={busy} className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-full bg-[var(--accent-blue)] px-5 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Crea progetto
          </button>
        </form>
      )}

      {created?.link && (
        <div className="mt-4 rounded-2xl border border-[var(--accent-blue)]/50 bg-[var(--accent-blue)]/10 p-4">
          <p className="text-sm font-semibold text-[var(--text-primary)]">Progetto «{created.name}» creato</p>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">Per farlo vedere a una persona: selezionalo e premi «Dai accesso». Oppure manda il link del solo progetto e, a parte, la sua password:</p>
          <p className="mt-1 break-all rounded-lg bg-[var(--background)] px-3 py-2 font-mono text-xs text-[var(--text-primary)]">{created.link}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={async () => (await copyText(created.link as string)) && setNotice('Link copiato. Ricordati di mandare la password a parte.')} className="inline-flex min-h-[36px] items-center gap-1 rounded-full bg-[var(--accent-blue)] px-3 text-xs font-semibold text-white">
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

      {showAccess && boards && (
        <div className="mt-4">
          <AccessPanel boards={boards} accesses={accesses} portal={portal} reload={load} />
        </div>
      )}

      <div className="mt-6">
        {boards === null ? (
          <p className="py-8 text-center text-sm text-[var(--text-secondary)]">Caricamento…</p>
        ) : (
          !setup && <TodoHome data={home} onOpen={open} selected={selected} onToggleSelect={toggle} folderExtra={viewers} emptyText="Ancora nessun progetto: premi «Nuovo progetto»." />
        )}
      </div>

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 md:bottom-6">
          <div className="flex w-full max-w-xl flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--accent-blue)]/50 bg-[var(--card-background)] px-3 py-2 shadow-2xl">
            <span className="text-sm font-semibold text-[var(--text-primary)]">
              {selected.size} {selected.size === 1 ? 'progetto selezionato' : 'progetti selezionati'}
            </span>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setSelected(new Set(home.boards.map((b) => b.id)))} className={pill}>
                Tutti
              </button>
              <button type="button" onClick={() => setSelected(new Set())} className={pill}>
                Annulla
              </button>
              <button type="button" onClick={() => setGranting(true)} className="inline-flex min-h-[36px] items-center gap-1 rounded-full bg-[var(--accent-blue)] px-4 text-xs font-semibold text-white">
                <UserCheck className="h-3.5 w-3.5" /> Dai accesso
              </button>
            </div>
          </div>
        </div>
      )}

      {granting && boards && (
        <GrantDialog
          boards={boards}
          accesses={accesses}
          selected={[...selected]}
          onClose={() => setGranting(false)}
          onDone={(message, creds) => {
            setGranting(false)
            setSelected(new Set())
            setNotice(message)
            if (creds) setCredentials(creds)
            load()
          }}
        />
      )}
    </div>
  )
}
