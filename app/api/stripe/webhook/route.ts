import { NextRequest, NextResponse } from 'next/server'
import { stripeConfigured, stripeId, stripeWebhookSecret, verifyStripeSignature, type StripeEvent } from '@/lib/stripe'
import { refreshSubscription } from '@/lib/billing'
import { invalidateWorkspacePlan } from '@/lib/usage-limits'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

// Eventi di Stripe (nessuna sessione utente: vale solo la firma sul corpo grezzo,
// chiave STRIPE_WEBHOOK_SECRET). Gli eventi possono arrivare in disordine o
// ripetuti: ogni volta si rilegge l'abbonamento da Stripe e si scrive lo stato
// vero (billing:<spazio> e workspaces.plan), quindi rifarlo non cambia niente.
// Errore (500) solo se la scrittura non riesce: Stripe riprova da solo.

const HANDLED = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
])

/** Eventi gia' elaborati da questa istanza (per poco: le ripetizioni arrivano presto). */
const processed = new Map<string, number>()
const PROCESSED_TTL_MS = 15 * 60_000

function remember(eventId: string) {
  const now = Date.now()
  processed.set(eventId, now)
  if (processed.size > 500) for (const [id, at] of processed) if (now - at > PROCESSED_TTL_MS) processed.delete(id)
}
const seenRecently = (eventId: string) => {
  const at = processed.get(eventId)
  return at !== undefined && Date.now() - at < PROCESSED_TTL_MS
}

/** Valore annidato di un oggetto dell'evento (senza fidarsi della forma). */
function pick(value: unknown, ...path: (string | number)[]): unknown {
  let current = value
  for (const key of path) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Record<string | number, unknown>)[key]
  }
  return current
}
const textOf = (value: unknown) => (typeof value === 'string' && value ? value : null)

/** Abbonamento a cui si riferisce l'evento e, se c'e', lo spazio di lavoro. */
function subscriptionOfEvent(event: StripeEvent): { subscriptionId: string | null; workspaceHint: string | null } {
  const obj = event.data.object
  switch (event.type) {
    case 'checkout.session.completed':
      if (obj.mode !== 'subscription') return { subscriptionId: null, workspaceHint: null }
      return {
        subscriptionId: stripeId(obj.subscription),
        workspaceHint: textOf(obj.client_reference_id) ?? textOf(pick(obj, 'metadata', 'workspace_id')),
      }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return { subscriptionId: stripeId(obj.id), workspaceHint: textOf(pick(obj, 'metadata', 'workspace_id')) }
    case 'invoice.paid':
    case 'invoice.payment_failed':
      return {
        // Versioni dell'API fino al 2025: invoice.subscription; dopo: invoice.parent.subscription_details.
        subscriptionId:
          stripeId(obj.subscription) ??
          stripeId(pick(obj, 'parent', 'subscription_details', 'subscription')) ??
          stripeId(pick(obj, 'lines', 'data', 0, 'subscription')) ??
          stripeId(pick(obj, 'lines', 'data', 0, 'parent', 'subscription_item_details', 'subscription')),
        workspaceHint:
          textOf(pick(obj, 'subscription_details', 'metadata', 'workspace_id')) ??
          textOf(pick(obj, 'parent', 'subscription_details', 'metadata', 'workspace_id')),
      }
    default:
      return { subscriptionId: null, workspaceHint: null }
  }
}

export async function POST(req: NextRequest) {
  const secret = stripeWebhookSecret()
  if (!secret || !stripeConfigured()) return NextResponse.json({ error: 'Pagamenti non configurati' }, { status: 503 })

  // Corpo grezzo, cosi' com'e' arrivato: la firma e' calcolata su questi byte.
  const payload = Buffer.from(await req.arrayBuffer())
  if (!verifyStripeSignature(payload, req.headers.get('stripe-signature'), secret)) {
    return NextResponse.json({ error: 'Firma non valida' }, { status: 400 })
  }
  let event: StripeEvent
  try {
    event = JSON.parse(payload.toString('utf8')) as StripeEvent
  } catch {
    return NextResponse.json({ error: 'Evento non valido' }, { status: 400 })
  }
  if (!event?.id || typeof event.type !== 'string' || !event.data?.object || typeof event.data.object !== 'object') {
    return NextResponse.json({ error: 'Evento non valido' }, { status: 400 })
  }
  if (!HANDLED.has(event.type) || seenRecently(event.id)) return NextResponse.json({ received: true })

  const { subscriptionId, workspaceHint } = subscriptionOfEvent(event)
  if (!subscriptionId) {
    remember(event.id)
    return NextResponse.json({ received: true })
  }
  try {
    const synced = await refreshSubscription(subscriptionId, workspaceHint)
    if (synced) {
      invalidateWorkspacePlan(synced.workspaceId)
      const { status, plan } = synced.state
      console.log(
        `stripe ${event.type}: spazio ${synced.workspaceId.slice(0, 8)} -> ${status} ${plan ?? ''}${synced.applied ? '' : ` (${subscriptionId} ignorato: c'è un altro abbonamento in corso)`}`
      )
    }
    remember(event.id)
    return NextResponse.json({ received: true })
  } catch (error) {
    console.error(`stripe ${event.type} (${event.id}):`, error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Evento non elaborato' }, { status: 500 })
  }
}
