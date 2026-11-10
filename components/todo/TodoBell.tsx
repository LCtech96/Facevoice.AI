'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Bell, CalendarClock, Clock, Loader2, Mail, Sparkles, X } from 'lucide-react'
import { BELL_COLORS, type TodoBellData, type TodoBellItem, type TodoBellKind } from '@/lib/todo-shared'

// Campanella in alto: numero degli avvisi da leggere e, toccandola, l'elenco di cosa
// c'e' da fare dal piu' urgente (in ritardo, oggi, presto, solleciti, nuove). Toccando
// un avviso si apre l'attivita' nel suo progetto. Sul computer si apre sotto la
// campanella, sul telefono come foglio a tutta larghezza dal basso (fuori dalla testata,
// che con lo sfondo sfocato tratterrebbe il pannello). Si aggiorna ogni 60 secondi
// (solo con la pagina in vista).

const POLL_MS = 60_000

export type BellRequest = (method: 'GET' | 'POST') => Promise<{ ok: boolean; status: number; data: Record<string, any> }>

const ICONS: Record<TodoBellKind, typeof Bell> = { overdue: AlertTriangle, today: Clock, soon: CalendarClock, reminder: Mail, new: Sparkles }

export default function TodoBell({ request, onOpen, onLocked }: { request: BellRequest; onOpen: (item: TodoBellItem) => void; onLocked?: () => void }) {
  const [data, setData] = useState<TodoBellData | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  // Avvisi da leggere al momento dell'apertura: restano evidenziati finche' il pannello e' aperto.
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const [spot, setSpot] = useState<{ top: number; right: number }>({ top: 64, right: 16 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const openRef = useRef(false)
  openRef.current = open

  const load = useCallback(async () => {
    setLoading(true)
    const r = await request('GET')
    setLoading(false)
    if (r.status === 401) {
      onLocked?.()
      return null
    }
    if (r.ok && Array.isArray(r.data.items)) {
      const next = { items: r.data.items as TodoBellItem[], unread: Number(r.data.unread) || 0 }
      setData(next)
      setFailed(false)
      return next
    }
    setFailed(true)
    return null
  }, [request, onLocked])

  useEffect(() => {
    load()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, POLL_MS)
    const onVisible = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  const close = useCallback(() => {
    setOpen(false)
    setFresh(new Set())
    buttonRef.current?.focus()
  }, [])

  const place = useCallback(() => {
    const r = buttonRef.current?.getBoundingClientRect()
    if (r) setSpot({ top: Math.round(r.bottom + 8), right: Math.max(8, Math.round(window.innerWidth - r.right)) })
  }, [])

  const toggle = async () => {
    if (open) return close()
    place()
    setOpen(true)
    const now = (await load()) || data
    const unread = now ? now.items.filter((i) => i.unread) : []
    setFresh(new Set(unread.map((i) => i.id)))
    if (now && now.unread > 0) {
      // Aperta: tutto letto (il numero sparisce subito, il server lo ricorda).
      setData({ items: now.items.map((i) => ({ ...i, unread: false })), unread: 0 })
      request('POST').catch(() => undefined)
    }
  }

  // Esc chiude; il clic fuori chiude (sul computer).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || buttonRef.current?.contains(t)) return
      close()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('resize', place)
    panelRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', place)
    }
  }, [open, close, place])

  const unread = data?.unread || 0
  const badge = unread > 9 ? '9+' : String(unread)

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread ? `Notifiche: ${unread} da leggere` : 'Notifiche'}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border-color)] text-[var(--text-primary)] hover:border-[var(--accent-blue)]"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex min-w-[20px] items-center justify-center rounded-full bg-[#FF3B30] px-1 text-[11px] font-bold leading-5 text-white" aria-hidden="true">
            {badge}
          </span>
        )}
      </button>

      {open &&
        createPortal(
        <>
          <div className="fixed inset-0 z-[80] bg-black/40 sm:hidden" onClick={close} aria-hidden="true" />
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Notifiche"
            tabIndex={-1}
            style={{ '--bell-top': `${spot.top}px`, '--bell-right': `${spot.right}px` } as CSSProperties}
            className="fixed inset-x-0 bottom-0 z-[81] flex max-h-[85dvh] flex-col rounded-t-2xl border border-[var(--border-color)] bg-[var(--card-background)] shadow-2xl outline-none sm:inset-x-auto sm:bottom-auto sm:left-auto sm:right-[var(--bell-right)] sm:top-[var(--bell-top)] sm:max-h-[70vh] sm:w-[380px] sm:rounded-2xl"
          >
            <div className="flex items-center justify-between gap-2 border-b border-[var(--border-color)] px-4 py-3">
              <h2 className="text-base font-semibold text-[var(--text-primary)]">Cosa c’è da fare</h2>
              <div className="flex items-center gap-1">
                {loading && <Loader2 className="h-4 w-4 animate-spin text-[var(--text-secondary)]" aria-label="Aggiornamento" />}
                <button type="button" onClick={close} className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[var(--text-secondary)]" aria-label="Chiudi le notifiche">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
              {failed && !data && <p className="px-4 py-6 text-center text-sm text-[var(--text-secondary)]">Non riesco a caricare le notifiche: riprova tra poco.</p>}
              {data && data.items.length === 0 && <p className="px-4 py-8 text-center text-sm text-[var(--text-secondary)]">Tutto a posto: niente in scadenza.</p>}
              {data && data.items.length > 0 && (
                <ul className="divide-y divide-[var(--border-color)]">
                  {data.items.map((item) => {
                    const Icon = ICONS[item.kind]
                    const color = BELL_COLORS[item.kind]
                    const isNew = fresh.has(item.id) || item.unread
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => {
                            close()
                            onOpen(item)
                          }}
                          className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-[var(--background-secondary)] focus:bg-[var(--background-secondary)] focus:outline-none ${isNew ? 'bg-[var(--accent-blue)]/5' : ''}`}
                        >
                          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: `${color}22`, color }}>
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs text-[var(--text-secondary)]">{item.boardName}</span>
                            <span className={`block break-words text-sm text-[var(--text-primary)] ${isNew ? 'font-semibold' : ''}`}>{item.title}</span>
                            <span className="mt-0.5 block text-xs font-medium" style={{ color }}>
                              {item.label}
                            </span>
                          </span>
                          {isNew && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[var(--accent-blue)]" aria-label="Da leggere" />}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        </>,
          document.body
        )}
    </div>
  )
}
