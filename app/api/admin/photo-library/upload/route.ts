import { NextRequest, NextResponse } from 'next/server'
import { createPhotoUploads } from '@/lib/photo-library'
import { photoErrorResponse, photoGuard } from '../auth'

export const dynamic = 'force-dynamic'

/** { files: [{ fileName, type, size }] } → indirizzi firmati per caricare le foto dal browser. */
export async function POST(req: NextRequest) {
  const denied = await photoGuard(req, 'edit')
  if (denied) return denied
  try {
    const body = await req.json().catch(() => ({}))
    return NextResponse.json({ uploads: await createPhotoUploads(body?.files) })
  } catch (error) {
    return photoErrorResponse(error, 'Caricamento non disponibile')
  }
}
