import { createHmac } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendPushToAdmins } from '@/lib/push'
import { romeOffsetMinutes } from '@/lib/lead-send'

// Appuntamenti fissati dall'AI nelle conversazioni (chiamate o incontri con un
// giorno e un'ora precisi). Finiscono in un calendario da abbonare sull'iPhone
// (con promemoria) e arriva subito una notifica push. Una riga di app_settings
// per appuntamento: appointment:<id>.

const PREFIX = 'appointment:'
/** Durata segnata in calendario. */
const DURATION_MIN = 30

export type Appointment = {
  id: string
  /** Inizio, ISO UTC. */
  when: string
  kind: string
  phone: string | null
  note: string | null
  contactName: string | null
  platform: string
  contactId: string
  leadId?: string | null
  createdAt: string
  status: 'confirmed' | 'cancelled'
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

export async function listAppointments(opts: { upcoming?: boolean } = {}): Promise<Appointment[]> {
  const { data } = await supabaseAdmin.from('app_settings').select('value').like('key', `${PREFIX}%`).limit(1000)
  const list = (data || [])
    .map((row) => {
      try {
        return JSON.parse(row.value) as Appointment
      } catch {
        return null
      }
    })
    .filter((a): a is Appointment => Boolean(a?.when))
    .sort((a, b) => a.when.localeCompare(b.when))
  // In calendario restano anche quelli di ieri; nella lista "prossimi" solo da un'ora fa in poi.
  return opts.upcoming ? list.filter((a) => a.status === 'confirmed' && new Date(a.when).getTime() > Date.now() - 3_600_000) : list
}

/** "2026-10-30 15:30" (ora italiana) → Date. */
export function romeLocalToDate(day: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{1,2}:\d{2}$/.test(time)) return null
  const [h, m] = time.split(':').map(Number)
  const guess = new Date(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`)
  if (Number.isNaN(guess.getTime())) return null
  // L'ora legale si calcola per quel giorno, non per oggi.
  return new Date(guess.getTime() - romeOffsetMinutes(guess) * 60_000)
}

export const formatRome = (iso: string) =>
  new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Orari gia' occupati nei prossimi giorni, per l'AI (cosi' non propone quelli). */
export async function bookedSlotsText(): Promise<string> {
  const list = await listAppointments({ upcoming: true })
  return list.length ? list.map((a) => `${formatRome(a.when)} (${DURATION_MIN} min)`).join('; ') : 'nessuno'
}

/** Riga che l'AI aggiunge quando un appuntamento e' confermato (o annullato). */
const MARKER_RE = /\[\[APPUNTAMENTO:\s*([^\]]+)\]\]/g
const CANCEL_RE = /\[\[APPUNTAMENTO_ANNULLATO\]\]/g

export type ParsedAppointment = { when: Date; kind: string; phone: string | null; note: string | null }

export function parseAppointmentMarkers(text: string): { text: string; appointments: ParsedAppointment[]; cancel: boolean } {
  const appointments: ParsedAppointment[] = []
  for (const match of text.matchAll(MARKER_RE)) {
    const [dateTime, kind, phone, note] = match[1].split('|').map((p) => p.trim())
    const [day, time] = (dateTime || '').split(/\s+/)
    const when = romeLocalToDate(day || '', time || '')
    if (!when) continue
    appointments.push({
      when,
      kind: kind || 'chiamata',
      phone: phone && phone !== '-' ? phone.slice(0, 40) : null,
      note: note && note !== '-' ? note.slice(0, 300) : null,
    })
  }
  const cancel = CANCEL_RE.test(text)
  const clean = text.replace(MARKER_RE, '').replace(CANCEL_RE, '').replace(/\n{3,}/g, '\n\n').trim()
  return { text: clean, appointments, cancel }
}

/** Annulla gli appuntamenti futuri ancora confermati con questa persona. */
export async function cancelAppointmentsFor(platform: string, contactId: string) {
  const list = await listAppointments({ upcoming: true })
  for (const a of list.filter((x) => x.platform === platform && x.contactId === contactId)) {
    await supabaseAdmin
      .from('app_settings')
      .update({ value: JSON.stringify({ ...a, status: 'cancelled' }), updated_at: new Date().toISOString() })
      .eq('key', `${PREFIX}${a.id}`)
  }
}

export async function createAppointment(input: Omit<Appointment, 'id' | 'createdAt' | 'status'>): Promise<Appointment> {
  const appointment: Appointment = { ...input, id: newId(), createdAt: new Date().toISOString(), status: 'confirmed' }
  await supabaseAdmin
    .from('app_settings')
    .upsert({ key: `${PREFIX}${appointment.id}`, value: JSON.stringify(appointment), updated_at: appointment.createdAt })
  await sendPushToAdmins({
    title: '📅 Appuntamento fissato',
    body: `${input.contactName || 'Contatto'} · ${formatRome(input.when)} · ${input.kind}${input.phone ? ` · ${input.phone}` : ''}`,
    url: '/admin/pipeline',
  }).catch(() => undefined)
  return appointment
}

export async function setAppointmentStatus(id: string, status: Appointment['status']) {
  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', `${PREFIX}${id}`).maybeSingle()
  if (!data) return null
  const appointment = { ...(JSON.parse(data.value) as Appointment), status }
  await supabaseAdmin
    .from('app_settings')
    .update({ value: JSON.stringify(appointment), updated_at: new Date().toISOString() })
    .eq('key', `${PREFIX}${id}`)
  return appointment
}

// ---------------------------------------------------------------------
// Calendario da abbonare (iPhone: Impostazioni > Calendario > Account > Aggiungi calendario)
// ---------------------------------------------------------------------

/** Parte segreta dell'indirizzo del calendario (chi non la conosce non lo legge). */
export function calendarToken(): string | null {
  const secret = (process.env.CRON_SECRET || '').trim()
  return secret ? createHmac('sha256', secret).update('calendar-feed').digest('hex').slice(0, 32) : null
}

const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const icsText = (value: string) => value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (c) => `\\${c}`)

/** Righe ICS piu' lunghe di 75 caratteri vanno spezzate (RFC 5545). */
function fold(line: string) {
  const out: string[] = []
  let rest = line
  while (rest.length > 74) {
    out.push(rest.slice(0, 74))
    rest = ` ${rest.slice(74)}`
  }
  out.push(rest)
  return out.join('\r\n')
}

export function buildIcs(appointments: Appointment[], siteUrl: string): string {
  const now = icsDate(new Date())
  const events = appointments
    .filter((a) => a.status === 'confirmed')
    .flatMap((a) => {
      const start = new Date(a.when)
      const description = [
        `Canale: ${a.platform}`,
        a.phone ? `Telefono: ${a.phone}` : '',
        a.note ? `Note: ${a.note}` : '',
        `Conversazione: ${siteUrl}/admin/inbox`,
      ]
        .filter(Boolean)
        .join('\n')
      return [
        'BEGIN:VEVENT',
        `UID:${a.id}@facevoice.ai`,
        `DTSTAMP:${now}`,
        `DTSTART:${icsDate(start)}`,
        `DTEND:${icsDate(new Date(start.getTime() + DURATION_MIN * 60_000))}`,
        `SUMMARY:${icsText(`${a.kind[0].toUpperCase()}${a.kind.slice(1)} con ${a.contactName || 'contatto'}`)}`,
        `DESCRIPTION:${icsText(description)}`,
        ...(a.phone ? [`LOCATION:${icsText(a.phone)}`] : []),
        // Promemoria sull'iPhone: 30 e 10 minuti prima.
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:Appuntamento tra 30 minuti',
        'TRIGGER:-PT30M',
        'END:VALARM',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:Appuntamento tra 10 minuti',
        'TRIGGER:-PT10M',
        'END:VALARM',
        'END:VEVENT',
      ]
    })
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Facevoice AI//Appuntamenti//IT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Facevoice · Appuntamenti',
    'X-WR-TIMEZONE:Europe/Rome',
    'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
    'X-PUBLISHED-TTL:PT15M',
    ...events,
    'END:VCALENDAR',
  ]
    .map(fold)
    .join('\r\n')
}
