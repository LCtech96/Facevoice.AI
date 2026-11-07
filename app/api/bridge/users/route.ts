import { NextRequest, NextResponse } from 'next/server'
import { bridgeAuthError } from '@/lib/bridge-auth'
import { bridgeUsers } from '@/lib/usage-limits'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Per il pannello di Facevoice (sito principale, pagina Utenti): tutti gli utenti
// registrati qui, con la spesa AI del periodo, il gettone e il dettaglio per collegamento,
// l'Assistente e le Automazioni (automations: pagina visibile, automationsSentToday: email di oggi).
// terms: ultima accettazione dei termini e condizioni (versione, data, IP, browser, caselle
// spuntate, impronta del testo; current = e' la versione in vigore), null se mai accettati.
// Se le accettazioni non si leggono il campo manca (il pannello non mostra un falso "no").

type BridgeTerms = {
  version: string
  acceptedAt: string
  ip: string
  userAgent: string
  items: string[]
  textHash: string
  email: string
  source: string
  current: boolean
}

/** Ultima accettazione per utente e versione in vigore; null se non si leggono. */
async function termsByUser(): Promise<{ version: string; byUser: Map<string, BridgeTerms> } | null> {
  try {
    const [{ latestAcceptances }, { TERMS_VERSION }] = await Promise.all([import('@/lib/terms-acceptance'), import('@/lib/terms')])
    const byUser = new Map<string, BridgeTerms>()
    for (const [userId, e] of await latestAcceptances()) {
      byUser.set(userId, {
        version: e.version,
        acceptedAt: e.acceptedAt,
        ip: e.ip,
        userAgent: e.userAgent,
        items: e.items,
        textHash: e.textHash,
        email: e.email,
        source: e.source,
        current: e.version === TERMS_VERSION,
      })
    }
    return { version: TERMS_VERSION, byUser }
  } catch (error) {
    console.error('collegamento utenti, termini:', error instanceof Error ? error.message : error)
    return null
  }
}

export async function GET(req: NextRequest) {
  const denied = bridgeAuthError(req)
  if (denied) return denied
  try {
    const [data, terms] = await Promise.all([bridgeUsers(), termsByUser()])
    const body = terms
      ? { ...data, termsVersion: terms.version, users: data.users.map((u) => ({ ...u, terms: terms.byUser.get(u.id) ?? null })) }
      : data
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('collegamento utenti:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Utenti non disponibili' }, { status: 500 })
  }
}
