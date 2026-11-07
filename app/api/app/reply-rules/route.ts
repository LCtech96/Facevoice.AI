import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'
import { MAX_RULE_CHARS, RULE_PLATFORMS, deleteRule, readRules, updateRule } from '@/lib/saas/corrections'

export const dynamic = 'force-dynamic'

// Istruzioni, "Correzioni imparate": le regole nate dalle correzioni (Omnichat,
// "Sempre, per messaggi così") e dalle bozze modificate. Le vede tutto il team;
// le modificano e le cancellano il titolare e gli amministratori.

export async function GET(req: NextRequest) {
  const access = await requireWorkspace(req)
  if (access instanceof NextResponse) return access
  try {
    return NextResponse.json({ rules: await readRules(access.workspace.id) })
  } catch (error) {
    console.error('reply rules read:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Correzioni non disponibili, riprova.' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const access = await requireWorkspace(req, 'admin')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  const id = typeof body.id === 'string' ? body.id : ''
  const patch: { rule?: string; platform?: string | null; byAdmin?: boolean } = {}
  if (body.rule !== undefined) {
    const rule = typeof body.rule === 'string' ? body.rule.replace(/\s+/g, ' ').trim() : ''
    if (!rule) return NextResponse.json({ error: 'Scrivi la regola.' }, { status: 400 })
    if (rule.length > MAX_RULE_CHARS) return NextResponse.json({ error: `Regola troppo lunga (massimo ${MAX_RULE_CHARS} caratteri).` }, { status: 400 })
    patch.rule = rule
    // Riscritta da titolare o amministratore: ora e' una regola loro (nel pool pesa almeno 1).
    patch.byAdmin = true
  }
  if (body.platform !== undefined) {
    if (body.platform !== null && !(RULE_PLATFORMS as readonly string[]).includes(String(body.platform))) {
      return NextResponse.json({ error: 'Canale non valido' }, { status: 400 })
    }
    patch.platform = body.platform === null ? null : String(body.platform)
  }
  if (!id || !Object.keys(patch).length) return NextResponse.json({ error: 'Niente da salvare' }, { status: 400 })
  try {
    const rule = await updateRule(access.workspace.id, id, patch)
    if (!rule) return NextResponse.json({ error: 'Correzione non trovata' }, { status: 404 })
    return NextResponse.json({ rule })
  } catch (error) {
    console.error('reply rules update:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Non salvata, riprova.' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const access = await requireWorkspace(req, 'admin')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  const id = (typeof body.id === 'string' && body.id) || req.nextUrl.searchParams.get('id') || ''
  if (!id) return NextResponse.json({ error: 'Correzione non indicata' }, { status: 400 })
  try {
    if (!(await deleteRule(access.workspace.id, id))) return NextResponse.json({ error: 'Correzione non trovata' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('reply rules delete:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Non eliminata, riprova.' }, { status: 500 })
  }
}
