import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'
import { FACEVOICE_WORKSPACE_ID } from '@/lib/workspace-db'
import { asPlan, invalidateWorkspacePlan, PLAN_LABELS } from '@/lib/usage-limits'
import {
  billingConfigured,
  coverageFromOtherSpace,
  isLiveState,
  readBillingState,
  refreshFromCustomer,
  refreshSubscription,
  renewalOverdue,
  trialAvailableFor,
} from '@/lib/billing'
import { PAID_PLANS, PAID_PLAN_LABELS, PLAN_PRICES_EUR, type BillingInfo } from '@/lib/billing-shared'

export const dynamic = 'force-dynamic'

// Pagina Piano: abbonamento dello spazio, rinnovo, prova e prezzi. Mai il budget
// dell'AI in euro. ?sync=1 (subito dopo il pagamento): se l'evento di Stripe non
// e' ancora arrivato, l'abbonamento si legge direttamente da Stripe. Il piano
// dell'AI e' per titolare: senza abbonamento qui, vale quello di un altro suo spazio.

export async function GET(req: NextRequest) {
  const access = await requireWorkspace(req)
  if (access instanceof NextResponse) return access
  const ws = access.workspace
  const configured = billingConfigured()
  const canManage = ws.role !== 'member'
  const base: BillingInfo = {
    configured,
    plan: 'free',
    planLabel: PLAN_LABELS.free,
    status: null,
    renewsAt: null,
    trialEndsAt: null,
    cancelAtPeriodEnd: false,
    trialAvailable: false,
    hasCustomer: false,
    canManage,
    facevoice: ws.id === FACEVOICE_WORKSPACE_ID,
    coveredBy: null,
    prices: PAID_PLANS.map((plan) => ({ plan, label: PAID_PLAN_LABELS[plan], eur: PLAN_PRICES_EUR[plan] })),
  }
  const reply = (info: BillingInfo) => NextResponse.json(info, { headers: { 'Cache-Control': 'no-store' } })

  if (base.facevoice) return reply({ ...base, plan: 'facevoice', planLabel: PLAN_LABELS.facevoice })
  if (!configured) {
    const plan = asPlan(ws.plan)
    return reply({ ...base, plan, planLabel: PLAN_LABELS[plan] })
  }

  try {
    let state = await readBillingState(ws.id)
    // Rinnovo passato ma non ancora arrivato, oppure ritorno dal pagamento: si chiede a Stripe.
    const renewalMissed = renewalOverdue(state)
    const afterCheckout = req.nextUrl.searchParams.get('sync') === '1' && canManage && !isLiveState(state)
    if (renewalMissed || afterCheckout) {
      const synced = await (renewalMissed && state.subscriptionId ? refreshSubscription(state.subscriptionId, ws.id) : refreshFromCustomer(ws.id, state)).catch(
        (error) => {
          console.warn('piano: stato non letto da Stripe:', error instanceof Error ? error.message : error)
          return null
        }
      )
      if (synced?.applied) {
        state = synced.state
        invalidateWorkspacePlan(ws.id)
      }
    }
    const live = isLiveState(state)
    // Nessun abbonamento qui: forse un altro spazio dello stesso titolare ha gia' il piano.
    const coverage = live ? null : await coverageFromOtherSpace(ws.id)
    if (coverage) {
      const other = coverage.state
      return reply({
        ...base,
        plan: coverage.plan,
        planLabel: PAID_PLAN_LABELS[coverage.plan],
        status: other.status,
        renewsAt: other.currentPeriodEnd,
        trialEndsAt: other.status === 'trialing' ? other.trialEnd : null,
        cancelAtPeriodEnd: other.cancelAtPeriodEnd,
        hasCustomer: Boolean(state.customerId && state.subscriptionId),
        coveredBy: coverage.workspaceName,
      })
    }
    const plan = live && state.plan ? state.plan : null
    return reply({
      ...base,
      plan: plan ?? 'none',
      planLabel: plan ? PAID_PLAN_LABELS[plan] : PLAN_LABELS.none,
      status: state.status,
      renewsAt: live ? state.currentPeriodEnd : null,
      trialEndsAt: state.status === 'trialing' ? state.trialEnd : null,
      cancelAtPeriodEnd: live && state.cancelAtPeriodEnd,
      trialAvailable: !live && (await trialAvailableFor(ws.id, state)),
      // Solo con un abbonamento (anche finito) c'e' qualcosa da gestire: carta, fatture, disdetta.
      hasCustomer: Boolean(state.customerId && state.subscriptionId),
    })
  } catch (error) {
    console.error('piano:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Piano non disponibile, riprova tra poco.' }, { status: 500 })
  }
}
