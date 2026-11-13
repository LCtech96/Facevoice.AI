import { NextRequest, NextResponse } from 'next/server'
import { calendarFeed } from '@/lib/todo-calendar'

export const dynamic = 'force-dynamic'

// File del calendario (.ics) che l'iPhone, Google Calendar o Outlook rileggono da soli.
// Il link e' segreto e firmato: senza link giusto lo stesso «non trovato». Solo
// lettura, mai indicizzato.

const HEADERS = { 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' }

export async function GET(req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params
  const token = decodeURIComponent(file || '').replace(/\.ics$/i, '')
  try {
    const ics = await calendarFeed(token, req.nextUrl.origin)
    if (!ics) return new NextResponse('Calendario non trovato.', { status: 404, headers: { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
    return new NextResponse(ics, {
      status: 200,
      headers: {
        ...HEADERS,
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="progetti-facevoice.ics"',
        'Cache-Control': 'private, max-age=300',
      },
    })
  } catch (error) {
    console.error('todo: calendario', error instanceof Error ? error.message.slice(0, 160) : 'errore')
    return new NextResponse('Calendario non disponibile in questo momento.', { status: 503, headers: { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
  }
}
