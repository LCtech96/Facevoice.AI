import { NextRequest, NextResponse } from 'next/server'
import { canAccess, getStaffAccess } from '@/lib/staff-access'
import { PhotoError } from '@/lib/photo-library'
import { DraftConflictError, DraftError } from '@/lib/social-posts'

/**
 * Libreria foto e autopilota di Facevoice: vede chi ha "Canali e AI"; carica, cambia e
 * pubblica solo l'amministratore (i caroselli escono sui profili dell'azienda).
 */
export async function photoGuard(req: NextRequest, cap: 'view' | 'edit'): Promise<NextResponse | null> {
  const access = await getStaffAccess(req)
  if (!access) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  if (cap === 'view' ? !canAccess(access, 'control', 'view') : !access.isAdmin) {
    return NextResponse.json({ error: 'Solo l’amministratore può cambiare la libreria foto e l’autopilota.' }, { status: 403 })
  }
  return null
}

export function photoErrorResponse(error: unknown, fallback: string) {
  if (error instanceof PhotoError || error instanceof DraftError) return NextResponse.json({ error: error.message }, { status: error.status })
  if (error instanceof DraftConflictError) return NextResponse.json({ error: error.message }, { status: 409 })
  console.error(`${fallback}:`, error instanceof Error ? error.message : error)
  return NextResponse.json({ error: fallback }, { status: 500 })
}
