import { NextRequest, NextResponse } from 'next/server'
import { authFromRequest, ownerOnlyResponse } from '@/lib/workspace'
import { readSharedAccess, verifySharedPassword } from '@/lib/shared-access'
import { reserveSlot } from '@/lib/limiter'

export const dynamic = 'force-dynamic'

// Prima di salvare la nuova password dell'account (pagina «Password dimenticata»): non deve
// essere la password dei collaboratori. Chi la conosce entrerebbe come titolare, con tutti i
// poteri sull'account; spegnerla dopo non basta, perche' la stringa la sanno gia'.
// La chiede la pagina di reimpostazione con la sessione appena aperta (mai un collaboratore).
// Risposte: 200 { ok } se va bene, 409 se e' quella dei collaboratori; ogni errore 503
// (la pagina non salva: meglio riprovare che salvare senza controllo).

const NO_STORE = { 'Cache-Control': 'no-store' }
const UNAVAILABLE = () => NextResponse.json({ error: 'Non riesco a controllare la password in questo momento, riprova tra poco.' }, { status: 503, headers: NO_STORE })

export async function POST(req: NextRequest) {
  let auth
  try {
    auth = await authFromRequest(req)
  } catch {
    return UNAVAILABLE()
  }
  if (!auth || !('user' in auth)) return NextResponse.json({ error: 'Accedi per continuare' }, { status: 401, headers: NO_STORE })
  if (auth.user.shared) return ownerOnlyResponse()
  const body = await req.json().catch(() => null)
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!password || password.length > 200) return NextResponse.json({ error: 'Password non valida.' }, { status: 400, headers: NO_STORE })
  try {
    // Pochi controlli per account (ognuno e' un calcolo scrypt).
    if (!(await reserveSlot(`pw_reset_check:${auth.user.id}`, [{ windowMs: 15 * 60_000, max: 20 }]))) {
      return NextResponse.json({ error: 'Troppi tentativi: aspetta qualche minuto e riprova.' }, { status: 429, headers: NO_STORE })
    }
    const access = await readSharedAccess(auth.user.id)
    if (access.enabled && access.hash && (await verifySharedPassword(password, access.hash))) {
      return NextResponse.json(
        { error: 'Questa è la password dei collaboratori: scegline una diversa, che conosci solo tu.', code: 'same_as_shared' },
        { status: 409, headers: NO_STORE }
      )
    }
    return NextResponse.json({ ok: true }, { headers: NO_STORE })
  } catch (error) {
    console.error('controllo nuova password:', error instanceof Error ? error.message.slice(0, 160) : error)
    return UNAVAILABLE()
  }
}
