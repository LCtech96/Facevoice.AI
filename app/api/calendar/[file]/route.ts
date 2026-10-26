import { NextRequest, NextResponse } from 'next/server'
import { buildIcs, calendarToken, listAppointments } from '@/lib/appointments'

export const dynamic = 'force-dynamic'

/**
 * Calendario degli appuntamenti da abbonare sull'iPhone (webcal://…/api/calendar/<codice>.ics).
 * Il codice segreto e' l'unica protezione: chi non lo conosce riceve 404.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params
  const token = calendarToken()
  if (!token || file.replace(/\.ics$/, '') !== token) return new NextResponse('Not found', { status: 404 })
  const since = Date.now() - 30 * 86_400_000
  const appointments = (await listAppointments()).filter((a) => new Date(a.when).getTime() > since)
  return new NextResponse(buildIcs(appointments, req.nextUrl.origin), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="facevoice-appuntamenti.ics"',
      'Cache-Control': 'no-store',
    },
  })
}
