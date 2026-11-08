'use client'

import { useCallback, useEffect, useState } from 'react'
import { Newspaper, Play, Plus, X } from 'lucide-react'
import { getAccessToken } from '@/lib/session-token'

// Blog automatico: nei giorni scelti, a ogni uscita (fino a 4 al giorno, ognuna con la
// sua ora e il suo argomento) l'AI scrive un articolo sulle ultime notizie vere di
// quell'argomento (con i link alle fonti) e lo pubblica nel blog della home.

type Slot = { id: string; time: string; topic: string }
type Settings = { enabled: boolean; days: number[]; slots: Slot[]; time: string; shareFacebook: boolean; shareInstagram: boolean; coverImage: boolean }
type RunStatus = 'running' | 'published' | 'skipped' | 'error' | null
type SlotState = { lastDate: string | null; lastStatus: RunStatus; lastNote: string | null; lastPost: { title: string; url: string } | null; updatedAt: string | null }
type BlogState = {
  lastDate: string | null
  lastStatus: RunStatus
  lastNote: string | null
  lastPost: { title: string; url: string } | null
  lastFacebook?: string | null
  lastTopic?: string | null
  slots?: Record<string, SlotState>
  updatedAt: string | null
}
/** Riga in modifica: "custom" = argomento scritto a mano (Altro…). */
type Row = { id?: string; time: string; topic: string; custom: boolean }

const DAYS = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab']
const GREEN = '#34C759'
const ORANGE = '#FF9500'
const OTHER = '__altro'
const AI_TOPIC = 'Novità sull’AI'
const FALLBACK_TOPICS = [AI_TOPIC, 'Marketing digitale', 'Social media', 'Piccole imprese e PMI', 'Tecnologia', 'Ristorazione e turismo']

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
const timeOf = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
const romeToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

async function authFetch(url: string, init: RequestInit = {}) {
  const token = await getAccessToken()
  return fetch(url, {
    ...init,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  })
}

const rowsOf = (slots: Slot[], topics: string[]): Row[] => slots.map((s) => ({ id: s.id, time: s.time, topic: s.topic, custom: !topics.includes(s.topic) }))
const sameRows = (rows: Row[], slots: Slot[]) =>
  rows.length === slots.length && rows.every((r, i) => r.id === slots[i].id && r.time === slots[i].time && r.topic.trim() === slots[i].topic)

/** Stesse regole del server, per avvisare subito: ora valida, argomento, niente due uscite a meno di N minuti. */
function rowsProblem(rows: Row[], maxLen: number, gap: number): string | null {
  if (!rows.length) return 'Serve almeno un orario.'
  for (const r of rows) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time)) return 'Scegli un orario per ogni uscita.'
    const topic = r.topic.trim()
    if (topic.length < 3) return 'Scrivi l’argomento (almeno 3 lettere).'
    if (topic.length > maxLen) return `L’argomento può avere al massimo ${maxLen} caratteri.`
  }
  const sorted = [...rows].sort((a, b) => minutesOf(a.time) - minutesOf(b.time))
  for (let i = 1; i < sorted.length; i++) {
    const diff = minutesOf(sorted[i].time) - minutesOf(sorted[i - 1].time)
    if (diff === 0) return `Ci sono due uscite alle ${sorted[i].time}.`
    if (diff < gap) return `Le uscite delle ${sorted[i - 1].time} e delle ${sorted[i].time} sono troppo vicine: lascia almeno ${gap} minuti.`
  }
  return null
}

/** Ora libera per una nuova uscita: 3 ore dopo l'ultima, altrimenti la prima mezz'ora libera dalle 9. */
function freeTime(rows: Row[], gap: number): string {
  const taken = rows.map((r) => minutesOf(r.time)).filter(Number.isFinite)
  const ok = (m: number) => m >= 0 && m < 24 * 60 && taken.every((t) => Math.abs(t - m) >= gap)
  const last = taken.length ? Math.max(...taken) : 9 * 60 + 40
  if (ok(last + 180)) return timeOf(last + 180)
  for (let m = 9 * 60; m < 9 * 60 + 24 * 60; m += 30) if (ok(m % (24 * 60))) return timeOf(m % (24 * 60))
  return '18:00'
}

export default function BlogAutoPanel() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [state, setState] = useState<BlogState | null>(null)
  const [topics, setTopics] = useState<string[]>(FALLBACK_TOPICS)
  const [limits, setLimits] = useState({ maxSlots: 4, maxTopicLength: 80, minGapMinutes: 30 })
  const [rows, setRows] = useState<Row[] | null>(null)
  const [nowTopic, setNowTopic] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await authFetch('/api/admin/blog-auto').catch(() => null)
    if (!res?.ok) return
    const data = await res.json()
    setSettings(data.settings)
    setState(data.state)
    if (Array.isArray(data.topics) && data.topics.length) setTopics(data.topics)
    if (data.maxSlots) setLimits({ maxSlots: data.maxSlots, maxTopicLength: data.maxTopicLength || 80, minGapMinutes: data.minGapMinutes || 30 })
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(() => document.visibilityState === 'visible' && load(), 8000)
    return () => clearInterval(timer)
  }, [load])

  const save = async (patch: Record<string, unknown>) => {
    if (!settings) return false
    setBusy(true)
    setNotice(null)
    const res = await authFetch('/api/admin/blog-auto', { method: 'PUT', body: JSON.stringify(patch) }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setBusy(false)
    if (res?.ok && data.settings) {
      setSettings(data.settings)
      return true
    }
    setNotice(data.error || 'Non salvato, riprova.')
    return false
  }

  const runNow = async (topic: string) => {
    setBusy(true)
    setNotice(null)
    const res = await authFetch('/api/admin/blog-auto', { method: 'POST', body: JSON.stringify({ topic }) }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setBusy(false)
    setNotice(
      res?.ok
        ? `Sto leggendo le notizie su «${data.topic || topic}» e scrivendo l’articolo: ci vogliono 1-2 minuti, poi ti arriva una notifica.`
        : data.error || 'Avvio non riuscito.'
    )
    load()
  }

  if (!settings) return null
  const slots = settings.slots?.length ? settings.slots : [{ id: 'main', time: settings.time, topic: AI_TOPIC }]
  const editing = rows ?? rowsOf(slots, topics)
  const changed = rows !== null && !sameRows(rows, slots)
  const problem = changed ? rowsProblem(editing, limits.maxTopicLength, limits.minGapMinutes) : null
  const running = state?.lastStatus === 'running' && state.updatedAt && Date.now() - new Date(state.updatedAt).getTime() < 300_000
  const daysText = settings.days.map((d) => DAYS[d]).join(', ')
  const savedTopics = [...new Set(slots.map((s) => s.topic))]
  const nowChoices = [...new Set([...savedTopics, ...topics])]
  const chosenNow = nowTopic && nowChoices.includes(nowTopic) ? nowTopic : slots[0].topic
  const today = romeToday()

  const edit = (next: Row[]) => setRows(next)
  const setRow = (i: number, patch: Partial<Row>) => edit(editing.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const saveRows = async () => {
    if (problem) return
    const ok = await save({ slots: editing.map((r) => ({ ...(r.id ? { id: r.id } : {}), time: r.time, topic: r.topic.trim() })) })
    if (ok) setRows(null)
  }

  return (
    <section className="mt-8 rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
            <Newspaper className="w-4 h-4 shrink-0" style={{ color: settings.enabled ? GREEN : 'var(--text-secondary)' }} />
            Blog automatico
          </p>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)] truncate">{savedTopics.join(' · ')}</p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {settings.enabled
              ? `Ogni ${daysText}, a ogni orario qui sotto, l’AI legge le ultime notizie sull’argomento scelto e pubblica un articolo nel blog.`
              : 'Accendilo per pubblicare da solo, ogni giorno scelto, un articolo per ogni orario sulle ultime notizie dell’argomento.'}{' '}
            Usa solo notizie vere (per l’AI testate come ANSA, Wired, AI4Business, TechCrunch e The Verge; per gli altri argomenti Google News),
            con i link alle fonti in fondo. Se le notizie nuove sono troppo poche, quell’uscita salta.
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
      </div>

      <div className="mt-3 space-y-2">
        <p className="text-xs font-medium text-[var(--text-primary)]">Uscite (ora italiana)</p>
        {editing.map((row, i) => {
          const last = row.id ? state?.slots?.[row.id] : undefined
          const when = last?.lastDate ? (last.lastDate === today ? 'oggi' : last.lastDate.slice(8, 10) + '/' + last.lastDate.slice(5, 7)) : ''
          return (
            <div key={row.id || `nuova-${i}`} className="rounded-xl border border-[var(--border-color)] bg-[var(--background)] p-2">
              <div className="flex items-center gap-1.5">
                <input
                  type="time"
                  value={row.time}
                  disabled={busy}
                  onChange={(e) => setRow(i, { time: e.target.value })}
                  className="w-[6.5rem] shrink-0 px-2 py-1 rounded-lg bg-[var(--background-secondary)] border border-[var(--border-color)] text-[16px] sm:text-xs text-[var(--text-primary)]"
                  aria-label={`Ora dell’uscita ${i + 1}`}
                />
                <select
                  value={row.custom ? OTHER : row.topic}
                  disabled={busy}
                  onChange={(e) =>
                    e.target.value === OTHER ? setRow(i, { custom: true, topic: row.custom ? row.topic : '' }) : setRow(i, { custom: false, topic: e.target.value })
                  }
                  className="min-w-0 flex-1 px-2 py-1 rounded-lg bg-[var(--background-secondary)] border border-[var(--border-color)] text-[16px] sm:text-xs text-[var(--text-primary)]"
                  aria-label={`Argomento dell’uscita ${i + 1}`}
                >
                  {topics.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                  <option value={OTHER}>Altro…</option>
                </select>
                {editing.length > 1 && (
                  <button
                    disabled={busy}
                    onClick={() => edit(editing.filter((_, j) => j !== i))}
                    className="shrink-0 p-1.5 rounded-full text-[var(--text-secondary)] hover:bg-[var(--background-secondary)] disabled:opacity-40"
                    aria-label={`Togli l’uscita delle ${row.time}`}
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              {row.custom && (
                <input
                  type="text"
                  value={row.topic}
                  maxLength={limits.maxTopicLength}
                  disabled={busy}
                  placeholder="Scrivi l’argomento, es. Fotografia"
                  onChange={(e) => setRow(i, { topic: e.target.value })}
                  className="mt-1.5 w-full px-2 py-1 rounded-lg bg-[var(--background-secondary)] border border-[var(--border-color)] text-[16px] sm:text-xs text-[var(--text-primary)]"
                  aria-label={`Argomento scritto a mano per l’uscita ${i + 1}`}
                />
              )}
              {last?.lastStatus && when && (
                <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                  {when}:{' '}
                  {last.lastStatus === 'running' ? (
                    'sto scrivendo…'
                  ) : last.lastStatus === 'published' && last.lastPost ? (
                    <a href={last.lastPost.url} className="text-[var(--accent-blue)] hover:underline">
                      {last.lastPost.title}
                    </a>
                  ) : (
                    <span style={{ color: ORANGE }}>non pubblicato{last.lastNote ? ` (${last.lastNote})` : ''}</span>
                  )}
                </p>
              )}
            </div>
          )
        })}
        <div className="flex flex-wrap items-center gap-2">
          {editing.length < limits.maxSlots && (
            <button
              disabled={busy}
              onClick={() => edit([...editing, { time: freeTime(editing, limits.minGapMinutes), topic: topics[0] || AI_TOPIC, custom: false }])}
              className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs border border-[var(--border-color)] text-[var(--text-primary)] disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5" /> Aggiungi orario
            </button>
          )}
          {changed && (
            <>
              <button
                disabled={busy || Boolean(problem)}
                onClick={saveRows}
                className="px-3 py-1.5 rounded-full text-xs text-white disabled:opacity-40"
                style={{ background: GREEN }}
              >
                Salva orari
              </button>
              <button disabled={busy} onClick={() => setRows(null)} className="px-2 py-1.5 text-xs text-[var(--text-secondary)]">
                Annulla
              </button>
            </>
          )}
        </div>
        {problem && <p className="text-xs" style={{ color: ORANGE }}>{problem}</p>}
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        <select
          value={chosenNow}
          disabled={busy || Boolean(running)}
          onChange={(e) => setNowTopic(e.target.value)}
          className="min-w-0 flex-1 px-2 py-1 rounded-lg bg-[var(--background)] border border-[var(--border-color)] text-[16px] sm:text-xs text-[var(--text-primary)]"
          aria-label="Argomento dell’articolo da scrivere subito"
        >
          {nowChoices.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button
          onClick={() => runNow(chosenNow)}
          disabled={busy || Boolean(running)}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs text-white disabled:opacity-40"
          style={{ background: '#0A84FF' }}
        >
          <Play className="w-3.5 h-3.5" /> {running ? 'Sto scrivendo…' : 'Genera ora'}
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {(
          [
            ['coverImage', 'Usa la prima immagine del carosello come copertina dell’articolo nel blog, se non ne ha una.'],
            ['shareFacebook', 'Pubblica ogni articolo anche sulla Pagina Facebook, come carosello di immagini con l’inizio dell’articolo e il link.'],
            ['shareInstagram', 'Pubblica ogni articolo anche su Instagram, come carosello con una didascalia (su Instagram i link non sono cliccabili: rimanda al blog).'],
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
          Il carosello (da 3 a 6 immagini, colori Facevoice) ha una copertina con il titolo (e una foto generata dall’AI quando riesce), una slide per ogni notizia e una slide finale con l’invito al blog. Vale per tutti gli articoli del blog, automatici e scritti a mano; per ognuno ti arriva una notifica con l’esito.
        </p>
        <p className="text-[11px] text-[var(--text-secondary)]">
          Ogni uscita usa l’AI e genera immagini (ha un costo). Instagram permette al massimo 50 post al giorno: con 4 uscite nessun problema.
        </p>
      </div>

      {notice && <p className="mt-2 text-xs text-[var(--text-secondary)]">{notice}</p>}
      {state?.lastStatus && state.lastStatus !== 'running' && (
        <p className="mt-2 text-xs text-[var(--text-secondary)]">
          Ultimo articolo{state.lastTopic ? ` (${state.lastTopic})` : ''}:{' '}
          {state.lastStatus === 'published' && state.lastPost ? (
            <a href={state.lastPost.url} className="text-[var(--accent-blue)] hover:underline">
              {state.lastPost.title}
            </a>
          ) : (
            <span style={{ color: ORANGE }}>non pubblicato ({state.lastNote})</span>
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
