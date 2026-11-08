import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'
import { requireVideoReplies } from '@/lib/video-replies-access'
import { createVideoUpload, VIDEO_MAX_MB } from '@/lib/saas/video'
import {
  createVideoReply,
  deleteVideoReply,
  detachVideoFromDraft,
  listVideoReplies,
  updateVideoReply,
  videoReplyView,
  VideoReplyError,
} from '@/lib/saas/video-replies'
import { DM_VIDEO_LIMIT_BYTES } from '@/lib/saas/video-replies-shared'

export const dynamic = 'force-dynamic'

// Video risposte (Automazioni → "Video automazione", e Assistente): video che l'AI manda nei
// messaggi diretti quando la richiesta della persona corrisponde a "quando mandarlo".
// GET    -> elenco, limiti degli allegati per canale e dell'archivio
// POST action=upload_url -> indirizzo firmato: il browser carica il video direttamente nell'archivio
// POST action=create     -> crea la video risposta dal video caricato
// POST action=detach     -> toglie il video proposto da una bozza dell'Omnichat
// PATCH  {id, ...}       -> titolo, quando mandarlo, messaggio, canali, attiva, una sola volta per persona
// DELETE {id}            -> elimina
// Tutto solo con la Video automazione attiva (per chi chiede e per il titolare: lib/video-replies-access.ts),
// tranne "togli il video" da una bozza (chi puo' inviare la bozza puo' anche toglierlo).

const fail = (error: unknown, fallback: string, status = 400) => {
  const message = error instanceof Error && error.message ? error.message : fallback
  if (!(error instanceof VideoReplyError)) console.error(`saas video risposte: ${message}`)
  return NextResponse.json({ error: message.charAt(0).toUpperCase() + message.slice(1) }, { status })
}

export async function GET(req: NextRequest) {
  const access = await requireVideoReplies(req)
  if (access instanceof NextResponse) return access
  try {
    const videos = await listVideoReplies(access.workspace.id)
    return NextResponse.json({ videos: videos.map(videoReplyView), limits: DM_VIDEO_LIMIT_BYTES, maxMb: VIDEO_MAX_MB })
  } catch (error) {
    return fail(error, 'Video risposte non disponibili, riprova.', 500)
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const action = String(body.action || '')
  const access = action === 'detach' ? await requireWorkspace(req) : await requireVideoReplies(req, 'admin')
  if (access instanceof NextResponse) return access
  try {
    if (action === 'upload_url') return NextResponse.json(await createVideoUpload(access.workspace.id, body))
    if (action === 'create') {
      const { video, warning } = await createVideoReply(access.workspace.id, body, { userId: access.userId, origin: req.nextUrl.origin })
      return NextResponse.json({ video: videoReplyView(video), warning })
    }
    if (action === 'detach') {
      const { data: draft } = await access.db.from('social_messages').select('id, platform, contact_id, direction').eq('id', String(body.draftId || '')).maybeSingle()
      if (!draft || draft.direction !== 'out') return NextResponse.json({ error: 'Bozza non trovata' }, { status: 404 })
      await detachVideoFromDraft(access.workspace.id, draft.platform as string, draft.contact_id as string, draft.id as string)
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'Azione non valida' }, { status: 400 })
  } catch (error) {
    return fail(error, 'Operazione non riuscita')
  }
}

export async function PATCH(req: NextRequest) {
  const access = await requireVideoReplies(req, 'admin')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  try {
    const { video, warning } = await updateVideoReply(access.workspace.id, String(body.id || ''), body)
    return NextResponse.json({ video: videoReplyView(video), warning })
  } catch (error) {
    return fail(error, 'Modifica non riuscita')
  }
}

export async function DELETE(req: NextRequest) {
  const access = await requireVideoReplies(req, 'admin')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  const id = String(body.id || req.nextUrl.searchParams.get('id') || '')
  try {
    await deleteVideoReply(access.workspace.id, id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return fail(error, 'Eliminazione non riuscita')
  }
}
