import { NextRequest, NextResponse } from 'next/server'
import { getAdminEmail } from '@/lib/admin-request'
import { bridgeErrorResponse, callBeta } from '@/lib/beta-bridge'
import { isTermsVersion, termsTextFrom } from '@/lib/beta-users'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Testo esatto di una versione dei termini e condizioni della beta (pagina Utenti, "Vedi i
// termini accettati"). Solo admin: il testo resta sulla beta, qui passa con il segreto del
// collegamento. GET ?version=AAAA-MM-GG.

export async function GET(req: NextRequest) {
  if (!(await getAdminEmail(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const version = req.nextUrl.searchParams.get('version')?.trim() || ''
  if (!isTermsVersion(version)) return NextResponse.json({ error: 'Versione non valida.' }, { status: 400 })
  try {
    const doc = termsTextFrom(await callBeta(`/api/bridge/terms?version=${encodeURIComponent(version)}`))
    if (!doc || doc.version !== version) {
      return NextResponse.json({ error: 'La beta ha mandato un testo non valido.' }, { status: 502 })
    }
    return NextResponse.json(doc, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return bridgeErrorResponse(error)
  }
}
