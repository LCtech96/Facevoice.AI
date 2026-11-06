import { NextRequest, NextResponse } from 'next/server'
import { bridgeAuthError } from '@/lib/bridge-auth'
import { userExists } from '@/lib/usage-limits'
import { facevoiceMember } from '@/lib/assistant-access'
import { AUTOMATIONS_LOCKED_MESSAGE, setAutomationsAccess } from '@/lib/automations-access'

export const dynamic = 'force-dynamic'

// Dal pannello di Facevoice (pagina Utenti): mostra o nasconde la pagina Automazioni
// (email programmate) per una persona. Come l'Assistente: chi e' nello spazio Facevoice
// l'ha sempre attiva e non si tocca. Con la pagina nascosta le sue automazioni non partono
// e l'Assistente non le comanda.

export async function POST(req: NextRequest) {
  const denied = bridgeAuthError(req)
  if (denied) return denied
  const body = await req.json().catch(() => null)
  const userId = typeof body?.userId === 'string' ? body.userId.trim() : ''
  const enabled = body?.enabled
  if (!/^[0-9a-f-]{36}$/i.test(userId) || typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'Dati non validi' }, { status: 400 })
  }
  try {
    if (!(await userExists(userId))) return NextResponse.json({ error: 'Utente non trovato' }, { status: 404 })
    if (await facevoiceMember(userId)) return NextResponse.json({ error: AUTOMATIONS_LOCKED_MESSAGE }, { status: 400 })
    await setAutomationsAccess(userId, enabled)
    return NextResponse.json({ ok: true, automations: enabled })
  } catch (error) {
    console.error('collegamento automazioni:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Automazioni non salvate' }, { status: 500 })
  }
}
