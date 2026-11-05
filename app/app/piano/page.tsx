'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Check, CheckCircle2, CreditCard, Loader2 } from 'lucide-react'
import { useWorkspace } from '@/components/app/WorkspaceContext'
import { UsageTokens, refreshUsage, useUsage } from '@/components/app/UsageLights'
import { PAID_PLANS, PAID_PLAN_LABELS, PLAN_PRICES_EUR, TRIAL_DAYS, VAT_PERCENT, isPaidPlan, type BillingInfo, type PaidPlan } from '@/lib/billing-shared'
import { noPlanMessage, usageLabel } from '@/lib/usage-shared'

// Pagina Piano: i tre piani (Pro in evidenza, al centro), il piano dello spazio con
// prova, rinnovo o chiusura, i gettoni del consumo e il portale di Stripe per
// carta e fatture. Senza pagamenti online attivi la pagina non c'e' (si torna alla
// home, come prima): niente prezzi pubblicati prima del lancio.

const CARDS: Record<PaidPlan, { tagline: string; badge?: string }> = {
  start: { tagline: 'Per iniziare' },
  pro: { tagline: 'Quasi 3 volte più utilizzo di Start', badge: 'Il più scelto' },
  business: { tagline: 'Quasi 7 volte più utilizzo di Start', badge: 'Miglior valore' },
}

const FEATURES = [
  'Assistente AI',
  'Risposte automatiche ai messaggi e ai commenti',
  'Post e caroselli',
  'Instagram, Facebook ed Email',
  'I tre gettoni dei consumi',
]

const LIVE = new Set(['active', 'trialing', 'past_due'])
const isLive = (info: BillingInfo | null) => Boolean(info && LIVE.has(info.status || ''))
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }) : '')
/** "il 5 dicembre", "l'8 dicembre", "al 5 dicembre", "all'11 dicembre". */
const onDay = (article: 'il' | 'al', iso: string | null) => {
  const n = iso ? new Date(iso).getDate() : 0
  const elided = n === 8 || n === 11
  return `${article === 'il' ? (elided ? 'l’' : 'il ') : elided ? 'all’' : 'al '}${day(iso)}`
}

/** Riga sotto il piano attuale. */
function statusLine(info: BillingInfo): string {
  if (info.facevoice) return 'Lo spazio Facevoice non ha limiti: non serve un piano.'
  if (!info.configured) return ''
  if (info.coveredBy) return `Incluso nel piano ${info.planLabel} di «${info.coveredBy}»: si gestisce da quello spazio.`
  if (!isLive(info)) return noPlanMessage(info.trialAvailable)
  if (info.status === 'past_due') return 'Pagamento non riuscito: aggiorna la carta da «Gestisci abbonamento e fatture».'
  if (info.status === 'trialing') return `Prova gratuita fino ${onDay('al', info.trialEndsAt || info.renewsAt)}${info.cancelAtPeriodEnd ? ', poi si chiude' : ''}.`
  if (info.cancelAtPeriodEnd) return `Si chiude ${onDay('il', info.renewsAt)}.`
  return `Si rinnova ${onDay('il', info.renewsAt)}.`
}

/** Bottone di una scheda. */
function buttonFor(info: BillingInfo, plan: PaidPlan): { label: string; disabled: boolean; current: boolean } {
  const name = PAID_PLAN_LABELS[plan]
  // Piano di un altro spazio dello stesso titolare: si cambia da li'.
  if (info.coveredBy) return { label: info.plan === plan ? 'Il tuo piano' : `Passa a ${name}`, disabled: true, current: info.plan === plan }
  const live = isLive(info)
  if (live && info.plan === plan) {
    return info.cancelAtPeriodEnd
      ? { label: `Riattiva ${name}`, disabled: !info.canManage, current: true }
      : { label: 'Il tuo piano', disabled: true, current: true }
  }
  if (live) return { label: `Passa a ${name}`, disabled: !info.canManage || info.status === 'past_due', current: false }
  return { label: info.trialAvailable ? `Inizia la prova gratuita di ${TRIAL_DAYS} giorni` : `Scegli ${name}`, disabled: !info.canManage, current: false }
}

function PlanPage() {
  const { appFetch } = useWorkspace()
  const { status: usage } = useUsage()
  const params = useSearchParams()
  const router = useRouter()
  const [info, setInfo] = useState<BillingInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<PaidPlan | 'portal' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // Ritorno dal pagamento (?ok=1): si aspetta che Stripe confermi l'abbonamento.
  const [paid, setPaid] = useState<'waiting' | 'done' | 'slow' | null>(() => (params.get('ok') === '1' ? 'waiting' : null))

  const load = useCallback(
    async (sync = false): Promise<BillingInfo | null> => {
      const res = await appFetch(`/api/app/billing${sync ? '?sync=1' : ''}`).catch(() => null)
      const data = res ? await res.json().catch(() => null) : null
      if (!res?.ok || !data || typeof data.plan !== 'string') {
        setLoadError(data?.error || 'Piano non disponibile, riprova.')
        return null
      }
      setLoadError(null)
      setInfo(data as BillingInfo)
      return data as BillingInfo
    },
    [appFetch]
  )

  // Anche cambiando spazio di lavoro (appFetch cambia con lo spazio).
  useEffect(() => {
    setInfo(null)
    load()
  }, [load])

  // Pagamenti online non attivi: la pagina non c'e' ancora.
  const notConfigured = info !== null && !info.configured
  useEffect(() => {
    if (notConfigured) router.replace('/app')
  }, [notConfigured, router])

  useEffect(() => {
    if (paid !== 'waiting') return
    let alive = true
    let tries = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      const data = await load(true)
      if (!alive) return
      if (isLive(data)) {
        setPaid('done')
        refreshUsage()
        router.replace('/app/piano')
        return
      }
      if (++tries >= 12) return setPaid('slow')
      timer = setTimeout(tick, 2500)
    }
    timer = setTimeout(tick, 800)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [paid, load, router])

  const choose = async (plan: PaidPlan) => {
    if (!info) return
    const name = PAID_PLAN_LABELS[plan]
    const resume = isLive(info) && info.plan === plan && info.cancelAtPeriodEnd
    if (isLive(info) && isPaidPlan(info.plan) && info.plan !== plan) {
      const upgrade = PAID_PLANS.indexOf(plan) > PAID_PLANS.indexOf(info.plan)
      const question =
        info.status === 'trialing'
          ? `Passi a ${name} da subito. La prova continua: paghi solo alla fine.`
          : upgrade
            ? `Passi a ${name} da subito: paghi ora ${PLAN_PRICES_EUR[plan]} € + IVA, meno la parte non usata del piano attuale, e il mese riparte da oggi.`
            : `Passi a ${name} da subito: dal prossimo rinnovo paghi ${PLAN_PRICES_EUR[plan]} €/mese + IVA.`
      if (!window.confirm(question)) return
    }
    setBusy(plan)
    setError(null)
    setNotice(null)
    const res = await appFetch('/api/app/billing/checkout', { method: 'POST', body: JSON.stringify({ plan }) }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (!res?.ok) {
      // Abbonamento gia' in corso (altra scheda, altro spazio): si mostra lo stato vero.
      if (res?.status === 409) await load()
      setBusy(null)
      setError(data.error || 'Connessione non riuscita, riprova.')
      return
    }
    // Abbonamento nuovo, o piano piu' alto da confermare con la banca: pagina di Stripe.
    if (typeof data.url === 'string') {
      window.location.href = data.url
      return
    }
    await load()
    refreshUsage()
    setBusy(null)
    setNotice(resume ? `Fatto: il piano ${name} si rinnova di nuovo.` : data.changed ? `Fatto: ora hai il piano ${name}.` : `Hai già il piano ${name}.`)
  }

  const openPortal = async () => {
    setBusy('portal')
    setError(null)
    const res = await appFetch('/api/app/billing/portal', { method: 'POST' }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (res?.ok && typeof data.url === 'string') {
      window.location.href = data.url
      return
    }
    setBusy(null)
    setError(data.error || 'Connessione non riuscita, riprova.')
  }

  if (!info || notConfigured) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-extrabold">Piano</h1>
        {loadError && !info ? (
          <div className="space-y-3">
            <p className="text-[var(--text-secondary)]">{loadError}</p>
            <button onClick={() => load()} className="rounded-full bg-[var(--accent-blue)] px-5 py-2 text-sm font-semibold text-white">
              Riprova
            </button>
          </div>
        ) : (
          <Loader2 className="h-5 w-5 animate-spin text-[var(--text-secondary)]" />
        )}
      </div>
    )
  }

  const showPortal = info.configured && info.hasCustomer && info.canManage && !info.facevoice

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold">Piano</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">L’AI inclusa per il tuo spazio di lavoro. Cambi o disdici quando vuoi.</p>
      </div>

      {paid === 'waiting' && (
        <div className="flex items-center gap-3 rounded-2xl border border-[var(--accent-blue)]/40 bg-[var(--accent-blue)]/10 p-4 text-sm">
          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[var(--accent-blue)]" />
          <p>Pagamento ricevuto: sto attivando il piano…</p>
        </div>
      )}
      {paid === 'done' && (
        <div className="flex items-center gap-3 rounded-2xl border border-[#34C759]/40 bg-[#34C759]/10 p-4 text-sm">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-[#34C759]" />
          <p>
            {info.status === 'trialing' ? `Fatto: la prova gratuita di ${TRIAL_DAYS} giorni è partita.` : `Fatto: il piano ${info.planLabel} è attivo.`} L’AI è pronta.
          </p>
        </div>
      )}
      {paid === 'slow' && (
        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-4 text-sm text-[var(--text-secondary)]">
          Il pagamento è andato a buon fine: il piano si attiva tra pochi istanti. Ricarica la pagina tra un minuto.
        </div>
      )}

      <div className="flex flex-col gap-4 rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-widest text-[var(--text-secondary)]">PIANO ATTUALE</p>
          <p className="mt-1 text-xl font-extrabold">{info.planLabel}</p>
          {statusLine(info) && <p className="mt-1 text-sm text-[var(--text-secondary)]">{statusLine(info)}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <UsageTokens />
          <div className="text-sm">
            <p className="font-semibold">{usageLabel(usage?.shown ?? 'none', usage?.blocked ?? false, usage?.reason)}</p>
            {usage && !usage.blocked && usage.daysLeft > 0 && (
              <p className="text-[var(--text-secondary)]">Si azzera tra {usage.daysLeft === 1 ? '1 giorno' : `${usage.daysLeft} giorni`}</p>
            )}
          </div>
        </div>
      </div>

      {showPortal && (
        <button
          onClick={openPortal}
          disabled={busy !== null}
          className="flex items-center gap-2 rounded-full border border-[var(--border-color)] px-5 py-2 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--background-secondary)] disabled:opacity-50"
        >
          {busy === 'portal' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />} Gestisci abbonamento e fatture
        </button>
      )}

      {!info.canManage && !info.facevoice && !info.coveredBy && (
        <p className="text-sm text-[var(--text-secondary)]">Solo il titolare o un amministratore dello spazio può scegliere il piano.</p>
      )}
      {error && <p className="text-sm text-[#ff6b6b]">{error}</p>}
      {notice && <p className="text-sm text-[#34C759]">{notice}</p>}

      <div className="grid gap-6 pt-3 md:grid-cols-3 md:gap-4">
        {PAID_PLANS.map((plan) => {
          const card = CARDS[plan]
          const highlighted = plan === 'pro'
          const button = buttonFor(info, plan)
          return (
            <div
              key={plan}
              className={`relative flex flex-col rounded-2xl border bg-[var(--background-secondary)] p-5 ${
                highlighted
                  ? 'border-[var(--accent-blue)] shadow-[0_0_0_1px_var(--accent-blue),0_16px_48px_-16px_rgba(42,101,254,0.6)] md:-my-3 md:py-8'
                  : 'border-[var(--border-color)]'
              }`}
            >
              {card.badge && (
                <span
                  className={`absolute -top-3 left-5 rounded-full px-3 py-1 text-xs font-bold ${
                    highlighted ? 'bg-[var(--accent-blue)] text-white' : 'border border-[var(--border-color)] bg-[var(--background)] text-[var(--text-primary)]'
                  }`}
                >
                  {card.badge}
                </span>
              )}
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xl font-extrabold">{PAID_PLAN_LABELS[plan]}</h2>
                {button.current && <span className="rounded-full bg-[#34C759] px-2 py-0.5 text-xs font-semibold text-white">Attivo</span>}
              </div>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">{card.tagline}</p>
              <p className="mt-4">
                <span className="text-4xl font-extrabold">{PLAN_PRICES_EUR[plan]} €</span>
                <span className="text-sm text-[var(--text-secondary)]">/mese + IVA</span>
              </p>
              {!info.facevoice && (
                <button
                  onClick={() => choose(plan)}
                  disabled={button.disabled || busy !== null}
                  className={`mt-5 flex w-full items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-bold disabled:opacity-50 ${
                    highlighted || (!isLive(info) && info.trialAvailable)
                      ? 'bg-[var(--accent-blue)] text-white'
                      : 'border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--background)]'
                  }`}
                >
                  {busy === plan && <Loader2 className="h-4 w-4 animate-spin" />} {button.label}
                </button>
              )}
              <ul className="mt-5 space-y-2 text-sm">
                {FEATURES.map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-blue)]" /> {feature}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>

      <div className="space-y-1 text-xs text-[var(--text-secondary)]">
        <p>Prezzi IVA esclusa: si aggiunge l’IVA al {VAT_PERCENT}%.</p>
        {info.trialAvailable && (
          <p>Prova gratuita di {TRIAL_DAYS} giorni: serve la carta, ma paghi solo alla fine. Se disdici prima, non paghi niente.</p>
        )}
      </div>
    </div>
  )
}

export default function PlanPageRoute() {
  return (
    <Suspense fallback={<Loader2 className="h-5 w-5 animate-spin text-[var(--text-secondary)]" />}>
      <PlanPage />
    </Suspense>
  )
}
