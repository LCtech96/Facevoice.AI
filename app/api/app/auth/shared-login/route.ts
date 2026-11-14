import { NextRequest, NextResponse } from 'next/server'
import { ipHashOf, sharedLogin } from '@/lib/shared-access'

export const dynamic = 'force-dynamic'

// Entrata di un collaboratore: email del titolare + password dei collaboratori (attivata
// dal titolare in Account). Si prova solo dopo l'accesso normale con email e password.
// Ogni 15 minuti al massimo 8 tentativi sbagliati per email dalla stessa rete, 60 per email
// in tutto e 30 per rete; errore sempre uguale. Risponde con l'accesso firmato da usare per
// le API dell'area clienti.

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const result = await sharedLogin(body?.email, body?.password, ipHashOf(req.headers))
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status, headers: { 'Cache-Control': 'no-store' } })
  return NextResponse.json(
    { token: result.token, exp: result.exp, userId: result.userId, email: result.email },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
