import webpush from 'web-push'
import { supabaseAdmin } from '@/lib/supabase-admin'

type VapidKeys = { publicKey: string; privateKey: string }

let cached: VapidKeys | null = null

/**
 * Chiavi VAPID per firmare le notifiche push. Si leggono dalle variabili
 * d'ambiente se presenti; altrimenti vengono generate una volta e salvate
 * in app_settings, tabella che solo il server puo' leggere.
 */
export async function getVapidKeys(): Promise<VapidKeys> {
  if (cached) return cached

  const envPublic = process.env.VAPID_PUBLIC_KEY?.trim()
  const envPrivate = process.env.VAPID_PRIVATE_KEY?.trim()
  if (envPublic && envPrivate) {
    cached = { publicKey: envPublic, privateKey: envPrivate }
    return cached
  }

  const { data } = await supabaseAdmin
    .from('app_settings')
    .select('value')
    .eq('key', 'vapid_keys')
    .maybeSingle()

  if (data?.value) {
    cached = JSON.parse(data.value) as VapidKeys
    return cached
  }

  const generated = webpush.generateVAPIDKeys()
  // ignoreDuplicates: se due richieste generano insieme, vince la prima e rileggiamo quella.
  await supabaseAdmin
    .from('app_settings')
    .upsert({ key: 'vapid_keys', value: JSON.stringify(generated) }, { onConflict: 'key', ignoreDuplicates: true })

  const { data: stored } = await supabaseAdmin
    .from('app_settings')
    .select('value')
    .eq('key', 'vapid_keys')
    .single()

  cached = JSON.parse(stored!.value) as VapidKeys
  return cached
}

export type PushPayload = { title: string; body: string; url: string; tag?: string }

export async function sendPushToAdmins(payload: PushPayload) {
  const { data: subs } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')

  if (!subs?.length) return

  const keys = await getVapidKeys()
  webpush.setVapidDetails('mailto:info@facevoice.ai', keys.publicKey, keys.privateKey)

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
          { TTL: 60 * 60 * 24 }
        )
      } catch (error: any) {
        // 404/410: il dispositivo ha revocato l'iscrizione, la togliamo.
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          await supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id)
        } else {
          console.error('Push error:', error?.statusCode, error?.body || error?.message)
        }
      }
    })
  )
}
