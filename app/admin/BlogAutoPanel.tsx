'use client'

import { useCallback, useEffect, useState } from 'react'
import { Newspaper, Play } from 'lucide-react'
import { getAccessToken } from '@/lib/session-token'

// Blog automatico: nei giorni scelti l'AI scrive un articolo sulle ultime notizie
// dell'intelligenza artificiale (da testate vere, con i link alle fonti) e lo
// pubblica nel blog della home.

type Settings = { enabled: boolean; days: number[]; time: string; shareFacebook: boolean; shareInstagram: boolean; coverImage: boolean }
type BlogState = {
  lastDate: string | null
  lastStatus: 'running' | 'published' | 'skipped' | 'error' | null
  lastNote: string | null
  lastPost: { title: string; url: string } | null
  lastFacebook?: string | null
  updatedAt: string | null
}

const DAYS = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab']
const GREEN = '#34C759'

async function authFetch(url: string, init: RequestInit = {}) {
  const token = await getAccessToken()
  return fetch(url, {
    ...init,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  })
}

export default function BlogAutoPanel() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [state, setState] = useState<BlogState | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await authFetch('/api/admin/blog-auto').catch(() => null)
    if (!res?.ok) return
    const data = await res.json()
    setSettings(data.settings)
    setState(data.state)
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(() => document.visibilityState === 'visible' && load(), 8000)
    return () => clearInterval(timer)
  }, [load])

  const save = async (patch: Partial<Settings>) => {
    if (!settings) return
    setSettings({ ...settings, ...patch })
    setBusy(true)
    const res = await authFetch('/api/admin/blog-auto', { method: 'PUT', body: JSON.stringify(patch) }).catch(() => null)
    setBusy(false)
    if (res?.ok) setSettings((await res.json()).settings)
    else setNotice('Non salvato, riprova.')
  }

  const runNow = async () => {
    setBusy(true)
    setNotice(null)
    const res = await authFetch('/api/admin/blog-auto', { method: 'POST' }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setBusy(false)
    setNotice(res?.ok ? 'Sto leggendo le notizie e scrivendo l’articolo: ci vogliono 1-2 minuti, poi ti arriva una notifica.' : data.error || 'Avvio non riuscito.')
    load()
  }

  if (!settings) return null
  const running = state?.lastStatus === 'running' && state.updatedAt && Date.now() - new Date(state.updatedAt).getTime() < 300_000
  const daysText = settings.days.map((d) => DAYS[d]).join(', ')

  return (
    <section className="mt-8 rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
            <Newspaper className="w-4 h-4 shrink-0" style={{ color: settings.enabled ? GREEN : 'var(--text-secondary)' }} />
            Blog automatico: novità sull’AI
          </p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {settings.enabled
              ? `Ogni ${daysText} alle ${settings.time} l’AI legge le ultime notizie sull’intelligenza artificiale e pubblica un articolo nel blog.`
              : 'Accendilo per pubblicare da solo un articolo sulle ultime novità dell’intelligenza artificiale.'}{' '}
            Usa solo notizie vere di testate come ANSA, Wired, AI4Business, TechCrunch e The Verge, con i link alle fonti in fondo. Se le
            notizie nuove sono troppo poche, quel giorno non pubblica niente.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={settings.enabled}
          aria-label="Accendi o spegni il blog automatico"
          disabled={busy}
          onClick={() => save({ enabled: !settings.enabled })}
          className="relative shrink-0 w-12 h-7 rounded-full transition-colors disabled:opacity-40"
          style={{ background: settings.enabled ? GREEN : 'var(--border-color)' }}
        >
          <span className="absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all" style={{ left: settings.enabled ? 22 : 2 }} />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {DAYS.map((label, day) => {
          const on = settings.days.includes(day)
          return (
            <button
              key={label}
              disabled={busy}
              onClick={() => {
                const days = on ? settings.days.filter((d) => d !== day) : [...settings.days, day]
                if (days.length) save({ days })
              }}
              className="px-2.5 py-1 rounded-full text-xs border transition-colors"
              style={on ? { background: GREEN, borderColor: GREEN, color: '#fff' } : { borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
            >
              {label}
            </button>
          )
        })}
        <input
          type="time"
          value={settings.time}
          disabled={busy}
          onChange={(e) => e.target.value && save({ time: e.target.value })}
          className="ml-1 px-2 py-1 rounded-lg bg-[var(--background)] border border-[var(--border-color)] text-[16px] sm:text-xs text-[var(--text-primary)]"
          aria-label="Ora di pubblicazione"
        />
        <button
          onClick={runNow}
          disabled={busy || Boolean(running)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs text-white disabled:opacity-40"
          style={{ background: '#0A84FF' }}
        >
          <Play className="w-3.5 h-3.5" /> {running ? 'Sto scrivendo…' : 'Genera ora'}
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {(
          [
            ['coverImage', 'Crea una copertina per ogni articolo senza immagine: generata dall’AI, oppure una grafica con titolo e marchio se l’AI non riesce.'],
            ['shareFacebook', 'Pubblica ogni articolo anche sulla Pagina Facebook, con l’inizio dell’articolo e il link.'],
            ['shareInstagram', 'Pubblica ogni articolo anche su Instagram, con la copertina e una didascalia (su Instagram i link non sono cliccabili: rimanda al blog).'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-start gap-2 text-xs text-[var(--text-primary)]">
            <input
              type="checkbox"
              checked={settings[key] !== false}
              disabled={busy}
              onChange={(e) => save({ [key]: e.target.checked })}
              className="mt-0.5"
            />
            <span>{label}</span>
          </label>
        ))}
        <p className="text-[11px] text-[var(--text-secondary)]">
          Vale per tutti gli articoli del blog, automatici e scritti a mano. Per ogni articolo ti arriva una notifica con l’esito.
        </p>
      </div>

      {notice && <p className="mt-2 text-xs text-[var(--text-secondary)]">{notice}</p>}
      {state?.lastStatus && state.lastStatus !== 'running' && (
        <p className="mt-2 text-xs text-[var(--text-secondary)]">
          Ultimo articolo:{' '}
          {state.lastStatus === 'published' && state.lastPost ? (
            <a href={state.lastPost.url} className="text-[var(--accent-blue)] hover:underline">
              {state.lastPost.title}
            </a>
          ) : (
            <span style={{ color: '#FF9500' }}>non pubblicato ({state.lastNote})</span>
          )}
          {state.lastStatus === 'published' && state.lastFacebook ? ` · ${state.lastFacebook}` : ''}
          {state.lastPost && state.lastStatus !== 'published' ? (
            <>
              {' '}· precedente:{' '}
              <a href={state.lastPost.url} className="text-[var(--accent-blue)] hover:underline">
                {state.lastPost.title}
              </a>
            </>
          ) : null}
        </p>
      )}
    </section>
  )
}
