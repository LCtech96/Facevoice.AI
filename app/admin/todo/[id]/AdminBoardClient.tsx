'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Copy, ListTodo } from 'lucide-react'
import TodoBoard from '@/components/todo/TodoBoard'
import { useAdminGate } from '../../contratti/useAdminGate'
import { adminTodoFetch, copyText } from '../todo-admin-api'
import PeoplePanel from './PeoplePanel'

// La todo list vista dall'admin: stessa bacheca di chi ha il link, ma l'admin vede
// tutto e puo' modificare tutto. Il server da' all'admin un cookie da admin (senza
// password, 12 ore) e la bacheca usa le stesse route. Sopra: le persone della todo list.

export default function AdminBoardClient({ id }: { id: string }) {
  const allowed = useAdminGate()
  const [info, setInfo] = useState<{ token: string; name: string; link: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const reopened = useRef(0)
  const [peopleOpen, setPeopleOpen] = useState(false)
  useEffect(() => {
    setPeopleOpen(new URLSearchParams(window.location.search).has('persone'))
  }, [])

  const open = useCallback(async () => {
    const r = await adminTodoFetch(`/api/admin/todo/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ action: 'open' }) })
    if (r.ok && r.data.token) {
      setError(null)
      setInfo({ token: r.data.token, name: r.data.name, link: r.data.link })
    } else setError(r.data.setup ? (r.data.update ? 'Esegui lo SQL aggiornato della todo list (file supabase/migrations/2026-11-08_todo_people.sql).' : 'Esegui prima lo SQL della todo list.') : r.data.error || 'Non riesco ad aprire la todo list.')
  }, [id])

  useEffect(() => {
    if (allowed) open()
  }, [allowed, open])

  // Accesso scaduto (12 ore passate o link nuovo da un'altra scheda): si riapre, al massimo qualche volta.
  const onLocked = useCallback(() => {
    if (reopened.current++ < 3) {
      setInfo(null)
      open()
    } else setError('Non riesco a riaprire la todo list: ricarica la pagina.')
  }, [open])

  if (!allowed) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[var(--accent-blue)]/30 border-t-[var(--accent-blue)]" />
      </div>
    )
  }

  return (
    <div className="pb-24 pt-20 md:pt-24">
      <div className="mx-auto mb-3 flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Link href="/admin/todo" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border-color)] text-[var(--text-primary)]" aria-label="Torna alle todo list">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="flex min-w-0 items-center gap-2 text-xl font-bold text-[var(--text-primary)]">
            <ListTodo className="h-5 w-5 shrink-0" />
            <span className="truncate">{info?.name || 'Todo list'}</span>
          </h1>
        </div>
        {info && (
          <button
            type="button"
            onClick={async () => {
              if (await copyText(info.link)) {
                setCopied(true)
                setTimeout(() => setCopied(false), 2500)
              }
            }}
            className="inline-flex min-h-[36px] items-center gap-1 rounded-full border border-[var(--border-color)] px-3 text-xs text-[var(--text-primary)]"
          >
            <Copy className="h-3.5 w-3.5" /> {copied ? 'Copiato' : 'Copia link'}
          </button>
        )}
      </div>
      {error && <p className="mx-4 rounded-xl border border-[#FF3B30]/40 bg-[#FF3B30]/10 px-3 py-2 text-sm text-[var(--text-primary)]">{error}</p>}
      {info && <PeoplePanel key={`p-${peopleOpen}`} boardId={id} startOpen={peopleOpen} />}
      {info && <TodoBoard key={info.token} token={info.token} onLocked={onLocked} />}
    </div>
  )
}
