import { NextRequest, NextResponse } from 'next/server'
import { bridgeAuthError } from '@/lib/bridge-auth'
import { bridgeUsers } from '@/lib/usage-limits'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Per il pannello di Facevoice (sito principale, pagina Utenti): tutti gli utenti
// registrati qui, con la spesa AI del periodo, il gettone e il dettaglio per collegamento,
// l'Assistente e le Automazioni (automations: pagina visibile, automationsSentToday: email di oggi).

export async function GET(req: NextRequest) {
  const denied = bridgeAuthError(req)
  if (denied) return denied
  try {
    return NextResponse.json(await bridgeUsers(), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('collegamento utenti:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Utenti non disponibili' }, { status: 500 })
  }
}
