import { NextRequest, NextResponse } from 'next/server'
import { requireAutomations } from '@/lib/automations-access'
import { AutomationError, automationsOverview, createAutomation, deleteAutomation, sendAutomationTest, updateAutomation } from '@/lib/saas/automations'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Pagina Automazioni dell'area clienti: email programmate dalla casella collegata.
// GET elenco, ultimi invii, contatore di oggi e casella; POST nuova automazione (o
// { test: true } = prova alla propria email); PATCH modifica, pausa e ripresa; DELETE.
// Solo per chi ha le automazioni attive (le accende Facevoice: lib/automations-access.ts);
// modificare serve il ruolo di amministratore dello spazio.

const failure = (error: unknown, label: string) => {
  if (error instanceof AutomationError) return NextResponse.json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, { status: error.status })
  console.error(`app automazioni ${label}:`, error instanceof Error ? error.message : error)
  return NextResponse.json({ error: 'Automazioni non disponibili, riprova.' }, { status: 500 })
}

export async function GET(req: NextRequest) {
  const access = await requireAutomations(req)
  if (access instanceof NextResponse) return access
  try {
    const overview = await automationsOverview(access.db)
    return NextResponse.json({ ...overview, canManage: access.workspace.role !== 'member' }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return failure(error, 'elenco')
  }
}

export async function POST(req: NextRequest) {
  const access = await requireAutomations(req, 'admin')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Dati non validi' }, { status: 400 })
  try {
    if (body.test === true) {
      const test = await sendAutomationTest(access.db, access.email, body.draft && typeof body.draft === 'object' ? body.draft : body)
      return NextResponse.json({ test, ...(await automationsOverview(access.db)) })
    }
    const saved = await createAutomation(access.db, access.userId, body, { origin: 'page' })
    return NextResponse.json({ ...saved, ...(await automationsOverview(access.db)) })
  } catch (error) {
    return failure(error, 'nuova')
  }
}

export async function PATCH(req: NextRequest) {
  const access = await requireAutomations(req, 'admin')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => null)
  const id = typeof body?.id === 'string' ? body.id : ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Dati non validi' }, { status: 400 })
  try {
    const { id: _id, ...patch } = body
    const saved = await updateAutomation(access.db, id, patch)
    return NextResponse.json({ ...saved, ...(await automationsOverview(access.db)) })
  } catch (error) {
    return failure(error, 'modifica')
  }
}

export async function DELETE(req: NextRequest) {
  const access = await requireAutomations(req, 'admin')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => null)
  const id = req.nextUrl.searchParams.get('id') || (typeof body?.id === 'string' ? body.id : '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Dati non validi' }, { status: 400 })
  try {
    await deleteAutomation(access.db, id)
    return NextResponse.json({ ok: true, ...(await automationsOverview(access.db)) })
  } catch (error) {
    return failure(error, 'cancella')
  }
}
