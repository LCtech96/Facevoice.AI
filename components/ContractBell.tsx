'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell } from 'lucide-react'
import { authFetch } from '@/components/useAssistantChat'
import { CONTRACT_NOTE_EVENT } from '@/lib/contract-text'

// Campanella dei contratti nella barra in alto (solo l'amministratore): pallino rosso
// se ci sono novita' (link aperto da chi lo riceve, richiesta di modifica, firma del
// destinatario, contratto firmato da tutti). Un tocco apre l'elenco; un tocco su una voce apre il contratto su quella
// richiesta e la segna come letta. Si aggiorna ogni minuto e quando si torna sulla pagina.

const API = '/api/admin/contracts/notifications'
const POLL_MS = 60_000

type Note = { id: string; at: string; kind: string; contractId: string; requestId?: string; title: string; read: boolean }

const when = (iso: string) => new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function ContractBell({ compact = false }: { compact?: boolean }) {
  const router = useRouter()
  const [items, setItems] = useState<Note[]>([])
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const res = await authFetch(API).catch(() => null)
    if (!res?.ok) return
    const data = await res.json().catch(() => null)
    if (!data) return
    setItems(Array.isArray(data.items) ? data.items : [])
    setUnread(typeof data.unread === 'number' ? data.unread : 0)
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(() => document.visibilityState === 'visible' && load(), POLL_MS)
    const onVisible = () => document.visibilityState === 'visible' && load()
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const mark = async (body: Record<string, unknown>) => {
    const res = await authFetch(API, { method: 'POST', body: JSON.stringify(body) }).catch(() => null)
    const data = res?.ok ? await res.json().catch(() => null) : null
    if (data) {
      setItems(Array.isArray(data.items) ? data.items : [])
      setUnread(typeof data.unread === 'number' ? data.unread : 0)
    }
  }

  const openItem = (n: Note) => {
    setOpen(false)
    if (!n.read) {
      setItems((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
      setUnread((u) => Math.max(0, u - 1))
      void mark({ ids: [n.id] })
    }
    // Se la pagina di quel contratto e' gia' aperta resta montata: le si dice di ricaricarsi.
    window.dispatchEvent(new CustomEvent(CONTRACT_NOTE_EVENT, { detail: n.contractId }))
    router.push(`/admin/contratti/${encodeURIComponent(n.contractId)}${n.requestId ? `?req=${encodeURIComponent(n.requestId)}` : ''}`)
  }

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={unread ? `Contratti: ${unread} novità` : 'Contratti: nessuna novità'}
        className={`relative flex items-center justify-center rounded-lg border border-[var(--border-color)] bg-[var(--background-secondary)] text-[var(--text-primary)] ${compact ? 'h-9 w-9' : 'h-10 w-10'}`}
      >
        <Bell size={18} />
        {unread > 0 && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-[#FF3B30] ring-2 ring-[var(--background)]" data-unread={unread} />}
      </button>
      {open && (
        <div
          className={`z-50 overflow-hidden rounded-lg border border-[var(--border-color)] bg-[var(--card-background)] shadow-xl ${
            // Sul telefono la campanella non e' all'estremo destro: l'elenco si appoggia allo schermo, non a lei.
            compact ? 'fixed inset-x-3 top-[calc(env(safe-area-inset-top)+4rem)] sm:left-auto sm:w-80' : 'absolute right-0 top-full mt-2 w-[min(20rem,calc(100vw-1.5rem))]'
          }`}
        >
          <div className="flex items-center justify-between border-b border-[var(--border-color)] px-3 py-2">
            <span className="text-sm font-semibold text-[var(--text-primary)]">Contratti</span>
            {unread > 0 && (
              <button type="button" onClick={() => mark({ all: true })} className="text-xs text-[var(--accent-blue)]">
                Segna tutte come lette
              </button>
            )}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-3 py-4 text-sm text-[var(--text-secondary)]">Nessuna novità.</p>
            ) : (
              items.map((n) => (
                <button key={n.id} type="button" onClick={() => openItem(n)} className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-[var(--background-secondary)]">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-[#FF3B30]'}`} />
                  <span className="min-w-0">
                    <span className={`block break-words text-sm ${n.read ? 'text-[var(--text-secondary)]' : 'font-semibold text-[var(--text-primary)]'}`}>{n.title}</span>
                    <span className="block text-xs text-[var(--text-secondary)]">{when(n.at)}</span>
                  </span>
                </button>
              ))
            )}
          </div>
          <button type="button" onClick={() => { setOpen(false); router.push('/admin/contratti') }} className="block w-full border-t border-[var(--border-color)] px-3 py-2 text-left text-sm text-[var(--accent-blue)]">
            Tutti i contratti
          </button>
        </div>
      )}
    </div>
  )
}
