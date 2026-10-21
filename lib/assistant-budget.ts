import type { UsageTally } from '@/lib/ai'

// Limite di spesa che Luca scrive nella richiesta ("non spendere più di 250k
// token", "massimo un dollaro", "fino a 50 centesimi"): la super chat si ferma
// prima di superarlo e dice cosa ha fatto.

export type Budget = { tokens?: number; usd?: number }

// "100.000" = centomila, "2,5" e "0.50" = decimali.
function num(raw: string) {
  const r = raw.replace(/[.,]+$/, '')
  if (r.includes(',')) return Number(r.replace(/\./g, '').replace(',', '.'))
  if (/^\d{1,3}(\.\d{3})+$/.test(r)) return Number(r.replace(/\./g, ''))
  return Number(r)
}

const WORDS: Record<string, number> = { mezzo: 0.5, un: 1, uno: 1, due: 2, tre: 3, quattro: 4, cinque: 5, dieci: 10 }

export function parseBudget(text: string): Budget | null {
  const t = text.toLowerCase()
  const budget: Budget = {}

  const tok = t.match(/(\d[\d.,]*)\s*(k|mila|m|milion[ei])?\s*(?:di\s+)?token/)
  if (tok) {
    const unit = tok[2] || ''
    const mult = unit === 'k' || unit === 'mila' ? 1000 : unit === 'm' || unit.startsWith('milion') ? 1_000_000 : 1
    const value = num(tok[1]) * mult
    if (value >= 1000) budget.tokens = value
  }

  const money =
    t.match(/(\d[\d.,]*)\s*(?:\$|dollar[oi]|usd|€|eur[o]?)/) ||
    t.match(/[$€]\s*(\d[\d.,]*)/) ||
    t.match(/\b(mezzo|un|uno|due|tre|quattro|cinque|dieci)\s+(?:dollar[oi]|eur[o]?)/)
  if (money) {
    const value = WORDS[money[1]] ?? num(money[1])
    if (value > 0) budget.usd = value
  }
  const cents = t.match(/(\d+)\s*centesimi/)
  if (cents && !budget.usd) budget.usd = Number(cents[1]) / 100

  return budget.tokens || budget.usd ? budget : null
}

/**
 * Limite (quasi) raggiunto: ci si ferma se il prossimo passo, stimato come
 * l'ultimo fatto, porterebbe oltre il limite. Il riepilogo finale costa poco.
 */
export function overBudget(budget: Budget | null | undefined, used: UsageTally, lastStep?: UsageTally) {
  if (!budget) return false
  const nextTokens = lastStep ? lastStep.input + lastStep.output : 0
  const nextCost = lastStep ? lastStep.cost : 0
  if (budget.tokens && used.input + used.output + nextTokens >= budget.tokens * 0.95) return true
  if (budget.usd && used.cost + nextCost >= budget.usd * 0.95) return true
  return false
}

export function describeBudget(budget: Budget) {
  return [budget.tokens ? `${budget.tokens.toLocaleString('it-IT')} token` : '', budget.usd ? `$${budget.usd}` : '']
    .filter(Boolean)
    .join(' o ')
}
