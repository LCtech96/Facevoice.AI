import { NextRequest, NextResponse } from 'next/server'
import { createWorkspace, membershipsOf, renameWorkspace, requireWorkspace, userFromRequest } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

// Spazi di lavoro dell'utente collegato: elenco e creazione del primo spazio
// (dopo la registrazione) o di uno nuovo, cambio del nome.

export async function GET(req: NextRequest) {
  const user = await userFromRequest(req)
  if (!user?.email) return NextResponse.json({ error: 'Accedi per continuare' }, { status: 401 })
  try {
    return NextResponse.json({ email: user.email, workspaces: await membershipsOf(user.id) })
  } catch (error) {
    console.error('app workspaces:', error)
    return NextResponse.json({ error: 'Spazi di lavoro non disponibili, riprova.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await userFromRequest(req)
  if (!user?.email) return NextResponse.json({ error: 'Accedi per continuare' }, { status: 401 })
  if (!user.email_confirmed_at && !user.confirmed_at) {
    return NextResponse.json({ error: 'Conferma prima la tua email.' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({}))
  try {
    const workspace = await createWorkspace(user.id, typeof body.name === 'string' ? body.name : '')
    return NextResponse.json({ workspace })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Spazio non creato, riprova.'
    console.error('app workspace create:', message)
    return NextResponse.json({ error: message.startsWith('spazio non creato') ? 'Spazio non creato, riprova.' : message }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  const access = await requireWorkspace(req, 'admin')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  try {
    const name = await renameWorkspace(access.workspace.id, typeof body.name === 'string' ? body.name : '')
    return NextResponse.json({ name })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    console.error('app workspace rename:', message)
    return NextResponse.json({ error: message.startsWith('nome non salvato') || !message ? 'Nome non salvato, riprova.' : message }, { status: 400 })
  }
}
