import { NextRequest, NextResponse } from 'next/server'
import { canAccess, getStaffAccess } from '@/lib/staff-access'
import { VideoError } from '@/lib/video-posts'

/**
 * Video su Instagram e Facebook di Facevoice: vede chi ha "Canali e AI"; carica, programma
 * e pubblica solo l'amministratore (escono sui profili dell'azienda).
 */
export async function videoGuard(req: NextRequest, cap: 'view' | 'edit'): Promise<NextResponse | null> {
  const access = await getStaffAccess(req)
  if (!access) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  if (cap === 'view' ? !canAccess(access, 'control', 'view') : !access.isAdmin) {
    return NextResponse.json({ error: 'Solo l’amministratore può caricare e pubblicare i video.' }, { status: 403 })
  }
  return null
}

export function videoErrorResponse(error: unknown, fallback: string) {
  if (error instanceof VideoError) return NextResponse.json({ error: error.message }, { status: error.status })
  console.error(`${fallback}:`, error instanceof Error ? error.message : error)
  return NextResponse.json({ error: fallback }, { status: 500 })
}
