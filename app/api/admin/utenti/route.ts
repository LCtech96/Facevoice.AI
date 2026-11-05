import { NextRequest, NextResponse } from 'next/server'
import { getAdminEmail } from '@/lib/admin-request'
import { bridgeErrorResponse, callBeta } from '@/lib/beta-bridge'
import { isLightMode, normalizeBetaUsers } from '@/lib/beta-users'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Utenti della beta per la pagina /admin/utenti (solo admin). I dati restano
// sulla beta: qui si passa la richiesta con il segreto del collegamento.

/** Tutti gli utenti registrati sulla beta con spesa AI del periodo e gettone. */
export async function GET(req: NextRequest) {
  if (!(await getAdminEmail(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  try {
    const data = await callBeta('/api/bridge/users')
    return NextResponse.json(normalizeBetaUsers(data), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return bridgeErrorResponse(error)
  }
}

/** { userId, mode: 'auto' | 'green' | 'orange' | 'red' }: il gettone che vede l'utente. */
export async function POST(req: NextRequest) {
  if (!(await getAdminEmail(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const userId = typeof body?.userId === 'string' ? body.userId.trim() : ''
  const mode = body?.mode
  if (!userId || userId.length > 100 || !/^[A-Za-z0-9-]+$/.test(userId)) {
    return NextResponse.json({ error: 'Utente non valido.' }, { status: 400 })
  }
  if (!isLightMode(mode)) {
    return NextResponse.json({ error: 'Scelta non valida: Automatico, Verde, Arancione o Rosso.' }, { status: 400 })
  }

  try {
    const data = (await callBeta('/api/bridge/users/light', { method: 'POST', body: { userId, mode } })) as {
      override?: unknown
    }
    const override = data?.override === 'green' || data?.override === 'orange' || data?.override === 'red' ? data.override : null
    return NextResponse.json({ ok: true, override })
  } catch (error) {
    return bridgeErrorResponse(error)
  }
}
