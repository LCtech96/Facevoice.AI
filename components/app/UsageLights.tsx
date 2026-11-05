'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useWorkspace } from './WorkspaceContext'
import { AI_BLOCKED_MESSAGE, UPGRADE_URL, USAGE_REFRESH_EVENT, usageLabel, type ShownLight, type UsageStatus } from '@/lib/usage-shared'

// Consumo dell'AI nell'area clienti: tre gettoni in fila come un semaforo
// (verde, arancione, rosso). Si accende solo quello del momento, gli altri
// restano grigi. Mai euro: quelli li vede solo Facevoice. Quando l'AI del piano
// e' finita compare l'avviso con "Passa al piano superiore".

const UsageCtx = createContext<{ status: UsageStatus | null; refresh: () => void }>({ status: null, refresh: () => {} })

/** Chiede di aggiornare i gettoni (es. dopo una richiesta all'AI). */
export function refreshUsage() {
  try {
    window.dispatchEvent(new Event(USAGE_REFRESH_EVENT))
  } catch {}
}

export function UsageProvider({ children }: { children: ReactNode }) {
  const { appFetch, workspace } = useWorkspace()
  const [status, setStatus] = useState<UsageStatus | null>(null)

  const refresh = useCallback(async () => {
    if (!workspace) return
    const res = await appFetch('/api/app/usage').catch(() => null)
    const data = res?.ok ? await res.json().catch(() => null) : null
    if (data && typeof data.shown === 'string') {
      setStatus({ shown: data.shown, blocked: Boolean(data.blocked), daysLeft: Number(data.daysLeft) || 0, periodEnd: String(data.periodEnd || '') })
    }
  }, [appFetch, workspace])

  // Cambiando spazio si riparte da zero (i gettoni sono del titolare di quello spazio).
  const workspaceId = workspace?.id
  useEffect(() => setStatus(null), [workspaceId])

  useEffect(() => {
    if (!workspaceId) return
    refresh()
    const timer = setInterval(() => document.visibilityState === 'visible' && refresh(), 60_000)
    const onVisible = () => document.visibilityState === 'visible' && refresh()
    // Dopo una richiesta all'AI il gettone si aggiorna poco dopo (il consumo si registra subito dopo la risposta).
    let later: ReturnType<typeof setTimeout> | undefined
    const onRefresh = () => {
      refresh()
      clearTimeout(later)
      later = setTimeout(refresh, 4000)
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener(USAGE_REFRESH_EVENT, onRefresh)
    return () => {
      clearInterval(timer)
      clearTimeout(later)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener(USAGE_REFRESH_EVENT, onRefresh)
    }
  }, [refresh, workspaceId])

  return <UsageCtx.Provider value={{ status, refresh }}>{children}</UsageCtx.Provider>
}

export const useUsage = () => useContext(UsageCtx)

const COLORS: Record<Exclude<ShownLight, 'none'>, string> = {
  green: '#34C759',
  orange: '#FF9500',
  red: '#FF3B30',
}

/** I tre gettoni. Senza "shown" usa lo stato dell'area clienti. */
export function UsageTokens({ shown, blocked, className = '' }: { shown?: ShownLight; blocked?: boolean; className?: string }) {
  const { status } = useUsage()
  const current = shown ?? status?.shown ?? 'none'
  const isBlocked = blocked ?? status?.blocked ?? false
  const label = usageLabel(current, isBlocked)
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--border-color)] px-1.5 py-1 ${className}`}
    >
      {(Object.keys(COLORS) as (keyof typeof COLORS)[]).map((color) => (
        <span
          key={color}
          className="h-2.5 w-2.5 rounded-full"
          style={
            current === color
              ? { backgroundColor: COLORS[color], boxShadow: `0 0 6px ${COLORS[color]}99` }
              : { backgroundColor: 'var(--border-color)', opacity: 0.6 }
          }
        />
      ))}
    </span>
  )
}

/** Icona dell'utente (foto di Google o iniziale) con i gettoni accanto. */
export function UserUsageBadge({ className = '' }: { className?: string }) {
  const { session, email } = useWorkspace()
  const meta = (session?.user.user_metadata || {}) as Record<string, unknown>
  const picture = [meta.avatar_url, meta.picture].find((v) => typeof v === 'string' && v.startsWith('https://')) as string | undefined
  const name = [meta.full_name, meta.name].find((v) => typeof v === 'string' && v.trim()) as string | undefined
  const initial = (name || email || '?').trim().charAt(0).toUpperCase()
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      {picture ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={picture} alt="" referrerPolicy="no-referrer" className="h-7 w-7 shrink-0 rounded-full object-cover" />
      ) : (
        <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent-blue)] text-xs font-bold text-white">
          {initial}
        </span>
      )}
      <UsageTokens />
    </span>
  )
}

/** Avviso in cima a tutte le pagine quando l'AI del piano e' finita. */
export function UsageBlockedBanner() {
  const { status } = useUsage()
  if (!status?.blocked) return null
  return (
    <div role="alert" className="flex flex-col gap-3 border-b border-[#FF3B30]/40 bg-[#FF3B30]/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-8">
      <div className="flex min-w-0 items-start gap-3">
        <UsageTokens className="mt-0.5" />
        <div className="min-w-0 text-sm">
          <p className="font-semibold text-[var(--text-primary)]">{AI_BLOCKED_MESSAGE}</p>
          {status.daysLeft > 0 && (
            <p className="mt-0.5 text-[var(--text-secondary)]">
              Altrimenti torna disponibile tra {status.daysLeft === 1 ? '1 giorno' : `${status.daysLeft} giorni`}.
            </p>
          )}
        </div>
      </div>
      <a
        href={UPGRADE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 self-start rounded-full bg-[var(--accent-blue)] px-4 py-2 text-sm font-bold text-white sm:self-auto"
      >
        Passa al piano superiore
      </a>
    </div>
  )
}
