import { createHash, timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { bridgeSecret } from '@/lib/usage-limits'

// Collegamento tra il sito principale (pannello di Facevoice) e questa app: le
// richieste portano la chiave condivisa FACEVOICE_BRIDGE_SECRET nell'header
// x-bridge-secret. Nessuna sessione utente: vale solo la chiave.

/** null se la richiesta e' autorizzata, altrimenti la risposta di errore da restituire. */
export function bridgeAuthError(req: NextRequest): NextResponse | null {
  const secret = bridgeSecret()
  if (!secret) return NextResponse.json({ error: 'Collegamento non configurato' }, { status: 503 })
  const given = req.headers.get('x-bridge-secret')?.trim() || ''
  // Confronto a tempo costante su due impronte della stessa lunghezza.
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(secret).digest()
  if (!given || a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }
  return null
}
