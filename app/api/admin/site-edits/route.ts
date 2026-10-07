import { NextRequest, NextResponse } from 'next/server'
import { getAdminEmail } from '@/lib/admin-request'
import { discardSiteEdit, getSiteEditStatus, publishSiteEdit, recordSiteEditResult, SiteEditError } from '@/lib/site-edit'

export const dynamic = 'force-dynamic'

/** Stato di una modifica al sito: ?id=... */
export async function GET(req: NextRequest) {
  if (!(await getAdminEmail(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id') || ''
  try {
    const status = await getSiteEditStatus(id)
    if (!status) return NextResponse.json({ error: 'Modifica non trovata' }, { status: 404 })
    return NextResponse.json(status)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Errore' }, { status: 500 })
  }
}

/**
 * Dal workflow (x-internal-key = SITE_EDIT_KEY): risultato del lavoro.
 * Dall'admin: { id, action: 'publish' | 'discard' }.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const key = (process.env.SITE_EDIT_KEY || '').trim()
  if (key && req.headers.get('x-internal-key') === key) {
    const ok = await recordSiteEditResult(body)
    return NextResponse.json({ ok })
  }
  if (!(await getAdminEmail(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const id = typeof body?.id === 'string' ? body.id : ''
  try {
    if (body?.action === 'publish') return NextResponse.json(await publishSiteEdit(id))
    if (body?.action === 'discard') return NextResponse.json(await discardSiteEdit(id))
    return NextResponse.json({ error: 'Azione non valida' }, { status: 400 })
  } catch (error) {
    const status = error instanceof SiteEditError ? 400 : 500
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Errore' }, { status })
  }
}
