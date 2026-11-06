import { NextRequest, NextResponse } from 'next/server'
import { createWorkspace, membershipsOf, renameWorkspace, requireWorkspace, userFromRequest } from '@/lib/workspace'
import { assistantAccess } from '@/lib/assistant-access'
import { automationsAccess } from '@/lib/automations-access'

export const dynamic = 'force-dynamic'

// Spazi di lavoro dell'utente collegato: elenco e creazione del primo spazio
// (dopo la registrazione) o di uno nuovo, cambio del nome. Con l'elenco, se la persona
// ha l'Assistente attivo (assistant: true/false; null se non si e' potuto leggere) e
// se vede la pagina Automazioni (automations, stesse regole).

export async function GET(req: NextRequest) {
  const user = await userFromRequest(req)
  if (!user?.email) return NextResponse.json({ error: 'Accedi per continuare' }, { status: 401 })
  try {
    const workspaces = await membershipsOf(user.id)
    const ids = workspaces.map((w) => w.id)
    const [assistant, automations] = await Promise.all([
      assistantAccess(user.id, ids)
        .then((a) => a.enabled)
        .catch((error) => {
          console.error('app workspaces assistente:', error instanceof Error ? error.message : error)
          return null
        }),
      automationsAccess(user.id, ids)
        .then((a) => a.enabled)
        .catch((error) => {
          console.error('app workspaces automazioni:', error instanceof Error ? error.message : error)
          return null
        }),
    ])
    return NextResponse.json({ email: user.email, workspaces, assistant, automations })
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
