import { NextRequest, NextResponse } from 'next/server'
import { writeVideoCaption } from '@/lib/video-posts'
import { videoErrorResponse, videoGuard } from '../auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** { caption, instruction } → didascalia scritta (se vuota) o modificata dall'AI. */
export async function POST(req: NextRequest) {
  const denied = await videoGuard(req, 'edit')
  if (denied) return denied
  try {
    const body = await req.json().catch(() => ({}))
    return NextResponse.json({ caption: await writeVideoCaption(body || {}) })
  } catch (error) {
    return videoErrorResponse(error, 'L’AI non ha risposto, riprova')
  }
}
