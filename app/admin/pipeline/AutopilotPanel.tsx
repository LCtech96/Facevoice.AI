'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, Play, Save, Zap } from 'lucide-react'
import { getAccessToken } from '@/lib/session-token'
import { useStaffAccess } from '@/components/useStaffAccess'

// Pannello dell'automazione giornaliera: ogni giorno all'ora scelta cerca nuove
// attivita', legge i loro siti (email e bozza) e invia le prime email.

type Settings = {
  enabled: boolean
  time: string
  searches: string[]
  searchesPerDay: number
  resultsPerSearch: number
  emailsPerDay: number
  next: number
}
type Run = {
  date: string
  status: 'running' | 'done' | 'error'
  phase: string
  statusText: string
  startedAt: string
  updatedAt: string
  manual?: boolean
  searched: { query: string; found: number; added: number; error?: string }[]
  analyzed: number
  withEmail: number
  sent: { id: string; name: string; email: string }[]
  errors: string[]
}
type State = { settings: Settings; run: Run | null; running: boolean; sentToday: number; placesConfigured: boolean }

const ACCENT = '#0A84FF'
const DONE = '#34C759'
const MAX_EMAILS = 30

async function authFetch(url: string, init: RequestInit = {}) {
  const token = await getAccessToken()
  return fetch(url, {
    ...init,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  })
}

function dayLabel(date: string) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
  if (date === today) return 'oggi'
  return new Date(`${date}T12:00:00`).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })
}

export default function AutopilotPanel({ onRunning }: { onRunning: (text: string | null) => void }) {
  const staff = useStaffAccess()
  const [state, setState] = useState<State | null>(null)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<Settings | null>(null)
  const [searchesText, setSearchesText] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await authFetch('/api/admin/autopilot').catch(() => null)
    if (!res?.ok) return
    const data = (await res.json()) as State
    setState(data)
    onRunning(data.running ? data.run?.statusText || 'Automazione al lavoro…' : null)
  }, [onRunning])

  useEffect(() => {
    load()
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load()
    }, 6000)
    return () => clearInterval(timer)
  }, [load])

  const startEdit = () => {
    if (!state) return
    setForm(state.settings)
    setSearchesText(state.settings.searches.join('\n'))
    setOpen(true)
  }

  const save = async (patch?: Partial<Settings>) => {
    const body = patch ?? { ...form, searches: searchesText.split('\n').map((s) => s.trim()).filter(Boolean) }
    setBusy(true)
    setNotice(null)
    const res = await authFetch('/api/admin/autopilot', { method: 'PUT', body: JSON.stringify(body) }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setBusy(false)
    if (!res?.ok) return setNotice(data.error || 'Non salvato, riprova.')
    setState((s) => (s ? { ...s, settings: data.settings } : s))
    if (!patch) {
      setOpen(false)
      setNotice('Salvato.')
    }
  }

  const runNow = async () => {
    if (!window.confirm('Avvio adesso l’automazione: cerca, legge i siti e invia le email (fino al numero scelto per oggi). Procedo?')) return
    setBusy(true)
    setNotice(null)
    const res = await authFetch('/api/admin/autopilot', { method: 'POST' }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setBusy(false)
    if (!res?.ok) return setNotice(data.error || 'Non sono riuscito ad avviarla.')
    load()
  }

  if (!state) return null
  const { settings, run } = state
  const canEdit = staff.isAdmin
  const nextSearches = settings.searches.length
    ? Array.from({ length: Math.min(settings.searchesPerDay, settings.searches.length) }, (_, i) => settings.searches[(settings.next + i) % settings.searches.length])
    : []
  const added = run ? run.searched.reduce((n, s) => n + s.added, 0) : 0
  const input =
    'w-full px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border-color)] text-[16px] sm:text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] outline-none focus:border-[var(--accent-blue)]'

  return (
    <section className="mt-5 rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
            <Zap className="w-4 h-4 shrink-0" style={{ color: settings.enabled ? DONE : 'var(--text-secondary)' }} />
            Automazione giornaliera
            <span
              className="px-2 py-0.5 rounded-full text-[11px] font-medium"
              style={{ background: `${settings.enabled ? DONE : '#8E8E93'}22`, color: settings.enabled ? DONE : 'var(--text-secondary)' }}
            >
              {settings.enabled ? 'attiva' : 'spenta'}
            </span>
          </p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {settings.enabled
              ? `Ogni giorno alle ${settings.time}: ${nextSearches.length ? `${nextSearches.length} ricerch${nextSearches.length === 1 ? 'a' : 'e'}` : 'nessuna ricerca'}, lettura dei siti e fino a ${settings.emailsPerDay} email.`
              : 'Accendila per cercare clienti, trovare le email e inviare le prime email ogni giorno da sola.'}
            {nextSearches.length ? ` Prossime ricerche: ${nextSearches.map((q) => `“${q}”`).join(', ')}.` : ''}
          </p>
        </div>
        {canEdit && (
          <button
            role="switch"
            aria-checked={settings.enabled}
            aria-label="Accendi o spegni l'automazione"
            disabled={busy || (!settings.enabled && !settings.searches.length)}
            title={!settings.searches.length ? 'Aggiungi prima almeno una ricerca' : undefined}
            onClick={() => save({ enabled: !settings.enabled })}
            className="relative shrink-0 w-12 h-7 rounded-full transition-colors disabled:opacity-40"
            style={{ background: settings.enabled ? DONE : 'var(--border-color)' }}
          >
            <span className="absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all" style={{ left: settings.enabled ? 22 : 2 }} />
          </button>
        )}
      </div>

      {!state.placesConfigured && (
        <p className="mt-3 px-3 py-2 rounded-lg bg-[#FF9500]/10 text-[#FF9500] text-sm">Manca GOOGLE_PLACES_API_KEY: le ricerche non funzionano.</p>
      )}

      {/* Ultima esecuzione */}
      {run && (
        <div className="mt-3 rounded-xl border border-[var(--border-color)] bg-[var(--background)] px-3 py-2.5 text-sm">
          <p className="text-[var(--text-primary)]">
            <span className="font-medium">
              {state.running ? 'Al lavoro adesso' : `Ultima esecuzione: ${dayLabel(run.date)}`}
              {run.manual ? ' (avviata a mano)' : ''}
            </span>
            {state.running && run.statusText ? <span className="text-[var(--text-secondary)]"> · {run.statusText}</span> : null}
            {!state.running && run.status === 'running' ? <span className="text-[var(--text-secondary)]"> · in ripresa…</span> : null}
          </p>
          <p className="mt-1 text-[var(--text-secondary)]">
            <b className="text-[var(--text-primary)] tabular-nums">{added}</b> nuove attività ·{' '}
            <b className="text-[var(--text-primary)] tabular-nums">{run.analyzed}</b> siti letti ·{' '}
            <b className="text-[var(--text-primary)] tabular-nums">{run.withEmail}</b> email trovate ·{' '}
            <b className="tabular-nums" style={{ color: run.sent.length ? DONE : 'var(--text-primary)' }}>
              {run.sent.length}
            </b>{' '}
            email inviate
          </p>
          {run.searched.length > 0 && (
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              Ricerche:{' '}
              {run.searched.map((s) => (s.error ? `“${s.query}” (errore: ${s.error})` : `“${s.query}” (${s.found} trovate, ${s.added} nuove)`)).join(' · ')}
            </p>
          )}
          {run.sent.length > 0 && (
            <p className="mt-1 text-xs text-[var(--text-secondary)]">Inviate a: {run.sent.map((s) => s.name).join(', ')}</p>
          )}
          {run.errors.length > 0 && (
            <details className="mt-1 text-xs text-[#FF9500]">
              <summary className="cursor-pointer">{run.errors.length} avvisi</summary>
              <ul className="mt-1 list-disc pl-4 space-y-0.5">
                {run.errors.slice(-10).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {canEdit && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => (open ? setOpen(false) : startEdit())}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border border-[var(--border-color)] text-[var(--text-primary)]"
          >
            Impostazioni <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
          <button
            onClick={runNow}
            disabled={busy || state.running || !settings.searches.length}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs text-white disabled:opacity-40"
            style={{ background: ACCENT }}
          >
            <Play className="w-3.5 h-3.5" /> Avvia ora
          </button>
          <span className="self-center text-xs text-[var(--text-secondary)]">
            Email inviate oggi: {state.sentToday}/{MAX_EMAILS}
          </span>
        </div>
      )}

      {open && form && (
        <div className="mt-3 space-y-3">
          <label className="block">
            <span className="block text-[11px] text-[var(--text-secondary)] mb-1">Ricerche su Google Maps, una per riga (usate a rotazione, giorno dopo giorno)</span>
            <textarea
              value={searchesText}
              onChange={(e) => setSearchesText(e.target.value)}
              rows={6}
              placeholder={'alimentari Palermo\nnegozi di elettronica Palermo\nartigianato Cefalù\nB&B Terrasini'}
              className={input}
            />
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <label className="block">
              <span className="block text-[11px] text-[var(--text-secondary)] mb-1">Ora (Italia)</span>
              <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} className={input} />
            </label>
            <label className="block">
              <span className="block text-[11px] text-[var(--text-secondary)] mb-1">Ricerche al giorno (1-5)</span>
              <input type="number" min={1} max={5} value={form.searchesPerDay} onChange={(e) => setForm({ ...form, searchesPerDay: Number(e.target.value) })} className={input} />
            </label>
            <label className="block">
              <span className="block text-[11px] text-[var(--text-secondary)] mb-1">Risultati per ricerca (5-60)</span>
              <input type="number" min={5} max={60} value={form.resultsPerSearch} onChange={(e) => setForm({ ...form, resultsPerSearch: Number(e.target.value) })} className={input} />
            </label>
            <label className="block">
              <span className="block text-[11px] text-[var(--text-secondary)] mb-1">Email al giorno (0-{MAX_EMAILS})</span>
              <input type="number" min={0} max={MAX_EMAILS} value={form.emailsPerDay} onChange={(e) => setForm({ ...form, emailsPerDay: Number(e.target.value) })} className={input} />
            </label>
          </div>
          <p className="text-xs text-[var(--text-secondary)]">
            Le email partono dalla tua casella Gmail collegata, una ogni 20-45 secondi, con il testo scritto dall’AI per ogni attività
            (stesse regole delle bozze della pagina Clienti). Mai due volte allo stesso indirizzo, mai a chi ha chiesto di non essere
            contattato; le risposte arrivano in Messaggi. Ogni sito letto costa una chiamata AI (al massimo 40 al giorno).
          </p>
          <button
            onClick={() => save()}
            disabled={busy}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm text-white disabled:opacity-40"
            style={{ background: ACCENT }}
          >
            <Save className="w-4 h-4" /> Salva
          </button>
        </div>
      )}

      {notice && <p className="mt-2 text-xs text-[var(--text-secondary)]">{notice}</p>}
    </section>
  )
}
