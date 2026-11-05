// Consumo dell'AI dei clienti: tipi e testi usati sia dal server sia dalle pagine.
// Qui niente database e niente euro: la logica (soglie, periodo, blocco, avvisi)
// sta in lib/usage-limits.ts.

import { PLAN_PAGE_URL, TRIAL_DAYS } from '@/lib/billing-shared'

/** Livello automatico del consumo nel periodo del piano. */
export type UsageLevel = 'none' | 'green' | 'orange' | 'red' | 'blocked'
/** Gettone scelto a mano da Facevoice per un utente. */
export type UsageLight = 'green' | 'orange' | 'red'
/** Gettone acceso che vede il cliente ('none' = tutti grigi). */
export type ShownLight = 'none' | UsageLight

/** Perche' l'AI e' ferma: limite del piano raggiunto, oppure nessun piano attivo. */
export type BlockReason = 'limit' | 'no_plan'

/** Quello che l'area clienti sa del consumo: mai euro, mai token. */
export type UsageStatus = {
  shown: ShownLight
  blocked: boolean
  daysLeft: number
  periodEnd: string
  /** Solo se bloccato. */
  reason?: BlockReason
  /** Pagamenti online attivi: "Passa al piano superiore" porta alla pagina Piano. */
  billing?: boolean
  /** Senza piano: la prova gratuita spetta ancora. */
  trialAvailable?: boolean
}

/** Contatto WhatsApp: dove porta "Passa al piano superiore" finche' il pagamento online non e' attivo. */
export const UPGRADE_URL = `https://wa.me/393514206353?text=${encodeURIComponent('Ciao, vorrei passare al piano superiore di Facevoice AI')}`

/** Dove porta "Passa al piano superiore": la pagina Piano con i pagamenti attivi, altrimenti WhatsApp. */
export const upgradeUrl = (billing: boolean | undefined) => (billing ? PLAN_PAGE_URL : UPGRADE_URL)

export const AI_BLOCKED_MESSAGE = "Hai finito l'AI inclusa nel tuo piano per questo mese: passa al piano superiore."

/** Nessun abbonamento in corso (solo con i pagamenti online attivi). */
export const noPlanMessage = (trialAvailable: boolean) =>
  trialAvailable ? `Scegli un piano per usare l'AI: i primi ${TRIAL_DAYS} giorni sono gratis.` : "Scegli un piano per usare l'AI."

/** Testo dell'AI ferma, secondo il motivo. */
export const blockedMessage = (reason: BlockReason | undefined, trialAvailable = false) =>
  reason === 'no_plan' ? noPlanMessage(trialAvailable) : AI_BLOCKED_MESSAGE

/** Evento del browser: qualcosa e' cambiato nel consumo, i gettoni si aggiornano. */
export const USAGE_REFRESH_EVENT = 'fv-usage-refresh'

/** Testo del gettone (tooltip e lettori di schermo). */
export function usageLabel(shown: ShownLight, blocked: boolean, reason?: BlockReason): string {
  if (blocked && reason === 'no_plan') return 'Consumo AI: nessun piano attivo'
  if (blocked) return 'Consumo AI: finito'
  if (shown === 'red') return 'Consumo AI: quasi finito'
  if (shown === 'orange') return 'Consumo AI: a metà'
  return "Consumo AI: all'inizio"
}
