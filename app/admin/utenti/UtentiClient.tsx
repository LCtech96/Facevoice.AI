'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Clapperboard, Clock, FileText, Printer, RefreshCw, Search, ShieldAlert, ShieldCheck, Sparkles, Users, X } from 'lucide-react'
import { createClient } from '@/lib/supabase-client'
import { getAccessToken } from '@/lib/session-token'
import { isAdminEmail } from '@/lib/admin-auth'
import {
  aiCallsOf,
  aiTokensOf,
  assistantFrom,
  automationsFull,
  automationsLocked,
  automationsSpaces,
  automationsTodayText,
  daysLeftText,
  formatCount,
  formatEurRound,
  hasUsage,
  planLabelFor,
  planPriceEur,
  romeDateTime,
  shortUserAgent,
  shownFor,
  subscriptionBadge,
  subscriptionPlanLabel,
  subscriptionStatusLabel,
  subscriptionSummary,
  termsPrintHtml,
  termsStatus,
  termsTextFrom,
  usageFromOthersSpaces,
  videoRepliesLocked,
  type BetaAutomations,
  type BetaSubscription,
  type BetaTerms,
  type BetaTermsText,
  type BetaUser,
  type BetaUsersResponse,
  type LightMode,
  type ShownLight,
  type SubscriptionTone,
  type UsageCounts,
} from '@/lib/beta-users'
import { ATTRIBUTION_LABEL, ATTRIBUTION_RULE, formatMoney, userPlacesShare, type PlacesAttribution } from '@/lib/consumi'

// Pagina "Utenti": chi e' iscritto alla beta, i suoi consumi reali (richieste
// Places e chiamate AI con i token, registrati dalla beta quando il fornitore ha
// risposto; in euro solo il costo Google reale ripartito sulle sue richieste) e
// quale gettone vede (verde, arancione, rosso).
// Dalla scheda l'admin accende o spegne anche la chat Assistente della beta
// e mostra o nasconde la pagina Automazioni e la Video automazione (scheda in Automazioni).
// Termini e condizioni: nella lista un piccolo "Termini ✓ / ✗"; nella scheda quando, con quale
// versione, da quale IP e dispositivo li ha accettati, e il testo esatto accettato (da stampare).
// ?u=<id> apre subito la scheda di quell'utente (link delle notifiche).

const LIGHTS = [
  { key: 'green', label: 'Verde', color: '#34C759' },
  { key: 'orange', label: 'Arancione', color: '#FF9500' },
  { key: 'red', label: 'Rosso', color: '#FF3B30' },
] as const

const LIGHT_NAME: Record<ShownLight, string> = {
  none: 'Nessun gettone acceso',
  green: 'Gettone verde',
  orange: 'Gettone arancione',
  red: 'Gettone rosso',
}

const MODES: { mode: LightMode; label: string }[] = [
  { mode: 'auto', label: 'Automatico' },
  { mode: 'green', label: 'Verde' },
  { mode: 'orange', label: 'Arancione' },
  { mode: 'red', label: 'Rosso' },
]

const ROLE: Record<BetaUser['workspaces'][number]['role'], string> = {
  owner: 'proprietario',
  admin: 'admin',
  member: 'membro',
}

const date = (iso: string | null) =>
  iso && !Number.isNaN(Date.parse(iso))
    ? new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—'
const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

function initials(user: BetaUser) {
  const words = (user.name || user.email).replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean)
  return ((words[0]?.[0] || '?') + (words[1]?.[0] || '')).toUpperCase()
}

function hue(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360
  return h
}

/** Tre gettoni in fila, come un semaforo orizzontale: acceso solo quello attuale. */
function Tokens({ shown, large = false }: { shown: ShownLight; large?: boolean }) {
  const dot = large ? 'h-4 w-4' : 'h-2.5 w-2.5'
  return (
    <span
      role="img"
      aria-label={LIGHT_NAME[shown]}
      title={LIGHT_NAME[shown]}
      className={`inline-flex items-center rounded-full border border-[var(--border-color)] bg-[var(--background)] ${large ? 'gap-1.5 px-2 py-1.5' : 'gap-1 px-1.5 py-1'}`}
    >
      {LIGHTS.map((l) => {
        const on = shown === l.key
        return (
          <span
            key={l.key}
            className={`${dot} rounded-full transition-colors`}
            style={{ background: on ? l.color : 'var(--border-color)', boxShadow: on ? `0 0 6px ${l.color}` : undefined }}
          />
        )
      })}
    </span>
  )
}

function Avatar({ user, size = 56 }: { user: BetaUser; size?: number }) {
  const [broken, setBroken] = useState(false)
  const style = { width: size, height: size }
  if (user.avatarUrl && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={user.avatarUrl}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        style={style}
        className="rounded-full object-cover bg-[var(--background-secondary)]"
      />
    )
  }
  return (
    <span
      style={{ ...style, background: `hsl(${hue(user.id)} 55% 42%)`, fontSize: size * 0.36 }}
      className="flex items-center justify-center rounded-full font-semibold text-white"
    >
      {initials(user)}
    </span>
  )
}

/** Icona tonda con i gettoni sotto: si tocca per aprire la scheda. */
function UserIcon({ user, size = 56, onClick }: { user: BetaUser; size?: number; onClick?: () => void }) {
  const content = (
    <>
      <Avatar user={user} size={size} />
      <span className="absolute -bottom-2 left-1/2 -translate-x-1/2">
        <Tokens shown={user.shown} />
      </span>
    </>
  )
  if (!onClick) return <span className="relative shrink-0 inline-block pb-2">{content}</span>
  return (
    <button type="button" onClick={onClick} aria-label={`Apri la scheda di ${user.name}`} className="relative shrink-0 pb-2">
      {content}
    </button>
  )
}

function Badges({ user }: { user: BetaUser }) {
  return (
    <>
      {user.blocked && (
        <span className="shrink-0 rounded-full bg-[#FF3B30]/15 px-2 py-0.5 text-[11px] font-semibold text-[#FF3B30]">bloccato</span>
      )}
      {user.unlimited && (
        <span className="shrink-0 rounded-full bg-[var(--accent-blue)]/15 px-2 py-0.5 text-[11px] font-semibold text-[var(--accent-blue)]">
          senza limite
        </span>
      )}
      {user.override && (
        <span className="shrink-0 rounded-full border border-[var(--border-color)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">
          scelto da te
        </span>
      )}
    </>
  )
}

const TONE_TEXT: Record<SubscriptionTone, string> = {
  green: 'text-[#34C759]',
  blue: 'text-[var(--accent-blue)]',
  orange: 'text-[#FF9500]',
  red: 'text-[#FF3B30]',
  grey: 'text-[var(--text-secondary)]',
}
const TONE_BG: Record<SubscriptionTone, string> = {
  green: 'bg-[#34C759]/15',
  blue: 'bg-[var(--accent-blue)]/15',
  orange: 'bg-[#FF9500]/15',
  red: 'bg-[#FF3B30]/15',
  grey: 'border border-[var(--border-color)]',
}

/** Stato dell'abbonamento in piccolo (nulla se la beta non lo manda). */
function SubscriptionBadge({ user }: { user: BetaUser }) {
  if (user.subscription === undefined) return null
  const { text, tone } = subscriptionBadge(user.subscription)
  return (
    <span className={`inline-block max-w-full truncate rounded-full px-2 py-0.5 text-[11px] font-medium ${TONE_BG[tone]} ${TONE_TEXT[tone]}`}>
      {text}
    </span>
  )
}

/** Riga "Abbonamento" della scheda: piano, prezzo, stato e prossima scadenza. */
function SubscriptionRow({ sub }: { sub: BetaSubscription | null }) {
  if (!sub) {
    return (
      <div className="col-span-2 rounded-xl bg-[var(--background)] p-3">
        <p className="text-xs text-[var(--text-secondary)]">Abbonamento</p>
        <p className="text-sm font-medium text-[var(--text-primary)]">Senza abbonamento</p>
      </div>
    )
  }
  const price = planPriceEur(sub.plan)
  const ended = sub.status === 'canceled' || sub.status === 'incomplete_expired'
  const when: string[] = []
  if (sub.status === 'trialing' && sub.trialEndsAt) when.push(`prova fino al ${date(sub.trialEndsAt)}`)
  else if (sub.renewsAt && !sub.cancelAtPeriodEnd && !ended) when.push(`prossimo rinnovo ${date(sub.renewsAt)}`)
  if (sub.cancelAtPeriodEnd && !ended) {
    when.push(`si chiude a fine periodo${sub.renewsAt && sub.status !== 'trialing' ? ` (${date(sub.renewsAt)})` : ''}`)
  }
  const whenLine = when.join(' · ')
  return (
    <div className="col-span-2 rounded-xl bg-[var(--background)] p-3">
      <p className="text-xs text-[var(--text-secondary)]">Abbonamento</p>
      <p className="text-sm font-medium text-[var(--text-primary)]">
        {subscriptionPlanLabel(sub.plan)}
        {price > 0 && ` · ${formatEurRound(price)}/mese + IVA`} ·{' '}
        <span className={TONE_TEXT[subscriptionBadge(sub).tone]}>{subscriptionStatusLabel(sub.status)}</span>
      </p>
      {whenLine && (
        <p className="text-xs text-[var(--text-secondary)]">{whenLine.charAt(0).toUpperCase() + whenLine.slice(1)}</p>
      )}
    </div>
  )
}

const SWITCH_ON = '#34C759'

/** Nella lista: chi ha la chat Assistente accesa. */
function AssistantChip() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--accent-blue)]/15 px-2 py-0.5 text-[11px] font-medium text-[var(--accent-blue)]">
      <Sparkles className="h-3 w-3" aria-hidden="true" />
      Assistente
    </span>
  )
}

/** Nella lista: chi ha la pagina Automazioni visibile, con le email mandate oggi (spaces: spazi sommati dalla beta). */
function AutomationsChip({ automations, spaces }: { automations: BetaAutomations; spaces: number }) {
  const full = automationsFull(automations.sentToday, spaces)
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
        full ? 'bg-[#FF9500]/15 text-[#FF9500]' : 'bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]'
      }`}
    >
      <Clock className="h-3 w-3" aria-hidden="true" />
      Automazioni · {automationsTodayText(automations.sentToday, spaces)}
    </span>
  )
}

/** Nella lista: chi ha la Video automazione visibile. */
function VideoRepliesChip() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--accent-blue)]/15 px-2 py-0.5 text-[11px] font-medium text-[var(--accent-blue)]">
      <Clapperboard className="h-3 w-3" aria-hidden="true" />
      Video automazione
    </span>
  )
}

/** Nella lista: termini e condizioni accettati (versione in vigore), di una versione precedente o mai. */
function TermsChip({ terms, currentVersion }: { terms: BetaTerms | null | undefined; currentVersion?: string }) {
  const status = termsStatus(terms, currentVersion)
  if (status === 'unknown') return null
  const look =
    status === 'ok'
      ? { text: 'Termini ✓', cls: 'bg-[#34C759]/15 text-[#34C759]', title: 'Ha accettato i termini in vigore' }
      : status === 'old'
        ? { text: 'Termini: versione vecchia', cls: 'bg-[#FF9500]/15 text-[#FF9500]', title: 'Ha accettato una versione precedente dei termini' }
        : { text: 'Termini ✗', cls: 'bg-[#FF3B30]/15 text-[#FF3B30]', title: 'Non ha accettato i termini' }
  return (
    <span title={look.title} className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${look.cls}`}>
      {look.text}
    </span>
  )
}

/** Riga con interruttore della scheda (Assistente AI, Automazioni, Video automazione): salva subito. */
function SwitchRow({
  id,
  title,
  description,
  on,
  locked,
  onLabel,
  offLabel,
  saving,
  error,
  onToggle,
}: {
  id: string
  title: string
  description: string
  on: boolean
  locked: boolean
  onLabel: string
  offLabel: string
  saving: boolean
  error: string | null
  onToggle: () => void
}) {
  return (
    <div className="mt-3 rounded-xl bg-[var(--background)] p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p id={id} className="text-sm font-medium text-[var(--text-primary)]">
            {title}
          </p>
          <p className="text-xs text-[var(--text-secondary)]">{description}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={id}
          aria-busy={saving || undefined}
          disabled={locked || saving}
          onClick={onToggle}
          className="-my-1.5 -mr-1 inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-full px-1 text-sm font-medium disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)]"
        >
          <span style={{ color: on ? SWITCH_ON : 'var(--text-secondary)' }}>{on ? onLabel : offLabel}</span>
          <span
            className={`relative h-7 w-12 rounded-full transition-colors ${locked || saving ? 'opacity-60' : ''}`}
            style={{ background: on ? SWITCH_ON : 'var(--border-color)' }}
          >
            <span className="absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all" style={{ left: on ? 22 : 2 }} />
          </span>
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-[#FF3B30]">{error}</p>}
    </div>
  )
}

/** Testo dell'errore con il punto finale e cosa resta com'era. */
function rollbackMessage(e: unknown, after: string) {
  const message = (e instanceof Error && e.message.trim()) || 'Salvataggio non riuscito.'
  const sentence = /[.!?…]$/.test(message) ? message : `${message}.`
  return `${sentence} ${after}`
}

const workspacesLine = (user: BetaUser) =>
  user.workspaces.length
    ? user.workspaces.map((w) => `${w.name} · ${planLabelFor(w.plan)}`).join(', ')
    : 'Nessuno spazio di lavoro'

const int = (v: number) => Math.round(v).toLocaleString('it-IT')

/** "120 Places · 45 AI" (consumi reali del mese, per la lista). */
const usageLine = (c: UsageCounts) => `${int(c.places.ok + c.places.error)} Places · ${int(aiCallsOf(c))} AI`

/**
 * Costo Google Places reale ripartito sulle richieste del mese (null se non disponibile o se
 * l'utente non e' titolare: i suoi numeri sono gia' contati al titolare).
 * usersOk: richieste Places riuscite di tutti i titolari (la somma delle quote non supera il costo).
 */
function googleShare(user: Pick<BetaUser, 'usage' | 'workspaces'>, places: PlacesAttribution | null, usersOk: number) {
  if (!places) return null
  const value = userPlacesShare(user.usage, usageFromOthersSpaces(user.workspaces), places, usersOk)
  return value === null ? null : formatMoney(value, places.currency)
}

/** Richieste Places riuscite del mese dei titolari (chi lavora negli spazi di altri e' gia' contato). */
const ownersOk = (users: BetaUser[]) =>
  users.reduce((n, u) => n + (u.usage && !usageFromOthersSpaces(u.workspaces) ? u.usage.month.places.ok : 0), 0)

/** Riquadro "oggi" o "mese" dei consumi reali nella scheda. */
function UsageBox({ title, c }: { title: string; c: UsageCounts }) {
  return (
    <div className="rounded-xl bg-[var(--background)] p-3">
      <p className="text-xs text-[var(--text-secondary)]">{title}</p>
      <p className="text-sm font-medium tabular-nums text-[var(--text-primary)]">
        {int(c.places.ok)} Places{c.places.error ? <span className="font-normal text-[var(--text-secondary)]"> · {int(c.places.error)} errori</span> : null}
      </p>
      <p className="text-sm font-medium tabular-nums text-[var(--text-primary)]">{int(aiCallsOf(c))} chiamate AI</p>
      <p className="text-[11px] tabular-nums text-[var(--text-secondary)]">
        Gemini {int(c.ai.gemini.calls)} · Claude {int(c.ai.claude.calls)} · {formatCount(aiTokensOf(c))} token
      </p>
    </div>
  )
}

export default function UtentiClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [allowed, setAllowed] = useState(false)
  const [data, setData] = useState<BetaUsersResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  // Dati reali di Google per ripartire il costo Places (null: non collegati).
  const [places, setPlaces] = useState<PlacesAttribution | null>(null)
  // Per non ricaricare la lista quando siamo noi a cambiare ?u= aprendo una scheda.
  const selfNav = useRef<string | null>(null)

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
      const token = await getAccessToken()
      if (!token) throw new Error('Sessione scaduta: accedi di nuovo.')
      const res = await fetch('/api/admin/utenti', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || 'Impossibile caricare gli utenti della beta.')
      setData(json as BetaUsersResponse)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossibile caricare gli utenti della beta.')
    } finally {
      setLoading(false)
    }
    // Costo Google reale da ripartire: se non e' collegato la pagina resta com'e'.
    try {
      const token = await getAccessToken()
      if (!token) return
      const res = await fetch('/api/admin/consumi?parte=ripartizione', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      const json = await res.json().catch(() => null)
      setPlaces(res.ok && json?.places?.ok ? (json.places.value as PlacesAttribution) : null)
    } catch {
      setPlaces(null)
    }
  }, [])

  useEffect(() => {
    if (allowed) load()
  }, [allowed, load])

  // ?u= dall'indirizzo (anche quando la notifica riapre la pagina gia' aperta).
  const loadedOnce = Boolean(data)
  useEffect(() => {
    const u = searchParams.get('u')
    setOpenId(u)
    if (u && u !== selfNav.current && loadedOnce) load()
    selfNav.current = null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const open = (id: string) => {
    selfNav.current = id
    setOpenId(id)
    router.replace(`/admin/utenti?u=${encodeURIComponent(id)}`, { scroll: false })
  }
  const close = useCallback(() => {
    setOpenId(null)
    router.replace('/admin/utenti', { scroll: false })
  }, [router])

  const users = useMemo(() => data?.users ?? [], [data])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return users
    return users.filter((u) =>
      [u.name, u.email, ...u.workspaces.map((w) => w.name)].some((v) => v.toLowerCase().includes(q))
    )
  }, [users, query])

  const selected = openId ? users.find((u) => u.id === openId) ?? null : null
  const notFound = Boolean(openId && data && !selected)
  // Con consumi: dai consumi reali se la beta li manda, altrimenti da quello che segna la beta.
  // Chi non e' titolare di uno spazio no: i suoi numeri sono quelli del titolare.
  const using = users.filter((u) => !usageFromOthersSpaces(u.workspaces) && (u.usage ? hasUsage(u.usage.month) : u.eur > 0)).length
  const usersOk = useMemo(() => ownersOk(users), [users])
  const blocked = users.filter((u) => u.blocked).length
  const subs = useMemo(() => subscriptionSummary(users), [users])
  // Solo se la beta manda gia' lo stato dell'assistente.
  const assistantKnown = users.some((u) => u.assistant)
  const withAssistant = users.filter((u) => u.assistant?.enabled).length
  const automationsKnown = users.some((u) => u.automations)
  const withAutomations = users.filter((u) => u.automations?.enabled).length
  const videoRepliesKnown = users.some((u) => u.videoReplies !== undefined)
  const withVideoReplies = users.filter((u) => u.videoReplies === true).length
  // Solo se la beta manda gia' le accettazioni dei termini.
  const termsKnown = users.some((u) => u.terms !== undefined)
  const withoutTerms = users.filter((u) => termsStatus(u.terms, data?.termsVersion) !== 'ok' && u.terms !== undefined).length

  const updateUser = (id: string, patch: Partial<BetaUser>) =>
    setData((d) => (d ? { ...d, users: d.users.map((u) => (u.id === id ? { ...u, ...patch } : u)) } : d))

  if (!allowed) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[var(--accent-blue)]/30 border-t-[var(--accent-blue)]" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pt-20 md:pt-24 pb-28 md:pb-16">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-[var(--text-primary)]">
            <Users className="h-6 w-6" /> Utenti
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Iscritti alla beta e i loro consumi reali del mese: richieste Places e chiamate AI con i token.
          </p>
          {data && (
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              {users.length} {users.length === 1 ? 'utente' : 'utenti'} · {using} con consumi · {blocked}{' '}
              {blocked === 1 ? 'bloccato' : 'bloccati'}
              {assistantKnown && ` · ${withAssistant} con l’assistente`}
              {automationsKnown && ` · ${withAutomations} con le automazioni`}
              {videoRepliesKnown && ` · ${withVideoReplies} con la video automazione`}
              {termsKnown && ` · ${withoutTerms} senza i termini in vigore`} · aggiornato {dateTime(data.updatedAt)}
            </p>
          )}
          {subs && (
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              Abbonamenti attivi: {subs.active.map((a) => `${a.label} ${a.count}`).join(' · ')} · {subs.trialing} in prova
              {subs.failed > 0 && ` · ${subs.failed} con pagamento non riuscito`} ·{' '}
              <span className="font-medium text-[var(--text-primary)]">{formatEurRound(subs.monthlyEur)}/mese</span> stimati, IVA
              esclusa
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="self-start inline-flex items-center gap-2 rounded-lg bg-[var(--accent-blue)] px-4 py-2 text-sm text-white hover:bg-[var(--accent-blue)]/90 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Aggiorna
        </button>
      </div>

      <label className="mt-5 flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)] px-3 py-2 focus-within:border-[var(--accent-blue)]">
        <Search className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cerca per nome, email o spazio di lavoro"
          className="w-full bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none"
        />
      </label>

      {error && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#FF3B30]/40 bg-[#FF3B30]/10 px-3 py-2 text-sm text-[var(--text-primary)]">
          <span>{error}</span>
          <button type="button" onClick={load} disabled={loading} className="text-sm font-medium text-[var(--accent-blue)] disabled:opacity-50">
            Riprova
          </button>
        </div>
      )}

      {notFound && (
        <div className="mt-4 flex items-center justify-between gap-2 rounded-xl bg-[var(--background-secondary)] px-3 py-2 text-sm text-[var(--text-secondary)]">
          <span>Questo utente non è tra gli iscritti alla beta.</span>
          <button type="button" onClick={close} aria-label="Chiudi" className="p-1">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {!data && loading && <p className="mt-8 text-center text-sm text-[var(--text-secondary)]">Caricamento…</p>}

      {data && (
        <ul className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((user) => (
            <li
              key={user.id}
              className={`flex gap-4 rounded-2xl border bg-[var(--card-background)] p-4 ${
                user.blocked ? 'border-[#FF3B30]/50' : 'border-[var(--border-color)]'
              }`}
            >
              <UserIcon user={user} onClick={() => open(user.id)} />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => open(user.id)}
                    className="min-w-0 truncate text-left font-semibold text-[var(--text-primary)] hover:underline"
                  >
                    {user.name}
                  </button>
                  <Badges user={user} />
                </div>
                <p className="truncate text-xs text-[var(--text-secondary)]">{user.email}</p>
                {(user.subscription !== undefined || user.assistant?.enabled || user.automations?.enabled || user.videoReplies === true || user.terms !== undefined) && (
                  <div className="mt-1 flex min-w-0 flex-wrap gap-1">
                    <SubscriptionBadge user={user} />
                    <TermsChip terms={user.terms} currentVersion={data?.termsVersion} />
                    {user.assistant?.enabled && <AssistantChip />}
                    {user.automations?.enabled && <AutomationsChip automations={user.automations} spaces={automationsSpaces(user.workspaces)} />}
                    {user.videoReplies === true && <VideoRepliesChip />}
                  </div>
                )}
                <div className="mt-2 flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                    {user.usage ? usageLine(user.usage.month) : 'Consumi non ancora inviati'}
                  </span>
                  <span className="shrink-0 text-xs text-[var(--text-secondary)]">{daysLeftText(user.period.daysLeft)}</span>
                </div>
                {user.usage && usageFromOthersSpaces(user.workspaces) && (
                  <p className="text-[11px] text-[var(--text-secondary)]">Spazi in cui lavora, già contati dal titolare</p>
                )}
                {googleShare(user, places, usersOk) && (
                  <p className="text-[11px] text-[var(--text-secondary)]">
                    {ATTRIBUTION_LABEL}: {googleShare(user, places, usersOk)}
                  </p>
                )}
                <p className="mt-0.5 truncate text-xs text-[var(--text-secondary)]" title={workspacesLine(user)}>
                  <span className="font-medium text-[var(--text-primary)]">Piano {user.planLabel}</span> · {workspacesLine(user)}
                </p>
              </div>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="col-span-full py-8 text-center text-sm text-[var(--text-secondary)]">
              {users.length ? 'Nessun utente trovato.' : 'Nessun utente iscritto alla beta.'}
            </li>
          )}
        </ul>
      )}

      {selected && data && (
        <UserSheet
          user={selected}
          places={places}
          usersOk={usersOk}
          termsVersion={data.termsVersion}
          onClose={close}
          onSaved={(patch) => updateUser(selected.id, patch)}
        />
      )}
    </div>
  )
}

function UserSheet({
  user,
  places,
  usersOk = 0,
  termsVersion,
  onClose,
  onSaved,
}: {
  user: BetaUser
  places: PlacesAttribution | null
  /** Richieste Places riuscite del mese di tutti i titolari. */
  usersOk?: number
  /** Versione dei termini in vigore sulla beta (se la manda). */
  termsVersion?: string
  onClose: () => void
  onSaved: (patch: Partial<BetaUser>) => void
}) {
  const [saving, setSaving] = useState<LightMode | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [assistantSaving, setAssistantSaving] = useState(false)
  const [assistantError, setAssistantError] = useState<string | null>(null)
  const [automationsSaving, setAutomationsSaving] = useState(false)
  const [automationsError, setAutomationsError] = useState<string | null>(null)
  const [videoRepliesSaving, setVideoRepliesSaving] = useState(false)
  const [videoRepliesError, setVideoRepliesError] = useState<string | null>(null)
  const [termsOpen, setTermsOpen] = useState(false)
  const mode: LightMode = user.override ?? 'auto'

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
    }
  }, [onClose])

  useEffect(() => {
    setSaveError(null)
    setAssistantError(null)
    setAutomationsError(null)
    setVideoRepliesError(null)
    setTermsOpen(false)
  }, [user.id])

  const choose = async (next: LightMode) => {
    if (next === mode || saving) return
    setSaving(next)
    setSaveError(null)
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Sessione scaduta: accedi di nuovo.')
      const res = await fetch('/api/admin/utenti', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId: user.id, mode: next }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || 'Salvataggio non riuscito.')
      const override = json?.override === 'green' || json?.override === 'orange' || json?.override === 'red' ? json.override : null
      onSaved({ override, shown: shownFor(user.level, override) })
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Salvataggio non riuscito.')
    } finally {
      setSaving(null)
    }
  }

  // Si vede subito la scelta; se la beta non la salva torna com'era.
  const toggleAssistant = async () => {
    const prev = user.assistant
    if (!prev || prev.locked || assistantSaving) return
    const next = !prev.enabled
    setAssistantSaving(true)
    setAssistantError(null)
    onSaved({ assistant: { ...prev, enabled: next } })
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Sessione scaduta: accedi di nuovo.')
      const res = await fetch('/api/admin/utenti', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId: user.id, assistant: next }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || 'Salvataggio non riuscito.')
      onSaved({ assistant: assistantFrom(json?.assistant) ?? { ...prev, enabled: next } })
    } catch (e) {
      onSaved({ assistant: prev })
      setAssistantError(rollbackMessage(e, `L’assistente resta ${prev.enabled ? 'attivo' : 'spento'}.`))
    } finally {
      setAssistantSaving(false)
    }
  }

  // Come l'assistente: si vede subito, se la beta non salva torna com'era.
  const toggleAutomations = async () => {
    const prev = user.automations
    if (!prev || automationsLocked(user) || automationsSaving) return
    const next = !prev.enabled
    setAutomationsSaving(true)
    setAutomationsError(null)
    onSaved({ automations: { ...prev, enabled: next } })
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Sessione scaduta: accedi di nuovo.')
      const res = await fetch('/api/admin/utenti', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId: user.id, automations: next }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || 'Salvataggio non riuscito.')
      onSaved({ automations: { ...prev, enabled: typeof json?.automations === 'boolean' ? json.automations : next } })
    } catch (e) {
      onSaved({ automations: prev })
      // Rete giu' (il browser lo dice in inglese): un messaggio in italiano.
      const error = e instanceof TypeError ? new Error('Connessione non riuscita: riprova.') : e
      setAutomationsError(rollbackMessage(error, `La pagina Automazioni resta ${prev.enabled ? 'visibile' : 'nascosta'}.`))
    } finally {
      setAutomationsSaving(false)
    }
  }

  // Come le automazioni: si vede subito, se la beta non salva torna com'era.
  const toggleVideoReplies = async () => {
    const prev = user.videoReplies
    if (prev === undefined || videoRepliesLocked(user) || videoRepliesSaving) return
    const next = !prev
    setVideoRepliesSaving(true)
    setVideoRepliesError(null)
    onSaved({ videoReplies: next })
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Sessione scaduta: accedi di nuovo.')
      const res = await fetch('/api/admin/utenti', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ userId: user.id, videoReplies: next }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || 'Salvataggio non riuscito.')
      onSaved({ videoReplies: typeof json?.videoReplies === 'boolean' ? json.videoReplies : next })
    } catch (e) {
      onSaved({ videoReplies: prev })
      const error = e instanceof TypeError ? new Error('Connessione non riuscita: riprova.') : e
      setVideoRepliesError(rollbackMessage(error, `La video automazione resta ${prev ? 'visibile' : 'nascosta'}.`))
    } finally {
      setVideoRepliesSaving(false)
    }
  }

  // Il gettone lo calcola la beta: qui si mostra lo stato, senza importi stimati.
  const hasLimit = !user.unlimited && user.limitEur > 0
  const usage = user.usage
  const shared = usageFromOthersSpaces(user.workspaces)
  const share = googleShare(user, places, usersOk)

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="utente-nome"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] shadow-2xl sm:rounded-2xl sm:pb-5"
      >
        <div className="flex items-start gap-4">
          <UserIcon user={user} size={64} />
          <div className="min-w-0 flex-1">
            <h2 id="utente-nome" className="truncate text-lg font-semibold text-[var(--text-primary)]">
              {user.name}
            </h2>
            <p className="truncate text-sm text-[var(--text-secondary)]">{user.email}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Badges user={user} />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi"
            className="shrink-0 rounded-lg p-1 text-[var(--text-secondary)] hover:bg-[var(--background)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <div className="col-span-2 rounded-xl bg-[var(--background)] p-3">
            <p className="text-xs text-[var(--text-secondary)]">Periodo dell’abbonamento</p>
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {date(user.period.start)} – {date(user.period.end)}
            </p>
          </div>
          <div className="rounded-xl bg-[var(--background)] p-3">
            <p className="text-xs text-[var(--text-secondary)]">Piano</p>
            <p className="text-sm font-medium text-[var(--text-primary)]">{user.planLabel}</p>
          </div>
          <div className="rounded-xl bg-[var(--background)] p-3">
            <p className="text-xs text-[var(--text-secondary)]">Rinnovo</p>
            <p className="text-sm font-medium text-[var(--text-primary)]">{daysLeftText(user.period.daysLeft)}</p>
          </div>
          {user.subscription !== undefined && <SubscriptionRow sub={user.subscription} />}
        </div>

        {user.terms !== undefined && <TermsRow terms={user.terms} currentVersion={termsVersion} onOpen={() => setTermsOpen(true)} />}
        {termsOpen && user.terms && <TermsSheet user={user} terms={user.terms} onClose={() => setTermsOpen(false)} />}

        {user.assistant && (
          <SwitchRow
            id="assistente-ai"
            title="Assistente AI"
            description={user.assistant.locked ? 'Sempre attivo (Facevoice)' : 'La chat Assistente nell’area clienti della beta'}
            on={user.assistant.enabled || user.assistant.locked}
            locked={user.assistant.locked}
            onLabel="Attivo"
            offLabel="Spento"
            saving={assistantSaving}
            error={assistantError}
            onToggle={toggleAssistant}
          />
        )}

        {user.automations && (
          <SwitchRow
            id="automazioni"
            title="Automazioni"
            description={
              (automationsLocked(user) ? 'Sempre visibile (Facevoice)' : 'La pagina Automazioni nell’area clienti della beta') +
              (user.automations.enabled ? ` · email ${automationsTodayText(user.automations.sentToday, automationsSpaces(user.workspaces))}` : '')
            }
            on={user.automations.enabled}
            locked={automationsLocked(user)}
            onLabel="Visibile"
            offLabel="Nascosta"
            saving={automationsSaving}
            error={automationsError}
            onToggle={toggleAutomations}
          />
        )}

        {user.videoReplies !== undefined && (
          <SwitchRow
            id="video-automazione"
            title="Video automazione"
            description={
              videoRepliesLocked(user)
                ? 'Sempre visibile (Facevoice)'
                : 'Video mandati dall’AI nei messaggi Instagram e Messenger (scheda in Automazioni, anche senza le email e senza l’Assistente)'
            }
            on={user.videoReplies}
            locked={videoRepliesLocked(user)}
            onLabel="Visibile"
            offLabel="Nascosta"
            saving={videoRepliesSaving}
            error={videoRepliesError}
            onToggle={toggleVideoReplies}
          />
        )}

        <div className="mt-3 flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Consumi reali</h3>
          <p className="text-xs text-[var(--text-secondary)]">
            {user.unlimited ? 'senza limite' : user.blocked ? 'limite raggiunto' : LIGHT_NAME[user.shown].toLowerCase()}
          </p>
        </div>
        {usage ? (
          <>
            {shared && (
              <p className="mt-1 text-xs text-[var(--text-secondary)]">
                Non è titolare di uno spazio: questi sono i consumi degli spazi in cui lavora, già contati dal titolare.
              </p>
            )}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <UsageBox title="Oggi" c={usage.today} />
              <UsageBox title="Questo mese" c={usage.month} />
            </div>
            {share && (
              <p className="mt-2 text-xs text-[var(--text-primary)]">
                {ATTRIBUTION_LABEL}: <b className="tabular-nums">{share}</b>
                <span className="block text-[11px] text-[var(--text-secondary)]">= {ATTRIBUTION_RULE}</span>
              </p>
            )}
            <h3 className="mt-5 text-sm font-semibold text-[var(--text-primary)]">Per funzione</h3>
            {usage.byFeature.length ? (
              <ul className="mt-2 space-y-1.5">
                {usage.byFeature.map((f) => (
                  <li key={f.feature} className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate text-[var(--text-primary)]">{f.label}</span>
                    <span className="shrink-0 text-xs tabular-nums text-[var(--text-secondary)]">
                      {[f.places ? `${int(f.places)} Places` : '', f.aiCalls ? `${int(f.aiCalls)} AI · ${formatCount(f.input + f.output)} token` : '']
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-[var(--text-secondary)]">Nessun consumo in questo periodo.</p>
            )}
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">La beta non manda ancora i consumi reali di questo utente.</p>
            {user.byConnection.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {user.byConnection.map((c) => (
                  <li key={c.key} className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate text-[var(--text-primary)]">{c.label}</span>
                    <span className="shrink-0 text-xs tabular-nums text-[var(--text-secondary)]">
                      {c.calls} {c.calls === 1 ? 'richiesta' : 'richieste'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        <h3 className="mt-5 text-sm font-semibold text-[var(--text-primary)]">Spazi di lavoro</h3>
        {user.workspaces.length ? (
          <ul className="mt-2 space-y-1 text-sm">
            {user.workspaces.map((w) => (
              <li key={w.id || w.name} className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[var(--text-primary)]">{w.name}</span>
                <span className="shrink-0 text-xs text-[var(--text-secondary)]">
                  {planLabelFor(w.plan)} · {ROLE[w.role]}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Nessuno spazio di lavoro.</p>
        )}
        <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
          I consumi contano gli spazi di cui è proprietario; se non ne ha, quelli in cui lavora (già contati dal titolare).
        </p>

        <h3 className="mt-5 text-sm font-semibold text-[var(--text-primary)]">Gettone che vede l’utente</h3>
        <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {MODES.map((m) => {
            const active = mode === m.mode
            const color = LIGHTS.find((l) => l.key === m.mode)?.color
            return (
              <button
                key={m.mode}
                type="button"
                onClick={() => choose(m.mode)}
                disabled={Boolean(saving)}
                aria-pressed={active}
                className={`inline-flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-sm transition-colors disabled:opacity-60 ${
                  active
                    ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)] text-white'
                    : 'border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--background)]'
                }`}
              >
                {color && <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />}
                {saving === m.mode ? 'Salvo…' : m.label}
              </button>
            )
          })}
        </div>
        <p className="mt-2 text-xs text-[var(--text-secondary)]">
          Ora vede: {LIGHT_NAME[user.shown].toLowerCase()}. Automatico segue i consumi del suo piano: verde appena inizia, poi arancione e rosso
          vicino al limite.
          {user.unlimited
            ? ' Questo utente non ha limite.'
            : hasLimit
              ? ' Al limite del piano l’AI si blocca comunque, qualunque colore scegli.'
              : ''}
        </p>
        {saveError && <p className="mt-2 text-xs text-[#FF3B30]">{saveError}</p>}

        <p className="mt-5 text-[11px] text-[var(--text-secondary)]">
          Iscritto il {date(user.createdAt)} · ultimo accesso {user.lastSignInAt ? date(user.lastSignInAt) : 'mai'}
        </p>
      </div>
    </div>
  )
}

/** Riga "Termini e condizioni" della scheda: quando, versione, IP e dispositivo; avviso se mancano. */
function TermsRow({ terms, currentVersion, onOpen }: { terms: BetaTerms | null; currentVersion?: string; onOpen: () => void }) {
  if (!terms) {
    return (
      <div className="mt-3 flex items-start gap-2 rounded-xl border border-[#FF3B30]/40 bg-[#FF3B30]/10 p-3">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#FF3B30]" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)]">Termini e condizioni non accettati</p>
          <p className="text-xs text-[var(--text-secondary)]">
            Non risulta nessuna accettazione. Al prossimo accesso la beta gli chiede di accettarli e non può usare l’area clienti finché non lo fa.
          </p>
        </div>
      </div>
    )
  }
  const old = termsStatus(terms, currentVersion) === 'old'
  return (
    <div className="mt-3 rounded-xl bg-[var(--background)] p-3">
      <div className="flex items-start gap-2">
        <ShieldCheck className={`mt-0.5 h-4 w-4 shrink-0 ${old ? 'text-[#FF9500]' : 'text-[#34C759]'}`} aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-xs text-[var(--text-secondary)]">Termini e condizioni</p>
          <p className="break-words text-sm text-[var(--text-primary)]">
            Termini accettati il {romeDateTime(terms.acceptedAt)} (ora di Roma), versione {terms.version}, IP {terms.ip || 'non registrato'}, dispositivo{' '}
            {shortUserAgent(terms.userAgent)}
          </p>
          {old && (
            <p className="mt-1 text-xs text-[#FF9500]">
              Non ha ancora accettato la versione in vigore{currentVersion ? ` (${currentVersion})` : ''}: gliela chiediamo al prossimo accesso.
            </p>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="mt-2 inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-[var(--border-color)] px-3 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--background-secondary)]"
      >
        <FileText className="h-4 w-4" aria-hidden="true" /> Vedi i termini accettati
      </button>
    </div>
  )
}

/** Il testo dei termini in blocchi leggibili: titolo, intestazioni "N. ...", elenchi "- ", paragrafi. */
function TermsText({ text }: { text: string }) {
  const lines = text.split('\n')
  const out: ReactNode[] = []
  let list: string[] = []
  const flush = () => {
    if (!list.length) return
    const items = list
    list = []
    out.push(
      <ul key={`l${out.length}`} className="mt-2 list-disc space-y-1 pl-5">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    )
  }
  lines.forEach((raw, i) => {
    const line = raw.trim()
    if (line.startsWith('- ')) return void list.push(line.slice(2))
    flush()
    if (!line) return
    if (i === 0) out.push(<p key={i} className="text-base font-semibold text-[var(--text-primary)]">{line}</p>)
    else if (/^\d{1,2}\.\s/.test(line)) out.push(<p key={i} className="mt-4 font-semibold text-[var(--text-primary)]">{line}</p>)
    else out.push(<p key={i} className="mt-2">{line}</p>)
  })
  flush()
  return <>{out}</>
}

/** Foglio con il testo esatto accettato (letto dalla beta), le caselle spuntate e "Stampa". */
function TermsSheet({ user, terms, onClose }: { user: BetaUser; terms: BetaTerms; onClose: () => void }) {
  const [doc, setDoc] = useState<BetaTermsText | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [printError, setPrintError] = useState<string | null>(null)

  // Esc chiude solo questo foglio (non la scheda sotto).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  useEffect(() => {
    let alive = true
    setDoc(null)
    setError(null)
    ;(async () => {
      try {
        const token = await getAccessToken()
        if (!token) throw new Error('Sessione scaduta: accedi di nuovo.')
        const res = await fetch(`/api/admin/utenti/termini?version=${encodeURIComponent(terms.version)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const json = await res.json().catch(() => null)
        if (!res.ok) throw new Error(json?.error || 'Testo dei termini non disponibile.')
        const parsed = termsTextFrom(json)
        if (!parsed) throw new Error('Testo dei termini non valido.')
        if (alive) setDoc(parsed)
      } catch (e) {
        if (alive) setError(e instanceof TypeError ? 'Connessione non riuscita: riprova.' : e instanceof Error ? e.message : 'Testo dei termini non disponibile.')
      }
    })()
    return () => {
      alive = false
    }
  }, [terms.version])

  const verified = doc && terms.textHash ? terms.textHash === doc.hash : null
  const items = terms.items.length ? terms.items : doc?.items ?? []

  const print = () => {
    if (!doc) return
    setPrintError(null)
    const win = window.open('', '_blank')
    if (!win) return setPrintError('Il browser ha bloccato la nuova finestra: consenti i popup per questo sito e riprova.')
    win.opener = null
    win.document.open()
    win.document.write(termsPrintHtml({ name: user.name, email: user.email, terms, doc }))
    win.document.close()
    win.focus()
    win.print()
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/60 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="termini-titolo"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col rounded-t-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border-color)] p-4">
          <div className="min-w-0">
            <h2 id="termini-titolo" className="text-base font-semibold text-[var(--text-primary)]">
              Termini accettati da {user.name}
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">
              Versione {terms.version} · {romeDateTime(terms.acceptedAt)} · IP {terms.ip || 'non registrato'}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Chiudi" className="shrink-0 rounded-lg p-1 text-[var(--text-secondary)] hover:bg-[var(--background)]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm leading-relaxed text-[var(--text-secondary)]">
          <div className="rounded-xl bg-[var(--background)] p-3 text-xs">
            <p>
              <span className="text-[var(--text-primary)]">Email:</span> {terms.email || user.email}
            </p>
            <p className="break-words">
              <span className="text-[var(--text-primary)]">Dispositivo:</span> {shortUserAgent(terms.userAgent)}
              {terms.userAgent ? ` — ${terms.userAgent}` : ''}
            </p>
            <p>
              <span className="text-[var(--text-primary)]">Dove:</span>{' '}
              {terms.source === 'signup' ? 'alla registrazione' : terms.source === 'gate' ? 'all’ingresso nell’area clienti' : '—'}
            </p>
          </div>

          {items.length > 0 && (
            <>
              <p className="mt-4 text-sm font-semibold text-[var(--text-primary)]">Caselle spuntate</p>
              <ul className="mt-1 space-y-1">
                {items.map((item, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-[#34C759]" aria-hidden="true">
                      ✓
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </>
          )}

          <p className="mt-4 text-sm font-semibold text-[var(--text-primary)]">Testo esatto</p>
          {error ? (
            <p className="mt-1 text-[#FF3B30]">{error}</p>
          ) : !doc ? (
            <p className="mt-1">Caricamento…</p>
          ) : (
            <>
              <p className={`mt-1 break-all text-[11px] ${verified === false ? 'text-[#FF3B30]' : ''}`}>
                Impronta SHA-256: {doc.hash}{' '}
                {verified === true
                  ? '· verificata: il testo è identico a quello accettato'
                  : verified === false
                    ? '· DIVERSA da quella registrata all’accettazione'
                    : ''}
              </p>
              <div translate="no" className="mt-3 rounded-xl border border-[var(--border-color)] bg-[var(--background)] p-4">
                <TermsText text={doc.text} />
              </div>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border-color)] p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
          {printError && <p className="mr-auto text-xs text-[#FF3B30]">{printError}</p>}
          <button
            type="button"
            onClick={print}
            disabled={!doc}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent-blue)] px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            <Printer className="h-4 w-4" aria-hidden="true" /> Stampa
          </button>
          <button type="button" onClick={onClose} className="rounded-lg border border-[var(--border-color)] px-4 py-2 text-sm text-[var(--text-primary)]">
            Chiudi
          </button>
        </div>
      </div>
    </div>
  )
}
