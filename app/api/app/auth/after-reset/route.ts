import { NextRequest, NextResponse } from 'next/server'
import { authFromRequest, ownerOnlyResponse } from '@/lib/workspace'
import { disableSharedPassword, readSharedAccess } from '@/lib/shared-access'

export const dynamic = 'force-dynamic'

// Dopo «Password dimenticata» (nuova password dell'account scelta): per sicurezza si spegne
// anche la password dei collaboratori. Se qualcuno aveva preso l'account e l'aveva attivata,
// da qui non entra piu'; il titolare la riattiva da Account con una password nuova.
// Lo chiede la pagina di reimpostazione con la sessione appena usata (mai un collaboratore).

export async function POST(req: NextRequest) {
  let auth
  try {
    auth = await authFromRequest(req)
  } catch {
    return NextResponse.json({ error: 'Non disponibile in questo momento.' }, { status: 503 })
  }
  if (!auth || !('user' in auth)) return NextResponse.json({ error: 'Accedi per continuare' }, { status: 401 })
  if (auth.user.shared) return ownerOnlyResponse()
  try {
    const access = await readSharedAccess(auth.user.id)
    if (!access.enabled) return NextResponse.json({ sharedDisabled: false }, { headers: { 'Cache-Control': 'no-store' } })
    await disableSharedPassword(auth.user.id)
    return NextResponse.json({ sharedDisabled: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('dopo il recupero password:', error instanceof Error ? error.message.slice(0, 160) : error)
    return NextResponse.json({ error: 'Non riesco a spegnere la password dei collaboratori: fallo da Account.' }, { status: 500 })
  }
}
