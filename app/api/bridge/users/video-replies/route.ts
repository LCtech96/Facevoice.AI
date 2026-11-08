import { NextRequest, NextResponse } from 'next/server'
import { bridgeAuthError } from '@/lib/bridge-auth'
import { userExists } from '@/lib/usage-limits'
import { facevoiceMember } from '@/lib/assistant-access'
import { VIDEO_REPLIES_LOCKED_MESSAGE, setVideoRepliesAccess } from '@/lib/video-replies-access'

export const dynamic = 'force-dynamic'

// Dal pannello di Facevoice (pagina Utenti): mostra o nasconde la "Video automazione"
// (video risposte nei messaggi diretti) per una persona. Come le Automazioni: chi e' nello
// spazio Facevoice l'ha sempre attiva e non si tocca. Spenta: la scheda sparisce, le API
// rifiutano, l'Assistente non la comanda e (se e' il titolare) i video non partono.

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
    if (await facevoiceMember(userId)) return NextResponse.json({ error: VIDEO_REPLIES_LOCKED_MESSAGE }, { status: 400 })
    await setVideoRepliesAccess(userId, enabled)
    return NextResponse.json({ ok: true, videoReplies: enabled })
  } catch (error) {
    console.error('collegamento video automazione:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Video automazione non salvata' }, { status: 500 })
  }
}
