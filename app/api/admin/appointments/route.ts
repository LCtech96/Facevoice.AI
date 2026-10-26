import { NextRequest, NextResponse } from 'next/server'
import { guard } from '@/lib/staff-access'
import { calendarToken, listAppointments, setAppointmentStatus } from '@/lib/appointments'

export const dynamic = 'force-dynamic'

/** Prossimi appuntamenti; all'admin anche l'indirizzo del calendario da abbonare. */
export async function GET(req: NextRequest) {
  const access = await guard(req, 'leads', 'view')
  if (access instanceof NextResponse) return access
  const token = access.isAdmin ? calendarToken() : null
  const host = req.nextUrl.host
  return NextResponse.json({
    appointments: await listAppointments({ upcoming: true }),
    calendarUrl: token ? `webcal://${host}/api/calendar/${token}.ics` : null,
    calendarHttps: token ? `https://${host}/api/calendar/${token}.ics` : null,
  })
}

/** Annulla (o riattiva) un appuntamento. body: { id, status: 'cancelled' | 'confirmed' } */
export async function PATCH(req: NextRequest) {
  const access = await guard(req, 'leads', 'calls')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  if (typeof body?.id !== 'string' || !['cancelled', 'confirmed'].includes(body?.status)) {
    return NextResponse.json({ error: 'Richiesta non valida' }, { status: 400 })
  }
  const appointment = await setAppointmentStatus(body.id, body.status)
  if (!appointment) return NextResponse.json({ error: 'Appuntamento non trovato' }, { status: 404 })
  return NextResponse.json({ appointment })
}
