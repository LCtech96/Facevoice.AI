import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAdminEmail } from '@/lib/admin-request'
import { getVapidKeys, listPushDevices, removePushDevice, sendPushToAdmins, updateDeviceInfo } from '@/lib/push'

export const dynamic = 'force-dynamic'

/** Chiave pubblica VAPID, necessaria al browser per iscriversi. */
export async function GET(req: NextRequest) {
  if (!(await getAdminEmail(req))) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }
  const keys = await getVapidKeys()
  const list = await listPushDevices()
  return NextResponse.json({ publicKey: keys.publicKey, devices: list.length, list })
}

/** Registra questo dispositivo; con { test: true } invia anche una notifica di prova. */
export async function POST(req: NextRequest) {
  const email = await getAdminEmail(req)
  if (!email) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })

  const body = await req.json().catch(() => ({}))

  // Solo prova: { test: true } senza iscrizione -> notifica a tutti i dispositivi.
  if (body?.test && !body?.subscription) {
    const result = await sendPushToAdmins({
      title: 'Notifica di prova',
      body: 'Se leggi questo messaggio, le notifiche di Messaggi funzionano su questo dispositivo.',
      url: '/admin/inbox',
    })
    return NextResponse.json(result)
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
    .upsert({ endpoint, p256dh, auth, user_email: email }, { onConflict: 'endpoint' })
    .select('id, created_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Browser e sistema del dispositivo: servono per sapere quali dispositivi ricevono le notifiche.
  await updateDeviceInfo(saved.id, {
    userAgent: (req.headers.get('user-agent') || '').slice(0, 400) || undefined,
    installed: typeof body?.installed === 'boolean' ? body.installed : undefined,
    registeredAt: saved.created_at,
    lastSeenAt: new Date().toISOString(),
  })

  if (body?.test) {
    await sendPushToAdmins({
      title: 'Notifiche attive',
      body: 'Riceverai qui un avviso per ogni nuovo messaggio su WhatsApp, Messenger, Instagram ed email.',
      url: '/admin/inbox',
    })
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  if (!(await getAdminEmail(req))) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }
  const body = await req.json().catch(() => ({}))
  if (typeof body?.endpoint === 'string') {
    const { data: sub } = await supabaseAdmin.from('push_subscriptions').select('id').eq('endpoint', body.endpoint).maybeSingle()
    if (sub) await removePushDevice(sub.id)
  }
  return NextResponse.json({ success: true })
}
