// Cambio dollaro -> euro per mostrare i costi dell'AI (BCE tramite Frankfurter), tenuto
// per 12 ore; se il servizio non risponde si usa EUR_PER_USD o un valore indicativo.

let rate: { value: number; at: number } | null = null

export async function eurPerUsd(): Promise<number> {
  if (rate && Date.now() - rate.at < 12 * 3600_000) return rate.value
  const fallback = Number(process.env.EUR_PER_USD) || 0.92
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=USD&to=EUR', { signal: AbortSignal.timeout(3000) })
    const value = Number((await res.json())?.rates?.EUR)
    rate = { value: value > 0 ? value : fallback, at: Date.now() }
  } catch {
    rate = { value: fallback, at: Date.now() - 11 * 3600_000 }
  }
  return rate.value
}

/** Token ed euro di un lavoro (dal contatore di lib/ai). */
export async function usageSummary(tally: { input: number; output: number; cost: number }) {
  return { tokens: tally.input + tally.output, eur: Math.round(tally.cost * (await eurPerUsd()) * 10000) / 10000 }
}
