import { modelLabel } from '@/lib/ai-models'
import type { Usage } from '@/components/useAssistantChat'

// Numeri della super chat: token, costi e date brevi.

export const fmtTokens = (n: number) => n.toLocaleString('it-IT')
export const fmtCost = (cost: number) => (cost <= 0 ? 'gratis' : `$${cost.toFixed(cost < 0.01 ? 4 : 3)}`)
const usedModels = (u: Usage) =>
  Object.keys(u.models)
    .map(modelLabel)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(' + ')

/** Riga "Gemini Flash · 4.210 token · gratis" sotto le risposte e durante il lavoro. */
export function usageLine(u?: Usage) {
  if (!u || !u.calls) return null
  return `${usedModels(u)} · ${fmtTokens(u.input + u.output)} token · ${fmtCost(u.cost)}`
}

/** "5 nov, 14:30" */
export const shortDate = (iso: string) => new Date(iso).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
