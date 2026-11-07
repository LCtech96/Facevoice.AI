import { NextRequest, NextResponse } from 'next/server'
import { getStaffAccess, type StaffAccess } from '@/lib/staff-access'
import { ContractError } from '@/lib/contracts'

// Pezzi comuni delle route dei contratti: mai in cache, mai indicizzate, solo
// l'amministratore per le route interne, controlli su origine e dimensione per
// quelle pubbliche del link.

export const NO_STORE = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE })

/** Solo l'amministratore (i dipendenti no: i contratti hanno dati personali). */
export async function adminOnly(req: NextRequest): Promise<StaffAccess | NextResponse> {
  const access = await getStaffAccess(req)
  if (!access) return json({ error: 'Non autorizzato' }, 401)
  if (!access.isAdmin) return json({ error: 'Solo l’amministratore può vedere e gestire i contratti.' }, 403)
  return access
}

/** Corpo JSON entro una dimensione massima (la firma disegnata sta comoda in 300 KB). */
export async function readBody(req: NextRequest, max = 300_000): Promise<Record<string, unknown> | null> {
  const raw = await req.text().catch(() => '')
  if (!raw || raw.length > max) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Le richieste che cambiano qualcosa arrivano dalla stessa origine (difesa in piu' oltre al cookie SameSite). */
export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return true
  try {
    return new URL(origin).host === (req.headers.get('x-forwarded-host') || req.headers.get('host') || req.nextUrl.host)
  } catch {
    return false
  }
}

/** IP di chi firma (per il registro delle firme): il primo di x-forwarded-for, ripulito. */
export function clientIp(req: NextRequest): string {
  const raw = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || ''
  const clean = raw.replace(/[^0-9a-fA-F:.]/g, '').slice(0, 64)
  return clean || 'non disponibile'
}

export function errorResponse(error: unknown) {
  if (error instanceof ContractError) return json({ error: error.message }, error.status)
  console.error('contratti: errore', error instanceof Error ? error.message : 'sconosciuto')
  return json({ error: 'Qualcosa non è andato: riprova.' }, 500)
}
