import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'
import { FACEVOICE_WORKSPACE_ID } from '@/lib/workspace-db'
import { invalidateWorkspacePlan } from '@/lib/usage-limits'
import { isStripeError } from '@/lib/stripe'
import {
  CheckoutConflictError,
  appUrl,
  billingConfigured,
  changePlan,
  coverageFromOtherSpace,
  createCheckout,
  fetchSubscription,
  liveSubscriptionOfCustomer,
  markSubscriptionGone,
  readBillingState,
  syncSubscription,
  trialAvailableFor,
} from '@/lib/billing'
import { PAID_PLAN_LABELS, isPaidPlan } from '@/lib/billing-shared'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Scelta del piano (titolare o amministratore dello spazio). Senza abbonamento in
// corso: pagina di pagamento di Stripe ({ url }), con 3 giorni gratis se spettano.
// Con un abbonamento attivo o in prova: cambio di piano subito ({ ok, plan }); piano
// piu' alto che aspetta il pagamento (conferma della banca): fattura di Stripe ({ url, pending }).
// Mai un secondo abbonamento: ne' sullo stesso spazio ne' se un altro spazio dello
// stesso titolare ha gia' un piano (il piano dell'AI e' per persona).

const ALREADY_PAID = 'Hai già un abbonamento in corso: ricarica la pagina.'

export async function POST(req: NextRequest) {
  const access = await requireWorkspace(req, 'admin')
  if (access instanceof NextResponse) return access
  if (!billingConfigured()) return NextResponse.json({ error: 'Il pagamento online arriva presto: scrivici su WhatsApp.' }, { status: 503 })
  const body = await req.json().catch(() => ({}))
  const plan = body?.plan
  if (!isPaidPlan(plan)) return NextResponse.json({ error: 'Piano non valido' }, { status: 400 })
  const ws = access.workspace
  if (ws.id === FACEVOICE_WORKSPACE_ID) return NextResponse.json({ error: 'Lo spazio Facevoice non ha bisogno di un piano.' }, { status: 400 })

  try {
    let state = await readBillingState(ws.id)
    // Prima di decidere, lo stato vero da Stripe (un evento potrebbe essere in ritardo).
    const sub = state.subscriptionId ? await fetchSubscription(state.subscriptionId) : null
    if (sub) {
      const synced = await syncSubscription(sub, ws.id)
      if (synced?.applied) state = synced.state
      invalidateWorkspacePlan(ws.id)
    } else if (state.subscriptionId) {
      // Non c'e' piu' su Stripe: lo stato si chiude.
      state = (await markSubscriptionGone(ws.id, state.subscriptionId)).state
      invalidateWorkspacePlan(ws.id)
    }

    if (sub && (sub.status === 'active' || sub.status === 'trialing')) {
      // Piano piu' alto ancora da pagare (conferma della banca): prima si chiude quello.
      if (sub.pending_update) {
        return NextResponse.json({ error: 'C’è un pagamento da confermare: completalo da «Gestisci abbonamento e fatture».' }, { status: 409 })
      }
      const change = await changePlan(ws.id, sub, plan)
      if (change) {
        await syncSubscription(change.subscription, ws.id)
        invalidateWorkspacePlan(ws.id)
      }
      if (change?.pendingUrl) return NextResponse.json({ url: change.pendingUrl, pending: true })
      if (change?.subscription.pending_update) {
        return NextResponse.json({ error: 'Pagamento non riuscito: controlla la carta da «Gestisci abbonamento e fatture».' }, { status: 400 })
      }
      return NextResponse.json({ ok: true, plan, changed: Boolean(change) })
    }
    if (sub && (sub.status === 'past_due' || sub.status === 'unpaid' || sub.status === 'incomplete' || sub.status === 'paused')) {
      return NextResponse.json({ error: 'C’è un pagamento in sospeso: sistemalo da «Gestisci abbonamento e fatture».' }, { status: 409 })
    }

    // Abbonamento gia' pagato (altra scheda) ma l'evento di Stripe non e' ancora arrivato.
    const paid = await liveSubscriptionOfCustomer(ws.id, state.customerId)
    if (paid) {
      await syncSubscription(paid, ws.id)
      invalidateWorkspacePlan(ws.id)
      return NextResponse.json({ error: ALREADY_PAID }, { status: 409 })
    }
    // Il piano di un altro spazio dello stesso titolare vale gia' anche qui.
    const coverage = await coverageFromOtherSpace(ws.id)
    if (coverage) {
      return NextResponse.json(
        { error: `Il piano ${PAID_PLAN_LABELS[coverage.plan]} di «${coverage.workspaceName}» vale anche qui: per cambiarlo apri quello spazio.` },
        { status: 409 }
      )
    }

    const trial = await trialAvailableFor(ws.id, state)
    const url = await createCheckout({ workspaceId: ws.id, workspaceName: ws.name, email: access.email, plan, trial, appUrl: appUrl(req) })
    return NextResponse.json({ url, trial })
  } catch (error) {
    if (error instanceof CheckoutConflictError) return NextResponse.json({ error: ALREADY_PAID }, { status: 409 })
    console.error(`piano ${ws.id.slice(0, 8)} -> ${plan}:`, error instanceof Error ? error.message : error)
    if (isStripeError(error) && (error.type === 'card_error' || error.status === 402)) {
      return NextResponse.json({ error: 'Pagamento non riuscito: controlla la carta da «Gestisci abbonamento e fatture».' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Pagamento non disponibile ora, riprova tra poco.' }, { status: 502 })
  }
}
