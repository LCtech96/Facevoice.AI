import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ChatAuthError, currentPeriodStart, requireChatAdmin } from '@/lib/chat-auth'

export const dynamic = 'force-dynamic'

type Row = {
  feature: string
  provider: 'gemini' | 'claude'
  outcome: 'ok' | 'limit' | 'error'
  input_tokens: number
  output_tokens: number
  cost_usd: number | string
  created_at: string
}

function totals() {
  return { geminiCalls: 0, claudeCalls: 0, geminiLimits: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }
}

function add(t: ReturnType<typeof totals>, row: Row) {
  if (row.provider === 'gemini' && row.outcome === 'limit') t.geminiLimits++
  if (row.outcome !== 'ok') return
  if (row.provider === 'gemini') t.geminiCalls++
  else t.claudeCalls++
  t.inputTokens += row.input_tokens || 0
  t.outputTokens += row.output_tokens || 0
  t.costUsd += Number(row.cost_usd || 0)
}

/** Consumo delle AI automatiche (chat del sito, risposte, Ricerca clienti) nel mese corrente. */
export async function GET(req: NextRequest) {
  try {
    await requireChatAdmin(req)
    const periodStart = currentPeriodStart()
    const rows: Row[] = []
    // Paginato: Supabase restituisce al massimo 1000 righe per richiesta.
    for (let from = 0; from < 50_000; from += 1000) {
      const { data, error } = await supabaseAdmin
        .from('ai_usage')
        .select('feature, provider, outcome, input_tokens, output_tokens, cost_usd, created_at')
        .gte('created_at', periodStart.toISOString())
        .order('created_at', { ascending: false })
        .range(from, from + 999)
      if (error) {
        // Tabella non ancora creata: la pagina lo spiega invece di andare in errore.
        if (error.code === '42P01' || /ai_usage/.test(error.message)) {
          return NextResponse.json({ missingTable: true })
        }
        throw error
      }
      rows.push(...((data || []) as Row[]))
      if (!data || data.length < 1000) break
    }

    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const month = totals()
    const today = totals()
    const byFeature = new Map<string, ReturnType<typeof totals>>()
    let lastLimitAt: string | null = null
    let lastClaudeAt: string | null = null

    for (const row of rows) {
      add(month, row)
      if (new Date(row.created_at) >= startOfToday) add(today, row)
      const f = byFeature.get(row.feature) || totals()
      add(f, row)
      byFeature.set(row.feature, f)
      if (row.outcome === 'limit' && !lastLimitAt) lastLimitAt = row.created_at
      if (row.provider === 'claude' && row.outcome === 'ok' && !lastClaudeAt) lastClaudeAt = row.created_at
    }

    return NextResponse.json({
      periodStart: periodStart.toISOString(),
      month,
      today,
      lastLimitAt,
      lastClaudeAt,
      lastCallAt: rows[0]?.created_at ?? null,
      byFeature: [...byFeature.entries()]
        .map(([feature, t]) => ({ feature, ...t }))
        .sort((a, b) => b.geminiCalls + b.claudeCalls - (a.geminiCalls + a.claudeCalls)),
    })
  } catch (error) {
    if (error instanceof ChatAuthError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('ai usage:', error)
    return NextResponse.json({ error: 'Errore nel recuperare il consumo delle AI automatiche.' }, { status: 500 })
  }
}
