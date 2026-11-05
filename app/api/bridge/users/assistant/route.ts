import { NextRequest, NextResponse } from 'next/server'
import { bridgeAuthError } from '@/lib/bridge-auth'
import { userExists } from '@/lib/usage-limits'
import { ASSISTANT_LOCKED_MESSAGE, facevoiceMember, setAssistantAccess } from '@/lib/assistant-access'

export const dynamic = 'force-dynamic'

// Dal pannello di Facevoice (pagina Utenti): accende o spegne la pagina Assistente per
// una persona. Chi e' nello spazio Facevoice l'ha sempre attiva e non si tocca.

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
    if (await facevoiceMember(userId)) return NextResponse.json({ error: ASSISTANT_LOCKED_MESSAGE }, { status: 400 })
    await setAssistantAccess(userId, enabled)
    return NextResponse.json({ ok: true, assistant: { enabled, locked: false } })
  } catch (error) {
    console.error('collegamento assistente:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Assistente non salvato' }, { status: 500 })
  }
}
