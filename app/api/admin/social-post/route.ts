import { NextRequest, NextResponse } from 'next/server'
import { getStaffAccess } from '@/lib/staff-access'
import { loadPostDraft, publishPostDraft } from '@/lib/social-posts'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Carosello creato dalla super chat: stato della bozza e pubblicazione con il
// pulsante "Pubblica" dell'anteprima. Solo l'amministratore (esce a nome di Facevoice).

async function admin(req: NextRequest) {
  const access = await getStaffAccess(req)
  return access?.isAdmin ? access : null
}

export async function GET(req: NextRequest) {
  if (!(await admin(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const draft = await loadPostDraft(req.nextUrl.searchParams.get('id') || '')
  if (!draft) return NextResponse.json({ error: 'Bozza non trovata' }, { status: 404 })
  return NextResponse.json({ draft })
}

export async function POST(req: NextRequest) {
  if (!(await admin(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const platforms = (Array.isArray(body.platforms) ? body.platforms : ['instagram', 'facebook']).filter(
    (p: unknown): p is 'instagram' | 'facebook' => p === 'instagram' || p === 'facebook'
  )
  if (!platforms.length) return NextResponse.json({ error: 'Scegli Instagram, Facebook o entrambi' }, { status: 400 })
  try {
    const draft = await publishPostDraft(String(body.draftId || ''), {
      platforms,
      caption: typeof body.caption === 'string' ? body.caption : undefined,
      facebook: typeof body.facebook === 'string' ? body.facebook : undefined,
    })
    if (draft.status !== 'published') {
      return NextResponse.json({ error: draft.results?.errors?.join(' · ') || 'Pubblicazione non riuscita', draft }, { status: 502 })
    }
    return NextResponse.json({ ok: true, draft })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Pubblicazione non riuscita' }, { status: 400 })
  }
}
