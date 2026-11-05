import { NextRequest, NextResponse } from 'next/server'
import { getStaffAccess } from '@/lib/staff-access'
import { DraftConflictError, DraftError, loadPostDraft, publishPostDraft, type PostDraft } from '@/lib/social-posts'
import { arrangeSlides, carouselState, editSlidesAI, editSlideTexts, restoreDraftVersion, undoLastChange, type SlideEdit } from '@/lib/carousel-edit'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Carosello creato dalla super chat: stato della bozza, modifiche slide per slide
// (PATCH) e pubblicazione con il pulsante "Pubblica" dell'anteprima (POST).
// Solo l'amministratore (esce a nome di Facevoice).

async function admin(req: NextRequest) {
  const access = await getStaffAccess(req)
  return access?.isAdmin ? access : null
}

const urlList = (value: unknown) => (Array.isArray(value) ? value.filter((u): u is string => typeof u === 'string' && u.length > 0) : null)
const numberList = (value: unknown) => (Array.isArray(value) ? value.map(Number).filter((n) => Number.isFinite(n)) : [])

/** Risposta con la bozza attuale, cosi' la scheda si rimette in pari anche dopo un errore. */
async function withState(body: Record<string, unknown>, status: number, draft: PostDraft | null) {
  return NextResponse.json({ ...body, ...(draft ? await carouselState(draft) : {}) }, { status })
}

async function failure(error: unknown, id: string, fallback: string) {
  if (error instanceof DraftConflictError) return withState({ error: error.message }, 409, error.draft)
  const status = error instanceof DraftError ? error.status : 500
  if (!(error instanceof DraftError)) console.error('social post:', error)
  const current = await loadPostDraft(id).catch(() => null)
  return withState({ error: error instanceof Error && error.message ? error.message : fallback }, status, current)
}

export async function GET(req: NextRequest) {
  if (!(await admin(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const draft = await loadPostDraft(req.nextUrl.searchParams.get('id') || '')
  if (!draft) return NextResponse.json({ error: 'Bozza non trovata' }, { status: 404 })
  return withState({}, 200, draft)
}

/** Modifiche alle slide: base = le slide che Luca ha davanti (se sono cambiate: 409). */
export async function PATCH(req: NextRequest) {
  if (!(await admin(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const id = String(body.draftId || '')
  const base = urlList(body.base)
  if (!base?.length) return withState({ error: 'Manca la versione del carosello: aggiorna la pagina e riprova.' }, 400, await loadPostDraft(id).catch(() => null))
  try {
    let outcome
    switch (body.action) {
      case 'edit_text': {
        const edits: SlideEdit[] = (Array.isArray(body.edits) ? body.edits : [])
          .filter((e: unknown): e is Record<string, unknown> => Boolean(e) && typeof e === 'object')
          .map((e: Record<string, unknown>) => {
            const edit: SlideEdit = { n: Number(e.n) }
            for (const field of ['hook', 'label', 'subtitle', 'title', 'text', 'button'] as const) if (typeof e[field] === 'string') edit[field] = e[field] as string
            return edit
          })
        outcome = await editSlideTexts(id, base, edits)
        break
      }
      case 'edit_slides':
        outcome = await editSlidesAI(id, base, numberList(body.slides), typeof body.instruction === 'string' ? body.instruction : '')
        break
      case 'arrange':
        outcome = await arrangeSlides(id, base, numberList(body.slides))
        break
      case 'undo':
        outcome = await undoLastChange(id, base)
        break
      case 'restore':
        outcome = await restoreDraftVersion(id, base, typeof body.at === 'string' ? body.at : '')
        break
      default:
        return withState({ error: 'Modifica non riconosciuta.' }, 400, await loadPostDraft(id).catch(() => null))
    }
    return withState({ ok: true, changed: outcome.changed, done: outcome.done }, 200, outcome.draft)
  } catch (error) {
    return failure(error, id, 'Modifica non riuscita, riprova.')
  }
}

export async function POST(req: NextRequest) {
  if (!(await admin(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const platforms = (Array.isArray(body.platforms) ? body.platforms : ['instagram', 'facebook']).filter(
    (p: unknown): p is 'instagram' | 'facebook' => p === 'instagram' || p === 'facebook'
  )
  if (!platforms.length) return NextResponse.json({ error: 'Scegli Instagram, Facebook o entrambi' }, { status: 400 })
  const id = String(body.draftId || '')
  try {
    const draft = await publishPostDraft(id, {
      platforms,
      caption: typeof body.caption === 'string' ? body.caption : undefined,
      facebook: typeof body.facebook === 'string' ? body.facebook : undefined,
      // Le slide che Luca ha davanti: se sono cambiate da un'altra parte non si pubblica (409).
      base: urlList(body.base) ?? undefined,
    })
    if (draft.status !== 'published') {
      return withState({ error: draft.results?.errors?.join(' · ') || 'Pubblicazione non riuscita' }, 502, draft)
    }
    return withState({ ok: true }, 200, draft)
  } catch (error) {
    if (error instanceof DraftConflictError) return withState({ error: error.message }, 409, error.draft)
    const current = await loadPostDraft(id).catch(() => null)
    return withState({ error: error instanceof Error ? error.message : 'Pubblicazione non riuscita' }, 400, current)
  }
}
