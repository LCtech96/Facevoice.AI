import { NextRequest, NextResponse } from 'next/server'
import { getAdminEmail } from '@/lib/admin-request'
import { bridgeErrorResponse, callBeta } from '@/lib/beta-bridge'
import { assistantFrom, isLightMode, normalizeBetaUsers, type LightMode } from '@/lib/beta-users'

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

/**
 * Una scelta alla volta per un utente:
 * - { userId, mode: 'auto' | 'green' | 'orange' | 'red' }: il gettone che vede l'utente;
 * - { userId, assistant: true | false }: la chat Assistente della beta accesa o spenta;
 * - { userId, automations: true | false }: la pagina Automazioni della beta visibile o nascosta.
 */
export async function POST(req: NextRequest) {
  if (!(await getAdminEmail(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const userId = typeof body?.userId === 'string' ? body.userId.trim() : ''
  if (!userId || userId.length > 100 || !/^[A-Za-z0-9-]+$/.test(userId)) {
    return NextResponse.json({ error: 'Utente non valido.' }, { status: 400 })
  }

  const choices = [body.mode, body.assistant, body.automations].filter((v) => v !== undefined).length
  if (choices > 1) return NextResponse.json({ error: 'Una scelta alla volta.' }, { status: 400 })

  if (body.automations !== undefined) {
    if (typeof body.automations !== 'boolean') {
      return NextResponse.json({ error: 'Scelta non valida: Visibile o Nascosta.' }, { status: 400 })
    }
    return saveAutomations(userId, body.automations)
  }

  if (body.assistant !== undefined) {
    if (typeof body.assistant !== 'boolean') {
      return NextResponse.json({ error: 'Scelta non valida: Attivo o Spento.' }, { status: 400 })
    }
    return saveAssistant(userId, body.assistant)
  }

  if (!isLightMode(body.mode)) {
    return NextResponse.json({ error: 'Scelta non valida: Automatico, Verde, Arancione o Rosso.' }, { status: 400 })
  }
  return saveLight(userId, body.mode)
}

async function saveLight(userId: string, mode: LightMode) {
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

/** La beta salva la scelta (assistant_access:<userId>) e rifiuta di spegnerla ai membri di Facevoice. */
async function saveAssistant(userId: string, enabled: boolean) {
  try {
    const data = (await callBeta('/api/bridge/users/assistant', { method: 'POST', body: { userId, enabled } })) as {
      assistant?: unknown
    }
    // La beta ha salvato: se non rimanda lo stato vale quello chiesto.
    const assistant = assistantFrom(data?.assistant) ?? { enabled, locked: false }
    return NextResponse.json({ ok: true, assistant })
  } catch (error) {
    return bridgeErrorResponse(error)
  }
}

/** La beta salva la scelta (automations_access:<userId>) e rifiuta di spegnerla ai membri di Facevoice. */
async function saveAutomations(userId: string, enabled: boolean) {
  try {
    const data = (await callBeta('/api/bridge/users/automations', { method: 'POST', body: { userId, enabled } })) as {
      automations?: unknown
    }
    // La beta ha salvato: se non rimanda lo stato vale quello chiesto.
    const automations = typeof data?.automations === 'boolean' ? data.automations : enabled
    return NextResponse.json({ ok: true, automations })
  } catch (error) {
    return bridgeErrorResponse(error)
  }
}
