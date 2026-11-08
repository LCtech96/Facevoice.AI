import { NextRequest, NextResponse } from 'next/server'
import { NO_STORE, errorResponse, json, projectAccess } from '@/lib/todo-http'
import { imageViewUrl } from '@/lib/todo-store'

export const dynamic = 'force-dynamic'

// Foto di un'attivita' di un progetto aperto dalla schermata generale: solo per chi
// puo' aprire quel progetto; si viene mandati a un link a tempo di un'ora.

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const access = await projectAccess(req, id)
    if ('res' in access) return access.res
    const url = await imageViewUrl(access.board, req.nextUrl.searchParams.get('p') || '')
    if (!url) return json({ error: 'Immagine non trovata.' }, 404)
    return NextResponse.redirect(url, { status: 302, headers: { ...NO_STORE, 'Cache-Control': 'private, max-age=1800' } })
  } catch (error) {
    return errorResponse(error)
  }
}
