import { NextRequest, NextResponse } from 'next/server'
import { bridgeAuthError } from '@/lib/bridge-auth'
import { setUsageLight, userExists } from '@/lib/usage-limits'

export const dynamic = 'force-dynamic'

// Dal pannello di Facevoice: gettone scelto a mano per un utente (verde, arancione,
// rosso) oppure di nuovo automatico. Non sblocca mai l'AI arrivata al limite.

const MODES = new Set(['auto', 'green', 'orange', 'red'])

export async function POST(req: NextRequest) {
  const denied = bridgeAuthError(req)
  if (denied) return denied
  const body = await req.json().catch(() => ({}))
  const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
  const mode = typeof body.mode === 'string' ? body.mode : ''
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !MODES.has(mode)) {
    return NextResponse.json({ error: 'Dati non validi' }, { status: 400 })
  }
  try {
    if (!(await userExists(userId))) return NextResponse.json({ error: 'Utente non trovato' }, { status: 404 })
    const override = await setUsageLight(userId, mode as 'auto' | 'green' | 'orange' | 'red')
    return NextResponse.json({ ok: true, override })
  } catch (error) {
    console.error('collegamento gettone:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Gettone non salvato' }, { status: 500 })
  }
}
