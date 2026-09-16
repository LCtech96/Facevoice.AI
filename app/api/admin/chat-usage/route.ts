import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ChatAuthError, currentPeriodStart, requireChatAdmin } from '@/lib/chat-auth'

export const dynamic = 'force-dynamic'

type UsageRow = {
  user_id: string
  model: string
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
  cost_usd: number | string
  created_at: string
}

function fail(error: unknown) {
  if (error instanceof ChatAuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  console.error('Admin usage API error:', error)
  return NextResponse.json({ error: 'Errore nel recuperare il consumo.' }, { status: 500 })
}

function emptyTotals() {
  return {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    costUsd: 0,
  }
}

function addRow(totals: ReturnType<typeof emptyTotals>, row: UsageRow) {
  totals.requests += 1
  totals.inputTokens += row.input_tokens || 0
  totals.outputTokens += row.output_tokens || 0
  totals.cacheCreationTokens += row.cache_creation_input_tokens || 0
  totals.cacheReadTokens += row.cache_read_input_tokens || 0
  totals.costUsd += Number(row.cost_usd || 0)
}

/** Consumo del mese corrente per ogni dipendente, con dettaglio per modello. */
export async function GET(req: NextRequest) {
  try {
    await requireChatAdmin(req)

    const periodStart = currentPeriodStart()

    const [membersResult, usageResult] = await Promise.all([
      supabaseAdmin
        .from('chat_members')
        .select('user_id, email, display_name, role, monthly_limit_usd, is_active, created_at')
        .order('email', { ascending: true }),
      supabaseAdmin
        .from('chat_usage')
        .select(
          'user_id, model, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, cost_usd, created_at'
        )
        .gte('created_at', periodStart.toISOString()),
    ])

    if (membersResult.error) throw membersResult.error
    if (usageResult.error) throw usageResult.error

    const rows = (usageResult.data || []) as UsageRow[]

    const byUser = new Map<
      string,
      { totals: ReturnType<typeof emptyTotals>; byModel: Map<string, ReturnType<typeof emptyTotals>>; lastUsedAt: string | null }
    >()

    for (const row of rows) {
      const entry =
        byUser.get(row.user_id) ||
        { totals: emptyTotals(), byModel: new Map(), lastUsedAt: null }

      addRow(entry.totals, row)

      const modelTotals = entry.byModel.get(row.model) || emptyTotals()
      addRow(modelTotals, row)
      entry.byModel.set(row.model, modelTotals)

      if (!entry.lastUsedAt || row.created_at > entry.lastUsedAt) {
        entry.lastUsedAt = row.created_at
      }

      byUser.set(row.user_id, entry)
    }

    const members = (membersResult.data || []).map((member) => {
      const entry = byUser.get(member.user_id)
      const totals = entry?.totals ?? emptyTotals()
      const limitUsd = Number(member.monthly_limit_usd)

      return {
        userId: member.user_id,
        email: member.email,
        displayName: member.display_name,
        role: member.role,
        isActive: member.is_active,
        limitUsd,
        spentUsd: totals.costUsd,
        remainingUsd: Math.max(0, limitUsd - totals.costUsd),
        percentUsed: limitUsd > 0 ? Math.min(100, (totals.costUsd / limitUsd) * 100) : 0,
        lastUsedAt: entry?.lastUsedAt ?? null,
        totals,
        byModel: Array.from(entry?.byModel.entries() ?? []).map(([model, modelTotals]) => ({
          model,
          ...modelTotals,
        })),
      }
    })

    const grandTotal = members.reduce((sum, m) => sum + m.spentUsd, 0)

    return NextResponse.json({
      periodStart: periodStart.toISOString(),
      totalCostUsd: grandTotal,
      members,
    })
  } catch (error) {
    return fail(error)
  }
}

/** Aggiunge un dipendente alla chat interna (deve essersi gia' registrato). */
export async function POST(req: NextRequest) {
  try {
    await requireChatAdmin(req)
    const body = await req.json()
    const email = String(body?.email || '').trim().toLowerCase()

    if (!email) {
      return NextResponse.json({ error: 'Email mancante.' }, { status: 400 })
    }

    // listUsers e' paginato; cerchiamo l'utente scorrendo le pagine.
    const PER_PAGE = 200
    let found: { id: string; email?: string } | null = null

    for (let page = 1; page <= 100 && !found; page++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage: PER_PAGE,
      })
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      found = data.users.find((u) => u.email?.toLowerCase() === email) ?? null
      if (data.users.length < PER_PAGE) break
    }

    if (!found) {
      return NextResponse.json(
        { error: 'Nessun utente registrato con questa email. Deve prima creare un account sul sito.' },
        { status: 404 }
      )
    }

    const { data, error } = await supabaseAdmin
      .from('chat_members')
      .upsert(
        {
          user_id: found.id,
          email,
          display_name: body?.display_name ? String(body.display_name) : null,
          role: body?.role === 'admin' ? 'admin' : 'employee',
          monthly_limit_usd: Number(body?.monthly_limit_usd ?? 20),
          is_active: true,
        },
        { onConflict: 'user_id' }
      )
      .select('user_id, email, display_name, role, monthly_limit_usd, is_active')
      .single()

    if (error) throw error
    return NextResponse.json({ member: data })
  } catch (error) {
    return fail(error)
  }
}

/** Modifica limite, ruolo o stato di un dipendente. */
export async function PATCH(req: NextRequest) {
  try {
    const admin = await requireChatAdmin(req)
    const body = await req.json()
    const userId = String(body?.userId || '')

    if (!userId) {
      return NextResponse.json({ error: 'userId mancante.' }, { status: 400 })
    }

    const updates: Record<string, unknown> = {}
    if (body?.monthly_limit_usd !== undefined) {
      const limit = Number(body.monthly_limit_usd)
      if (!Number.isFinite(limit) || limit < 0) {
        return NextResponse.json({ error: 'Limite non valido.' }, { status: 400 })
      }
      updates.monthly_limit_usd = limit
    }
    if (typeof body?.is_active === 'boolean') {
      updates.is_active = body.is_active
    }
    if (body?.role === 'admin' || body?.role === 'employee') {
      updates.role = body.role
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nessuna modifica richiesta.' }, { status: 400 })
    }

    // Un admin non puo' togliersi da solo i privilegi o disattivarsi:
    // eviterebbe di lasciare il sistema senza nessuno che possa entrare.
    if (userId === admin.user_id && (updates.role === 'employee' || updates.is_active === false)) {
      return NextResponse.json(
        { error: 'Non puoi rimuovere i tuoi stessi privilegi di amministratore.' },
        { status: 400 }
      )
    }

    const { data, error } = await supabaseAdmin
      .from('chat_members')
      .update(updates)
      .eq('user_id', userId)
      .select('user_id, email, display_name, role, monthly_limit_usd, is_active')
      .maybeSingle()

    if (error) throw error
    if (!data) {
      return NextResponse.json({ error: 'Membro non trovato.' }, { status: 404 })
    }

    return NextResponse.json({ member: data })
  } catch (error) {
    return fail(error)
  }
}
