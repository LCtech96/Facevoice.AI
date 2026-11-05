// Consumo dell'AI dei clienti: tipi e testi usati sia dal server sia dalle pagine.
// Qui niente database e niente euro: la logica (soglie, periodo, blocco, avvisi)
// sta in lib/usage-limits.ts.

/** Livello automatico del consumo nel periodo del piano. */
export type UsageLevel = 'none' | 'green' | 'orange' | 'red' | 'blocked'
/** Gettone scelto a mano da Facevoice per un utente. */
export type UsageLight = 'green' | 'orange' | 'red'
/** Gettone acceso che vede il cliente ('none' = tutti grigi). */
export type ShownLight = 'none' | UsageLight

/** Quello che l'area clienti sa del consumo: mai euro, mai token. */
export type UsageStatus = { shown: ShownLight; blocked: boolean; daysLeft: number; periodEnd: string }

/** Dove porta "Passa al piano superiore" (unico punto da cambiare quando arriva il pagamento online). */
export const UPGRADE_URL = `https://wa.me/393514206353?text=${encodeURIComponent('Ciao, vorrei passare al piano superiore di Facevoice AI')}`

export const AI_BLOCKED_MESSAGE = "Hai finito l'AI inclusa nel tuo piano per questo mese: passa al piano superiore."

/** Evento del browser: qualcosa e' cambiato nel consumo, i gettoni si aggiornano. */
export const USAGE_REFRESH_EVENT = 'fv-usage-refresh'

/** Testo del gettone (tooltip e lettori di schermo). */
export function usageLabel(shown: ShownLight, blocked: boolean): string {
  if (blocked) return 'Consumo AI: finito'
  if (shown === 'red') return 'Consumo AI: quasi finito'
  if (shown === 'orange') return 'Consumo AI: a metà'
  return "Consumo AI: all'inizio"
}
