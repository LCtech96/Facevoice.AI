import { NextRequest, NextResponse } from 'next/server'
import { createVideoUpload } from '@/lib/video-posts'
import { videoErrorResponse, videoGuard } from '../auth'

export const dynamic = 'force-dynamic'

/** { fileName, type, size } → indirizzo firmato per caricare il video dal browser. */
export async function POST(req: NextRequest) {
  const denied = await videoGuard(req, 'edit')
  if (denied) return denied
  try {
    const body = await req.json().catch(() => ({}))
    return NextResponse.json(await createVideoUpload(body || {}))
  } catch (error) {
    return videoErrorResponse(error, 'Caricamento non disponibile')
  }
}
