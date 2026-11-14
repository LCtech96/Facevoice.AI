import { NextRequest, NextResponse } from 'next/server'
import { authFromRequest, createWorkspace, membershipsOf, ownerOnlyResponse, renameWorkspace, requireWorkspace, sharedRevokedResponse } from '@/lib/workspace'
import { assistantAccess } from '@/lib/assistant-access'
import { automationsAccess } from '@/lib/automations-access'
import { videoRepliesAccess } from '@/lib/video-replies-access'

export const dynamic = 'force-dynamic'

// Spazi di lavoro dell'utente collegato: elenco e creazione del primo spazio
// (dopo la registrazione) o di uno nuovo, cambio del nome. Con l'elenco, se la persona
// ha l'Assistente attivo (assistant: true/false; null se non si e' potuto leggere) e
// se vede la pagina Automazioni (automations, stesse regole) e la Video automazione (videoReplies).

export async function GET(req: NextRequest) {
  const auth = await authFromRequest(req).catch(() => null)
  if (auth && 'revoked' in auth) return sharedRevokedResponse(auth.revoked)
  const user = auth?.user
  if (!user?.email) return NextResponse.json({ error: 'Accedi per continuare' }, { status: 401 })
  try {
    const workspaces = await membershipsOf(user.id)
    const ids = workspaces.map((w) => w.id)
    const [assistant, automations, videoReplies] = await Promise.all([
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
      videoRepliesAccess(user.id, ids)
        .then((a) => a.enabled)
        .catch((error) => {
          console.error('app workspaces video automazione:', error instanceof Error ? error.message : error)
          return null
        }),
    ])
    return NextResponse.json({ email: user.email, workspaces, assistant, automations, videoReplies, shared: Boolean(user.shared) })
  } catch (error) {
    console.error('app workspaces:', error)
    return NextResponse.json({ error: 'Spazi di lavoro non disponibili, riprova.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await authFromRequest(req).catch(() => null)
  if (auth && 'revoked' in auth) return sharedRevokedResponse(auth.revoked)
  const user = auth?.user
  if (!user?.email) return NextResponse.json({ error: 'Accedi per continuare' }, { status: 401 })
  if (user.shared) return ownerOnlyResponse('Solo il titolare dell’account può creare un nuovo spazio di lavoro.')
  if (!user.email_confirmed_at && !user.confirmed_at) {
    return NextResponse.json({ error: 'Conferma prima la tua email.' }, { status: 403 })
  }
  // Nessuno spazio senza i termini e condizioni in vigore accettati (lib/terms-acceptance.ts).
  const termsOk = await import('@/lib/terms-acceptance')
    .then((terms) => terms.hasCurrentAcceptance(user.id))
    .catch((error) => {
      console.error('app workspace termini:', error instanceof Error ? error.message : error)
      return null
    })
  if (termsOk === null) return NextResponse.json({ error: 'Non riesco a controllare i termini, riprova.' }, { status: 500 })
  if (!termsOk) return NextResponse.json({ error: 'Prima accetta i termini e condizioni.', code: 'terms_required' }, { status: 403 })
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
