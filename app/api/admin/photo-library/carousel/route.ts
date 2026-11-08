import { NextRequest, NextResponse } from 'next/server'
import { approveCarousel } from '@/lib/photo-library'
import { DraftError, unschedulePostDraft, updatePostDraft, loadPostDraft } from '@/lib/social-posts'
import { photoErrorResponse, photoGuard } from '../auth'

export const dynamic = 'force-dynamic'

/**
 * Caroselli programmati o da approvare: { id, action }.
 * approve = esce entro un minuto; unschedule = torna bozza; dismiss = non va pubblicato (resta tra le bozze).
 */
export async function POST(req: NextRequest) {
  const denied = await photoGuard(req, 'edit')
  if (denied) return denied
  try {
    const body = await req.json().catch(() => ({}))
    const id = String(body?.id || '')
    if (body?.action === 'approve') return NextResponse.json({ draft: await approveCarousel(id, Array.isArray(body?.base) ? body.base : undefined) })
    if (body?.action === 'unschedule') return NextResponse.json({ draft: await unschedulePostDraft(id) })
    if (body?.action === 'dismiss') {
      const draft = await loadPostDraft(id)
      if (!draft) throw new DraftError('Carosello non trovato', 404)
      return NextResponse.json({ draft: await updatePostDraft(id, draft.urls, (current) => ({ ...current, needsApproval: false })) })
    }
    throw new DraftError('Azione non valida.')
  } catch (error) {
    return photoErrorResponse(error, 'Operazione non riuscita')
  }
}
