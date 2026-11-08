import { NextRequest, NextResponse } from 'next/server'
import { NO_STORE, errorResponse, guestBoard, json } from '@/lib/todo-http'
import { imageViewUrl } from '@/lib/todo-store'

export const dynamic = 'force-dynamic'

// Foto di un'attivita': le foto stanno in uno spazio privato; da qui (solo con il
// cookie di questa todo list) si viene mandati a un link a tempo di un'ora.

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params
    const access = await guestBoard(req, token)
    if ('res' in access) return access.res
    const url = await imageViewUrl(access.board, req.nextUrl.searchParams.get('p') || '')
    if (!url) return json({ error: 'Immagine non trovata.' }, 404)
    return NextResponse.redirect(url, { status: 302, headers: { ...NO_STORE, 'Cache-Control': 'private, max-age=1800' } })
  } catch (error) {
    return errorResponse(error)
  }
}
