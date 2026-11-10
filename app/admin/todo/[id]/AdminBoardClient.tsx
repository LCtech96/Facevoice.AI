'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, KeyRound, Loader2, Pencil, RefreshCw, Settings, Trash2 } from 'lucide-react'
import TodoBoard from '@/components/todo/TodoBoard'
import TodoBell from '@/components/todo/TodoBell'
import ProjectHeader from '@/components/todo/ProjectHeader'
import { projectApi } from '@/components/todo/todo-api'
import { useAdminGate } from '../../contratti/useAdminGate'
import { PasswordField } from '../AccessPanel'
import { adminBellRequest, adminTodoFetch, copyText, ensureAdminCookie, type AdminBoard } from '../todo-admin-api'

// Un progetto visto dall'admin: «← Tutti i progetti», nome, impostazioni del progetto
// (link, password del link, nome, eliminazione) e la stessa bacheca delle persone.
// La bacheca usa le route per id con il cookie dell'admin.

const pill = 'inline-flex min-h-[36px] items-center gap-1 rounded-full border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-primary)] disabled:opacity-50'

export default function AdminBoardClient({ id, task }: { id: string; task: string | null }) {
  const allowed = useAdminGate()
  const router = useRouter()
  const [board, setBoard] = useState<AdminBoard | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [settings, setSettings] = useState(false)
  const [pwOpen, setPwOpen] = useState(false)
  const [newPw, setNewPw] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [boardKey, setBoardKey] = useState(0)
  const reopened = useRef(0)

  const loadInfo = useCallback(async () => {
    const r = await adminTodoFetch(`/api/admin/todo/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ action: 'open' }) })
    if (r.ok && r.data.board) {
      setBoard(r.data.board)
      return true
    }
    setError(r.data.setup ? 'Esegui prima lo SQL della todo list.' : r.data.error || 'Non riesco ad aprire il progetto.')
    return false
  }, [id])

  const start = useCallback(async () => {
    if (!(await ensureAdminCookie())) return setError('Non riesco ad aprire il progetto: ricarica la pagina.')
    if (await loadInfo()) setReady(true)
  }, [loadInfo])

  useEffect(() => {
    if (allowed) start()
  }, [allowed, start])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(t)
  }, [notice])

  // Cookie dell'admin scaduto (dopo 12 ore): si rinnova, al massimo qualche volta.
  const onLocked = useCallback(async () => {
    if (reopened.current++ < 3 && (await ensureAdminCookie())) setBoardKey((k) => k + 1)
    else setError('Non riesco a riaprire il progetto: ricarica la pagina.')
  }, [])

  const patch = async (body: Record<string, unknown>, done: string) => {
    setBusy(String(body.action))
    const r = await adminTodoFetch(`/api/admin/todo/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) })
    setBusy(null)
    if (!r.ok) {
      setError(r.data.error || 'Operazione non riuscita.')
      return false
    }
    setError(null)
    setNotice(done)
    if (r.data.board) setBoard(r.data.board)
    return true
  }

  const back = () => router.push('/admin/todo')

  if (!allowed) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[var(--accent-blue)]/30 border-t-[var(--accent-blue)]" />
      </div>
    )
  }

  return (
    <div className="pb-24 pt-20 md:pt-24">
      <ProjectHeader
        name={board?.name || 'Progetto'}
        onBack={back}
        actions={
          <>
            {board && (
              <button type="button" onClick={() => setSettings(!settings)} className={pill} aria-expanded={settings}>
                <Settings className="h-3.5 w-3.5" /> Impostazioni progetto
              </button>
            )}
            <TodoBell request={adminBellRequest} onOpen={(item) => router.push(`/admin/todo/${encodeURIComponent(item.boardId)}?t=${encodeURIComponent(item.taskId)}`)} />
          </>
        }
      />
      {board && settings && (
        <div className="mx-auto mb-3 max-w-6xl px-4">
          <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-3">
            <p className="text-xs text-[var(--text-secondary)]">Link del solo progetto (con la sua password): chi lo usa vede solo questo progetto. Per far vedere più progetti a una persona usa «Dai accesso» nella schermata dei progetti.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={async () => (board.link ? (await copyText(board.link)) && setNotice('Link copiato. Ricordati di mandare la password a parte.') : setError('Link non leggibile: crea un link nuovo.'))} className={pill}>
                <Copy className="h-3.5 w-3.5" /> Copia link
              </button>
              <button type="button" onClick={() => (setPwOpen(!pwOpen), setNewPw(''))} className={pill}>
                <KeyRound className="h-3.5 w-3.5" /> Cambia password del link
              </button>
              <button
                type="button"
                disabled={busy === 'regenerate'}
                onClick={() => window.confirm(`Creare un link nuovo per «${board.name}»? Il link di prima smette di funzionare e chi era dentro con il link dovrà usare quello nuovo.`) && patch({ action: 'regenerate' }, 'Link nuovo creato: copialo e mandalo.')}
                className={pill}
              >
                {busy === 'regenerate' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Nuovo link
              </button>
              <button
                type="button"
                onClick={() => {
                  const next = window.prompt('Nuovo nome del progetto:', board.name)
                  if (next && next.trim() && next.trim() !== board.name) patch({ action: 'rename', name: next }, 'Nome cambiato.')
                }}
                className={pill}
              >
                <Pencil className="h-3.5 w-3.5" /> Rinomina
              </button>
              <button
                type="button"
                disabled={busy === 'delete'}
                onClick={async () => {
                  if (!window.confirm(`Eliminare «${board.name}» con tutte le tabelle, le attività e le immagini? Non si può annullare.`)) return
                  setBusy('delete')
                  const r = await adminTodoFetch(`/api/admin/todo/${encodeURIComponent(id)}`, { method: 'DELETE' })
                  setBusy(null)
                  if (!r.ok) return setError(r.data.error || 'Non riesco a eliminare.')
                  back()
                }}
                className="inline-flex min-h-[36px] items-center gap-1 rounded-full border border-[#FF3B30]/40 px-3 py-1.5 text-xs text-[#FF3B30] disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" /> Elimina progetto
              </button>
            </div>
            {pwOpen && (
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <div className="flex-1">
                  <PasswordField id="board-pw" value={newPw} onChange={setNewPw} placeholder="Nuova password del link (almeno 6 caratteri)" />
                </div>
                <button
                  type="button"
                  disabled={busy === 'password'}
                  onClick={async () => {
                    if (newPw.length < 6) return setError('La password deve avere almeno 6 caratteri.')
                    if (await patch({ action: 'password', password: newPw }, 'Password del link cambiata: chi era dentro con il link deve mettere quella nuova.')) {
                      setPwOpen(false)
                      setNewPw('')
                    }
                  }}
                  className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-full bg-[var(--accent-blue)] px-4 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {busy === 'password' && <Loader2 className="h-4 w-4 animate-spin" />} Salva password
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {error && <p className="mx-4 mb-3 rounded-xl border border-[#FF3B30]/40 bg-[#FF3B30]/10 px-3 py-2 text-sm text-[var(--text-primary)]">{error}</p>}
      {notice && <p className="mx-4 mb-3 rounded-xl border border-[#34C759]/40 bg-[#34C759]/10 px-3 py-2 text-sm text-[var(--text-primary)]">{notice}</p>}
      {ready && (
        <TodoBoard
          key={boardKey}
          api={projectApi(id)}
          initialTask={task}
          onTaskClose={() => task && router.replace(`/admin/todo/${encodeURIComponent(id)}`, { scroll: false })}
          onLocked={onLocked}
          notFoundText="Progetto non trovato: forse è stato eliminato."
        />
      )}
    </div>
  )
}
