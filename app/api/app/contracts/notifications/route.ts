import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'
import { listNotes, markNotesRead } from '@/lib/saas/contracts'

export const dynamic = 'force-dynamic'

// Campanella dei contratti (barra in alto dell'area clienti): richieste di modifica, link aperto, firme del
// destinatario e contratti completati dello spazio. Solo titolare e amministratori; lette per persona.
//   GET                      { items, unread }
//   POST { id | "all" }      segna come letta

const headers = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function GET(req: NextRequest) {
  const access = await requireWorkspace(req, 'admin')
  if (access instanceof NextResponse) return access
  const notes = await listNotes(access.workspace.id, access.userId).catch(() => ({ items: [], unread: 0 }))
  const res = NextResponse.json(notes)
  res.headers.set('Cache-Control', headers['Cache-Control'])
  return res
}

export async function POST(req: NextRequest) {
  const access = await requireWorkspace(req, 'admin')
  if (access instanceof NextResponse) return access
  const body = ((await req.json().catch(() => null)) || {}) as { id?: unknown }
  const id = body.id === 'all' ? 'all' : typeof body.id === 'string' && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null
  if (!id) return NextResponse.json({ error: 'Richiesta non valida.' }, { status: 400 })
  await markNotesRead(access.workspace.id, access.userId, id)
  return NextResponse.json(await listNotes(access.workspace.id, access.userId))
}
