import { NextRequest, NextResponse } from 'next/server'
import { guard } from '@/lib/staff-access'
import { createWaMediaUpload } from '@/lib/wa-media'
import { WaError } from '@/lib/wa-store'

export const dynamic = 'force-dynamic'

/**
 * Foto o video da mandare su WhatsApp dalla casella: { fileName, type, size } -> indirizzo
 * firmato per caricare il file direttamente dal browser (JPG/PNG fino a 5 MB, MP4 fino a 16 MB).
 * L'invio vero passa da POST /api/admin/inbox/thread con { media: { url }, text }.
 */
export async function POST(req: NextRequest) {
  const access = await guard(req, 'inbox', 'reply')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  try {
    return NextResponse.json(await createWaMediaUpload({ fileName: body?.fileName, type: body?.type, size: body?.size }, ['image', 'video'], 'chat'))
  } catch (error) {
    if (error instanceof WaError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('casella, caricamento file:', error)
    return NextResponse.json({ error: 'Caricamento non disponibile: riprova.' }, { status: 500 })
  }
}
