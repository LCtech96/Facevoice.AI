'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { FolderOpen, Loader2, LogOut, RefreshCw } from 'lucide-react'
import TodoBoard from '@/components/todo/TodoBoard'
import TodoHome from '@/components/todo/TodoHome'
import ProjectHeader from '@/components/todo/ProjectHeader'
import { projectApi } from '@/components/todo/todo-api'
import { projectColor, type TodoHomeData } from '@/lib/todo-shared'

// Pagina della persona: i suoi progetti (cartelle + calendario) e, aprendone uno, le
// sue tabelle e attivita'. Avanti e indietro con i tasti del browser (?p=progetto).

export default function Portal({ name }: { name: string }) {
  const router = useRouter()
  const params = useSearchParams()
  const projectId = params.get('p')
  const taskId = params.get('t')
  const [data, setData] = useState<TodoHomeData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Accesso finito (password cambiata o accesso tolto): si ricarica e ricompare l'entrata.
  const onLocked = useCallback(() => window.location.reload(), [])

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/todo/home', { credentials: 'same-origin', cache: 'no-store' }).catch(() => null)
    const body = res ? await res.json().catch(() => null) : null
    setLoading(false)
    if (res?.status === 401) return onLocked()
    if (res?.ok && body?.boards) {
      setData({ boards: body.boards, tasks: body.tasks || [] })
      setError(null)
    } else setError(body?.error || 'Connessione assente: riprova.')
  }, [onLocked])

  // All'apertura e ogni volta che si torna alla schermata generale (conteggi aggiornati).
  useEffect(() => {
    load()
  }, [projectId, load])

  // Sulla schermata generale (dentro un progetto ci pensa la bacheca ogni 6 s): ogni 15 s
  // un controllo leggero, cosi' chi ha la password vecchia esce subito e vede l'avviso.
  useEffect(() => {
    if (projectId) return
    const timer = setInterval(async () => {
      if (document.visibilityState !== 'visible') return
      const res = await fetch('/api/todo/home', { credentials: 'same-origin', cache: 'no-store' }).catch(() => null)
      if (res?.status === 401) onLocked()
    }, 15_000)
    return () => clearInterval(timer)
  }, [projectId, onLocked])

  const open = (boardId: string, task?: string) => router.push(`/todo?p=${encodeURIComponent(boardId)}${task ? `&t=${encodeURIComponent(task)}` : ''}`)
  const back = () => router.push('/todo')

  const logout = async () => {
    await fetch('/api/todo/login', { method: 'DELETE', credentials: 'same-origin' }).catch(() => null)
    window.location.href = '/todo'
  }

  const index = projectId && data ? data.boards.findIndex((b) => b.id === projectId) : -1
  const project = index >= 0 && data ? data.boards[index] : null

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-[var(--border-color)] bg-[var(--background)]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3">
          <button type="button" onClick={back} className="flex min-w-0 items-center gap-2 text-lg font-bold text-[var(--text-primary)]">
            <FolderOpen className="h-5 w-5 shrink-0 text-[var(--accent-blue)]" />
            <span className="truncate">Progetti</span>
          </button>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden text-sm text-[var(--text-secondary)] sm:inline">{name}</span>
            <button type="button" onClick={logout} className="inline-flex min-h-[36px] items-center gap-1 rounded-full border border-[var(--border-color)] px-3 text-xs text-[var(--text-primary)]">
              <LogOut className="h-3.5 w-3.5" /> Esci
            </button>
          </div>
        </div>
      </header>

      {projectId ? (
        <div className="pt-4">
          <ProjectHeader name={project?.name || 'Progetto'} color={index >= 0 ? projectColor(index) : undefined} onBack={back} />
          <TodoBoard key={`${projectId}:${taskId || ''}`} api={projectApi(projectId)} initialTask={taskId} onLocked={onLocked} notFoundText="Progetto non trovato o non più condiviso con te." />
        </div>
      ) : (
        <div className="mx-auto max-w-6xl px-4 pb-24 pt-4">
          <div className="mb-4 flex items-center justify-between gap-2">
            <p className="text-sm text-[var(--text-secondary)]">Ciao {name}: apri un progetto o tocca un’attività nel calendario.</p>
            <button type="button" onClick={load} className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-full border border-[var(--border-color)] px-3 text-xs text-[var(--text-primary)]" aria-label="Aggiorna">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Aggiorna
            </button>
          </div>
          {error && <p className="mb-3 rounded-xl border border-[#FF3B30]/40 bg-[#FF3B30]/10 px-3 py-2 text-sm text-[var(--text-primary)]">{error}</p>}
          {data ? (
            <TodoHome data={data} onOpen={open} emptyText="Non hai ancora progetti: chiedi all’admin di dartene l’accesso." />
          ) : (
            <div className="flex min-h-[40vh] items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
            </div>
          )}
        </div>
      )}
    </>
  )
}
