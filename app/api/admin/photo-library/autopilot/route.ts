import { NextRequest, NextResponse } from 'next/server'
import { requestPhotoTask, saveAutopilotSettings, startAutopilotNow } from '@/lib/photo-library'
import { photoErrorResponse, photoGuard } from '../auth'

export const dynamic = 'force-dynamic'

/** Impostazioni dell'autopilota (solo i campi da cambiare). */
export async function PUT(req: NextRequest) {
  const denied = await photoGuard(req, 'edit')
  if (denied) return denied
  try {
    const body = await req.json().catch(() => ({}))
    return NextResponse.json({ settings: await saveAutopilotSettings(body || {}) })
  } catch (error) {
    return photoErrorResponse(error, 'Impostazioni non salvate')
  }
}

/** "Prova ora": un carosello subito, con le regole dell'autopilota. */
export async function POST(req: NextRequest) {
  const denied = await photoGuard(req, 'edit')
  if (denied) return denied
  try {
    const key = await startAutopilotNow((k) => requestPhotoTask(req.nextUrl.origin, { task: 'autopilot', key: k }))
    return NextResponse.json({ ok: true, key })
  } catch (error) {
    return photoErrorResponse(error, 'Avvio non riuscito')
  }
}
