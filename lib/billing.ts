import { createHash } from 'crypto'
import type { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { readSetting, updateSetting } from '@/lib/settings-store'
import { FACEVOICE_WORKSPACE_ID } from '@/lib/workspace-db'
import { workspaceOwnerId } from '@/lib/workspace'
import { PAID_PLANS, PAID_PLAN_LABELS, PLAN_PRICES_EUR, TRIAL_DAYS, VAT_PERCENT, isPaidPlan, type PaidPlan } from '@/lib/billing-shared'
import {
  encodeForm,
  isStripeError,
  stripeId,
  stripeRequest,
  stripeLiveMode,
  type StripeCheckoutSession,
  type StripeCustomer,
  type StripeInvoice,
  type StripeList,
  type StripePrice,
  type StripeSubscription,
  type StripeTaxRate,
} from '@/lib/stripe'

export { stripeConfigured as billingConfigured } from '@/lib/stripe'

// Abbonamenti dei clienti: un abbonamento Stripe per spazio di lavoro. Lo stato
// sta in app_settings (chiave billing:<workspaceId>) ed e' sempre preso da Stripe
// (gli eventi possono arrivare in disordine: si rilegge l'abbonamento prima di
// scrivere). workspaces.plan segue lo stato: start/pro/business, 'trial' durante
// la prova, 'free' senza abbonamento in corso. Lo spazio Facevoice non ha mai bisogno di un piano.

// --- Stato per spazio -------------------------------------------------------------------

/** Pagina di pagamento di Stripe aperta per lo spazio (una sola alla volta). */
export type CheckoutRef = { id: string; url: string; plan: PaidPlan; trial: boolean; expiresAt: string }

export type BillingState = {
  customerId: string | null
  subscriptionId: string | null
  status: string | null
  plan: PaidPlan | null
  priceId: string | null
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  trialEnd: string | null
  cancelAtPeriodEnd: boolean
  updatedAt: string | null
  /** Modo di Stripe in cui e' stato scritto (true reale, false prova): con l'altra chiave non vale. */
  livemode: boolean | null
  checkout: CheckoutRef | null
}

export const EMPTY_BILLING: BillingState = {
  customerId: null,
  subscriptionId: null,
  status: null,
  plan: null,
  priceId: null,
  currentPeriodStart: null,
  currentPeriodEnd: null,
  trialEnd: null,
  cancelAtPeriodEnd: false,
  updatedAt: null,
  livemode: null,
  checkout: null,
}

const BILLING_PREFIX = 'billing:'
export const billingKey = (workspaceId: string) => `${BILLING_PREFIX}${workspaceId}`

const text = (value: unknown) => (typeof value === 'string' && value ? value : null)
const isoText = (value: unknown) => {
  const s = text(value)
  return s && !Number.isNaN(new Date(s).getTime()) ? s : null
}

function parseCheckout(raw: unknown): CheckoutRef | null {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const id = text(c.id)
  const url = text(c.url)
  const expiresAt = isoText(c.expiresAt)
  return id && url && expiresAt && isPaidPlan(c.plan) ? { id, url, plan: c.plan, trial: c.trial === true, expiresAt } : null
}

export function parseBillingState(raw: unknown): BillingState {
  let value = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      value = null
    }
  }
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  return {
    customerId: text(v.customerId),
    subscriptionId: text(v.subscriptionId),
    status: text(v.status),
    plan: isPaidPlan(v.plan) ? v.plan : null,
    priceId: text(v.priceId),
    currentPeriodStart: isoText(v.currentPeriodStart),
    currentPeriodEnd: isoText(v.currentPeriodEnd),
    trialEnd: isoText(v.trialEnd),
    cancelAtPeriodEnd: v.cancelAtPeriodEnd === true,
    updatedAt: isoText(v.updatedAt),
    livemode: typeof v.livemode === 'boolean' ? v.livemode : null,
    checkout: parseCheckout(v.checkout),
  }
}

/**
 * Stato valido con la chiave di adesso: quello scritto nell'altro modo (chiavi di
 * prova contro chiavi reali, es. un'anteprima con le chiavi di prova sullo stesso
 * database) non conta, come se non ci fosse.
 */
function parseCurrentBillingState(raw: unknown): BillingState {
  const state = parseBillingState(raw)
  const mode = stripeLiveMode()
  return mode !== null && state.livemode !== null && state.livemode !== mode ? EMPTY_BILLING : state
}

export async function readBillingState(workspaceId: string): Promise<BillingState> {
  return parseCurrentBillingState((await readSetting(billingKey(workspaceId))).value)
}

/** Stato di piu' spazi in una lettura (quelli senza riga non ci sono nella mappa). */
export async function readBillingStates(workspaceIds: string[]): Promise<Map<string, BillingState>> {
  const map = new Map<string, BillingState>()
  if (!workspaceIds.length) return map
  const { data, error } = await supabaseAdmin.from('app_settings').select('key, value').in('key', workspaceIds.map(billingKey))
  if (error) throw new Error(`abbonamenti non letti: ${error.message}`)
  for (const row of data || []) map.set(String(row.key).slice(BILLING_PREFIX.length), parseCurrentBillingState(row.value))
  return map
}

/** Tutti gli spazi con uno stato di abbonamento (per il pannello di Facevoice). */
export async function allBillingStates(): Promise<Map<string, BillingState>> {
  const map = new Map<string, BillingState>()
  const { data, error } = await supabaseAdmin.from('app_settings').select('key, value').like('key', `${BILLING_PREFIX}%`).limit(10_000)
  if (error) throw new Error(`abbonamenti non letti: ${error.message}`)
  for (const row of data || []) map.set(String(row.key).slice(BILLING_PREFIX.length), parseCurrentBillingState(row.value))
  return map
}

const saveBillingState = (workspaceId: string, fn: (current: BillingState) => BillingState | false) =>
  updateSetting<BillingState>(billingKey(workspaceId), parseCurrentBillingState, fn)

// --- Cosa vale l'abbonamento --------------------------------------------------------------

/** Abbonamento in corso: attivo, in prova, o con un pagamento in ritardo (tolleranza). */
export const isLiveStatus = (status: string | null | undefined) => status === 'active' || status === 'trialing' || status === 'past_due'

/**
 * Tolleranza dopo la fine del periodo: il rinnovo arriva da Stripe subito; se
 * non arriva (webhook fermo o sbagliato) oltre questo tempo l'abbonamento non vale piu'.
 */
export const RENEWAL_GRACE_MS = 2 * 24 * 60 * 60_000

const timeOf = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : NaN)

/** Periodo finito e rinnovo non ancora arrivato: lo stato va riletto da Stripe. */
export const renewalOverdue = (state: BillingState | null | undefined, now = Date.now()) =>
  Boolean(state?.subscriptionId && isLiveStatus(state.status) && timeOf(state.currentPeriodEnd) < now)

/** Abbonamento in corso secondo lo stato e le date (oltre la tolleranza dopo la fine del periodo, no). */
export function isLiveState(state: BillingState | null | undefined, now = Date.now()): boolean {
  if (!state?.subscriptionId || !isLiveStatus(state.status)) return false
  return !(timeOf(state.currentPeriodEnd) + RENEWAL_GRACE_MS < now)
}

/**
 * Pagamento in ritardo sul primo periodo dopo la prova (il primo addebito non e'
 * andato): non e' mai stato pagato niente, quindi nessuna tolleranza.
 */
function unpaidAfterTrial(state: BillingState): boolean {
  return state.status === 'past_due' && Boolean(state.trialEnd) && timeOf(state.currentPeriodStart) <= timeOf(state.trialEnd) + 60_000
}

/**
 * Piano dell'AI dato dall'abbonamento: 'trial' durante la prova, il piano se attivo
 * o in ritardo dopo almeno un periodo pagato, altrimenti null.
 */
export function subscriptionAIPlan(state: BillingState | null | undefined, now = Date.now()): 'trial' | PaidPlan | null {
  if (!state || !isLiveState(state, now) || unpaidAfterTrial(state)) return null
  return state.status === 'trialing' ? 'trial' : state.plan
}

/** Periodo dell'abbonamento in corso (quello di Stripe), se c'e'. */
export function subscriptionPeriod(state: BillingState | null | undefined): { start: Date; end: Date } | null {
  if (!state || !isLiveState(state) || !state.currentPeriodStart || !state.currentPeriodEnd) return null
  const start = new Date(state.currentPeriodStart)
  const end = new Date(state.currentPeriodEnd)
  return end.getTime() > start.getTime() ? { start, end } : null
}

/** Valore di workspaces.plan per questo stato. */
export const workspacePlanFor = (state: BillingState) => subscriptionAIPlan(state) ?? 'free'

// --- Prezzi e IVA (creati da soli al primo uso) -------------------------------------------

const LOOKUP_KEYS: Record<PaidPlan, string> = { start: 'fv_start_monthly', pro: 'fv_pro_monthly', business: 'fv_business_monthly' }
const priceCents = (plan: PaidPlan) => Math.round(PLAN_PRICES_EUR[plan] * 100)

export type PlanPrice = { plan: PaidPlan; id: string; unitAmount: number | null }

const CATALOG_TTL_MS = 60 * 60_000
let pricesCache: { at: number; prices: Record<PaidPlan, PlanPrice> } | null = null
let pricesLoading: Promise<Record<PaidPlan, PlanPrice>> | null = null
/** Prezzi visti da questa istanza -> piano (anche se un giorno cambia il lookup_key). */
const planByPriceId = new Map<string, PaidPlan>()

/** Chiave del giorno: due istanze che creano la stessa cosa insieme non fanno doppioni. */
const today = () => new Date().toISOString().slice(0, 10)

/** Piano di un prezzo: dal lookup_key, poi dai metadati, poi dai prezzi gia' visti. */
export function planFromPrice(price: Partial<StripePrice> | null | undefined): PaidPlan | null {
  if (!price) return null
  const byKey = PAID_PLANS.find((plan) => LOOKUP_KEYS[plan] === price.lookup_key)
  if (byKey) return byKey
  const meta = price.metadata?.fv_plan
  if (isPaidPlan(meta)) return meta
  return (price.id && planByPriceId.get(price.id)) || null
}

async function loadPrices(): Promise<Record<PaidPlan, PlanPrice>> {
  const list = await stripeRequest<StripeList<StripePrice>>('GET', '/prices', {
    lookup_keys: PAID_PLANS.map((plan) => LOOKUP_KEYS[plan]),
    active: true,
    limit: 10,
  })
  const prices = {} as Record<PaidPlan, PlanPrice>
  for (const plan of PAID_PLANS) {
    let price = list.data.find((p) => p.lookup_key === LOOKUP_KEYS[plan])
    if (!price) {
      price = await stripeRequest<StripePrice>(
        'POST',
        '/prices',
        {
          currency: 'eur',
          unit_amount: priceCents(plan),
          recurring: { interval: 'month' },
          tax_behavior: 'exclusive',
          lookup_key: LOOKUP_KEYS[plan],
          transfer_lookup_key: true,
          product_data: { name: `Facevoice AI ${PAID_PLAN_LABELS[plan]}`, metadata: { fv_plan: plan } },
          metadata: { fv_plan: plan },
        },
        { idempotencyKey: `fv-price-${LOOKUP_KEYS[plan]}-${priceCents(plan)}-${today()}` }
      )
      console.log(`stripe: creato il prezzo ${LOOKUP_KEYS[plan]} (${price.id})`)
    }
    planByPriceId.set(price.id, plan)
    prices[plan] = { plan, id: price.id, unitAmount: price.unit_amount }
  }
  return prices
}

/** I tre prezzi mensili (cercati per lookup_key, creati se mancano), tenuti in memoria. */
export async function ensurePrices(): Promise<Record<PaidPlan, PlanPrice>> {
  if (pricesCache && Date.now() - pricesCache.at < CATALOG_TTL_MS) return pricesCache.prices
  pricesLoading ??= loadPrices()
    .then((prices) => {
      pricesCache = { at: Date.now(), prices }
      return prices
    })
    .finally(() => {
      pricesLoading = null
    })
  return pricesLoading
}

let taxRateCache: { at: number; id: string } | null = null

/** Aliquota IVA 22% aggiunta al prezzo (trovata dai metadati fv_key=iva22, creata se manca). */
export async function ensureTaxRate(): Promise<string> {
  if (taxRateCache && Date.now() - taxRateCache.at < CATALOG_TTL_MS) return taxRateCache.id
  let startingAfter: string | undefined
  for (let page = 0; page < 10; page++) {
    const list = await stripeRequest<StripeList<StripeTaxRate>>('GET', '/tax_rates', { active: true, limit: 100, starting_after: startingAfter })
    const found = list.data.find((rate) => rate.metadata?.fv_key === 'iva22')
    if (found) {
      taxRateCache = { at: Date.now(), id: found.id }
      return found.id
    }
    if (!list.has_more || !list.data.length) break
    startingAfter = list.data[list.data.length - 1].id
  }
  const created = await stripeRequest<StripeTaxRate>(
    'POST',
    '/tax_rates',
    {
      display_name: 'IVA',
      description: `IVA ${VAT_PERCENT}%`,
      percentage: VAT_PERCENT,
      inclusive: false,
      country: 'IT',
      tax_type: 'vat',
      metadata: { fv_key: 'iva22' },
    },
    { idempotencyKey: `fv-taxrate-iva22-${today()}` }
  )
  console.log(`stripe: creata l'aliquota IVA (${created.id})`)
  taxRateCache = { at: Date.now(), id: created.id }
  return created.id
}

// --- Cliente --------------------------------------------------------------------------------

/** Cliente Stripe dello spazio: quello salvato se esiste ancora, altrimenti uno nuovo. */
export async function getOrCreateCustomer(workspaceId: string, info: { email: string; name: string }): Promise<string> {
  const state = await readBillingState(workspaceId)
  let sameRequest = true
  if (state.customerId) {
    try {
      const customer = await stripeRequest<StripeCustomer>('GET', `/customers/${encodeURIComponent(state.customerId)}`)
      if (!customer.deleted) return customer.id
    } catch (error) {
      if (!isStripeError(error) || error.status !== 404) throw error
    }
    // Cliente cancellato su Stripe: se ne crea uno nuovo (chiave diversa da quella di prima).
    sameRequest = false
  }
  const params = { email: info.email, name: info.name, metadata: { workspace_id: workspaceId }, preferred_locales: ['it'] }
  const fingerprint = createHash('sha256').update(encodeForm(params)).digest('hex').slice(0, 16)
  const customer = await stripeRequest<StripeCustomer>('POST', '/customers', params, {
    idempotencyKey: sameRequest ? `fv-customer-${workspaceId}-${fingerprint}` : undefined,
  })
  await saveBillingState(workspaceId, (current) => ({
    ...current,
    customerId: customer.id,
    livemode: current.livemode ?? stripeLiveMode(),
    updatedAt: new Date().toISOString(),
  }))
  return customer.id
}

async function workspaceOfCustomer(customerId: string | null): Promise<string | null> {
  if (!customerId) return null
  try {
    const customer = await stripeRequest<StripeCustomer>('GET', `/customers/${encodeURIComponent(customerId)}`)
    return customer.metadata?.workspace_id || null
  } catch {
    return null
  }
}

// --- Prova gratuita ---------------------------------------------------------------------------

/** Con le chiavi di prova la prova si segna a parte: i test non tolgono la prova vera. */
const trialKey = (userId: string) => (stripeLiveMode() === false ? `billing_trial_used:test:${userId}` : `billing_trial_used:${userId}`)

/** Prova usata dal titolare (e con quale abbonamento), oppure null. */
async function trialRecord(userId: string): Promise<{ subscriptionId: string | null } | null> {
  const { value } = await readSetting(trialKey(userId))
  if (value === null) return null
  let parsed: unknown = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      parsed = null
    }
  }
  const v = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
  return { subscriptionId: text(v.subscriptionId) }
}

export async function trialUsedBy(userId: string): Promise<boolean> {
  return (await trialRecord(userId)) !== null
}

/** La prova vale una volta per persona (il titolare dello spazio). */
export async function markTrialUsed(userId: string, info: Record<string, string>): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await supabaseAdmin
    .from('app_settings')
    .upsert({ key: trialKey(userId), value: JSON.stringify({ ...info, at: now }), updated_at: now }, { onConflict: 'key', ignoreDuplicates: true })
  if (error) throw new Error(`prova non segnata: ${error.message}`)
}

/** Prova ancora possibile: il titolare non l'ha mai usata e lo spazio non ha mai avuto un abbonamento. */
export async function trialAvailableFor(workspaceId: string, state?: BillingState): Promise<boolean> {
  if (workspaceId === FACEVOICE_WORKSPACE_ID) return false
  const current = state ?? (await readBillingState(workspaceId))
  if (current.subscriptionId) return false
  const ownerId = await workspaceOwnerId(workspaceId)
  return ownerId ? !(await trialUsedBy(ownerId)) : false
}

// --- Abbonamento da Stripe -> stato ---------------------------------------------------------

const toIso = (seconds: number | null | undefined) => (typeof seconds === 'number' && seconds > 0 ? new Date(seconds * 1000).toISOString() : null)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const workspaceIdOrNull = (value: unknown) => (typeof value === 'string' && UUID_RE.test(value.trim()) ? value.trim().toLowerCase() : null)

export function stateFromSubscription(sub: StripeSubscription, now = new Date()): BillingState {
  const item = sub.items?.data?.[0]
  let plan = planFromPrice(item?.price) ?? (isPaidPlan(sub.metadata?.plan) ? sub.metadata.plan : null)
  if (!plan) {
    // Prezzo non nostro (es. creato a mano): almeno Start, un cliente che paga non resta senza AI.
    console.warn(`stripe: piano non riconosciuto per l'abbonamento ${sub.id} (prezzo ${item?.price?.id}), vale Start`)
    plan = 'start'
  }
  return {
    customerId: stripeId(sub.customer),
    subscriptionId: sub.id,
    status: sub.status,
    plan,
    priceId: item?.price?.id ?? null,
    // Con le versioni dell'API dal 2025 il periodo sta sulla voce dell'abbonamento.
    currentPeriodStart: toIso(sub.current_period_start ?? item?.current_period_start),
    currentPeriodEnd: toIso(sub.current_period_end ?? item?.current_period_end),
    trialEnd: toIso(sub.trial_end),
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end || sub.cancel_at),
    updatedAt: now.toISOString(),
    livemode: typeof sub.livemode === 'boolean' ? sub.livemode : stripeLiveMode(),
    checkout: null,
  }
}

/**
 * Abbonamento in prova con la prova gia' usata dal titolare per un altro
 * abbonamento (pagine di pagamento aperte insieme, anche per spazi diversi):
 * la prova finisce subito e parte il pagamento.
 */
async function endRepeatedTrial(sub: StripeSubscription, workspaceId: string): Promise<StripeSubscription> {
  const ownerId = await workspaceOwnerId(workspaceId)
  const used = ownerId ? await trialRecord(ownerId) : null
  if (!used || used.subscriptionId === sub.id) return sub
  console.warn(`stripe: prova gia' usata dal titolare (${used.subscriptionId ?? '?'}), finisce subito per ${sub.id}`)
  return stripeRequest<StripeSubscription>(
    'POST',
    `/subscriptions/${encodeURIComponent(sub.id)}`,
    { trial_end: 'now' },
    { idempotencyKey: `fv-trial-end-${sub.id}` }
  )
}

/** Chiude un abbonamento doppio dello stesso spazio e, se e' gia' stato pagato, lo rimborsa. */
async function cancelDuplicate(sub: StripeSubscription, workspaceId: string): Promise<void> {
  console.warn(`stripe: spazio ${workspaceId.slice(0, 8)} con due abbonamenti in corso, chiudo il piu' recente (${sub.id})`)
  await stripeRequest('DELETE', `/subscriptions/${encodeURIComponent(sub.id)}`, { invoice_now: false, prorate: false })
  const invoiceId = stripeId(sub.latest_invoice)
  if (!invoiceId) return
  try {
    const invoice = await stripeRequest<StripeInvoice>('GET', `/invoices/${encodeURIComponent(invoiceId)}`)
    const paymentIntent = stripeId(invoice.payment_intent)
    const charge = stripeId(invoice.charge)
    if (invoice.amount_paid > 0 && (paymentIntent || charge)) {
      await stripeRequest(
        'POST',
        '/refunds',
        { ...(paymentIntent ? { payment_intent: paymentIntent } : { charge }), metadata: { fv_reason: 'duplicate_subscription', subscription_id: sub.id } },
        { idempotencyKey: `fv-refund-${invoice.id}` }
      )
      console.warn(`stripe: rimborsata la fattura ${invoice.id} dell'abbonamento doppio ${sub.id}`)
    }
  } catch (error) {
    console.error(`stripe: rimborso dell'abbonamento doppio ${sub.id} non riuscito, da fare a mano:`, error instanceof Error ? error.message : error)
  }
}

export type SyncResult = { workspaceId: string; state: BillingState; applied: boolean }

/**
 * Scrive lo stato di un abbonamento appena letto da Stripe: billing:<spazio> e
 * workspaces.plan, e segna la prova come usata dal titolare. Un abbonamento
 * finito non sovrascrive un altro abbonamento ancora in corso dello stesso spazio
 * (eventi vecchi che arrivano dopo). Due abbonamenti in corso sullo stesso spazio:
 * il piu' recente si chiude (e si rimborsa). Una seconda prova dello stesso
 * titolare finisce subito.
 */
export async function syncSubscription(input: StripeSubscription, hintWorkspaceId?: string | null): Promise<SyncResult | null> {
  let sub = input
  const workspaceId =
    workspaceIdOrNull(sub.metadata?.workspace_id) ?? workspaceIdOrNull(hintWorkspaceId) ?? workspaceIdOrNull(await workspaceOfCustomer(stripeId(sub.customer)))
  if (!workspaceId) {
    console.warn(`stripe: abbonamento ${sub.id} senza spazio di lavoro, ignorato`)
    return null
  }
  if (sub.status === 'trialing' && workspaceId !== FACEVOICE_WORKSPACE_ID) sub = await endRepeatedTrial(sub, workspaceId)

  const stored = await readBillingState(workspaceId)
  if (stored.subscriptionId && stored.subscriptionId !== sub.id && isLiveStatus(stored.status) && isLiveStatus(sub.status)) {
    const other = await fetchSubscription(stored.subscriptionId)
    if (other && isLiveStatus(other.status)) {
      const newer = other.created > sub.created ? other : sub
      await cancelDuplicate(newer, workspaceId)
      if (newer.id === sub.id) return { workspaceId, state: stored, applied: false }
    }
  }

  const live = isLiveStatus(sub.status)
  const next = stateFromSubscription(sub)
  let applied = true
  const saved = await saveBillingState(workspaceId, (current) => {
    applied = !(current.subscriptionId && current.subscriptionId !== sub.id && isLiveStatus(current.status) && !live)
    // Con un abbonamento in corso la pagina di pagamento aperta non serve piu'.
    return applied ? { ...next, customerId: next.customerId ?? current.customerId, checkout: live ? null : current.checkout } : false
  })
  if (!applied) return { workspaceId, state: saved, applied }

  if (workspaceId !== FACEVOICE_WORKSPACE_ID) {
    const { error } = await supabaseAdmin.from('workspaces').update({ plan: workspacePlanFor(saved) }).eq('id', workspaceId)
    if (error) throw new Error(`piano dello spazio non salvato: ${error.message}`)
  }
  // Ogni abbonamento partito (in prova o pagato) consuma la prova del titolare.
  if (sub.trial_start || (sub.status !== 'incomplete' && sub.status !== 'incomplete_expired')) {
    const ownerId = await workspaceOwnerId(workspaceId)
    if (ownerId) await markTrialUsed(ownerId, { workspaceId, subscriptionId: sub.id })
  }
  return { workspaceId, state: saved, applied }
}

export async function fetchSubscription(subscriptionId: string): Promise<StripeSubscription | null> {
  try {
    return await stripeRequest<StripeSubscription>('GET', `/subscriptions/${encodeURIComponent(subscriptionId)}`)
  } catch (error) {
    if (isStripeError(error) && error.status === 404) return null
    throw error
  }
}

/**
 * L'abbonamento salvato non esiste su Stripe (cancellato, o di un altro account):
 * lo stato si chiude, cosi' non tiene accesa l'AI.
 */
export async function markSubscriptionGone(workspaceId: string, subscriptionId: string): Promise<SyncResult> {
  let applied = false
  const saved = await saveBillingState(workspaceId, (current) => {
    applied = current.subscriptionId === subscriptionId && current.status !== 'canceled'
    return applied ? { ...current, status: 'canceled', cancelAtPeriodEnd: false, updatedAt: new Date().toISOString() } : false
  })
  if (applied) {
    console.warn(`stripe: abbonamento ${subscriptionId} non trovato, chiuso per lo spazio ${workspaceId.slice(0, 8)}`)
    if (workspaceId !== FACEVOICE_WORKSPACE_ID) {
      const { error } = await supabaseAdmin.from('workspaces').update({ plan: workspacePlanFor(saved) }).eq('id', workspaceId)
      if (error) throw new Error(`piano dello spazio non salvato: ${error.message}`)
    }
  }
  return { workspaceId, state: saved, applied }
}

/** Rilegge l'abbonamento da Stripe e lo scrive (webhook e cambio piano). Sparito da Stripe: chiuso. */
export async function refreshSubscription(subscriptionId: string, hintWorkspaceId?: string | null): Promise<SyncResult | null> {
  const sub = await fetchSubscription(subscriptionId)
  if (sub) return syncSubscription(sub, hintWorkspaceId)
  const workspaceId = workspaceIdOrNull(hintWorkspaceId)
  return workspaceId ? markSubscriptionGone(workspaceId, subscriptionId) : null
}

/** Abbonamento in corso del cliente di questo spazio (anche se l'evento di Stripe non e' ancora arrivato): il piu' vecchio. */
export async function liveSubscriptionOfCustomer(workspaceId: string, customerId: string | null): Promise<StripeSubscription | null> {
  if (!customerId) return null
  try {
    const list = await stripeRequest<StripeList<StripeSubscription>>('GET', '/subscriptions', { customer: customerId, status: 'all', limit: 20 })
    return (
      list.data
        .filter((sub) => isLiveStatus(sub.status) && (!sub.metadata?.workspace_id || workspaceIdOrNull(sub.metadata.workspace_id) === workspaceId))
        .sort((a, b) => a.created - b.created)[0] ?? null
    )
  } catch (error) {
    if (isStripeError(error) && (error.status === 404 || error.code === 'resource_missing')) return null
    throw error
  }
}

// --- Abbonamento di un altro spazio dello stesso titolare ------------------------------------

const AI_PLAN_ORDER: ('trial' | PaidPlan)[] = ['trial', ...PAID_PLANS]

export type Coverage = { workspaceId: string; workspaceName: string; plan: PaidPlan; state: BillingState }

/**
 * Il piano dell'AI e' per persona (il titolare): un abbonamento in corso su un
 * altro spazio dello stesso titolare vale anche qui. Il migliore, oppure null.
 */
export async function coverageFromOtherSpace(workspaceId: string): Promise<Coverage | null> {
  const ownerId = await workspaceOwnerId(workspaceId)
  if (!ownerId) return null
  const { data, error } = await supabaseAdmin.from('workspace_members').select('workspace_id').eq('user_id', ownerId).eq('role', 'owner')
  if (error) throw new Error(`spazi del titolare non letti: ${error.message}`)
  const others = [...new Set((data || []).map((row) => row.workspace_id as string))].filter((id) => id !== workspaceId)
  if (!others.length) return null
  const states = await readBillingStates(others)
  let best: { workspaceId: string; plan: 'trial' | PaidPlan; state: BillingState } | null = null
  for (const id of others) {
    const state = states.get(id)
    const plan = subscriptionAIPlan(state)
    if (state && plan && (!best || AI_PLAN_ORDER.indexOf(plan) > AI_PLAN_ORDER.indexOf(best.plan))) best = { workspaceId: id, plan, state }
  }
  if (!best) return null
  const { data: ws } = await supabaseAdmin.from('workspaces').select('name').eq('id', best.workspaceId).maybeSingle()
  return {
    workspaceId: best.workspaceId,
    workspaceName: (ws?.name as string | undefined) || 'un altro spazio',
    plan: best.state.plan ?? 'start',
    state: best.state,
  }
}

/**
 * Subito dopo il pagamento, se l'evento di Stripe non e' ancora arrivato: l'ultimo
 * abbonamento del cliente di questo spazio (prima quelli in corso).
 */
export async function refreshFromCustomer(workspaceId: string, state: BillingState): Promise<SyncResult | null> {
  if (!state.customerId) return null
  const list = await stripeRequest<StripeList<StripeSubscription>>('GET', '/subscriptions', { customer: state.customerId, status: 'all', limit: 5 })
  const mine = list.data
    .filter((sub) => !sub.metadata?.workspace_id || workspaceIdOrNull(sub.metadata.workspace_id) === workspaceId)
    .sort((a, b) => Number(isLiveStatus(b.status)) - Number(isLiveStatus(a.status)) || b.created - a.created)[0]
  return mine ? syncSubscription(mine, workspaceId) : null
}

// --- Pagamento, cambio piano, portale -----------------------------------------------------------

/** Indirizzo pubblico dell'app (per i ritorni da Stripe). */
export function appUrl(req: NextRequest): string {
  const configured = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '').trim()
  return (/^https?:\/\//i.test(configured) ? configured : req.nextUrl.origin).replace(/\/+$/, '')
}

/** Pagamento gia' completato in un'altra pagina: l'abbonamento sta arrivando da Stripe. */
export class CheckoutConflictError extends Error {
  constructor() {
    super('pagamento gia\' completato')
    this.name = 'CheckoutConflictError'
  }
}

/** Una pagina di pagamento resta valida 35 minuti (Stripe: da 30 minuti a 24 ore). */
const CHECKOUT_TTL_MS = 35 * 60_000

const getCheckout = (id: string) =>
  stripeRequest<StripeCheckoutSession>('GET', `/checkout/sessions/${encodeURIComponent(id)}`).catch((error) => {
    if (isStripeError(error) && error.status === 404) return null
    throw error
  })

/** Chiude una pagina di pagamento ancora aperta (completata proprio adesso: CheckoutConflictError). */
async function expireCheckout(id: string): Promise<void> {
  try {
    await stripeRequest('POST', `/checkout/sessions/${encodeURIComponent(id)}/expire`, undefined, { idempotencyKey: `fv-checkout-expire-${id}` })
  } catch (error) {
    const again = await getCheckout(id).catch(() => null)
    if (!again || again.status === 'expired') return
    if (again.status === 'complete') throw new CheckoutConflictError()
    throw error
  }
}

/**
 * Pagina di pagamento di Stripe per un abbonamento nuovo (con la prova se spetta).
 * Una sola pagina aperta per spazio: la stessa se si sceglie di nuovo lo stesso
 * piano, altrimenti quella vecchia si chiude. Gia' pagata: CheckoutConflictError.
 */
export async function createCheckout(options: {
  workspaceId: string
  workspaceName: string
  email: string
  plan: PaidPlan
  trial: boolean
  appUrl: string
}): Promise<string> {
  const { workspaceId, plan, trial } = options
  const open = (await readBillingState(workspaceId)).checkout
  if (open && timeOf(open.expiresAt) > Date.now()) {
    const session = await getCheckout(open.id)
    if (session?.status === 'complete') throw new CheckoutConflictError()
    if (session?.status === 'open') {
      if (open.plan === plan && open.trial === trial && session.url && session.expires_at * 1000 > Date.now() + 5 * 60_000) return session.url
      await expireCheckout(open.id)
    }
  }

  const [prices, taxRate, customer] = await Promise.all([
    ensurePrices(),
    ensureTaxRate(),
    getOrCreateCustomer(workspaceId, { email: options.email, name: options.workspaceName }),
  ])
  const metadata = { workspace_id: workspaceId, plan }
  // Due clic insieme (due schede) per lo stesso piano nello stesso minuto: stessa chiave, stessa pagina.
  const minute = Math.floor(Date.now() / 60_000)
  const expiresAt = new Date(minute * 60_000 + CHECKOUT_TTL_MS + 60_000)
  const session = await stripeRequest<StripeCheckoutSession>(
    'POST',
    '/checkout/sessions',
    {
    mode: 'subscription',
    customer,
    customer_update: { name: 'auto', address: 'auto' },
    client_reference_id: workspaceId,
    metadata,
    line_items: [{ price: prices[plan].id, quantity: 1, tax_rates: [taxRate] }],
    subscription_data: {
      metadata,
      ...(options.trial ? { trial_period_days: TRIAL_DAYS, trial_settings: { end_behavior: { missing_payment_method: 'cancel' } } } : {}),
    },
    // Carta chiesta anche per la prova.
    payment_method_collection: 'always',
    billing_address_collection: 'required',
    tax_id_collection: { enabled: true },
    locale: 'it',
    success_url: `${options.appUrl}/app/piano?ok=1`,
    cancel_url: `${options.appUrl}/app/piano`,
    expires_at: expiresAt,
    },
    { idempotencyKey: `fv-checkout-${workspaceId}-${plan}-${trial ? 'trial' : 'paid'}-${open?.id ?? 'none'}-${minute}` }
  )
  if (!session.url) throw new Error('pagina di pagamento non creata')
  const ref: CheckoutRef = { id: session.id, url: session.url, plan, trial, expiresAt: new Date(session.expires_at * 1000).toISOString() }
  let replaced = null as CheckoutRef | null
  await saveBillingState(workspaceId, (current) => {
    replaced = current.checkout && current.checkout.id !== session.id && current.checkout.id !== open?.id ? current.checkout : null
    return { ...current, checkout: ref, livemode: current.livemode ?? stripeLiveMode(), updatedAt: new Date().toISOString() }
  })
  // Un'altra pagina creata nello stesso momento (altra scheda, altro piano): si chiude, ne resta una.
  if (replaced) await expireCheckout(replaced.id).catch(() => {})
  return session.url
}

/** Chiusura prenotata: alla fine del periodo (cancel_at_period_end) o a una data (cancel_at, es. dalla dashboard). */
const cancelScheduled = (sub: StripeSubscription) => Boolean(sub.cancel_at_period_end || sub.cancel_at)

/** Parametri che tolgono la chiusura prenotata ('' toglie cancel_at). */
const clearCancel = (sub: StripeSubscription) =>
  sub.cancel_at_period_end ? { cancel_at_period_end: false } : sub.cancel_at ? { cancel_at: '' } : {}

export type PlanChange = {
  subscription: StripeSubscription
  /** Piano piu' alto in attesa del pagamento (conferma della banca o carta da cambiare): fattura da pagare su Stripe. */
  pendingUrl: string | null
}

/**
 * Cambio di piano su un abbonamento in corso.
 * - Piano piu' alto (fuori prova): il mese riparte da oggi al prezzo nuovo, meno la
 *   parte non usata del piano di prima, pagato subito; anche il periodo dell'AI
 *   riparte. Il cambio vale solo a pagamento riuscito: se la banca chiede la
 *   conferma (3-D Secure) o la carta non va, resta il piano di prima e c'e' la
 *   fattura da pagare (pendingUrl).
 * - Piano piu' basso, o durante la prova: subito, senza addebiti ne' rimborsi.
 * - Stesso piano con la chiusura prenotata: si riattiva.
 * null = niente da cambiare.
 */
export async function changePlan(workspaceId: string, sub: StripeSubscription, plan: PaidPlan): Promise<PlanChange | null> {
  const item = sub.items?.data?.[0]
  if (!item) throw new Error(`abbonamento ${sub.id} senza voci`)
  const current = planFromPrice(item.price)
  const metadata = { workspace_id: workspaceId, plan }
  const path = `/subscriptions/${encodeURIComponent(sub.id)}`
  if (current === plan) {
    if (!cancelScheduled(sub)) return null
    return { subscription: await stripeRequest<StripeSubscription>('POST', path, { ...clearCancel(sub), metadata }), pendingUrl: null }
  }
  const [prices, taxRate] = await Promise.all([ensurePrices(), ensureTaxRate()])
  const target = prices[plan]
  const upgrade = current
    ? PAID_PLANS.indexOf(plan) > PAID_PLANS.indexOf(current)
    : (target.unitAmount ?? priceCents(plan)) > (item.price.unit_amount ?? 0)
  // Durante la prova non si paga niente: il nuovo prezzo parte alla fine della prova.
  if (!upgrade || sub.status === 'trialing') {
    const subscription = await stripeRequest<StripeSubscription>('POST', path, {
      items: [{ id: item.id, price: target.id, tax_rates: [taxRate] }],
      proration_behavior: 'none',
      ...clearCancel(sub),
      metadata,
    })
    return { subscription, pendingUrl: null }
  }
  // Piano piu' alto: solo i parametri ammessi in un cambio che aspetta il pagamento
  // (le aliquote della voce restano quelle di prima).
  const changed = await stripeRequest<StripeSubscription>('POST', path, {
    items: [{ id: item.id, price: target.id }],
    billing_cycle_anchor: 'now',
    proration_behavior: 'always_invoice',
    payment_behavior: 'pending_if_incomplete',
    expand: ['latest_invoice'],
  })
  if (changed.pending_update) {
    const invoice = changed.latest_invoice && typeof changed.latest_invoice === 'object' ? changed.latest_invoice : null
    return { subscription: changed, pendingUrl: invoice?.hosted_invoice_url || null }
  }
  // Pagato: IVA sulla voce, piano nei metadati e chiusura prenotata tolta (non ammessi nel cambio in attesa).
  try {
    const subscription = await stripeRequest<StripeSubscription>('POST', path, {
      items: [{ id: item.id, tax_rates: [taxRate] }],
      proration_behavior: 'none',
      ...clearCancel(changed),
      metadata,
    })
    return { subscription, pendingUrl: null }
  } catch (error) {
    console.warn(`stripe: piano ${plan} pagato ma dati di ${sub.id} non aggiornati:`, error instanceof Error ? error.message : error)
    return { subscription: changed, pendingUrl: null }
  }
}

/** Portale di Stripe: carta, fatture, disdetta. */
export async function createPortalSession(customerId: string, baseUrl: string): Promise<string> {
  const configuration = (process.env.STRIPE_PORTAL_CONFIGURATION || '').trim() || undefined
  const session = await stripeRequest<{ url: string }>('POST', '/billing_portal/sessions', {
    customer: customerId,
    return_url: `${baseUrl}/app/piano`,
    locale: 'it',
    configuration,
  })
  return session.url
}
