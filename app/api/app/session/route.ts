import { NextRequest, NextResponse } from 'next/server'
import { authFromRequest, sharedRevokedResponse } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

// Controllo leggero e frequente (ogni 30 secondi con l'app aperta) per chi e' entrato con
// la password dei collaboratori: se il titolare la cambia o la spegne, esce subito.
// Un errore temporaneo risponde 503 e non fa uscire nessuno.

export async function GET(req: NextRequest) {
  let auth
  try {
    auth = await authFromRequest(req)
  } catch {
    return NextResponse.json({ error: 'Controllo non disponibile, riprovo tra poco.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
  if (auth && 'revoked' in auth) return sharedRevokedResponse(auth.revoked)
  if (!auth) return NextResponse.json({ error: 'Accedi per continuare' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  return NextResponse.json({ ok: true, shared: Boolean(auth.user.shared) }, { headers: { 'Cache-Control': 'no-store' } })
}
