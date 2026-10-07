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

/** Invia a tutti i dispositivi iscritti (o solo a `only`); restituisce quanti l'hanno ricevuta. */
export async function sendPushToAdmins(payload: PushPayload, only?: string[]): Promise<{ sent: number; failed: number }> {
  let query = supabaseAdmin.from('push_subscriptions').select('id, endpoint, p256dh, auth')
  if (only?.length) query = query.in('id', only)
  const { data: subs } = await query

  if (!subs?.length) {
    console.warn('Push: nessun dispositivo iscritto, notifica non inviata:', payload.title)
    return { sent: 0, failed: 0 }
  }
  let sent = 0
  let failed = 0

  const keys = await getVapidKeys()
  webpush.setVapidDetails('mailto:info@facevoice.ai', keys.publicKey, keys.privateKey)

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
          { TTL: 60 * 60 * 24, urgency: 'high' }
        )
        sent++
        await updateDeviceInfo(sub.id, { lastDeliveredAt: new Date().toISOString(), lastError: undefined })
      } catch (error: any) {
        failed++
        // 404/410: il dispositivo ha revocato l'iscrizione, la togliamo.
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          await removePushDevice(sub.id)
        } else {
          console.error('Push error:', error?.statusCode, error?.body || error?.message)
          await updateDeviceInfo(sub.id, { lastError: `${error?.statusCode || ''} ${error?.message || 'errore'}`.trim().slice(0, 200) })
        }
      }
    })
  )
  return { sent, failed }
}

// ---------------------------------------------------------------------
// Dispositivi: chi riceve le notifiche (per Messaggi e la super chat)
// ---------------------------------------------------------------------

/** Informazioni sul dispositivo, salvate in app_settings (push_device:<id>). */
export type DeviceInfo = {
  name?: string
  userAgent?: string
  installed?: boolean
  registeredAt?: string
  lastSeenAt?: string
  lastDeliveredAt?: string
  lastError?: string
}

const deviceKey = (id: string) => `push_device:${id}`

async function readDeviceInfo(id: string): Promise<DeviceInfo> {
  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', deviceKey(id)).maybeSingle()
  try {
    return data?.value ? (JSON.parse(data.value) as DeviceInfo) : {}
  } catch {
    return {}
  }
}

export async function updateDeviceInfo(id: string, patch: Partial<DeviceInfo>) {
  const info = { ...(await readDeviceInfo(id)), ...patch }
  for (const k of Object.keys(info) as (keyof DeviceInfo)[]) if (info[k] === undefined) delete info[k]
  await supabaseAdmin
    .from('app_settings')
    .upsert({ key: deviceKey(id), value: JSON.stringify(info), updated_at: new Date().toISOString() })
    .then(undefined, () => undefined)
}

export async function removePushDevice(id: string) {
  await supabaseAdmin.from('push_subscriptions').delete().eq('id', id)
  await supabaseAdmin.from('app_settings').delete().eq('key', deviceKey(id))
}

/** "Chrome su Windows", "Safari su iPhone"… dal browser che si e' iscritto. */
export function describeUserAgent(ua: string): string {
  const os = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? /Mobile/.test(ua)
          ? 'telefono Android'
          : 'tablet Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(ua)
            ? 'Mac'
            : /CrOS/.test(ua)
              ? 'Chromebook'
              : /Linux/.test(ua)
                ? 'Linux'
                : 'dispositivo sconosciuto'
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /SamsungBrowser/.test(ua)
        ? 'Samsung Internet'
        : /Firefox|FxiOS/.test(ua)
          ? 'Firefox'
          : /CriOS|Chrome/.test(ua)
            ? 'Chrome'
            : /Safari/.test(ua)
              ? 'Safari'
              : 'browser'
  return `${browser} su ${os}`
}

/** Per i dispositivi registrati prima che salvassimo il browser: si deduce dal servizio push. */
function describeEndpoint(endpoint: string): string {
  const host = (() => {
    try {
      return new URL(endpoint).hostname
    } catch {
      return ''
    }
  })()
  if (host.endsWith('push.apple.com')) return 'Safari / app su iPhone, iPad o Mac'
  if (host.endsWith('mozilla.com')) return 'Firefox'
  if (host.endsWith('notify.windows.com')) return 'Edge su Windows'
  if (host.endsWith('googleapis.com')) return 'Chrome (computer o Android)'
  return 'browser sconosciuto'
}

export type PushDevice = {
  id: string
  name: string
  device: string
  installedApp: boolean | null
  email: string | null
  registeredAt: string
  lastSeenAt: string | null
  lastDeliveredAt: string | null
  lastError: string | null
  knownDetails: boolean
}

export async function listPushDevices(): Promise<PushDevice[]> {
  const { data: subs } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, endpoint, user_email, created_at')
    .order('created_at', { ascending: true })
  if (!subs?.length) return []
  const { data: infos } = await supabaseAdmin
    .from('app_settings')
    .select('key, value')
    .in('key', subs.map((s) => deviceKey(s.id)))
  const byKey = new Map((infos || []).map((r) => [r.key, r.value as string]))
  return subs.map((s) => {
    let info: DeviceInfo = {}
    try {
      info = JSON.parse(byKey.get(deviceKey(s.id)) || '{}')
    } catch {}
    const device = info.userAgent ? describeUserAgent(info.userAgent) : describeEndpoint(s.endpoint)
    return {
      id: s.id,
      name: info.name || device,
      device,
      installedApp: info.installed ?? null,
      email: s.user_email,
      registeredAt: info.registeredAt || s.created_at,
      lastSeenAt: info.lastSeenAt || null,
      lastDeliveredAt: info.lastDeliveredAt || null,
      lastError: info.lastError || null,
      knownDetails: Boolean(info.userAgent),
    }
  })
}
