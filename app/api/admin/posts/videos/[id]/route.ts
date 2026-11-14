import { NextRequest, NextResponse } from 'next/server'
import { deleteVideoPost, publishVideoNow, updateVideoPost, videoForClient } from '@/lib/video-posts'
import { videoErrorResponse, videoGuard } from '../auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * { caption?, platforms?, tiktokOptions?, scheduledAt? } modifica (scheduledAt null = annulla la programmazione);
 * con publishNow: true pubblica subito (con le modifiche passate).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await videoGuard(req, 'edit')
  if (denied) return denied
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const patch = {
      ...(body && 'caption' in body ? { caption: body.caption } : {}),
      ...(body && 'platforms' in body ? { platforms: body.platforms } : {}),
      ...(body && 'tiktokOptions' in body ? { tiktokOptions: body.tiktokOptions } : {}),
    }
    if (body?.publishNow) return NextResponse.json({ video: videoForClient(await publishVideoNow(id, patch)) })
    const video = await updateVideoPost(id, { ...patch, ...(body && 'scheduledAt' in body ? { scheduledAt: body.scheduledAt } : {}) })
    return NextResponse.json({ video: videoForClient(video) })
  } catch (error) {
    return videoErrorResponse(error, 'Errore nel modificare il video')
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await videoGuard(req, 'edit')
  if (denied) return denied
  try {
    const { id } = await params
    await deleteVideoPost(id)
    return NextResponse.json({ success: true })
  } catch (error) {
    return videoErrorResponse(error, 'Errore nell’eliminare il video')
  }
}
