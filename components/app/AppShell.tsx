'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bot, CalendarClock, CreditCard, LayoutGrid, Loader2, LogOut, Menu, MessageSquareText, MessagesSquare, SlidersHorizontal, Zap } from 'lucide-react'
import AppAuth from './AppAuth'
import LanguageSwitch from './LanguageSwitch'
import { useTranslation } from '@/lib/i18n/LanguageContext'
import { WorkspaceProvider, useWorkspace } from './WorkspaceContext'
import { UsageBlockedBanner, UsageProvider, UserUsageBadge, useUsage } from './UsageLights'

// Cornice dell'area clienti: accesso, creazione del primo spazio di lavoro,
// menu delle pagine e scelta dello spazio. Accanto all'icona dell'utente i tre
// gettoni del consumo AI; se l'AI del piano e' finita, l'avviso in cima a ogni pagina.
// "Assistente AI" e "Automazioni" compaiono solo a chi ce li ha attivi (li accende Facevoice).

const NAV = [
  { href: '/app', label: 'Panoramica', icon: LayoutGrid },
  { href: '/app/omnichat', label: 'Omnichat', icon: MessagesSquare },
  { href: '/app/commenti', label: 'Commenti', icon: MessageSquareText },
  { href: '/app/istruzioni', label: 'Istruzioni', icon: SlidersHorizontal },
  { href: '/app/assistente', label: 'Assistente AI', short: 'Assistente', icon: Bot },
  { href: '/app/automazioni', label: 'Automazioni', icon: Zap },
]

function CreateWorkspace() {
  const { appFetch, reload, signOut, email } = useWorkspace()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await appFetch('/api/app/workspaces', { method: 'POST', body: JSON.stringify({ name }) }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (!res?.ok) {
      setError(data.error || 'Connessione non riuscita, riprova.')
      setBusy(false)
      return
    }
    await reload()
    setBusy(false)
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center px-4 py-10">
      <LanguageSwitch className="mb-8 self-end" />
      <p className="text-sm font-semibold tracking-widest text-[var(--accent-blue)]">ULTIMO PASSO</p>
      <h1 className="mt-3 text-3xl font-extrabold leading-tight text-[var(--text-primary)]">Come si chiama la tua attività?</h1>
      <p className="mt-3 text-[var(--text-secondary)]">È il nome del tuo spazio di lavoro: lì colleghi i canali e, se vuoi, inviti i colleghi.</p>
      <form onSubmit={create} className="mt-8 space-y-3">
        <input
          autoFocus
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Es. Pizzeria da Mario"
          className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)] px-4 py-3 text-[16px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]"
        />
        {error && <p className="text-sm text-[#ff6b6b]">{error}</p>}
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--accent-blue)] px-6 py-3 font-bold text-white disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} Crea lo spazio di lavoro
        </button>
      </form>
      <button onClick={signOut} className="mt-6 text-left text-sm text-[var(--text-secondary)]">
        Esci {email ? <span translate="no">({email})</span> : null}
      </button>
    </div>
  )
}

/** Salva la lingua della dashboard: l'AI la usa quando dal messaggio non si capisce la lingua. */
function useSaveDashboardLanguage() {
  const { workspace, appFetch } = useWorkspace()
  const { language } = useTranslation()
  const saved = useRef<string | null>(null)
  useEffect(() => {
    if (!workspace) return
    const key = `${workspace.id}:${language === 'it' ? 'it' : 'en'}`
    if (saved.current === key) return
    saved.current = key
    appFetch('/api/app/preferences', { method: 'PUT', body: JSON.stringify({ language: language === 'it' ? 'it' : 'en' }) }).catch(() => {
      saved.current = null
    })
  }, [workspace, language, appFetch])
}

function Frame({ children }: { children: ReactNode }) {
  const { ready, session, workspace, workspaces, selectWorkspace, signOut, error, reload, assistant, automations } = useWorkspace()
  const pathname = usePathname()
  useSaveDashboardLanguage()
  // "Piano" solo con i pagamenti online attivi: prima del lancio tutto resta com'era.
  const showPlan = Boolean(useUsage().status?.billing)

  if (!ready) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--text-secondary)]" />
      </div>
    )
  }
  if (!session) return <AppAuth />
  if (error) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-[var(--text-secondary)]">{error}</p>
        <button onClick={reload} className="rounded-full bg-[var(--accent-blue)] px-5 py-2 font-semibold text-white">
          Riprova
        </button>
      </div>
    )
  }
  if (!workspace) return <CreateWorkspace />

  const active = (href: string) => (href === '/app' ? pathname === '/app' : pathname?.startsWith(href))
  const nav = NAV.filter((item) => (item.href !== '/app/assistente' || assistant === true) && (item.href !== '/app/automazioni' || automations === true))

  return (
    <div className="min-h-[100dvh] pb-20 md:pb-0 md:pl-60">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-[var(--border-color)] bg-[var(--background-secondary)] p-4 md:flex">
        <div className="flex items-center justify-between gap-2 px-2">
          <p translate="no" className="text-xs font-semibold tracking-widest text-[var(--accent-blue)]">FACEVOICE AI</p>
          <UserUsageBadge />
        </div>
        {workspaces.length > 1 ? (
          <select
            value={workspace.id}
            onChange={(e) => selectWorkspace(e.target.value)}
            aria-label="Spazio di lavoro"
            translate="no"
            className="mt-3 rounded-lg border border-[var(--border-color)] bg-[var(--background)] px-2 py-2 text-sm text-[var(--text-primary)]"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        ) : (
          <p translate="no" className="mt-3 truncate px-2 font-bold text-[var(--text-primary)]">{workspace.name}</p>
        )}
        <nav className="mt-6 space-y-1">
          {nav.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                active(href) ? 'bg-[var(--accent-blue)] text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon className="h-4 w-4" /> {label}
            </Link>
          ))}
        </nav>
        <Link
          href="/app/programmati"
          className={`mt-4 flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
            active('/app/programmati') ? 'bg-[var(--accent-blue)] text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
        >
          <CalendarClock className="h-4 w-4" /> Contenuti programmati
        </Link>
        {showPlan && (
          <Link
            href="/app/piano"
            className={`mt-1 flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
              active('/app/piano') ? 'bg-[var(--accent-blue)] text-white' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <CreditCard className="h-4 w-4" /> Piano
          </Link>
        )}
        <LanguageSwitch className="mt-auto self-start" />
        <button onClick={signOut} className="mt-3 flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
          <LogOut className="h-4 w-4" /> Esci
        </button>
      </aside>

      <header className="flex items-center justify-between gap-3 border-b border-[var(--border-color)] px-4 py-3 md:hidden">
        {workspaces.length > 1 ? (
          <select
            value={workspace.id}
            onChange={(e) => selectWorkspace(e.target.value)}
            aria-label="Spazio di lavoro"
            translate="no"
            className="min-w-0 max-w-[60%] truncate rounded-lg border border-[var(--border-color)] bg-[var(--background)] px-2 py-1.5 text-sm font-bold text-[var(--text-primary)]"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        ) : (
          <p translate="no" className="truncate font-bold text-[var(--text-primary)]">{workspace.name}</p>
        )}
        <div className="flex shrink-0 items-center gap-3">
          <UserUsageBadge />
          <LanguageSwitch />
          <HeaderMenu onSignOut={signOut} showPlan={showPlan} />
        </div>
      </header>

      <UsageBlockedBanner />

      <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-10">{children}</div>

      <nav className={`fixed inset-x-0 bottom-0 grid ${nav.length > 5 ? 'grid-cols-6' : nav.length > 4 ? 'grid-cols-5' : 'grid-cols-4'} border-t border-[var(--border-color)] bg-[var(--background-secondary)] md:hidden`}>
        {nav.map(({ href, label, short, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={`flex min-w-0 flex-col items-center gap-1 py-2 ${nav.length > 5 ? 'text-[10px]' : 'text-[11px]'} ${active(href) ? 'text-[var(--accent-blue)]' : 'text-[var(--text-secondary)]'}`}
          >
            <Icon className="h-5 w-5 shrink-0" /> <span className="max-w-full truncate px-0.5">{short || label}</span>
          </Link>
        ))}
      </nav>
    </div>
  )
}

/** Menu ☰ della barra in alto (telefono): contenuti programmati, piano (con i pagamenti online attivi) ed esci. */
function HeaderMenu({ onSignOut, showPlan }: { onSignOut: () => void; showPlan: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const pathname = usePathname()

  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('touchstart', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('touchstart', close)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open} className="text-[var(--text-secondary)]">
        <Menu className="h-6 w-6" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-56 overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--background)] shadow-xl">
          <Link href="/app/programmati" className="flex items-center gap-3 px-4 py-3 text-sm text-[var(--text-primary)] hover:bg-[var(--background-secondary)]">
            <CalendarClock className="h-4 w-4 text-[var(--accent-blue)]" /> Contenuti programmati
          </Link>
          {showPlan && (
            <Link href="/app/piano" className="flex items-center gap-3 border-t border-[var(--border-color)] px-4 py-3 text-sm text-[var(--text-primary)] hover:bg-[var(--background-secondary)]">
              <CreditCard className="h-4 w-4 text-[var(--accent-blue)]" /> Piano
            </Link>
          )}
          <button onClick={onSignOut} className="flex w-full items-center gap-3 border-t border-[var(--border-color)] px-4 py-3 text-left text-sm text-[var(--text-secondary)] hover:bg-[var(--background-secondary)]">
            <LogOut className="h-4 w-4" /> Esci
          </button>
        </div>
      )}
    </div>
  )
}

export default function AppShell({ children }: { children: ReactNode }) {
  return (
    <WorkspaceProvider>
      <UsageProvider>
        <Frame>{children}</Frame>
      </UsageProvider>
    </WorkspaceProvider>
  )
}
