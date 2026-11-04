import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'
import { romeLocalToDate } from '@/lib/saas/posts'

export const dynamic = 'force-dynamic'

// Consumo dell'AI dello spazio (tabella ai_usage): token ed euro di oggi e del mese,
// per il pulsante accanto al titolo dell'assistente (si aggiorna ogni minuto).

type Row = { feature: string; outcome: string; input_tokens: number; output_tokens: number; cost_usd: number | string; created_at: string }

const LABELS: Record<string, string> = {
  saas_assistente: 'Assistente',
  saas_slide: 'Correzioni slide',
  saas_post: 'Testi dei post',
  saas_lettura_foto: 'Lettura delle foto',
  saas_recupero_testi: 'Recupero versioni',
}

// Cambio dollaro → euro (BCE tramite Frankfurter), tenuto per 12 ore; se non risponde
// si usa EUR_PER_USD o un valore indicativo.
let rate: { value: number; at: number } | null = null
async function eurPerUsd(): Promise<number> {
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

const empty = () => ({ calls: 0, input: 0, output: 0, tokens: 0, usd: 0 })

export async function GET(req: NextRequest) {
  const access = await requireWorkspace(req)
  if (access instanceof NextResponse) return access
  const now = new Date()
  const rome = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const [y, m, d] = rome.split('-')
  const monthStart = romeLocalToDate(`${y}-${m}-01T00:00`)
  const dayStart = romeLocalToDate(`${y}-${m}-${d}T00:00`)

  const rows: Row[] = []
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await access.db
      .from('ai_usage')
      .select('feature, outcome, input_tokens, output_tokens, cost_usd, created_at')
      .gte('created_at', monthStart.toISOString())
      .order('created_at', { ascending: false })
      .range(from, from + 999)
    if (error) return NextResponse.json({ error: 'Consumo non disponibile' }, { status: 500 })
    rows.push(...((data || []) as Row[]))
    if (!data || data.length < 1000) break
  }

  const month = empty()
  const today = empty()
  const byFeature = new Map<string, ReturnType<typeof empty>>()
  const add = (t: ReturnType<typeof empty>, r: Row) => {
    t.calls++
    t.input += r.input_tokens || 0
    t.output += r.output_tokens || 0
    t.tokens += (r.input_tokens || 0) + (r.output_tokens || 0)
    t.usd += Number(r.cost_usd || 0)
  }
  for (const r of rows) {
    if (r.outcome !== 'ok') continue
    add(month, r)
    if (new Date(r.created_at) >= dayStart) add(today, r)
    const f = byFeature.get(r.feature) || empty()
    add(f, r)
    byFeature.set(r.feature, f)
  }
  const eur = await eurPerUsd()
  const out = (t: ReturnType<typeof empty>) => ({ calls: t.calls, input: t.input, output: t.output, tokens: t.tokens, eur: Math.round(t.usd * eur * 10000) / 10000 })
  return NextResponse.json({
    updatedAt: now.toISOString(),
    eurPerUsd: eur,
    today: out(today),
    month: out(month),
    lastCallAt: rows[0]?.created_at ?? null,
    byFeature: [...byFeature.entries()]
      .map(([feature, t]) => ({ feature, label: LABELS[feature] || feature.replace(/^saas_/, '').replace(/_/g, ' '), ...out(t) }))
      .sort((a, b) => b.eur - a.eur || b.tokens - a.tokens),
  })
}
