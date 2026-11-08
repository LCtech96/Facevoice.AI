'use client'

import { useCallback } from 'react'
import { ListTodo, LogOut } from 'lucide-react'
import TodoBoard from '@/components/todo/TodoBoard'

// Todo list per chi ha il link: solo il nome e la bacheca, nessun altro collegamento.

export default function GuestBoard({ token, name }: { token: string; name: string }) {
  // Password cambiata o link rigenerato: si ricarica e ricompare la richiesta della password.
  const onLocked = useCallback(() => window.location.reload(), [])

  const logout = async () => {
    await fetch(`/api/todo/${encodeURIComponent(token)}/access`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => null)
    window.location.reload()
  }

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-[var(--border-color)] bg-[var(--background)]/90 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <h1 className="flex min-w-0 items-center gap-2 text-lg font-bold text-[var(--text-primary)]">
            <ListTodo className="h-5 w-5 shrink-0 text-[var(--accent-blue)]" />
            <span className="truncate">{name}</span>
          </h1>
          <button type="button" onClick={logout} className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-full border border-[var(--border-color)] px-3 text-xs text-[var(--text-primary)]">
            <LogOut className="h-3.5 w-3.5" /> Esci
          </button>
        </div>
      </header>
      <div className="pt-4">
        <TodoBoard token={token} onLocked={onLocked} />
      </div>
    </>
  )
}
