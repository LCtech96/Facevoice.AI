import { NextRequest, NextResponse } from 'next/server'
import { createVideoPost, listVideoPosts, publishVideoNow } from '@/lib/video-posts'
import { videoErrorResponse, videoGuard } from './auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Video caricati (dal piu' recente). */
export async function GET(req: NextRequest) {
  const denied = await videoGuard(req, 'view')
  if (denied) return denied
  try {
    return NextResponse.json({ videos: await listVideoPosts() })
  } catch (error) {
    return videoErrorResponse(error, 'Errore nel caricare i video')
  }
}

/**
 * Nuovo video dopo il caricamento del file: { path, fileName, caption, platforms, scheduledAt }
 * (scheduledAt vuoto = bozza), oppure con publishNow: true per pubblicarlo subito.
 */
export async function POST(req: NextRequest) {
  const denied = await videoGuard(req, 'edit')
  if (denied) return denied
  try {
    const body = await req.json().catch(() => ({}))
    const post = await createVideoPost({ ...body, scheduledAt: body?.publishNow ? null : body?.scheduledAt })
    return NextResponse.json({ video: body?.publishNow ? await publishVideoNow(post.id) : post })
  } catch (error) {
    return videoErrorResponse(error, 'Errore nel salvare il video')
  }
}
