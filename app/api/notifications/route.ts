import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { canAccess, getStaffAccess, type StaffAccess } from '@/lib/staff-access'
import { NOTIFY_CHANNELS, isNotifyChannel, readPrefs, setChannelPref } from '@/lib/notify-prefs'
import { getVapidKeys, listPushDevices, removePushDevice, sendPushToPeople, updateDeviceInfo } from '@/lib/push'

export const dynamic = 'force-dynamic'

// Notifiche di chi fa la richiesta (admin o dipendente con accesso ai Messaggi):
// per ogni canale push e/o email, e i propri dispositivi. Ognuno tocca solo le sue.

async function who(req: NextRequest): Promise<StaffAccess | NextResponse> {
  const access = await getStaffAccess(req)
  if (!access) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  if (!canAccess(access, 'inbox', 'view')) {
    return NextResponse.json({ error: 'Le notifiche dei messaggi servono a chi vede i Messaggi: chiedi l’accesso all’amministratore.' }, { status: 403 })
  }
  return access
}

export async function GET(req: NextRequest) {
  const access = await who(req)
  if (access instanceof NextResponse) return access
  const [prefs, keys, devices] = await Promise.all([readPrefs(access.email), getVapidKeys(), listPushDevices(access.email)])
  return NextResponse.json({ email: access.email, isAdmin: access.isAdmin, channels: NOTIFY_CHANNELS, prefs, publicKey: keys.publicKey, devices })
}

/** { channel, push?, email? }: cambia come avvisarti per un canale. */
export async function PUT(req: NextRequest) {
  const access = await who(req)
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  if (!isNotifyChannel(body?.channel)) return NextResponse.json({ error: 'Canale non valido.' }, { status: 400 })
  const patch = {
    ...(typeof body?.push === 'boolean' ? { push: body.push } : {}),
    ...(typeof body?.email === 'boolean' ? { email: body.email } : {}),
  }
  try {
    return NextResponse.json({ prefs: await setChannelPref(access.email, body.channel, patch) })
  } catch (error) {
    console.error('notifiche:', error instanceof Error ? error.message.slice(0, 160) : error)
    return NextResponse.json({ error: 'Non riesco a salvare: riprova.' }, { status: 500 })
  }
}

/** Registra questo dispositivo per le push; con { test: true } manda una prova ai tuoi dispositivi. */
export async function POST(req: NextRequest) {
  const access = await who(req)
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))

  if (body?.test && !body?.subscription) {
    return NextResponse.json(
      await sendPushToPeople([access.email], { title: 'Notifica di prova', body: 'Le notifiche arrivano su questo dispositivo.', url: '/admin/notifiche' })
    )
  }

  const sub = body?.subscription
  const endpoint = typeof sub?.endpoint === 'string' ? sub.endpoint : ''
  const p256dh = sub?.keys?.p256dh
  const auth = sub?.keys?.auth
  if (!endpoint.startsWith('https://') || typeof p256dh !== 'string' || typeof auth !== 'string') {
    return NextResponse.json({ error: 'Iscrizione non valida' }, { status: 400 })
  }
  const { data: saved, error } = await supabaseAdmin
    .from('push_subscriptions')
    .upsert({ endpoint, p256dh, auth, user_email: access.email }, { onConflict: 'endpoint' })
    .select('id, created_at')
    .single()
  if (error) return NextResponse.json({ error: 'Non riesco a registrare il dispositivo: riprova.' }, { status: 500 })
  await updateDeviceInfo(saved.id, {
    userAgent: (req.headers.get('user-agent') || '').slice(0, 400) || undefined,
    installed: typeof body?.installed === 'boolean' ? body.installed : undefined,
    registeredAt: saved.created_at,
    lastSeenAt: new Date().toISOString(),
  })
  if (body?.test) {
    await sendPushToPeople([access.email], { title: 'Notifiche attive', body: 'Riceverai qui gli avvisi dei canali che hai scelto.', url: '/admin/notifiche' })
  }
  return NextResponse.json({ success: true })
}

/** Toglie un tuo dispositivo ({ endpoint } di questo browser, oppure { id } dall'elenco). */
export async function DELETE(req: NextRequest) {
  const access = await who(req)
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  let query = supabaseAdmin.from('push_subscriptions').select('id, user_email')
  if (typeof body?.endpoint === 'string') query = query.eq('endpoint', body.endpoint)
  else if (typeof body?.id === 'string') query = query.eq('id', body.id)
  else return NextResponse.json({ error: 'Dispositivo non indicato.' }, { status: 400 })
  const { data: sub } = await query.maybeSingle()
  const owner = (sub?.user_email || '').toLowerCase()
  if (sub && (owner === access.email || (access.isAdmin && !owner))) await removePushDevice(sub.id)
  return NextResponse.json({ success: true })
}
