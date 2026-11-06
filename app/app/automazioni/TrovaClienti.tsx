'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Ban, Check, ChevronDown, Globe, Loader2, Mail, MessageCircle, Mic, PencilLine, Phone, RefreshCw, Search, Send, Sparkles, Trash2, X } from 'lucide-react'
import { useWorkspace } from '@/components/app/WorkspaceContext'
import { useDictation } from '@/components/useDictation'
import { WEEKDAYS } from '@/lib/automations-shared'
import { PROSPECTS_LEGAL, PROSPECT_EMAILS_MAX, PROSPECT_EMAILS_MIN, SEARCH_UNAVAILABLE, type ProspectMode, type ProspectStatus } from '@/lib/prospects-shared'

// Trova clienti: il cliente scrive a chi vuole rivolgersi, il motore trova le aziende su
// Google Maps, legge i siti, l'AI scrive la prima email; il cliente la legge e decide
// (Invia così, Modifica, Rigenera, Scarta, Non contattare) oppure lascia fare all'AI.
// Le email partono all'orario scelto dalla casella collegata, nel limite di 20 al giorno in tutto.

type Settings = { niche: string; area: string; offer: string; emailsPerDay: number; time: string; days: number[]; mode: ProspectMode; active: boolean }
type Prospect = {
  id: string
  name: string
  address: string | null
  website: string | null
  email: string | null
  phone: string | null
  mapsUrl: string | null
  status: ProspectStatus
  draft: { subject: string; body: string; language: string } | null
  edited?: boolean
  approvedBy?: 'user' | 'ai' | null
  sentAt?: string | null
  repliedAt?: string | null
  error?: string | null
  foundAt: string
}
type Run = { kind: 'slot' | 'manual'; startedAt: string; searches: number; found: number; reads: number; drafted: number; sent: number; note: string | null; working: boolean }
type Summary = { id: string; kind: 'slot' | 'manual'; startedAt: string; finishedAt: string; searches: number; found: number; reads: number; drafted: number; sent: number; note: string | null }
export type ProspectsData = {
  settings: Settings
  offerSuggestion: string
  available: boolean
  mailbox: { email: string; status: string } | null
  today: { used: number; limit: number }
  day: { sent: number; places: number; reads: number; drafts: number; manual: number }
  caps: { places: number; reads: number; drafts: number; regen: number; manual: number }
  counts: { found: number; toApprove: number; queued: number; sent: number; sentToday: number; noEmail: number; skipped: number; blocked: number; replied: number }
  prospects: Prospect[]
  run: Run | null
  history: Summary[]
  nextRun: string | null
  blocked: string[]
  blockedByAI: boolean
  canManage?: boolean
  warning?: string | null
}

type Notice = { text: string; tone: 'ok' | 'warn' | 'error' }

const ROME = 'Europe/Rome'
const locale = (language: string) => (language === 'it' ? 'it-IT' : 'en-GB')
const whenShort = (iso: string, language: string) =>
  new Date(iso).toLocaleString(locale(language), { timeZone: ROME, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const domainOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
const safeUrl = (url: string | null) => (url && /^https?:\/\//i.test(url) ? url : null)

const card = 'rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-3'
const input =
  'mt-1 w-full rounded-xl border border-[var(--border-color)] bg-[var(--background)] px-3 py-2 text-[16px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)] md:text-sm'
const chip = (on: boolean) =>
  `rounded-full border px-3 py-1.5 text-sm ${on ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)] text-white' : 'border-[var(--border-color)] text-[var(--text-primary)]'}`

export default function TrovaClienti({ language, onToday }: { language: string; onToday?: (today: { used: number; limit: number }) => void }) {
  const { appFetch, workspace } = useWorkspace()
  const [data, setData] = useState<ProspectsData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const canManage = data?.canManage ?? workspace?.role !== 'member'

  const apply = useCallback(
    (body: ProspectsData) => {
      setData((d) => ({ ...body, canManage: body.canManage ?? d?.canManage }))
      if (body.today) onToday?.(body.today)
    },
    [onToday]
  )

  const load = useCallback(async () => {
    const res = await appFetch('/api/app/automations/prospects').catch(() => null)
    const body = res ? await res.json().catch(() => null) : null
    if (res?.ok && body) {
      apply(body as ProspectsData)
      setLoadError(null)
    } else if (res?.status !== 403) setLoadError(body?.error || 'Trova clienti non disponibile, riprova.')
  }, [appFetch, apply])

  const working = Boolean(data?.run?.working)
  useEffect(() => {
    load()
    // Mentre lavora si aggiorna spesso (nuove aziende, bozze, invii), poi ogni 30 secondi.
    const timer = setInterval(() => document.visibilityState === 'visible' && load(), working ? 5000 : 30_000)
    const onVisible = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load, working])

  /** Azione sul server: risponde con tutto il riepilogo aggiornato. */
  const act = async (key: string, payload: Record<string, unknown>, ok?: string | ((body: ProspectsData & Record<string, unknown>) => string | null)): Promise<boolean> => {
    if (busy) return false
    setBusy(key)
    setNotice(null)
    const res = await appFetch('/api/app/automations/prospects', { method: 'POST', body: JSON.stringify(payload) }).catch(() => null)
    const body = res ? await res.json().catch(() => null) : null
    setBusy(null)
    if (!res?.ok || !body) {
      setNotice({ text: body?.error || 'Non riuscito, riprova.', tone: 'error' })
      if (body?.settings) apply(body)
      return false
    }
    apply(body)
    const text = typeof ok === 'function' ? ok(body) : ok
    if (body.warning) setNotice({ text: body.warning, tone: 'warn' })
    else if (text) setNotice({ text, tone: 'ok' })
    return true
  }

  if (!data) {
    return loadError ? (
      <div className="py-10 text-center">
        <p className="text-[var(--text-secondary)]">{loadError}</p>
        <button onClick={load} className="mt-4 rounded-full bg-[var(--accent-blue)] px-5 py-2 font-semibold text-white">
          Riprova
        </button>
      </div>
    ) : (
      <Loader2 className="h-5 w-5 animate-spin text-[var(--text-secondary)]" />
    )
  }

  const { counts, settings, today } = data
  const drafts = data.prospects.filter((p) => p.status === 'da_approvare')
  const queued = data.prospects.filter((p) => p.status === 'approvata' || p.status === 'in_invio')
  const failed = data.prospects.filter((p) => p.status === 'errore' && p.draft && p.email)
  const sent = data.prospects.filter((p) => p.status === 'inviata')
  const others = data.prospects.filter((p) => ['senza_email', 'saltata', 'non_contattare', 'nuova'].includes(p.status) || (p.status === 'errore' && !(p.draft && p.email)))
  const auto = settings.mode === 'auto'
  const nextLabel = data.nextRun ? whenShort(data.nextRun, language) : null
  const last = data.history[0]

  return (
    <div className="space-y-4">
      {!data.available && (
        <p className="flex items-start gap-2 rounded-2xl border border-[#FF9500]/40 bg-[#FF9500]/10 p-3 text-sm text-[#FF9500]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {SEARCH_UNAVAILABLE}. Le email già approvate partono comunque all’orario.
        </p>
      )}
      {data.blockedByAI && (
        <p className="flex items-start gap-2 rounded-2xl border border-[#FF3B30]/40 bg-[#FF3B30]/10 p-3 text-sm text-[#ff6b6b]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Hai finito l’AI inclusa nel tuo piano: niente nuove ricerche finché non si rinnova.
        </p>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Counter label="Trovati" value={String(counts.found)} />
        {auto ? (
          <Counter label="Pronte" value={String(counts.queued)} tone={counts.queued ? 'blue' : undefined} />
        ) : (
          <Counter label="Da approvare" value={String(counts.toApprove)} tone={counts.toApprove ? 'blue' : undefined} />
        )}
        <Counter label="Inviati oggi" value={`${today.used}/${today.limit}`} title={`Email partite oggi in tutto (programmate e Trova clienti): al massimo ${today.limit}`} tone={today.used >= today.limit ? 'red' : undefined} />
      </div>

      <div className={`${card} text-sm`}>
        {data.run?.working ? (
          <p className="flex items-start gap-2">
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-[var(--accent-blue)]" />
            <span>
              <span className="font-semibold">{data.run.kind === 'manual' ? 'Sto cercando nuove aziende…' : 'Giro di oggi in corso…'}</span>{' '}
              <span className="text-[var(--text-secondary)]">
                {data.run.found} trovate · {data.run.drafted} email scritte{data.run.kind === 'slot' ? ` · ${data.run.sent} inviate` : ''}
              </span>
            </span>
          </p>
        ) : (
          <>
            <p>
              <span className="text-[var(--text-secondary)]">Prossimo giro: </span>
              <span className="font-semibold">{settings.active && nextLabel ? nextLabel : 'in pausa'}</span>
            </p>
            {last && (
              <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                Ultimo giro ({whenShort(last.finishedAt, language)}): {last.found} aziende nuove, {last.drafted} email scritte
                {last.kind === 'slot' ? `, ${last.sent} inviate` : ''}
                {last.note ? ` · ${last.note}` : ''}
              </p>
            )}
          </>
        )}
        {canManage && !data.run?.working && settings.niche && data.available && (
          <button
            onClick={() => act('search', { action: 'search_now' }, 'Ricerca avviata: le nuove email compaiono qui tra qualche minuto.')}
            disabled={Boolean(busy) || data.blockedByAI}
            className="mt-2 flex items-center gap-1.5 rounded-full border border-[var(--accent-blue)] px-3 py-1.5 text-sm font-semibold text-[var(--accent-blue)] disabled:opacity-50"
          >
            {busy === 'search' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Cerca ora
          </button>
        )}
        {data.mailbox ? (
          <p className="mt-2 flex min-w-0 items-center gap-1.5 text-xs text-[var(--text-secondary)]">
            <Mail className="h-3.5 w-3.5 shrink-0" /> Invia da: <span translate="no" className="truncate font-medium text-[var(--text-primary)]">{data.mailbox.email}</span>
          </p>
        ) : (
          <p className="mt-2 text-xs text-[#FF9500]">
            Nessuna email collegata.{' '}
            <Link href="/app/canali/email" className="font-semibold text-[var(--accent-blue)]">
              Collegala →
            </Link>
          </p>
        )}
      </div>

      {notice && (
        <p className={`rounded-xl px-3 py-2 text-sm ${notice.tone === 'error' ? 'bg-[#FF3B30]/10 text-[#ff6b6b]' : notice.tone === 'warn' ? 'bg-[#FF9500]/10 text-[#FF9500]' : 'bg-[#34C759]/10 text-[#34C759]'}`}>
          {notice.text}
        </p>
      )}

      <SettingsCard data={data} canManage={canManage} busy={busy} act={act} />

      <p className="text-xs text-[var(--text-secondary)]">{PROSPECTS_LEGAL}</p>

      {!auto && (
        <section>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold">Da approvare ({drafts.length})</h2>
            {canManage && drafts.length > 1 && (
              <button
                onClick={() => act('all', { action: 'approve_all' }, (b) => `${b.approved} email approvate: partono al prossimo invio.`)}
                disabled={Boolean(busy)}
                className="flex items-center gap-1.5 rounded-full border border-[var(--accent-blue)] px-3 py-1.5 text-sm font-semibold text-[var(--accent-blue)] disabled:opacity-50"
              >
                {busy === 'all' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approva tutte
              </button>
            )}
          </div>
          {!drafts.length ? (
            <p className="mt-2 rounded-2xl border border-dashed border-[var(--border-color)] p-4 text-sm text-[var(--text-secondary)]">
              {settings.niche ? 'Nessuna email da approvare. Le nuove arrivano al prossimo giro, oppure tocca «Cerca ora».' : 'Scrivi a chi vuoi rivolgerti nelle impostazioni qui sopra, poi tocca «Cerca ora».'}
            </p>
          ) : (
            <div className="mt-2 space-y-3">
              {drafts.map((p) => (
                <DraftCard key={p.id} p={p} canManage={canManage} busy={busy} act={act} nextLabel={nextLabel} />
              ))}
            </div>
          )}
        </section>
      )}

      {(queued.length > 0 || auto) && (
        <section>
          <h2 className="text-lg font-bold">{auto ? 'Pronte, partono da sole' : 'Approvate'} ({queued.length})</h2>
          <p className="text-xs text-[var(--text-secondary)]">
            {nextLabel && settings.active ? `Partono al prossimo invio (${nextLabel}), le più vecchie prima.` : 'Partono al prossimo invio, quando Trova clienti è attivo.'}
          </p>
          {!queued.length ? (
            <p className="mt-2 rounded-2xl border border-dashed border-[var(--border-color)] p-4 text-sm text-[var(--text-secondary)]">
              L’AI sceglie le aziende, scrive e invia all’orario. Qui vedi quelle pronte e sotto quelle inviate.
            </p>
          ) : (
            <div className="mt-2 space-y-3">
              {queued.map((p) => (
                <DraftCard key={p.id} p={p} canManage={canManage} busy={busy} act={act} nextLabel={nextLabel} />
              ))}
            </div>
          )}
        </section>
      )}

      {failed.length > 0 && (
        <section>
          <h2 className="text-lg font-bold">Non partite ({failed.length})</h2>
          <div className="mt-2 space-y-3">
            {failed.map((p) => (
              <DraftCard key={p.id} p={p} canManage={canManage} busy={busy} act={act} nextLabel={nextLabel} />
            ))}
          </div>
        </section>
      )}

      <SentList sent={sent} language={language} />
      <OthersList others={others} />
      <BlockedList data={data} canManage={canManage} busy={busy} act={act} />
    </div>
  )
}

function Counter({ label, value, title, tone }: { label: string; value: string; title?: string; tone?: 'blue' | 'red' }) {
  return (
    <div className={`${card} min-w-0 px-2 text-center`} title={title}>
      <p className={`text-xl font-extrabold ${tone === 'blue' ? 'text-[var(--accent-blue)]' : tone === 'red' ? 'text-[#FF3B30]' : ''}`}>{value}</p>
      <p className="truncate text-[11px] text-[var(--text-secondary)]">{label}</p>
    </div>
  )
}

type Act = (key: string, payload: Record<string, unknown>, ok?: string | ((body: ProspectsData & Record<string, unknown>) => string | null)) => Promise<boolean>

function SettingsCard({ data, canManage, busy, act }: { data: ProspectsData; canManage: boolean; busy: string | null; act: Act }) {
  const s = data.settings
  const [open, setOpen] = useState(!s.niche)
  const [d, setD] = useState(() => ({ ...s, offer: s.offer || data.offerSuggestion, kind: s.days.length ? ('days' as const) : ('every' as const) }))
  const [dirty, setDirty] = useState(false)
  const set = (patch: Partial<typeof d>) => {
    setD((x) => ({ ...x, ...patch }))
    setDirty(true)
  }
  // Valori nuovi dal server (Assistente, altra scheda): si aggiornano se non si sta scrivendo.
  useEffect(() => {
    if (!dirty) setD({ ...s, offer: s.offer || data.offerSuggestion, kind: s.days.length ? 'days' : 'every' })
  }, [s, data.offerSuggestion, dirty])
  const dictate = (field: 'niche' | 'offer') => (text: string) => {
    setD((x) => ({ ...x, [field]: x[field] ? `${x[field]} ${text}` : text }))
    setDirty(true)
  }
  const nicheMic = useDictation(dictate('niche'))
  const offerMic = useDictation(dictate('offer'))

  const payload = (extra: Partial<Settings> = {}) => ({
    action: 'settings',
    settings: { niche: d.niche, area: d.area, offer: d.offer, emailsPerDay: d.emailsPerDay, time: d.time, days: d.kind === 'days' ? d.days : [], mode: d.mode, ...extra },
  })
  const save = async () => {
    if (d.kind === 'days' && !d.days.length) return
    if (await act('save', payload(), 'Impostazioni salvate.')) setDirty(false)
  }
  const toggle = () => act('active', s.active ? { action: 'settings', settings: { active: false } } : payload({ active: true }), s.active ? 'Trova clienti in pausa.' : 'Trova clienti attivo.').then((ok) => ok && setDirty(false))
  const searchNow = async () => {
    // Prima si salvano le modifiche (la ricerca usa quelle salvate).
    if (dirty && !(await act('save', payload()))) return
    setDirty(false)
    await act('search', { action: 'search_now' }, 'Ricerca avviata: le nuove email compaiono qui tra qualche minuto.')
  }
  return (
    <div className={`${card} ${s.active ? 'border-[var(--accent-blue)]/50' : ''}`}>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
          <span className="min-w-0">
            <span className="block text-sm font-semibold">Impostazioni</span>
            {!open && (
              <span className="block truncate text-xs text-[var(--text-secondary)]" translate="no">
                {s.niche ? `${s.niche}${s.area ? ` · ${s.area}` : ''} · ${s.emailsPerDay} al giorno · ${s.mode === 'auto' ? 'invia l’AI' : 'approvi tu'}` : 'Da completare'}
              </span>
            )}
          </span>
        </button>
        <button
          role="switch"
          aria-checked={s.active}
          aria-label={s.active ? 'Metti in pausa Trova clienti' : 'Attiva Trova clienti'}
          disabled={!canManage || Boolean(busy)}
          onClick={toggle}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${s.active ? 'bg-[#34C759]' : 'bg-[var(--border-color)]'}`}
        >
          <span className={`absolute left-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow transition-transform ${s.active ? 'translate-x-5' : ''}`}>
            {busy === 'active' && <Loader2 className="h-3 w-3 animate-spin text-[#8e8e93]" />}
          </span>
        </button>
      </div>

      {open && (
        <fieldset disabled={!canManage} className="mt-3 space-y-4">
          <div>
            <label htmlFor="tc-nicchia" className="text-xs font-semibold">
              A chi vuoi scrivere?
            </label>
            <div className="relative">
              <textarea
                id="tc-nicchia"
                value={d.niche}
                maxLength={300}
                onChange={(e) => set({ niche: e.target.value })}
                rows={3}
                placeholder="Es. ristoranti e pizzerie che non hanno un sito, B&B, palestre…"
                className={`${input} block pb-12 leading-relaxed`}
              />
              <MicButton mic={nicheMic} label="Detta a chi vuoi scrivere" />
            </div>
            {(nicheMic.error || nicheMic.listening) && (
              <p className={`mt-1 text-[11px] ${nicheMic.error ? 'text-[#ff6b6b]' : 'text-[var(--text-secondary)]'}`}>{nicheMic.error || 'Ti ascolto… tocca di nuovo il microfono per fermare.'}</p>
            )}
          </div>

          <div>
            <label htmlFor="tc-zona" className="text-xs font-semibold">
              Zona <span className="font-normal text-[var(--text-secondary)]">(facoltativa)</span>
            </label>
            <input id="tc-zona" value={d.area} maxLength={200} onChange={(e) => set({ area: e.target.value })} placeholder="Es. Palermo, Trapani" className={input} />
          </div>

          <div>
            <label htmlFor="tc-offerta" className="text-xs font-semibold">
              Cosa offri
            </label>
            <div className="relative">
              <textarea
                id="tc-offerta"
                value={d.offer}
                maxLength={1500}
                onChange={(e) => set({ offer: e.target.value })}
                rows={4}
                placeholder="Es. Facciamo siti e menù digitali per ristoranti, a partire da…"
                className={`${input} block pb-12 leading-relaxed`}
              />
              <MicButton mic={offerMic} label="Detta cosa offri" />
            </div>
            <p className="mt-1 text-[11px] text-[var(--text-secondary)]">{offerMic.error || 'Preso dalle tue Istruzioni: cambialo come vuoi. L’AI usa solo questo e le Istruzioni.'}</p>
          </div>

          <div>
            <p className="text-xs font-semibold">Email al giorno</p>
            <div className="mt-1 flex items-center gap-3">
              <button type="button" aria-label="Meno" onClick={() => set({ emailsPerDay: Math.max(PROSPECT_EMAILS_MIN, d.emailsPerDay - 1) })} className={`${chip(false)} h-9 w-9 px-0`}>
                −
              </button>
              <span className="w-8 text-center text-lg font-bold">{d.emailsPerDay}</span>
              <button type="button" aria-label="Più" onClick={() => set({ emailsPerDay: Math.min(PROSPECT_EMAILS_MAX, d.emailsPerDay + 1) })} className={`${chip(false)} h-9 w-9 px-0`}>
                +
              </button>
            </div>
            <p className="mt-1 text-[11px] text-[var(--text-secondary)]">Insieme alle email programmate, al massimo {data.today.limit} al giorno in tutto.</p>
          </div>

          <fieldset>
            <legend className="text-xs font-semibold">Quando</legend>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => set({ kind: 'every' })} className={chip(d.kind === 'every')} aria-pressed={d.kind === 'every'}>
                Ogni giorno
              </button>
              <button type="button" onClick={() => set({ kind: 'days', days: d.days.length ? d.days : [1, 2, 3, 4, 5] })} className={chip(d.kind === 'days')} aria-pressed={d.kind === 'days'}>
                Giorni scelti
              </button>
            </div>
            {d.kind === 'days' && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {WEEKDAYS.map((w) => {
                  const on = d.days.includes(w.day)
                  return (
                    <button key={w.day} type="button" aria-pressed={on} onClick={() => set({ days: on ? d.days.filter((x) => x !== w.day) : [...d.days, w.day] })} className={`${chip(on)} min-w-[2.75rem] px-2`}>
                      {w.short}
                    </button>
                  )
                })}
              </div>
            )}
            <label className="mt-2 block text-xs text-[var(--text-secondary)]">
              Ora
              <input type="time" value={d.time} onChange={(e) => set({ time: e.target.value })} className={`${input} max-w-[10rem]`} />
            </label>
            <p className="mt-1 text-[11px] text-[var(--text-secondary)]">{d.kind === 'days' && !d.days.length ? 'Scegli almeno un giorno.' : 'Ora italiana: a quest’ora cerca, scrive e invia.'}</p>
          </fieldset>

          <fieldset>
            <legend className="text-xs font-semibold">Come inviare</legend>
            <div className="mt-1 grid gap-2">
              {(
                [
                  ['approve', 'Approvo io ogni email', 'Leggi ogni email e decidi: inviala così, cambiala o scartala.'],
                  ['auto', 'L’AI invia da sola', 'L’AI sceglie a chi scrivere, personalizza e invia all’orario, senza approvazione.'],
                ] as const
              ).map(([mode, title, text]) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={d.mode === mode}
                  onClick={() => set({ mode })}
                  className={`rounded-xl border p-3 text-left ${d.mode === mode ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)]/10' : 'border-[var(--border-color)]'}`}
                >
                  <span className="flex items-center gap-1.5 text-sm font-semibold">
                    {mode === 'auto' ? <Sparkles className="h-4 w-4 text-[#BF5AF2]" /> : <Check className="h-4 w-4 text-[#34C759]" />} {title}
                  </span>
                  <span className="mt-0.5 block text-xs text-[var(--text-secondary)]">{text}</span>
                </button>
              ))}
            </div>
          </fieldset>

          {canManage && (
            <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
              <button
                type="button"
                onClick={searchNow}
                disabled={Boolean(busy) || !data.available || Boolean(data.run?.working) || d.niche.trim().length < 3}
                className="flex items-center justify-center gap-2 rounded-full border border-[var(--border-color)] px-5 py-3 text-sm font-semibold disabled:opacity-50"
              >
                {busy === 'search' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Cerca ora
              </button>
              <button
                type="button"
                onClick={save}
                disabled={Boolean(busy) || !dirty}
                className="flex items-center justify-center gap-2 rounded-full bg-[var(--accent-blue)] px-6 py-3 font-bold text-white disabled:opacity-50"
              >
                {busy === 'save' && <Loader2 className="h-4 w-4 animate-spin" />} Salva
              </button>
            </div>
          )}
          {!data.available && <p className="text-xs text-[#FF9500]">{SEARCH_UNAVAILABLE}.</p>}
        </fieldset>
      )}
    </div>
  )
}

function MicButton({ mic, label }: { mic: ReturnType<typeof useDictation>; label: string }) {
  if (!mic.supported) return null
  return (
    <button
      type="button"
      onClick={mic.toggle}
      aria-label={mic.listening ? 'Ferma la dettatura' : label}
      aria-pressed={mic.listening}
      className={`absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full border ${
        mic.listening ? 'border-[#FF3B30] bg-[#FF3B30]/10 text-[#FF3B30]' : 'border-[var(--border-color)] bg-[var(--background-secondary)] text-[var(--text-secondary)]'
      }`}
    >
      <Mic className="h-4 w-4" />
    </button>
  )
}

function DraftCard({ p, canManage, busy, act, nextLabel }: { p: Prospect; canManage: boolean; busy: string | null; act: Act; nextLabel: string | null }) {
  const [editing, setEditing] = useState(false)
  const [subject, setSubject] = useState(p.draft?.subject || '')
  const [body, setBody] = useState(p.draft?.body || '')
  const [expanded, setExpanded] = useState(false)
  const site = safeUrl(p.website)
  const k = (a: string) => `${a}:${p.id}`
  const queued = p.status === 'approvata'
  const sending = p.status === 'in_invio'
  const startEdit = () => {
    setSubject(p.draft?.subject || '')
    setBody(p.draft?.body || '')
    setEditing(true)
  }
  const btn = 'flex items-center gap-1 text-xs font-medium disabled:opacity-50'

  return (
    <div className={`${card} ${queued ? 'border-[#34C759]/40' : ''}`}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p translate="no" className="truncate text-sm font-semibold">
            {p.name}
          </p>
          <p className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--text-secondary)]">
            {site && (
              <a href={site} target="_blank" rel="noopener noreferrer nofollow" className="flex min-w-0 items-center gap-1 text-[var(--accent-blue)]">
                <Globe className="h-3.5 w-3.5 shrink-0" /> <span className="truncate" translate="no">{domainOf(site)}</span>
              </a>
            )}
            {p.email && (
              <span className="flex min-w-0 items-center gap-1">
                <Mail className="h-3.5 w-3.5 shrink-0" /> <span className="truncate" translate="no">{p.email}</span>
              </span>
            )}
          </p>
        </div>
        {queued && <span className="shrink-0 rounded-full bg-[#34C759]/15 px-2 py-0.5 text-[11px] font-semibold text-[#34C759]">{p.approvedBy === 'ai' ? 'Scelta dall’AI' : 'Approvata'}</span>}
        {sending && <span className="shrink-0 rounded-full bg-[var(--accent-blue)]/15 px-2 py-0.5 text-[11px] font-semibold text-[var(--accent-blue)]">Invio…</span>}
      </div>

      {p.status === 'errore' && p.error && <p className="mt-2 text-xs text-[#ff6b6b]">Non partita: {p.error}</p>}

      {editing ? (
        <div className="mt-3 space-y-2">
          <label className="block text-xs font-semibold">
            Oggetto
            <input translate="no" value={subject} maxLength={150} onChange={(e) => setSubject(e.target.value)} className={input} />
          </label>
          <label className="block text-xs font-semibold">
            Testo
            <textarea translate="no" value={body} maxLength={3400} onChange={(e) => setBody(e.target.value)} rows={10} className={`${input} leading-relaxed`} />
          </label>
          <p className="text-[11px] text-[var(--text-secondary)]">La riga per non ricevere altre email resta sempre in fondo.</p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => act(k('approve'), { action: 'approve', id: p.id, subject, body }, 'Email salvata e approvata: parte al prossimo invio.').then((ok) => ok && setEditing(false))}
              disabled={Boolean(busy)}
              className="flex items-center gap-1.5 rounded-full bg-[var(--accent-blue)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {busy === k('approve') ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Salva e approva
            </button>
            <button onClick={() => setEditing(false)} disabled={Boolean(busy)} className="rounded-full border border-[var(--border-color)] px-4 py-2 text-sm font-semibold disabled:opacity-50">
              Annulla
            </button>
          </div>
        </div>
      ) : (
        p.draft && (
          <div className="mt-2 rounded-xl border border-[var(--border-color)] bg-[var(--background)] p-3">
            <p translate="no" className="text-sm font-semibold">
              {p.draft.subject}
            </p>
            <p translate="no" className={`mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--text-primary)] ${expanded ? '' : 'line-clamp-6'}`}>
              {p.draft.body}
            </p>
            <button onClick={() => setExpanded((e) => !e)} className="mt-1 text-xs font-medium text-[var(--accent-blue)]">
              {expanded ? 'Mostra meno' : 'Leggi tutta'}
            </button>
            {p.edited && <p className="mt-1 text-[11px] text-[var(--text-secondary)]">Modificata da te</p>}
          </div>
        )
      )}

      {canManage && !editing && !sending && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {queued ? (
              <span className="flex items-center justify-center rounded-full border border-[var(--border-color)] px-3 py-2 text-center text-xs text-[var(--text-secondary)]">
                {nextLabel ? `Parte: ${nextLabel}` : 'Parte al prossimo invio'}
              </span>
            ) : (
              <button
                onClick={() => act(k('approve'), { action: 'approve', id: p.id }, 'Approvata: parte al prossimo invio.')}
                disabled={Boolean(busy)}
                className="flex items-center justify-center gap-1.5 rounded-full bg-[var(--accent-blue)] px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                {busy === k('approve') ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Invia così
              </button>
            )}
            <button
              onClick={() => act(k('send'), { action: 'send_now', id: p.id }, `Inviata a ${p.email}.`)}
              disabled={Boolean(busy)}
              className="flex items-center justify-center gap-1.5 rounded-full border border-[var(--accent-blue)] px-3 py-2 text-sm font-semibold text-[var(--accent-blue)] disabled:opacity-50"
            >
              {busy === k('send') ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Invia ora
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
            <button onClick={startEdit} disabled={Boolean(busy)} className={`${btn} text-[var(--accent-blue)]`}>
              <PencilLine className="h-3.5 w-3.5" /> Modifica
            </button>
            <button onClick={() => act(k('regen'), { action: 'regenerate', id: p.id }, 'Email riscritta dall’AI.')} disabled={Boolean(busy)} className={`${btn} text-[#BF5AF2]`}>
              {busy === k('regen') ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Rigenera
            </button>
            <button onClick={() => act(k('discard'), { action: 'discard', id: p.id }, 'Scartata.')} disabled={Boolean(busy)} className={`${btn} text-[var(--text-secondary)]`}>
              <Trash2 className="h-3.5 w-3.5" /> Scarta
            </button>
            <button
              onClick={() => confirm(`Non contattare più ${p.email || p.name}?`) && act(k('block'), { action: 'do_not_contact', id: p.id }, 'Aggiunta alla lista Non contattare.')}
              disabled={Boolean(busy)}
              className={`${btn} text-[#ff6b6b]`}
            >
              <Ban className="h-3.5 w-3.5" /> Non contattare
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function SentList({ sent, language }: { sent: Prospect[]; language: string }) {
  const [all, setAll] = useState(false)
  const shown = all ? sent : sent.slice(0, 10)
  return (
    <section>
      <h2 className="text-lg font-bold">Inviate ({sent.length})</h2>
      {!sent.length ? (
        <p className="mt-2 text-sm text-[var(--text-secondary)]">Ancora nessuna email inviata. Le risposte arrivano nell’Omnichat.</p>
      ) : (
        <>
          <ul className="mt-2 divide-y divide-[var(--border-color)] rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)]">
            {shown.map((p) => (
              <li key={p.id} className="px-3 py-2.5">
                <div className="flex items-center gap-2 text-sm">
                  <Check className="h-4 w-4 shrink-0 text-[#34C759]" />
                  <span translate="no" className="min-w-0 truncate font-medium">
                    {p.name}
                  </span>
                  {p.sentAt && <span className="ml-auto shrink-0 text-[11px] text-[var(--text-secondary)]">{whenShort(p.sentAt, language)}</span>}
                </div>
                <p className="mt-0.5 truncate pl-6 text-xs text-[var(--text-secondary)]">
                  <span translate="no">{p.email}</span> · <span translate="no">{p.draft?.subject}</span>
                </p>
                {p.repliedAt && (
                  <Link href="/app/omnichat" className="mt-0.5 flex items-center gap-1 pl-6 text-xs font-medium text-[var(--accent-blue)]">
                    <MessageCircle className="h-3.5 w-3.5" /> Ha risposto{p.error ? ` · ${p.error}` : ''}
                  </Link>
                )}
              </li>
            ))}
          </ul>
          {sent.length > 10 && !all && (
            <button onClick={() => setAll(true)} className="mt-2 text-sm font-medium text-[var(--accent-blue)]">
              Mostra tutte ({sent.length})
            </button>
          )}
        </>
      )}
    </section>
  )
}

const OTHER_LABEL: Partial<Record<ProspectStatus, string>> = { senza_email: 'Senza email', saltata: 'Saltata', non_contattare: 'Non contattare', nuova: 'Sito da leggere', errore: 'Errore' }

function OthersList({ others }: { others: Prospect[] }) {
  const [open, setOpen] = useState(false)
  if (!others.length) return null
  return (
    <section>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-1.5 text-sm font-semibold">
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} /> Altre aziende trovate ({others.length})
      </button>
      {open && (
        <ul className="mt-2 divide-y divide-[var(--border-color)] rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)]">
          {others.slice(0, 100).map((p) => {
            const site = safeUrl(p.website)
            return (
              <li key={p.id} className="px-3 py-2.5 text-sm">
                <p className="flex items-center gap-2">
                  <span translate="no" className="min-w-0 truncate font-medium">
                    {p.name}
                  </span>
                  <span className="ml-auto shrink-0 text-[11px] text-[var(--text-secondary)]">{OTHER_LABEL[p.status] || p.status}</span>
                </p>
                <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-[var(--text-secondary)]">
                  {p.error && <span>{p.error}</span>}
                  {site && (
                    <a href={site} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-1 text-[var(--accent-blue)]">
                      <Globe className="h-3 w-3" /> <span translate="no">{domainOf(site)}</span>
                    </a>
                  )}
                  {p.phone && (
                    <a href={`tel:${p.phone.replace(/[^\d+]/g, '')}`} className="flex items-center gap-1 text-[var(--accent-blue)]">
                      <Phone className="h-3 w-3" /> <span translate="no">{p.phone}</span>
                    </a>
                  )}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function BlockedList({ data, canManage, busy, act }: { data: ProspectsData; canManage: boolean; busy: string | null; act: Act }) {
  const [open, setOpen] = useState(false)
  const [entry, setEntry] = useState('')
  return (
    <section>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-1.5 text-sm font-semibold">
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} /> Non contattare ({data.blocked.length})
      </button>
      {open && (
        <div className={`${card} mt-2 space-y-2`}>
          <p className="text-xs text-[var(--text-secondary)]">A questi indirizzi e domini non si scrive mai. Chi risponde «no» si aggiunge da solo.</p>
          {canManage && (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (entry.trim()) act('block', { action: 'do_not_contact', entry }, 'Aggiunto alla lista Non contattare.').then((ok) => ok && setEntry(''))
              }}
            >
              <input
                value={entry}
                onChange={(e) => setEntry(e.target.value)}
                placeholder="email o @dominio.it"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                translate="no"
                className={`${input} mt-0 flex-1`}
              />
              <button type="submit" disabled={Boolean(busy) || !entry.trim()} className="shrink-0 rounded-full bg-[var(--accent-blue)] px-4 text-sm font-bold text-white disabled:opacity-50">
                Aggiungi
              </button>
            </form>
          )}
          {!data.blocked.length ? (
            <p className="text-sm text-[var(--text-secondary)]">Nessun indirizzo.</p>
          ) : (
            <ul className="space-y-1">
              {data.blocked.slice(0, 200).map((b) => (
                <li key={b} className="flex items-center gap-2 text-sm">
                  <span translate="no" className="min-w-0 flex-1 truncate">
                    {b}
                  </span>
                  {canManage && (
                    <button onClick={() => act(`unblock:${b}`, { action: 'unblock', entry: b })} disabled={Boolean(busy)} aria-label={`Togli ${b}`} className="p-1 text-[var(--text-secondary)] disabled:opacity-50">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
