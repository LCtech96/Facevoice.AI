'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Check, Clock, Images, Loader2, Lock, Mail, MessageCircle, Mic, PencilLine, Plus, Search, Send, Sparkles, Trash2, X, Zap } from 'lucide-react'
import { useWorkspace } from '@/components/app/WorkspaceContext'
import { useDictation } from '@/components/useDictation'
import { useTranslation } from '@/lib/i18n/LanguageContext'
import { AUTOMATIONS_DAILY_LIMIT, MAX_RECIPIENTS, WEEKDAYS, parseRecipients } from '@/lib/automations-shared'
import TrovaClienti from './TrovaClienti'
import FotoAutopilota from './FotoAutopilota'

// Automazioni: email programmate (un orario ogni giorno, nei giorni scelti o una volta
// sola) che partono dalla casella email collegata dal cliente, una per destinatario, e
// "Trova clienti" (TrovaClienti.tsx: aziende trovate su Google Maps e prime email scritte
// dall'AI). Al massimo 20 email al giorno in tutto. Solo per chi ce l'ha attiva (la accende
// Facevoice dal suo pannello): agli altri la pagina dice come chiederla. Si comandano anche
// dall'Assistente.

type Content = { mode: 'fixed'; body: string } | { mode: 'ai'; brief: string }
type Schedule = { kind: 'daily'; time: string; days: number[] } | { kind: 'once'; at: string }
type LastRun = { slot: string; at: string; sent: number; failed: number; skipped: number; note?: string }
type Automation = {
  id: string
  name: string
  active: boolean
  recipients: string[]
  subject: string
  content: Content
  schedule: Schedule
  lastRun: LastRun | null
  nextRun: string | null
  running: boolean
  done?: boolean
  origin?: 'page' | 'assistant'
}
type LogEntry = { id: string; automationId: string; name: string; to: string; subject: string; at: string; status: 'sent' | 'failed' | 'skipped'; error?: string; test?: boolean }
type Overview = {
  automations: Automation[]
  log: LogEntry[]
  today: { used: number; limit: number }
  mailbox: { email: string; status: string } | null
  canManage?: boolean
}

/** Bozza del modulo (crea o modifica). */
type Draft = {
  id?: string
  name: string
  recipients: string
  subject: string
  mode: 'fixed' | 'ai'
  body: string
  brief: string
  kind: 'every' | 'days' | 'once'
  days: number[]
  time: string
  date: string
  onceTime: string
  active: boolean
}

const ROME = 'Europe/Rome'
const WHATSAPP_NUMBER = '393514206353'
const activationUrl = (email: string | null) =>
  `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(`Ciao, vorrei attivare le automazioni di Facevoice AI per il mio account${email ? ` (${email})` : ''}.`)}`

/** Giorno e ora italiani di un istante, per i campi del modulo. */
function romeInput(iso: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: ROME, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(iso))
  const get = (t: string) => parts.find((p) => p.type === t)?.value || ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` }
}

const locale = (language: string) => (language === 'it' ? 'it-IT' : 'en-GB')
const whenShort = (iso: string, language: string) =>
  new Date(iso).toLocaleString(locale(language), { timeZone: ROME, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function scheduleLabel(s: Schedule, language: string): string {
  if (s.kind === 'once') return `Una volta: ${whenShort(s.at, language)}`
  const days = WEEKDAYS.filter((w) => s.days.includes(w.day))
  return `${!days.length || days.length === 7 ? 'Ogni giorno' : days.map((w) => w.short).join(', ')} alle ${s.time}`
}

function emptyDraft(): Draft {
  const tomorrow = romeInput(new Date(Date.now() + 86_400_000).toISOString())
  return { name: '', recipients: '', subject: '', mode: 'fixed', body: '', brief: '', kind: 'every', days: [], time: '09:00', date: tomorrow.date, onceTime: '09:00', active: true }
}

function draftOf(a: Automation): Draft {
  const base = emptyDraft()
  const once = a.schedule.kind === 'once' ? romeInput(a.schedule.at) : null
  return {
    ...base,
    id: a.id,
    name: a.name,
    recipients: a.recipients.join('\n'),
    subject: a.subject,
    mode: a.content.mode,
    body: a.content.mode === 'fixed' ? a.content.body : '',
    brief: a.content.mode === 'ai' ? a.content.brief : '',
    kind: a.schedule.kind === 'once' ? 'once' : a.schedule.days.length ? 'days' : 'every',
    days: a.schedule.kind === 'daily' ? a.schedule.days : [],
    time: a.schedule.kind === 'daily' ? a.schedule.time : base.time,
    date: once?.date || base.date,
    onceTime: once?.time || base.onceTime,
    active: a.active,
  }
}

/** Bozza -> dati per l'API (gli stessi controlli li rifa' il server). */
function payloadOf(d: Draft) {
  return {
    name: d.name,
    recipients: d.recipients,
    subject: d.subject,
    content: d.mode === 'ai' ? { mode: 'ai', brief: d.brief } : { mode: 'fixed', body: d.body },
    schedule: d.kind === 'once' ? { kind: 'once', at: `${d.date}T${d.onceTime}` } : { kind: 'daily', time: d.time, days: d.kind === 'days' ? d.days : [] },
    active: d.active,
  }
}

export default function AutomationsPage() {
  const { automations } = useWorkspace()
  // null: non si sa (lettura non riuscita): decide il server, che risponde 403 se e' nascosta.
  return automations === false ? <AutomationsLocked /> : <AutomationsBoard />
}

/** Automazioni non attive per questa persona: come chiederle. */
function AutomationsLocked() {
  const { email, refreshAutomations } = useWorkspace()
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && refreshAutomations()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refreshAutomations])
  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--background-secondary)]">
        <Lock className="h-5 w-5 text-[var(--accent-blue)]" />
      </span>
      <h1 className="mt-5 text-2xl font-extrabold">Le automazioni non sono attive per il tuo account.</h1>
      <p className="mt-2 text-[var(--text-secondary)]">Scrivici e le attiviamo per te.</p>
      <a
        href={activationUrl(email)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#25D366] px-5 py-3 font-bold text-white"
      >
        <MessageCircle className="h-5 w-5" /> Scrivici su WhatsApp
      </a>
      <Link href="/app/omnichat" className="mt-4 text-sm font-semibold text-[var(--accent-blue)]">
        Vai all’Omnichat →
      </Link>
    </div>
  )
}

function AutomationsBoard() {
  const { appFetch, workspace } = useWorkspace()
  const { language } = useTranslation()
  const [data, setData] = useState<Overview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Draft | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'warn' | 'error' } | null>(null)
  const [showAll, setShowAll] = useState(false)
  // Sezione aperta: email programmate, Trova clienti (#trova-clienti nell'indirizzo) o Autopilota foto (#autopilota-foto).
  const [tab, setTab] = useState<'email' | 'clienti' | 'foto'>('email')
  const canManage = data?.canManage ?? workspace?.role !== 'member'

  useEffect(() => {
    if (window.location.hash === '#trova-clienti') setTab('clienti')
    if (window.location.hash === '#autopilota-foto') setTab('foto')
  }, [])
  const openTab = (next: 'email' | 'clienti' | 'foto') => {
    setTab(next)
    setNotice(null)
    try {
      window.history.replaceState(null, '', next === 'clienti' ? '#trova-clienti' : next === 'foto' ? '#autopilota-foto' : window.location.pathname + window.location.search)
    } catch {}
  }
  // Le email di Trova clienti contano nello stesso limite: il contatore in alto resta giusto.
  const onToday = useCallback((today: { used: number; limit: number }) => setData((d) => (d && (d.today.used !== today.used || d.today.limit !== today.limit) ? { ...d, today } : d)), [])

  const load = useCallback(async () => {
    const res = await appFetch('/api/app/automations').catch(() => null)
    const body = res ? await res.json().catch(() => null) : null
    if (res?.ok && body) {
      setData(body as Overview)
      setLoadError(null)
    } else if (res?.status !== 403 || body?.code === 'owner_automations_disabled') setLoadError(body?.error || 'Automazioni non disponibili, riprova.')
  }, [appFetch])

  useEffect(() => {
    load()
    // Si aggiorna da sola (invii in corso, contatore, registro) mentre la pagina e' aperta.
    const timer = setInterval(() => document.visibilityState === 'visible' && load(), 30_000)
    const onVisible = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  const merge = (body: Partial<Overview> | null) => body?.automations && setData((d) => (d ? { ...d, ...body, canManage: d.canManage } : (body as Overview)))

  const toggle = async (a: Automation) => {
    if (busyId) return
    setBusyId(a.id)
    setNotice(null)
    setData((d) => d && { ...d, automations: d.automations.map((x) => (x.id === a.id ? { ...x, active: !a.active } : x)) })
    const res = await appFetch('/api/app/automations', { method: 'PATCH', body: JSON.stringify({ id: a.id, active: !a.active }) }).catch(() => null)
    const body = res ? await res.json().catch(() => null) : null
    setBusyId(null)
    if (!res?.ok) {
      setData((d) => d && { ...d, automations: d.automations.map((x) => (x.id === a.id ? { ...x, active: a.active } : x)) })
      setNotice({ text: body?.error || 'Non salvato, riprova.', tone: 'error' })
      return
    }
    merge(body)
    if (body?.warning) setNotice({ text: body.warning, tone: 'warn' })
  }

  const remove = async (a: Automation) => {
    if (busyId || !confirm(`Eliminare l’automazione «${a.name}»?`)) return
    setBusyId(a.id)
    const res = await appFetch(`/api/app/automations?id=${encodeURIComponent(a.id)}`, { method: 'DELETE' }).catch(() => null)
    const body = res ? await res.json().catch(() => null) : null
    setBusyId(null)
    if (!res?.ok) {
      setNotice({ text: body?.error || 'Non eliminata, riprova.', tone: 'error' })
      return
    }
    merge(body)
    setNotice({ text: 'Automazione eliminata.', tone: 'ok' })
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

  const { used, limit } = data.today ?? { used: 0, limit: AUTOMATIONS_DAILY_LIMIT }
  const full = used >= limit
  const mailbox = data.mailbox
  const entries = data.log ?? []
  const log = showAll ? entries : entries.slice(0, 15)

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-3xl font-extrabold">
            <Zap className="h-6 w-6 text-[var(--accent-blue)]" /> Automazioni
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">{tab === 'clienti' ? 'Trova aziende a cui scrivere e manda la prima email.' : tab === 'foto' ? 'Caroselli con le tue foto, pubblicati da soli.' : 'Email che partono da sole, all’ora che scegli.'}</p>
        </div>
        <span
          // Contatore delle email: non riguarda l'Autopilota foto.
          hidden={tab === 'foto'}
          className={`mt-1 shrink-0 rounded-full border px-3 py-1 text-sm font-semibold ${
            full ? 'border-[#FF3B30] text-[#FF3B30]' : used >= limit - 5 ? 'border-[#FF9500] text-[#FF9500]' : 'border-[var(--border-color)] text-[var(--text-primary)]'
          }`}
          title={`Al massimo ${limit} email al giorno`}
        >
          Oggi {used}/{limit}
        </span>
      </div>

      <div role="tablist" aria-label="Sezioni delle automazioni" className="grid grid-cols-3 gap-1 rounded-full border border-[var(--border-color)] bg-[var(--background-secondary)] p-1">
        {(
          [
            ['email', 'Email programmate', Clock],
            ['clienti', 'Trova clienti', Search],
            ['foto', 'Autopilota foto', Images],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => openTab(key)}
            className={`flex min-w-0 items-center justify-center gap-1.5 rounded-full px-1.5 py-2 text-xs font-semibold sm:px-2 sm:text-sm ${tab === key ? 'bg-[var(--accent-blue)] text-white' : 'text-[var(--text-secondary)]'}`}
          >
            <Icon className="hidden h-4 w-4 shrink-0 sm:block" /> <span className="truncate">{label}</span>
          </button>
        ))}
      </div>

      {tab === 'foto' ? (
        <FotoAutopilota />
      ) : tab === 'clienti' ? (
        <TrovaClienti language={language} onToday={onToday} />
      ) : (
        <>
          <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-3">
            {mailbox ? (
              <p className="flex min-w-0 items-center gap-2 text-sm">
                <Mail className="h-4 w-4 shrink-0 text-[var(--accent-blue)]" />
                <span className="shrink-0 text-[var(--text-secondary)]">Invia da:</span>
                <span translate="no" className="truncate font-semibold">
                  {mailbox.email}
                </span>
                {mailbox.status !== 'connected' && <span className="shrink-0 text-xs text-[#FF9500]">da ricollegare</span>}
              </p>
            ) : (
              <div className="text-sm">
                <p className="flex items-center gap-2 font-semibold">
                  <AlertTriangle className="h-4 w-4 text-[#FF9500]" /> Nessuna email collegata
                </p>
                <p className="mt-1 text-[var(--text-secondary)]">Le automazioni partono dalla tua casella: collegala per attivarle.</p>
                <Link href="/app/canali/email" className="mt-2 inline-block font-semibold text-[var(--accent-blue)]">
                  Collega la tua email →
                </Link>
              </div>
            )}
            <p className="mt-2 text-xs text-[var(--text-secondary)]">Invia solo a chi ti ha dato il consenso.</p>
            {full && <p className="mt-1 text-xs text-[#FF3B30]">Oggi hai raggiunto il limite di {limit} email: le altre partono da domani.</p>}
          </div>

          {notice && (
            <p className={`rounded-xl px-3 py-2 text-sm ${notice.tone === 'error' ? 'bg-[#FF3B30]/10 text-[#ff6b6b]' : notice.tone === 'warn' ? 'bg-[#FF9500]/10 text-[#FF9500]' : 'bg-[#34C759]/10 text-[#34C759]'}`}>
              {notice.text}
            </p>
          )}

          {canManage ? (
            <button
              onClick={() => {
                setNotice(null)
                setEditing(emptyDraft())
              }}
              disabled={!mailbox}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-[var(--accent-blue)] px-5 py-3 font-bold text-white disabled:opacity-50 md:w-auto"
            >
              <Plus className="h-5 w-5" /> Nuova automazione
            </button>
          ) : (
            <p className="text-sm text-[var(--text-secondary)]">Solo gli amministratori dello spazio possono modificare le automazioni.</p>
          )}

          <div className="space-y-3">
            {!data.automations?.length ? (
              <p className="rounded-2xl border border-dashed border-[var(--border-color)] p-4 text-sm text-[var(--text-secondary)]">
                Nessuna automazione. Creane una qui o chiedila all’Assistente (es. «manda ogni lunedì alle 9 un’email a…»).
              </p>
            ) : (
              data.automations.map((a) => (
                <AutomationCard
                  key={a.id}
                  a={a}
                  language={language}
                  canManage={canManage}
                  canActivate={Boolean(mailbox)}
                  busy={busyId === a.id}
                  onToggle={() => toggle(a)}
                  onEdit={() => {
                    setNotice(null)
                    setEditing(draftOf(a))
                  }}
                  onDelete={() => remove(a)}
                />
              ))
            )}
          </div>

          <section className="pt-2">
            <h2 className="text-lg font-bold">Ultimi invii</h2>
            {!entries.length ? (
              <p className="mt-2 text-sm text-[var(--text-secondary)]">Ancora nessun invio.</p>
            ) : (
              <ul className="mt-2 divide-y divide-[var(--border-color)] rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)]">
                {log.map((e) => (
                  <LogRow key={e.id} entry={e} language={language} />
                ))}
              </ul>
            )}
            {entries.length > 15 && !showAll && (
              <button onClick={() => setShowAll(true)} className="mt-2 text-sm font-medium text-[var(--accent-blue)]">
                Mostra tutti ({entries.length})
              </button>
            )}
          </section>

          {editing && (
            <AutomationSheet
              draft={editing}
              mailbox={mailbox?.email || null}
              onClose={() => setEditing(null)}
              onSaved={(body, message, tone) => {
                merge(body)
                setEditing(null)
                setNotice({ text: message, tone })
              }}
              onOverview={merge}
            />
          )}
        </>
      )}
    </div>
  )
}

function AutomationCard({
  a,
  language,
  canManage,
  canActivate,
  busy,
  onToggle,
  onEdit,
  onDelete,
}: {
  a: Automation
  language: string
  canManage: boolean
  canActivate: boolean
  busy: boolean
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const last = a.lastRun
  return (
    <div className={`rounded-2xl border bg-[var(--background-secondary)] p-3 ${a.active ? 'border-[var(--accent-blue)]/50' : 'border-[var(--border-color)]'}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p translate="no" className="truncate text-sm font-semibold">
            {a.name}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
            <Clock className="h-3.5 w-3.5 shrink-0" /> {scheduleLabel(a.schedule, language)}
          </p>
          <p className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">
            {a.recipients.length === 1 ? '1 destinatario' : `${a.recipients.length} destinatari`}: <span translate="no">{a.recipients.slice(0, 3).join(', ')}</span>
            {a.recipients.length > 3 ? ` e altri ${a.recipients.length - 3}` : ''}
          </p>
          {a.content.mode === 'ai' && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-[#BF5AF2]">
              <Sparkles className="h-3.5 w-3.5" /> Testo scritto dall’AI ogni volta
            </p>
          )}
        </div>
        <button
          role="switch"
          aria-checked={a.active}
          aria-label={a.active ? 'Metti in pausa' : 'Attiva'}
          disabled={!canManage || busy || (!a.active && (!canActivate || Boolean(a.done)))}
          onClick={onToggle}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${a.active ? 'bg-[#34C759]' : 'bg-[var(--border-color)]'}`}
        >
          <span className={`absolute left-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow transition-transform ${a.active ? 'translate-x-5' : ''}`}>
            {busy && <Loader2 className="h-3 w-3 animate-spin text-[#8e8e93]" />}
          </span>
        </button>
      </div>
      <p className="mt-2 text-xs">
        {a.running ? (
          <span className="font-medium text-[var(--accent-blue)]">Invio in corso…</span>
        ) : a.done ? (
          last && last.sent > 0 ? (
            <span className="text-[var(--text-secondary)]">Inviata</span>
          ) : (
            <span className="font-medium text-[#FF9500]">Non inviata: tocca «Modifica» per scegliere un nuovo orario</span>
          )
        ) : a.active && a.nextRun ? (
          <>
            <span className="text-[var(--text-secondary)]">Prossimo invio: </span>
            <span className="font-semibold">{whenShort(a.nextRun, language)}</span>
          </>
        ) : (
          <span className="text-[var(--text-secondary)]">In pausa</span>
        )}
      </p>
      {last && (
        <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
          Ultimo invio {whenShort(last.at, language)}: {last.sent} {last.sent === 1 ? 'inviata' : 'inviate'}
          {last.failed ? ` · ${last.failed} ${last.failed === 1 ? 'non riuscita' : 'non riuscite'}` : ''}
          {last.skipped ? ` · ${last.skipped} ${last.skipped === 1 ? 'saltata' : 'saltate'}` : ''}
          {last.note ? ` (${last.note})` : ''}
        </p>
      )}
      {canManage && (
        <div className="mt-2 flex gap-5">
          <button onClick={onEdit} disabled={busy} className="flex items-center gap-1 text-xs font-medium text-[var(--accent-blue)] disabled:opacity-50">
            <PencilLine className="h-3.5 w-3.5" /> Modifica
          </button>
          <button onClick={onDelete} disabled={busy} className="flex items-center gap-1 text-xs font-medium text-[#ff6b6b] disabled:opacity-50">
            <Trash2 className="h-3.5 w-3.5" /> Elimina
          </button>
        </div>
      )}
    </div>
  )
}

function LogRow({ entry, language }: { entry: LogEntry; language: string }) {
  const tone = entry.status === 'sent' ? 'text-[#34C759]' : entry.status === 'failed' ? 'text-[#ff6b6b]' : 'text-[#FF9500]'
  const label = entry.status === 'sent' ? 'Inviata' : entry.status === 'failed' ? 'Non riuscita' : 'Saltata'
  return (
    <li className="px-3 py-2.5">
      <div className="flex items-center gap-2 text-sm">
        {entry.status === 'sent' ? <Check className={`h-4 w-4 shrink-0 ${tone}`} /> : entry.status === 'failed' ? <X className={`h-4 w-4 shrink-0 ${tone}`} /> : <AlertTriangle className={`h-4 w-4 shrink-0 ${tone}`} />}
        <span translate="no" className="min-w-0 truncate font-medium">
          {entry.to}
        </span>
        <span className="ml-auto shrink-0 text-[11px] text-[var(--text-secondary)]">{whenShort(entry.at, language)}</span>
      </div>
      <p className="mt-0.5 truncate pl-6 text-xs text-[var(--text-secondary)]">
        <span className={tone}>{label}</span>
        {entry.test ? ' · prova' : ''} · <span translate="no">{entry.subject || entry.name}</span>
      </p>
      {entry.error && <p className="pl-6 text-xs text-[var(--text-secondary)]">{entry.error}</p>}
    </li>
  )
}

/** Modulo per creare o modificare un'automazione (dal basso sul telefono). */
function AutomationSheet({
  draft: initial,
  mailbox,
  onClose,
  onSaved,
  onOverview,
}: {
  draft: Draft
  mailbox: string | null
  onClose: () => void
  onSaved: (body: Partial<Overview>, message: string, tone: 'ok' | 'warn') => void
  onOverview: (body: Partial<Overview>) => void
}) {
  const { appFetch, email } = useWorkspace()
  const [d, setD] = useState<Draft>(initial)
  const [busy, setBusy] = useState<'save' | 'test' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testNote, setTestNote] = useState<string | null>(null)
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }))
  const field = d.mode === 'ai' ? 'brief' : 'body'
  const dictation = useDictation((text) => setD((x) => ({ ...x, [field]: x[field] ? `${x[field]} ${text}` : text })))
  const parsed = parseRecipients(d.recipients)
  const tooMany = parsed.emails.length > MAX_RECIPIENTS

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  /** Controlli rapidi prima di chiamare il server (che li rifa' tutti). */
  const check = (forTest = false): string | null => {
    if (!forTest) {
      if (parsed.invalid.length) return `Indirizzi non validi: ${parsed.invalid.slice(0, 5).join(', ')}`
      if (!parsed.emails.length) return 'Scrivi almeno un indirizzo email.'
      if (tooMany) return `Al massimo ${MAX_RECIPIENTS} destinatari.`
      if (d.kind === 'days' && !d.days.length) return 'Scegli almeno un giorno.'
    }
    if (d.mode === 'fixed' && !d.subject.trim()) return 'Scrivi l’oggetto dell’email.'
    if (d.mode === 'fixed' && !d.body.trim()) return 'Scrivi il testo dell’email.'
    if (d.mode === 'ai' && !d.brief.trim()) return 'Scrivi all’AI di cosa deve parlare l’email.'
    return null
  }

  const save = async () => {
    const problem = check()
    if (problem) return setError(problem)
    if (dictation.listening) dictation.stop()
    setBusy('save')
    setError(null)
    const payload = payloadOf(d)
    const res = await appFetch('/api/app/automations', {
      method: d.id ? 'PATCH' : 'POST',
      body: JSON.stringify(d.id ? { id: d.id, ...payload } : payload),
    }).catch(() => null)
    const body = res ? await res.json().catch(() => null) : null
    setBusy(null)
    if (!res?.ok) return setError(body?.error || 'Non salvata, riprova.')
    onSaved(body, body?.warning || (d.id ? 'Automazione salvata.' : 'Automazione creata.'), body?.warning ? 'warn' : 'ok')
  }

  const test = async () => {
    const problem = check(true)
    if (problem) return setError(problem)
    setBusy('test')
    setError(null)
    setTestNote(null)
    const res = await appFetch('/api/app/automations', { method: 'POST', body: JSON.stringify({ test: true, draft: payloadOf(d) }) }).catch(() => null)
    const body = res ? await res.json().catch(() => null) : null
    setBusy(null)
    if (!res?.ok) return setError(body?.error || 'Prova non inviata, riprova.')
    onOverview(body)
    setTestNote(`Prova inviata a ${body?.test?.to || email}: controlla la tua casella.`)
  }

  const input =
    'mt-1 w-full rounded-xl border border-[var(--border-color)] bg-[var(--background)] px-3 py-2 text-[16px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)] md:text-sm'
  const chip = (on: boolean) =>
    `rounded-full border px-3 py-1.5 text-sm ${on ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)] text-white' : 'border-[var(--border-color)] text-[var(--text-primary)]'}`

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 md:items-center" onClick={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={d.id ? 'Modifica automazione' : 'Nuova automazione'}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-[var(--background)] p-5 pb-8 shadow-xl md:max-w-lg md:rounded-3xl"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-extrabold">{d.id ? 'Modifica automazione' : 'Nuova automazione'}</h2>
          <button onClick={onClose} disabled={Boolean(busy)} aria-label="Chiudi" className="p-1 text-[var(--text-secondary)]">
            <X className="h-5 w-5" />
          </button>
        </div>
        {mailbox && (
          <p className="mt-1 truncate text-xs text-[var(--text-secondary)]">
            Invia da: <span translate="no">{mailbox}</span> · una email per destinatario
          </p>
        )}

        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="auto-nome" className="text-xs font-semibold">
              Nome <span className="font-normal text-[var(--text-secondary)]">(facoltativo)</span>
            </label>
            <input id="auto-nome" translate="no" value={d.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} placeholder="Es. Promemoria del lunedì" className={input} />
          </div>

          <div>
            <label htmlFor="auto-a" className="text-xs font-semibold">
              Destinatari
            </label>
            <textarea
              id="auto-a"
              translate="no"
              value={d.recipients}
              onChange={(e) => set({ recipients: e.target.value })}
              rows={3}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="mario@esempio.it, giulia@esempio.it"
              className={input}
            />
            <p className={`mt-1 text-[11px] ${parsed.invalid.length || tooMany ? 'text-[#ff6b6b]' : 'text-[var(--text-secondary)]'}`}>
              {parsed.invalid.length
                ? `Non validi: ${parsed.invalid.slice(0, 3).join(', ')}`
                : tooMany
                  ? `${parsed.emails.length} indirizzi: al massimo ${MAX_RECIPIENTS}`
                  : `${parsed.emails.length}/${MAX_RECIPIENTS} indirizzi · separali con una virgola o vai a capo`}
            </p>
          </div>

          <div>
            <label htmlFor="auto-oggetto" className="text-xs font-semibold">
              Oggetto {d.mode === 'ai' && <span className="font-normal text-[var(--text-secondary)]">(se lo lasci vuoto lo scrive l’AI)</span>}
            </label>
            <input id="auto-oggetto" translate="no" value={d.subject} maxLength={200} onChange={(e) => set({ subject: e.target.value })} placeholder="Es. Le novità della settimana" className={input} />
          </div>

          <fieldset>
            <legend className="text-xs font-semibold">Testo</legend>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => set({ mode: 'fixed' })} className={chip(d.mode === 'fixed')} aria-pressed={d.mode === 'fixed'}>
                Testo fisso
              </button>
              <button type="button" onClick={() => set({ mode: 'ai' })} className={chip(d.mode === 'ai')} aria-pressed={d.mode === 'ai'}>
                Scritto dall’AI ogni volta
              </button>
            </div>
            <div className="relative mt-2">
              <textarea
                translate="no"
                aria-label={d.mode === 'ai' ? 'Di cosa deve parlare l’email' : 'Testo dell’email'}
                value={d[field]}
                maxLength={d.mode === 'ai' ? 2000 : 10000}
                onChange={(e) => set({ [field]: e.target.value } as Partial<Draft>)}
                rows={6}
                placeholder={d.mode === 'ai' ? 'Es. Ricorda ai clienti le offerte della settimana, tono cordiale, breve.' : 'Ciao, …'}
                className={`${input} block pb-12 leading-relaxed`}
              />
              {dictation.supported && (
                <button
                  type="button"
                  onClick={dictation.toggle}
                  aria-label={dictation.listening ? 'Ferma la dettatura' : 'Detta il testo'}
                  aria-pressed={dictation.listening}
                  className={`absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full border ${
                    dictation.listening ? 'border-[#FF3B30] bg-[#FF3B30]/10 text-[#FF3B30]' : 'border-[var(--border-color)] bg-[var(--background-secondary)] text-[var(--text-secondary)]'
                  }`}
                >
                  <Mic className="h-4 w-4" />
                </button>
              )}
            </div>
            <p className={`mt-1 text-[11px] ${dictation.error ? 'text-[#ff6b6b]' : 'text-[var(--text-secondary)]'}`}>
              {dictation.error ||
                (dictation.listening
                  ? 'Ti ascolto… tocca di nuovo il microfono per fermare.'
                  : d.mode === 'ai'
                    ? 'A ogni invio l’AI scrive un’email nuova da queste indicazioni, con i dati della pagina Istruzioni. Conta nel consumo AI.'
                    : '')}
            </p>
          </fieldset>

          <fieldset>
            <legend className="text-xs font-semibold">Quando</legend>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {(
                [
                  ['every', 'Ogni giorno'],
                  ['days', 'Giorni scelti'],
                  ['once', 'Una volta'],
                ] as const
              ).map(([kind, label]) => (
                <button key={kind} type="button" onClick={() => set({ kind })} className={`${chip(d.kind === kind)} px-2`} aria-pressed={d.kind === kind}>
                  {label}
                </button>
              ))}
            </div>
            {d.kind === 'days' && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {WEEKDAYS.map((w) => {
                  const on = d.days.includes(w.day)
                  return (
                    <button
                      key={w.day}
                      type="button"
                      aria-pressed={on}
                      onClick={() => set({ days: on ? d.days.filter((x) => x !== w.day) : [...d.days, w.day] })}
                      className={`${chip(on)} min-w-[2.75rem] px-2`}
                    >
                      {w.short}
                    </button>
                  )
                })}
              </div>
            )}
            {d.kind === 'once' ? (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <label className="text-xs text-[var(--text-secondary)]">
                  Giorno
                  <input type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} className={input} />
                </label>
                <label className="text-xs text-[var(--text-secondary)]">
                  Ora
                  <input type="time" value={d.onceTime} onChange={(e) => set({ onceTime: e.target.value })} className={input} />
                </label>
              </div>
            ) : (
              <label className="mt-2 block text-xs text-[var(--text-secondary)]">
                Ora
                <input type="time" value={d.time} onChange={(e) => set({ time: e.target.value })} className={`${input} max-w-[10rem]`} />
              </label>
            )}
            <p className="mt-1 text-[11px] text-[var(--text-secondary)]">Ora italiana. Al massimo {AUTOMATIONS_DAILY_LIMIT} email al giorno in tutto.</p>
          </fieldset>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={d.active} onChange={(e) => set({ active: e.target.checked })} className="h-4 w-4 accent-[var(--accent-blue)]" />
            Attiva
          </label>

          <p className="text-xs text-[var(--text-secondary)]">Invia solo a chi ti ha dato il consenso.</p>
          {error && <p className="text-sm text-[#ff6b6b]">{error}</p>}
          {testNote && <p className="text-sm text-[#34C759]">{testNote}</p>}

          <div className="flex flex-col-reverse gap-2 md:flex-row md:justify-end">
            <button
              type="button"
              onClick={test}
              disabled={Boolean(busy) || !mailbox}
              className="flex items-center justify-center gap-2 rounded-full border border-[var(--border-color)] px-5 py-3 text-sm font-semibold disabled:opacity-50"
            >
              {busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Invia una prova a me
            </button>
            <button
              type="button"
              onClick={save}
              disabled={Boolean(busy)}
              className="flex items-center justify-center gap-2 rounded-full bg-[var(--accent-blue)] px-6 py-3 font-bold text-white disabled:opacity-50"
            >
              {busy === 'save' && <Loader2 className="h-4 w-4 animate-spin" />} Salva
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
