// Piani in abbonamento: dati usati sia dal server sia dalla pagina Piano.
// Solo prezzi e testi per i clienti: mai il budget dell'AI in euro (quello
// sta solo in lib/usage-limits.ts).

export const PAID_PLANS = ['start', 'pro', 'business'] as const
export type PaidPlan = (typeof PAID_PLANS)[number]

export const isPaidPlan = (value: unknown): value is PaidPlan => (PAID_PLANS as readonly unknown[]).includes(value)

/** Prezzi al mese, IVA esclusa. */
export const PLAN_PRICES_EUR: Record<PaidPlan, number> = { start: 49, pro: 99, business: 199 }

export const PAID_PLAN_LABELS: Record<PaidPlan, string> = { start: 'Start', pro: 'Pro', business: 'Business' }

/** Giorni di prova gratuita (con carta, una sola volta per persona). */
export const TRIAL_DAYS = 3

export const VAT_PERCENT = 22

/** Dove porta "Passa al piano superiore" quando i pagamenti online sono attivi. */
export const PLAN_PAGE_URL = '/app/piano'

/** Risposta di GET /api/app/billing. */
export type BillingInfo = {
  configured: boolean
  /** start | pro | business con un abbonamento in corso, 'none' senza, 'free' se i pagamenti non sono attivi, 'facevoice' per lo spazio Facevoice. */
  plan: string
  planLabel: string
  /** Stato dell'abbonamento su Stripe (active, trialing, past_due, canceled...) o null. */
  status: string | null
  /** Fine del periodo in corso: si rinnova (o si chiude, con cancelAtPeriodEnd) in quel giorno. */
  renewsAt: string | null
  trialEndsAt: string | null
  cancelAtPeriodEnd: boolean
  trialAvailable: boolean
  /** C'e' (o c'e' stato) un abbonamento su Stripe: si possono aprire abbonamento e fatture. */
  hasCustomer: boolean
  /** Titolare o amministratore: puo' scegliere il piano e pagare. */
  canManage: boolean
  facevoice: boolean
  /** Nome dell'altro spazio dello stesso titolare il cui abbonamento vale anche qui (il piano dell'AI e' per persona), o null. */
  coveredBy: string | null
  prices: { plan: PaidPlan; label: string; eur: number }[]
}
