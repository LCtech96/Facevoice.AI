import { NextRequest, NextResponse } from 'next/server'
import { requireAssistant } from '@/lib/assistant-access'
import { uploadWorkspaceImage } from '@/lib/saas/posts'

export const dynamic = 'force-dynamic'

// Caricamento di una foto (gia' ridotta nel browser) nell'archivio dello spazio.
// La usa solo l'Assistente: serve l'assistente attivo per chi fa la richiesta.

const DATA_URL = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/

export async function POST(req: NextRequest) {
  const access = await requireAssistant(req, 'admin')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  const match = typeof body.data === 'string' && body.data.length <= 4_000_000 ? body.data.match(DATA_URL) : null
  if (!match) return NextResponse.json({ error: 'Immagine non valida o troppo grande' }, { status: 400 })
  try {
    const url = await uploadWorkspaceImage(access.workspace.id, Buffer.from(match[2], 'base64'))
    return NextResponse.json({ url })
  } catch (error) {
    console.error('saas media:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Foto non caricata, riprova.' }, { status: 500 })
  }
}
