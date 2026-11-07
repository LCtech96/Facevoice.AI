'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, Check } from 'lucide-react'
import { useWorkspace } from './WorkspaceContext'

// Campanella dei contratti nella barra in alto: pallino rosso con le notifiche non lette
// (richieste di modifica, link aperto dal destinatario, chi non può firmare perché mancano data/ora e termine di consegna,
// firme del destinatario, contratti completati). Si aggiorna ogni 60
// secondi e quando si torna sulla pagina. Tocco su una notifica: la pagina del contratto su
// quella richiesta, e la notifica e' letta. Solo per titolare e amministratori dello spazio.

type Note = { id: string; at: string; kind: 'modifica' | 'aperto' | 'firmato' | 'completato' | 'bloccato'; contractId: string; changeId?: string; text: string; unread: boolean }

const POLL_MS = 60_000
const ago = (iso: string) => {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (min < 1) return 'adesso'
  if (min < 60) return `${min} min fa`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h fa`
  return new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })
}

export default function ContractsBell({ align = 'right' }: { align?: 'left' | 'right' }) {
  const { appFetch, workspace } = useWorkspace()
  const router = useRouter()
  const [notes, setNotes] = useState<Note[]>([])
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const allowed = Boolean(workspace && workspace.role !== 'member')

  const load = useCallback(async () => {
    if (!allowed) return
    const res = await appFetch('/api/app/contracts/notifications').catch(() => null)
    const data = res?.ok ? await res.json().catch(() => null) : null
    if (!data) return
    setNotes(Array.isArray(data.items) ? data.items.slice(0, 20) : [])
    setUnread(Number(data.unread) || 0)
  }, [appFetch, allowed])

  useEffect(() => {
    setNotes([])
    setUnread(0)
    if (!allowed) return
    load()
    const timer = setInterval(() => document.visibilityState === 'visible' && load(), POLL_MS)
    const onVisible = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [load, allowed, workspace?.id])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | TouchEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    document.addEventListener('touchstart', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('touchstart', close)
    }
  }, [open])

  const read = async (id: string) => {
    const res = await appFetch('/api/app/contracts/notifications', { method: 'POST', body: JSON.stringify({ id }) }).catch(() => null)
    const data = res?.ok ? await res.json().catch(() => null) : null
    if (data) {
      setNotes(Array.isArray(data.items) ? data.items.slice(0, 20) : [])
      setUnread(Number(data.unread) || 0)
    }
  }

  const go = (n: Note) => {
    setOpen(false)
    if (n.unread) void read(n.id)
    router.push(`/app/contratti/${n.contractId}${n.changeId ? `?richiesta=${n.changeId}` : ''}`)
  }

  if (!allowed) return null
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label={unread ? `Notifiche dei contratti: ${unread} da leggere` : 'Notifiche dei contratti'} aria-expanded={open} className="relative flex h-8 w-8 items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
        <Bell className="h-5 w-5" />
        {unread > 0 && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-[#FF3B30] ring-2 ring-[var(--background-secondary)]" />}
      </button>
      {open && (
        <div className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} top-full z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--background)] shadow-xl`}>
          <div className="flex items-center justify-between border-b border-[var(--border-color)] px-4 py-2.5">
            <p className="text-sm font-semibold text-[var(--text-primary)]">Contratti</p>
            {unread > 0 && (
              <button onClick={() => read('all')} className="inline-flex items-center gap-1 text-xs text-[var(--accent-blue)]">
                <Check className="h-3.5 w-3.5" /> Segna tutte come lette
              </button>
            )}
          </div>
          {notes.length ? (
            <ul className="max-h-80 overflow-y-auto">
              {notes.map((n) => (
                <li key={n.id}>
                  <button onClick={() => go(n)} className="flex w-full items-start gap-2.5 px-4 py-3 text-left hover:bg-[var(--background-secondary)]">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.unread ? 'bg-[#FF3B30]' : 'bg-transparent'}`} />
                    <span className="min-w-0">
                      <span className={`block break-words text-sm ${n.unread ? 'font-semibold text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>{n.text}</span>
                      <span className="text-xs text-[var(--text-secondary)]">{ago(n.at)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-4 text-sm text-[var(--text-secondary)]">Nessuna notifica.</p>
          )}
        </div>
      )}
    </div>
  )
}
