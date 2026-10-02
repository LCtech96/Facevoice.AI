import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAdminEmail } from '@/lib/admin-request'
import { getVapidKeys, sendPushToAdmins } from '@/lib/push'

export const dynamic = 'force-dynamic'

/** Chiave pubblica VAPID, necessaria al browser per iscriversi. */
export async function GET(req: NextRequest) {
  if (!(await getAdminEmail(req))) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }
  const keys = await getVapidKeys()
  return NextResponse.json({ publicKey: keys.publicKey })
}

/** Registra questo dispositivo; con { test: true } invia anche una notifica di prova. */
export async function POST(req: NextRequest) {
  const email = await getAdminEmail(req)
  if (!email) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const sub = body?.subscription
  const endpoint = typeof sub?.endpoint === 'string' ? sub.endpoint : ''
  const p256dh = sub?.keys?.p256dh
  const auth = sub?.keys?.auth

  if (!endpoint.startsWith('https://') || typeof p256dh !== 'string' || typeof auth !== 'string') {
    return NextResponse.json({ error: 'Iscrizione non valida' }, { status: 400 })
  }

  const { error } = await supabaseAdmin
    .from('push_subscriptions')
    .upsert({ endpoint, p256dh, auth, user_email: email }, { onConflict: 'endpoint' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (body?.test) {
    await sendPushToAdmins({
      title: 'Notifiche attive',
      body: 'Riceverai qui un avviso per ogni nuovo messaggio su WhatsApp, Messenger e Instagram.',
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
    await supabaseAdmin.from('push_subscriptions').delete().eq('endpoint', body.endpoint)
  }
  return NextResponse.json({ success: true })
}
