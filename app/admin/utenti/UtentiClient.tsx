'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { RefreshCw, Search, Sparkles, Users, X } from 'lucide-react'
import { createClient } from '@/lib/supabase-client'
import { getAccessToken } from '@/lib/session-token'
import { isAdminEmail } from '@/lib/admin-auth'
import {
  assistantFrom,
  daysLeftText,
  formatEur,
  formatEurRound,
  planLabelFor,
  planPriceEur,
  shownFor,
  subscriptionBadge,
  subscriptionPlanLabel,
  subscriptionStatusLabel,
  subscriptionSummary,
  type BetaAssistant,
  type BetaSubscription,
  type BetaUser,
  type BetaUsersResponse,
  type LightMode,
  type ShownLight,
  type SubscriptionTone,
} from '@/lib/beta-users'

// Pagina "Utenti": chi e' iscritto alla beta, quanto ha speso di AI nel periodo
// del suo abbonamento e quale gettone vede (verde, arancione, rosso).
// Dalla scheda l'admin accende o spegne anche la chat Assistente della beta.
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

const ASSISTANT_ON = '#34C759'

/** Nella lista: chi ha la chat Assistente accesa. */
function AssistantChip() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--accent-blue)]/15 px-2 py-0.5 text-[11px] font-medium text-[var(--accent-blue)]">
      <Sparkles className="h-3 w-3" aria-hidden="true" />
      Assistente
    </span>
  )
}

/** Riga "Assistente AI" della scheda: interruttore che salva subito. */
function AssistantRow({
  assistant,
  saving,
  error,
  onToggle,
}: {
  assistant: BetaAssistant
  saving: boolean
  error: string | null
  onToggle: () => void
}) {
  const on = assistant.enabled || assistant.locked
  return (
    <div className="mt-3 rounded-xl bg-[var(--background)] p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p id="assistente-ai" className="text-sm font-medium text-[var(--text-primary)]">
            Assistente AI
          </p>
          <p className="text-xs text-[var(--text-secondary)]">
            {assistant.locked ? 'Sempre attivo (Facevoice)' : 'La chat Assistente nell’area clienti della beta'}
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="assistente-ai"
          aria-busy={saving || undefined}
          disabled={assistant.locked || saving}
          onClick={onToggle}
          className="-my-1.5 -mr-1 inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-full px-1 text-sm font-medium disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-blue)]"
        >
          <span style={{ color: on ? ASSISTANT_ON : 'var(--text-secondary)' }}>{on ? 'Attivo' : 'Spento'}</span>
          <span
            className={`relative h-7 w-12 rounded-full transition-colors ${assistant.locked || saving ? 'opacity-60' : ''}`}
            style={{ background: on ? ASSISTANT_ON : 'var(--border-color)' }}
          >
            <span className="absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all" style={{ left: on ? 22 : 2 }} />
          </span>
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-[#FF3B30]">{error}</p>}
    </div>
  )
}

const workspacesLine = (user: BetaUser) =>
  user.workspaces.length
    ? user.workspaces.map((w) => `${w.name} · ${planLabelFor(w.plan)}`).join(', ')
    : 'Nessuno spazio di lavoro'

export default function UtentiClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [allowed, setAllowed] = useState(false)
  const [data, setData] = useState<BetaUsersResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
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
  const using = users.filter((u) => u.eur > 0).length
  const blocked = users.filter((u) => u.blocked).length
  const subs = useMemo(() => subscriptionSummary(users), [users])
  // Solo se la beta manda gia' lo stato dell'assistente.
  const assistantKnown = users.some((u) => u.assistant)
  const withAssistant = users.filter((u) => u.assistant?.enabled).length

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
            Iscritti alla beta e quanto hanno speso di AI nel mese del loro abbonamento.
          </p>
          {data && (
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              {users.length} {users.length === 1 ? 'utente' : 'utenti'} · {using} con consumi · {blocked}{' '}
              {blocked === 1 ? 'bloccato' : 'bloccati'}
              {assistantKnown && ` · ${withAssistant} con l’assistente`} · aggiornato {dateTime(data.updatedAt)}
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
                {(user.subscription !== undefined || user.assistant?.enabled) && (
                  <div className="mt-1 flex min-w-0 flex-wrap gap-1">
                    <SubscriptionBadge user={user} />
                    {user.assistant?.enabled && <AssistantChip />}
                  </div>
                )}
                <div className="mt-2 flex items-baseline justify-between gap-2">
                  <span className="text-lg font-bold tabular-nums text-[var(--text-primary)]">{formatEur(user.eur)}</span>
                  <span className="shrink-0 text-xs text-[var(--text-secondary)]">{daysLeftText(user.period.daysLeft)}</span>
                </div>
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
        <UserSheet user={selected} onClose={close} onSaved={(patch) => updateUser(selected.id, patch)} />
      )}
    </div>
  )
}

function UserSheet({
  user,
  onClose,
  onSaved,
}: {
  user: BetaUser
  onClose: () => void
  onSaved: (patch: Partial<BetaUser>) => void
}) {
  const [saving, setSaving] = useState<LightMode | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [assistantSaving, setAssistantSaving] = useState(false)
  const [assistantError, setAssistantError] = useState<string | null>(null)
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
      const message = (e instanceof Error && e.message.trim()) || 'Salvataggio non riuscito.'
      const sentence = /[.!?…]$/.test(message) ? message : `${message}.`
      setAssistantError(`${sentence} L’assistente resta ${prev.enabled ? 'attivo' : 'spento'}.`)
    } finally {
      setAssistantSaving(false)
    }
  }

  const { thresholds, limitEur: limit } = user
  // Barra della spesa solo per chi ha un limite (il proprietario di Facevoice no).
  const hasLimit = !user.unlimited && limit > 0
  const fill = hasLimit ? Math.min(100, (user.eur / limit) * 100) : 0
  const fillColor =
    user.blocked || user.level === 'red' ? '#FF3B30' : user.level === 'orange' ? '#FF9500' : '#34C759'
  const left = Math.max(0, limit - user.eur)

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

        {user.assistant && (
          <AssistantRow assistant={user.assistant} saving={assistantSaving} error={assistantError} onToggle={toggleAssistant} />
        )}

        <div className="mt-3 rounded-xl bg-[var(--background)] p-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs text-[var(--text-secondary)]">Spesa AI nel periodo</p>
            <p className="text-xs text-[var(--text-secondary)]">
              {user.unlimited
                ? 'senza limite'
                : user.blocked
                  ? 'limite raggiunto'
                  : hasLimit
                    ? `restano ${formatEur(left)}`
                    : ''}
            </p>
          </div>
          <p className="mt-0.5 text-2xl font-bold tabular-nums text-[var(--text-primary)]">
            {formatEur(user.eur)}{' '}
            {hasLimit && <span className="text-sm font-normal text-[var(--text-secondary)]">su {formatEur(limit)}</span>}
          </p>
          {hasLimit && (
            <>
              <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-[var(--border-color)]">
                <div className="h-full rounded-full transition-all" style={{ width: `${fill}%`, background: fillColor }} />
                {thresholds &&
                  [thresholds.orange, thresholds.red]
                    .filter((t) => t < limit)
                    .map((t) => (
                      <span
                        key={t}
                        className="absolute top-0 h-full w-px bg-[var(--background)]"
                        style={{ left: `${(t / limit) * 100}%` }}
                      />
                    ))}
              </div>
              <div className="mt-1 flex justify-between gap-2 text-[11px] text-[var(--text-secondary)]">
                <span>0 €</span>
                {thresholds && (
                  <span className="text-center">
                    arancione {formatEur(thresholds.orange)} · rosso {formatEur(thresholds.red)}
                  </span>
                )}
                <span>{formatEur(limit)}</span>
              </div>
            </>
          )}
        </div>

        <h3 className="mt-5 text-sm font-semibold text-[var(--text-primary)]">Per collegamento</h3>
        {user.byConnection.length ? (
          <ul className="mt-2 space-y-2">
            {user.byConnection.map((c) => (
              <li key={c.key}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="truncate text-[var(--text-primary)]">{c.label}</span>
                  <span className="shrink-0 tabular-nums text-[var(--text-primary)]">
                    {formatEur(c.eur)}
                    <span className="ml-1.5 text-xs text-[var(--text-secondary)]">
                      {c.calls} {c.calls === 1 ? 'richiesta' : 'richieste'}
                    </span>
                  </span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--border-color)]">
                  <div
                    className="h-full rounded-full bg-[var(--accent-blue)]"
                    style={{ width: `${user.eur > 0 ? Math.max(2, (c.eur / user.eur) * 100) : 0}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Nessun consumo in questo periodo.</p>
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
        <p className="mt-1 text-[11px] text-[var(--text-secondary)]">La spesa conta solo gli spazi di cui è proprietario.</p>

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
          Ora vede: {LIGHT_NAME[user.shown].toLowerCase()}. Automatico segue la spesa: verde appena inizia
          {thresholds ? `, arancione da ${formatEur(thresholds.orange)}, rosso da ${formatEur(thresholds.red)}` : ''}.
          {user.unlimited
            ? ' Questo utente non ha limite di spesa.'
            : hasLimit
              ? ` A ${formatEur(limit)} l’AI si blocca comunque, qualunque colore scegli.`
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
