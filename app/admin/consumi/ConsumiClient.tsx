'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Activity, Gauge, Globe, Info, Lightbulb, Plug, RefreshCw, Users, Wallet } from 'lucide-react'
import { createClient } from '@/lib/supabase-client'
import { getAccessToken } from '@/lib/session-token'
import { isAdminEmail } from '@/lib/admin-auth'
import { aiCallsOf, aiTokensOf, formatCount, type ShownLight } from '@/lib/beta-users'
import {
  ATTRIBUTION_FORMULA,
  ATTRIBUTION_LABEL,
  formatMoney,
  usageWeight,
  userPlacesShare,
  usersMonthTotals,
  type ConsumiResponse,
  type ConsumiUser,
  type Counts,
  type MonitoringData,
  type Source,
  type TrafficPoint,
  type TrafficSeries,
} from '@/lib/consumi'

// Pagina "Consumi" (solo admin): solo numeri reali.
// - Costi: export della fatturazione di Google (aggiornato da Google piu' volte al giorno) e Anthropic.
// - Ultima ora: richieste contate da Google al minuto, per chiave (si aggiorna ogni 60 secondi).
// - Utenti della beta: richieste e token registrati quando il fornitore ha risposto;
//   il costo in euro e' solo la parte del costo Google reale ripartita sulle loro richieste.
// - Come ridurre: consigli scritti dai numeri reali, non previsioni.

const OK = '#0A84FF'
const ERR = '#FF3B30'
const LIVE_MS = 60_000
const FULL_MS = 5 * 60_000

const LIGHT: Record<ShownLight, { color: string; text: string }> = {
  none: { color: 'var(--border-color)', text: 'nessun gettone' },
  green: { color: '#34C759', text: 'gettone verde' },
  orange: { color: '#FF9500', text: 'gettone arancione' },
  red: { color: '#FF3B30', text: 'gettone rosso' },
}

const n = (v: number) => Math.round(v).toLocaleString('it-IT')
const romeTime = (iso: string, seconds = false) =>
  new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), timeZone: 'Europe/Rome' })
/** "1 novembre" (giorno di inizio, ora italiana). */
const fromDay = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'long' })
const romeDay = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })

/** "alle 14:05" se e' di oggi, altrimenti "il 06/11 alle 22:10". */
function whenText(iso: string) {
  const same = romeDay(iso) === romeDay(new Date().toISOString())
  const day = new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Rome' })
  return same ? `alle ${romeTime(iso)}` : `il ${day} alle ${romeTime(iso)}`
}

const monthName = (invoiceMonth: string) => {
  const y = Number(invoiceMonth.slice(0, 4))
  const m = Number(invoiceMonth.slice(4, 6))
  if (!y || !m) return invoiceMonth
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('it-IT', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

const okData = <T,>(s: Source<T> | undefined): T | null => (s && s.status === 'ok' ? s.data : null)
const sumCounts = (list: Counts[]): Counts => list.reduce((a, c) => ({ ok: a.ok + c.ok, error: a.error + c.error }), { ok: 0, error: 0 })

/** Somma punto per punto (le serie di una risposta hanno gli stessi intervalli). */
function sumPoints(lists: TrafficPoint[][]): TrafficPoint[] {
  const base = lists.reduce((a, l) => (l.length > a.length ? l : a), [] as TrafficPoint[])
  return base.map((p, i) => ({ ...p, ok: lists.reduce((s, l) => s + (l[i]?.ok || 0), 0), error: lists.reduce((s, l) => s + (l[i]?.error || 0), 0) }))
}

async function authGet(url: string) {
  const token = await getAccessToken()
  if (!token) throw new Error('Sessione scaduta: accedi di nuovo.')
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(json?.error || 'Impossibile caricare i consumi.')
  return json
}

function Card({ id, icon, title, children, right }: { id?: string; icon: React.ReactNode; title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section id={id} className="min-w-0 rounded-2xl border border-[var(--border-color)] bg-[var(--card-background)] p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-2 text-base font-semibold text-[var(--text-primary)]">
          {icon}
          <span className="truncate">{title}</span>
        </h2>
        {right}
      </div>
      {children}
    </section>
  )
}

/** Fonte da collegare o in errore: una riga, mai una pagina di errore. */
function SourceNote({ source, what }: { source: Source<unknown>; what: string }) {
  if (source.status === 'da_collegare') {
    return (
      <p className="mt-2 rounded-xl bg-[var(--background)] px-3 py-2 text-sm text-[var(--text-secondary)]">
        {what}: da collegare (manca {source.missing.join(', ')}).{' '}
        <a href="#collega" className="font-medium text-[var(--accent-blue)]">
          Come collegare
        </a>
      </p>
    )
  }
  if (source.status === 'errore') {
    return <p className="mt-2 rounded-xl bg-[#FF3B30]/10 px-3 py-2 text-sm text-[var(--text-primary)]">{source.message}</p>
  }
  return null
}

const pointText = (p: TrafficPoint) => `${p.label}: ${n(p.ok)} riuscite${p.error ? `, ${n(p.error)} in errore` : ''}`

/** Barre verticali (riuscite in blu, errori in rosso sopra). Si tocca una barra per leggere il numero. */
function Bars({ points, name, height = 56 }: { points: TrafficPoint[]; name: string; height?: number }) {
  const [sel, setSel] = useState<number | null>(null)
  const max = Math.max(1, ...points.map((p) => p.ok + p.error))
  const picked = sel !== null ? points[sel] : null
  const all = sumCounts(points)
  if (!points.length) return null
  return (
    <div className="mt-2">
      <div className="flex items-end gap-px" style={{ height }} role="img" aria-label={`${name}: ${n(all.ok)} riuscite, ${n(all.error)} in errore`}>
        {points.map((p, i) => {
          const okH = p.ok ? Math.max(2, (p.ok / max) * height) : 0
          const errH = p.error ? Math.max(2, (p.error / max) * height) : 0
          return (
            <button
              key={p.t}
              type="button"
              tabIndex={-1}
              title={pointText(p)}
              onClick={() => setSel(sel === i ? null : i)}
              className={`flex h-full min-w-0 flex-1 flex-col justify-end ${sel === i ? 'opacity-100' : sel !== null ? 'opacity-60' : ''}`}
            >
              {errH > 0 && <span className="block w-full rounded-t-[2px]" style={{ height: errH, background: ERR }} />}
              {okH > 0 && <span className={`block w-full ${errH ? '' : 'rounded-t-[2px]'}`} style={{ height: okH, background: OK }} />}
              {!okH && !errH && <span className="block h-px w-full bg-[var(--border-color)]" />}
            </button>
          )
        })}
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2 text-[11px] tabular-nums text-[var(--text-secondary)]">
        <span>{points[0].label}</span>
        <span className="min-w-0 truncate text-center text-[var(--text-primary)]">{picked ? pointText(picked) : ''}</span>
        <span>{points[points.length - 1].label}</span>
      </div>
    </div>
  )
}

const Legend = () => (
  <p className="mt-1 flex items-center gap-3 text-[11px] text-[var(--text-secondary)]">
    <span className="inline-flex items-center gap-1">
      <span className="h-2 w-2 rounded-sm" style={{ background: OK }} /> riuscite
    </span>
    <span className="inline-flex items-center gap-1">
      <span className="h-2 w-2 rounded-sm" style={{ background: ERR }} /> in errore
    </span>
  </p>
)

const countsText = (c: Counts) => `${n(c.ok)}${c.error ? ` · ${n(c.error)} errori` : ''}`

// ---------------------------------------------------------------------
// Costi reali
// ---------------------------------------------------------------------

function CostsCard({ data }: { data: ConsumiResponse }) {
  const billing = okData(data.billing)
  const anthropic = okData(data.anthropic)
  // Voci del mese di fatturazione (le altre servono solo a oggi e alla ripartizione).
  const monthLines = billing ? billing.lines.filter((l) => l.month.gross !== 0 || l.month.credits !== 0 || l.month.usage !== 0) : []
  return (
    <Card icon={<Wallet className="h-5 w-5" />} title="Costi reali">
      <h3 className="mt-3 text-sm font-semibold text-[var(--text-primary)]">Google</h3>
      <SourceNote source={data.billing} what="Costi Google" />
      {billing && (
        <>
          {billing.totals.length === 0 && (
            <p className="mt-1 text-sm text-[var(--text-secondary)]">Nessun costo nell’export per {monthName(billing.invoiceMonth)}.</p>
          )}
          {billing.totals.map((t) => (
            <div key={t.currency} className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-[var(--background)] p-3">
                <p className="text-xs text-[var(--text-secondary)]">Questo mese, netto</p>
                <p className="text-2xl font-bold tabular-nums text-[var(--text-primary)]">{formatMoney(t.month.net, t.currency)}</p>
                <p className="text-[11px] text-[var(--text-secondary)]">
                  lordo {formatMoney(t.month.gross, t.currency)} · crediti {formatMoney(t.month.credits, t.currency)}
                </p>
              </div>
              <div className="rounded-xl bg-[var(--background)] p-3">
                <p className="text-xs text-[var(--text-secondary)]">Oggi, netto</p>
                <p className="text-2xl font-bold tabular-nums text-[var(--text-primary)]">{formatMoney(t.today.net, t.currency)}</p>
                <p className="text-[11px] text-[var(--text-secondary)]">solo quanto Google ha già esportato</p>
              </div>
            </div>
          ))}
          <p className="mt-2 text-xs text-[var(--text-secondary)]">
            {billing.lastExport ? `Dati Google aggiornati ${whenText(billing.lastExport)}` : 'Google non ha ancora esportato dati per questo mese'} · mese di
            fatturazione {monthName(billing.invoiceMonth)}. {data.billing.delay}
          </p>
          {billing.groups.length > 0 && (
            <ul className="mt-3 space-y-1.5 text-sm">
              {billing.groups.slice(0, 12).map((g) => (
                <li key={`${g.project}|${g.service}|${g.currency}`} className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-[var(--text-primary)]" title={`${g.service} · ${g.project}`}>
                    {g.service}
                    <span className="text-xs text-[var(--text-secondary)]"> · {g.project || 'senza progetto'}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-[var(--text-primary)]">
                    {formatMoney(g.month.net, g.currency)}
                    <span className="ml-1 text-xs text-[var(--text-secondary)]">oggi {formatMoney(g.today.net, g.currency)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {monthLines.length > 0 && (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-xs font-medium text-[var(--accent-blue)]">Voci di costo ({monthLines.length})</summary>
              <ul className="mt-2 space-y-2">
                {monthLines.slice(0, 60).map((l, i) => (
                  <li key={i} className="rounded-lg bg-[var(--background)] px-3 py-2">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-[var(--text-primary)]" title={l.sku}>
                        {l.sku}
                      </span>
                      <span className="shrink-0 tabular-nums text-[var(--text-primary)]">{formatMoney(l.month.net, l.currency)}</span>
                    </div>
                    <p className="truncate text-[11px] text-[var(--text-secondary)]">
                      {l.service} · {l.project || 'senza progetto'} · uso {formatCount(l.month.usage)} {l.unit}
                      {l.month.credits ? ` · crediti ${formatMoney(l.month.credits, l.currency)}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      <h3 className="mt-5 text-sm font-semibold text-[var(--text-primary)]">Claude (Anthropic)</h3>
      <SourceNote source={data.anthropic} what="Costi Claude" />
      {anthropic && (
        <>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-[var(--background)] p-3">
              <p className="text-xs text-[var(--text-secondary)]">Questo mese</p>
              <p className="text-xl font-bold tabular-nums text-[var(--text-primary)]">{formatMoney(anthropic.month, 'USD')}</p>
            </div>
            <div className="rounded-xl bg-[var(--background)] p-3">
              <p className="text-xs text-[var(--text-secondary)]">Oggi (UTC)</p>
              <p className="text-xl font-bold tabular-nums text-[var(--text-primary)]">{formatMoney(anthropic.today, 'USD')}</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-[var(--text-secondary)]">
            Letto {whenText(data.anthropic.status === 'ok' ? data.anthropic.fetchedAt : data.updatedAt)} dalla Admin API di Anthropic.{' '}
            {data.anthropic.delay}
          </p>
          {anthropic.byLine.length > 0 && (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-xs font-medium text-[var(--accent-blue)]">Per voce ({anthropic.byLine.length})</summary>
              <ul className="mt-2 space-y-1">
                {anthropic.byLine.map((l) => (
                  <li key={l.description} className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-[var(--text-primary)]">{l.description}</span>
                    <span className="shrink-0 tabular-nums text-[var(--text-primary)]">{formatMoney(l.amount, 'USD')}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------
// Richieste di Google: ultima ora per chiave, oggi e mese per API
// ---------------------------------------------------------------------

type KeyGroup = { key: string; label: string; project: string; minutes: TrafficPoint[]; lastHour: Counts; services: { label: string; lastHour: Counts }[] }

function byKey(series: TrafficSeries[]): KeyGroup[] {
  const map = new Map<string, TrafficSeries[]>()
  for (const s of series) {
    const key = `${s.project}|${s.credentialId}`
    map.set(key, [...(map.get(key) || []), s])
  }
  return [...map.entries()]
    .map(([key, list]) => ({
      key,
      label: list[0].credentialLabel,
      project: list[0].project,
      minutes: sumPoints(list.map((s) => s.minutes)),
      lastHour: sumCounts(list.map((s) => s.lastHour)),
      services: list
        .map((s) => ({ label: s.serviceLabel, lastHour: s.lastHour }))
        .filter((s) => s.lastHour.ok + s.lastHour.error > 0)
        .sort((a, b) => b.lastHour.ok + b.lastHour.error - (a.lastHour.ok + a.lastHour.error)),
    }))
    .sort((a, b) => b.lastHour.ok + b.lastHour.error - (a.lastHour.ok + a.lastHour.error))
}

function LastHourCard({ source, refreshing }: { source: Source<MonitoringData>; refreshing: boolean }) {
  const data = okData(source)
  const groups = useMemo(() => (data ? byKey(data.series) : []), [data])
  const active = groups.filter((g) => g.lastHour.ok + g.lastHour.error > 0)
  const quiet = groups.filter((g) => g.lastHour.ok + g.lastHour.error === 0)
  return (
    <Card
      icon={<Activity className="h-5 w-5" />}
      title="Ultima ora"
      right={
        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-[var(--text-secondary)]">
          <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} /> ogni 60 s
        </span>
      }
    >
      <p className="mt-1 text-xs text-[var(--text-secondary)]">Richieste al minuto per chiave, contate da Google.</p>
      <SourceNote source={source} what="Richieste di Google" />
      {data && (
        <>
          <Legend />
          {active.length === 0 && <p className="mt-3 text-sm text-[var(--text-secondary)]">Nessuna richiesta a Google nell’ultima ora.</p>}
          <ul className="mt-2 space-y-4">
            {active.map((g) => (
              <li key={g.key}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-medium text-[var(--text-primary)]" title={g.label}>
                    {g.label}
                  </span>
                  <span className="shrink-0 text-sm tabular-nums text-[var(--text-primary)]">{countsText(g.lastHour)}</span>
                </div>
                <p className="truncate text-[11px] text-[var(--text-secondary)]">
                  {g.project} · {g.services.map((s) => `${s.label} ${n(s.lastHour.ok + s.lastHour.error)}`).join(' · ')}
                </p>
                <Bars points={g.minutes} name={`${g.label}, ultima ora`} />
              </li>
            ))}
          </ul>
          {quiet.length > 0 && (
            <p className="mt-3 text-xs text-[var(--text-secondary)]">Nessuna richiesta nell’ultima ora: {quiet.map((g) => g.label).join(', ')}.</p>
          )}
          <p className="mt-3 text-[11px] text-[var(--text-secondary)]">
            Minuti fino alle {romeTime(data.windowEnd)} · letto alle {romeTime(source.status === 'ok' ? source.fetchedAt : data.windowEnd, true)}. {source.delay}
          </p>
          {data.warnings.map((w) => (
            <p key={w} className="mt-1 text-[11px] text-[#FF9500]">
              {w}
            </p>
          ))}
        </>
      )}
    </Card>
  )
}

function ApisCard({ source }: { source: Source<MonitoringData> }) {
  const [range, setRange] = useState<'today' | 'month'>('today')
  const data = okData(source)
  const services = useMemo(() => {
    if (!data) return []
    const map = new Map<string, TrafficSeries[]>()
    for (const s of data.series) map.set(s.service, [...(map.get(s.service) || []), s])
    return [...map.entries()]
      .map(([service, list]) => ({
        service,
        label: list[0].serviceLabel,
        today: sumCounts(list.map((s) => s.today)),
        month: sumCounts(list.map((s) => s.month)),
        hours: sumPoints(list.map((s) => s.hours)),
        days: sumPoints(list.map((s) => s.days)),
        keys: list
          .map((s) => ({ label: `${s.credentialLabel} · ${s.project}`, today: s.today, month: s.month }))
          .sort((a, b) => b.month.ok + b.month.error - (a.month.ok + a.month.error)),
      }))
      .filter((s) => s.month.ok + s.month.error > 0)
      .sort((a, b) => b.month.ok + b.month.error - (a.month.ok + a.month.error))
  }, [data])
  if (source.status !== 'ok') return null
  return (
    <Card
      icon={<Globe className="h-5 w-5" />}
      title="Richieste per API"
      right={
        <div className="flex shrink-0 rounded-full border border-[var(--border-color)] p-0.5 text-xs">
          {(['today', 'month'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              aria-pressed={range === r}
              className={`rounded-full px-3 py-1 ${range === r ? 'bg-[var(--accent-blue)] text-white' : 'text-[var(--text-primary)]'}`}
            >
              {r === 'today' ? 'Oggi' : 'Mese'}
            </button>
          ))}
        </div>
      }
    >
      <p className="mt-1 text-xs text-[var(--text-secondary)]">
        {range === 'today' ? 'Oggi per ora (ora italiana).' : 'Questo mese per giorno.'} Contate da Google, tutte le chiavi.
      </p>
      <Legend />
      {services.length === 0 && <p className="mt-3 text-sm text-[var(--text-secondary)]">Nessuna richiesta questo mese.</p>}
      <ul className="mt-2 space-y-5">
        {services.map((s) => (
          <li key={s.service}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-medium text-[var(--text-primary)]">{s.label}</span>
              <span className="shrink-0 text-sm tabular-nums text-[var(--text-primary)]">{countsText(range === 'today' ? s.today : s.month)}</span>
            </div>
            <Bars points={range === 'today' ? s.hours : s.days} name={`${s.label}, ${range === 'today' ? 'oggi' : 'questo mese'}`} height={48} />
            <ul className="mt-1 space-y-0.5">
              {s.keys.map((k, i) => (
                <li key={`${k.label}-${i}`} className="flex items-baseline justify-between gap-2 text-[11px] text-[var(--text-secondary)]">
                  <span className="min-w-0 truncate">{k.label}</span>
                  <span className="shrink-0 tabular-nums">{countsText(range === 'today' ? k.today : k.month)}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Card>
  )
}

// ---------------------------------------------------------------------
// Utenti della beta
// ---------------------------------------------------------------------

function UserRow({ user, money }: { user: ConsumiUser; money: { value: number; currency: string } | null }) {
  const u = user.usage
  const light = LIGHT[user.shown]
  const features = u ? u.byFeature.slice(0, 3) : []
  return (
    <li>
      <Link
        href={`/admin/utenti?u=${encodeURIComponent(user.id)}`}
        className="block rounded-xl border border-[var(--border-color)] bg-[var(--background)] p-3 hover:border-[var(--accent-blue)]"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{user.name}</p>
            <p className="truncate text-[11px] text-[var(--text-secondary)]">{user.email}</p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-[var(--text-secondary)]">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: light.color }} />
            {user.blocked ? 'bloccato' : light.text}
          </span>
        </div>
        {u ? (
          <>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div>
                <p className="text-[var(--text-secondary)]">Places oggi · mese</p>
                <p className="tabular-nums text-[var(--text-primary)]">
                  {n(u.today.places.ok)} · {n(u.month.places.ok)}
                  {u.month.places.error ? <span className="text-[var(--text-secondary)]"> ({n(u.month.places.error)} errori)</span> : null}
                </p>
              </div>
              <div>
                <p className="text-[var(--text-secondary)]">AI oggi · mese</p>
                <p className="tabular-nums text-[var(--text-primary)]">
                  {n(aiCallsOf(u.today))} · {n(aiCallsOf(u.month))}
                  <span className="text-[var(--text-secondary)]"> ({formatCount(aiTokensOf(u.month))} token)</span>
                </p>
              </div>
            </div>
            {aiCallsOf(u.month) > 0 && (
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                Nel mese: Gemini {n(u.month.ai.gemini.calls)} · Claude {n(u.month.ai.claude.calls)} chiamate
              </p>
            )}
            {user.sharedUsage && (
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
                Non è titolare di uno spazio: sono gli spazi in cui lavora, già contati dal titolare (fuori dai totali, senza euro).
              </p>
            )}
            {money && (
              <p className="mt-1 text-xs text-[var(--text-primary)]">
                {ATTRIBUTION_LABEL}: <b className="tabular-nums">{formatMoney(money.value, money.currency)}</b>
              </p>
            )}
            {features.length > 0 && (
              <p className="mt-1 truncate text-[11px] text-[var(--text-secondary)]">
                Più usate:{' '}
                {features
                  .map((f) => `${f.label} (${[f.places ? `${n(f.places)} Places` : '', f.aiCalls ? `${n(f.aiCalls)} AI` : ''].filter(Boolean).join(', ')})`)
                  .join(' · ')}
              </p>
            )}
          </>
        ) : (
          <p className="mt-2 text-xs text-[var(--text-secondary)]">La beta non manda ancora i consumi reali di questo utente.</p>
        )}
      </Link>
    </li>
  )
}

function UsersCard({ data }: { data: ConsumiResponse }) {
  const users = okData(data.users)
  const sorted = useMemo(() => (users ? [...users].sort((a, b) => usageWeight(b) - usageWeight(a)) : []), [users])
  const totals = useMemo(() => usersMonthTotals(sorted), [sorted])
  const places = data.places.ok ? data.places.value : null
  return (
    <Card icon={<Users className="h-5 w-5" />} title="Utenti della beta">
      <p className="mt-1 text-xs text-[var(--text-secondary)]">
        Richieste e token reali di ogni utente: spazi di cui è proprietario; chi non ne ha vede quelli in cui lavora, già contati dal titolare e
        fuori dai totali. Tocca un utente per aprire la sua scheda.
      </p>
      <SourceNote source={data.users} what="Utenti della beta" />
      {users && (
        <>
          <p className="mt-2 text-sm text-[var(--text-primary)]">
            Questo mese: <b className="tabular-nums">{n(totals.placesOk)}</b> richieste Places
            {totals.placesError ? ` (${n(totals.placesError)} in errore)` : ''} · <b className="tabular-nums">{n(totals.ai)}</b> chiamate AI (Gemini{' '}
            {n(totals.gemini)}, Claude {n(totals.claude)}) · {formatCount(totals.tokens)} token
          </p>
          <p className="mt-2 flex gap-1.5 rounded-xl bg-[var(--background)] px-3 py-2 text-[11px] text-[var(--text-secondary)]">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {places
                ? `${ATTRIBUTION_FORMULA} Ora: ${n(places.projectOk)} richieste del progetto ${places.project} e ${formatMoney(places.netCost, places.currency)} netti, dal ${fromDay(places.periodStart)}.`
                : `Google non sa quale utente ha fatto una richiesta (la beta usa una sola chiave): qui ci sono le richieste che la beta ha registrato. ${data.places.ok ? '' : data.places.reason}`}
            </span>
          </p>
          <ul className="mt-3 space-y-2">
            {sorted.map((u) => {
              const value = userPlacesShare(u.usage, u.sharedUsage, places, totals.placesOk)
              return <UserRow key={u.id} user={u} money={value !== null && places ? { value, currency: places.currency } : null} />
            })}
            {sorted.length === 0 && <li className="py-4 text-center text-sm text-[var(--text-secondary)]">Nessun utente iscritto alla beta.</li>}
          </ul>
        </>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------
// Sito principale, consigli, come collegare
// ---------------------------------------------------------------------

function SiteCard({ data }: { data: ConsumiResponse }) {
  const site = okData(data.site)
  return (
    <Card icon={<Gauge className="h-5 w-5" />} title="Il tuo sito: AI">
      <p className="mt-1 text-xs text-[var(--text-secondary)]">{data.site.delay}</p>
      <SourceNote source={data.site} what="AI del sito" />
      {site && (
        <>
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
            {([['Oggi', site.today], ['Questo mese', site.month]] as const).map(([label, t]) => (
              <div key={label} className="rounded-xl bg-[var(--background)] p-3">
                <p className="text-[var(--text-secondary)]">{label}</p>
                <p className="text-sm tabular-nums text-[var(--text-primary)]">
                  Gemini {n(t.gemini.calls)} · Claude {n(t.claude.calls)}
                </p>
                <p className="tabular-nums text-[var(--text-secondary)]">
                  {formatCount(t.gemini.input + t.gemini.output + t.claude.input + t.claude.output)} token
                  {t.limits ? ` · ${n(t.limits)} limiti Gemini` : ''}
                  {t.errors ? ` · ${n(t.errors)} errori` : ''}
                </p>
              </div>
            ))}
          </div>
          {site.byFeature.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {site.byFeature.slice(0, 6).map((f) => (
                <li key={f.feature} className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-[var(--text-primary)]">{f.label}</span>
                  <span className="shrink-0 text-xs tabular-nums text-[var(--text-secondary)]">
                    {n(f.calls)} chiamate · {formatCount(f.input + f.output)} token
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  )
}

function TipsCard({ tips }: { tips: string[] }) {
  return (
    <Card icon={<Lightbulb className="h-5 w-5" />} title="Come ridurre i consumi">
      <p className="mt-1 text-xs text-[var(--text-secondary)]">Dai numeri reali qui sopra, non da previsioni.</p>
      <ul className="mt-2 space-y-2">
        {tips.map((t) => (
          <li key={t} className="rounded-xl bg-[var(--background)] px-3 py-2 text-sm text-[var(--text-primary)]">
            {t}
          </li>
        ))}
      </ul>
    </Card>
  )
}

const STEPS: { title: string; text: string; env: string; link?: string }[] = [
  {
    title: 'Service account',
    text: 'In Google Cloud crea un service account e scarica la sua chiave JSON. Incolla tutto il file nella variabile su Vercel. Attiva Cloud Monitoring API, BigQuery API e API Keys API nel progetto del service account.',
    env: 'GOOGLE_USAGE_SA_JSON',
    link: 'https://cloud.google.com/iam/docs/keys-create-delete',
  },
  {
    title: 'Richieste al minuto',
    text: 'Scrivi i progetti da leggere, separati da virgola (la chiave della beta e quella del sito). Su ognuno dai al service account il ruolo “Monitoring Viewer”; per i nomi delle chiavi anche “API Keys Viewer”.',
    env: 'GOOGLE_USAGE_PROJECTS',
  },
  {
    title: 'Costi reali',
    text: 'Fatturazione → Esportazione fatturazione → BigQuery → “Costo di utilizzo standard”. Dai al service account “BigQuery Data Viewer” sul dataset e “BigQuery Job User” sul progetto del dataset. Scrivi progetto.dataset.tabella (gcp_billing_export_v1_…).',
    env: 'GOOGLE_BILLING_EXPORT_TABLE',
    link: 'https://cloud.google.com/billing/docs/how-to/export-data-bigquery-setup',
  },
  {
    title: 'Costo Places per utente',
    text: 'Scrivi il progetto Google della chiave della beta: serve per ripartire il suo costo Places reale sulle richieste di ogni utente. Deve essere anche in GOOGLE_USAGE_PROJECTS.',
    env: 'GOOGLE_BETA_PROJECT',
  },
  {
    title: 'Costi di Claude',
    text: 'Nella Console di Anthropic un admin dell’organizzazione crea una chiave Admin (sk-ant-admin…). Si usa solo per leggere i costi.',
    env: 'ANTHROPIC_ADMIN_API_KEY',
    link: 'https://platform.claude.com/docs/en/manage-claude/admin-api-keys',
  },
]

function ConnectCard() {
  return (
    <Card id="collega" icon={<Plug className="h-5 w-5" />} title="Come collegare">
      <p className="mt-1 text-xs text-[var(--text-secondary)]">Ogni fonte è facoltativa: quelle non collegate restano “da collegare”.</p>
      <ol className="mt-2 space-y-2 text-sm">
        {STEPS.map((s, i) => (
          <li key={s.env} className="rounded-xl bg-[var(--background)] px-3 py-2">
            <p className="font-medium text-[var(--text-primary)]">
              {i + 1}. {s.title} · <code className="text-xs">{s.env}</code>
            </p>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              {s.text}{' '}
              {s.link && (
                <a href={s.link} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-blue)]">
                  Guida
                </a>
              )}
            </p>
          </li>
        ))}
      </ol>
    </Card>
  )
}

// ---------------------------------------------------------------------
// Pagina
// ---------------------------------------------------------------------

export default function ConsumiClient() {
  const router = useRouter()
  const [allowed, setAllowed] = useState(false)
  const [data, setData] = useState<ConsumiResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [live, setLive] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Solo l'admin: gli altri tornano alla home (l'API rifiuta comunque).
  useEffect(() => {
    let alive = true
    createClient()
      .auth.getUser()
      .then(({ data: { user } }) => {
        if (!alive) return
        if (!user) router.replace('/auth')
        else if (!isAdminEmail(user.email)) router.replace('/home')
        else setAllowed(true)
      })
    return () => {
      alive = false
    }
  }, [router])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData((await authGet('/api/admin/consumi')) as ConsumiResponse)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossibile caricare i consumi.')
    } finally {
      setLoading(false)
    }
  }, [])

  // Solo le richieste di Google (pannello Ultima ora).
  const loadLive = useCallback(async () => {
    setLive(true)
    try {
      const json = (await authGet('/api/admin/consumi?parte=ora')) as { monitoring?: Source<MonitoringData> }
      if (json?.monitoring) setData((d) => (d ? { ...d, monitoring: json.monitoring! } : d))
    } catch {
      // Al prossimo minuto si riprova; i dati di prima restano.
    } finally {
      setLive(false)
    }
  }, [])

  useEffect(() => {
    if (!allowed) return
    load()
    let lastFull = Date.now()
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastFull >= FULL_MS) {
        lastFull = Date.now()
        load()
      } else loadLive()
    }, LIVE_MS)
    return () => clearInterval(timer)
  }, [allowed, load, loadLive])

  if (!allowed) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[var(--accent-blue)]/30 border-t-[var(--accent-blue)]" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pt-20 md:pt-24 pb-28 md:pb-16">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-[var(--text-primary)]">
            <Gauge className="h-6 w-6" /> Consumi
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Solo numeri reali: richieste contate da Google, costi fatturati da Google e Anthropic, richieste e token dei tuoi utenti. Nessuna stima.
          </p>
          {data && <p className="mt-1 text-xs text-[var(--text-secondary)]">Pagina aggiornata alle {romeTime(data.updatedAt)}</p>}
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="shrink-0 inline-flex items-center gap-2 rounded-lg bg-[var(--accent-blue)] px-3 py-2 text-sm text-white hover:bg-[var(--accent-blue)]/90 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Aggiorna
        </button>
      </div>

      {error && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#FF3B30]/40 bg-[#FF3B30]/10 px-3 py-2 text-sm text-[var(--text-primary)]">
          <span>{error}</span>
          <button type="button" onClick={load} disabled={loading} className="text-sm font-medium text-[var(--accent-blue)] disabled:opacity-50">
            Riprova
          </button>
        </div>
      )}

      {!data && loading && <p className="mt-8 text-center text-sm text-[var(--text-secondary)]">Caricamento…</p>}

      {data && (
        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
          <CostsCard data={data} />
          <LastHourCard source={data.monitoring} refreshing={live} />
          <div className="md:col-span-2">
            <UsersCard data={data} />
          </div>
          <TipsCard tips={data.tips} />
          <ApisCard source={data.monitoring} />
          <SiteCard data={data} />
          <ConnectCard />
        </div>
      )}
    </div>
  )
}
