import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { guard } from '@/lib/staff-access'
import { MAX_RULE_CHARS, STRONG_WEIGHT, deleteRule, readRules, updateRule } from '@/lib/corrections'

export const dynamic = 'force-dynamic'

// "Correzioni imparate" in Memoria AI (lib/corrections.ts): vederle (Memoria: vedere),
// modificarne il testo, attivarle/disattivarle, eliminarle, copiarle in una voce di Memoria
// (Memoria: modificare). Una regola riscritta dall'admin pesa almeno come una sua correzione.

export async function GET(req: NextRequest) {
  const access = await guard(req, 'control', 'view')
  if (access instanceof NextResponse) return access
  try {
    const rules = await readRules()
    // Voce di Memoria eliminata nel frattempo: si puo' copiare di nuovo.
    const ids = rules.map((r) => r.knowledgeId).filter((x): x is string => Boolean(x))
    const { data: items } = ids.length ? await supabaseAdmin.from('ai_knowledge').select('id').in('id', ids) : { data: [] }
    const alive = new Set((items || []).map((i: { id: string | number }) => String(i.id)))
    const shown = rules.map((r) => (r.knowledgeId && !alive.has(r.knowledgeId) ? { ...r, knowledgeId: undefined } : r))
    return NextResponse.json({ rules: shown, strongWeight: STRONG_WEIGHT })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Correzioni non lette' }, { status: 500 })
  }
}

const label = (text: string, max: number) => {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean
}

/** body: { id, rule?, active? } oppure { id, action: 'promote' } (copia in una voce di Memoria). */
export async function PATCH(req: NextRequest) {
  const access = await guard(req, 'control', 'edit')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'Correzione non indicata' }, { status: 400 })

  if (body.action === 'promote') {
    const rule = (await readRules()).find((r) => r.id === id)
    if (!rule) return NextResponse.json({ error: 'Correzione non trovata' }, { status: 404 })
    if (rule.knowledgeId) {
      const { data: existing } = await supabaseAdmin.from('ai_knowledge').select('id').eq('id', rule.knowledgeId).maybeSingle()
      if (existing) return NextResponse.json({ error: 'È già nella Memoria' }, { status: 409 })
    }
    const example = rule.example.corrected.trim()
      ? `\n\nEsempio: alla domanda «${label(rule.example.incoming, 300) || '…'}» rispondere «${label(rule.example.corrected, 800)}»`
      : ''
    const { data: item, error } = await supabaseAdmin
      .from('ai_knowledge')
      .insert({
        title: label(rule.rule.split('→')[0] || rule.rule, 80) || 'Risposta corretta',
        content: `${rule.rule}${example}`,
        category: 'Correzioni',
        is_active: true,
      })
      .select()
      .single()
    if (error || !item) return NextResponse.json({ error: error?.message || 'Voce di Memoria non creata' }, { status: 500 })
    const updated = await updateRule(id, { knowledgeId: String(item.id) })
    return NextResponse.json({ rule: updated, item })
  }

  const patch: { rule?: string; active?: boolean; byAdmin?: boolean } = {}
  if (typeof body.rule === 'string') {
    const text = body.rule.replace(/\s+/g, ' ').trim()
    if (!text) return NextResponse.json({ error: 'Scrivi la regola' }, { status: 400 })
    if (text.length > MAX_RULE_CHARS) return NextResponse.json({ error: 'Regola troppo lunga (massimo 400 caratteri)' }, { status: 400 })
    patch.rule = text
    patch.byAdmin = access.isAdmin
  }
  if (typeof body.active === 'boolean') patch.active = body.active
  if (patch.rule === undefined && patch.active === undefined) return NextResponse.json({ error: 'Niente da modificare' }, { status: 400 })
  const updated = await updateRule(id, patch)
  if (!updated) return NextResponse.json({ error: 'Correzione non trovata' }, { status: 404 })
  return NextResponse.json({ rule: updated })
}

export async function DELETE(req: NextRequest) {
  const access = await guard(req, 'control', 'edit')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id || !(await deleteRule(id))) return NextResponse.json({ error: 'Correzione non trovata' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
