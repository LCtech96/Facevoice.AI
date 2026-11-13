import { supabaseAdmin } from '@/lib/supabase-admin'
import { ADMIN_EMAILS, isAdminEmail } from '@/lib/admin-auth'
import { allPermissions } from '@/lib/staff-access'
import { hasCap } from '@/lib/staff-pages'

// Notifiche dei messaggi in arrivo, scelte da ognuno (admin e dipendenti con accesso
// ai Messaggi): per ogni canale collegato, push sui propri dispositivi e/o email al
// proprio indirizzo. Salvate in app_settings: notify_prefs:<email>.

export const NOTIFY_CHANNELS = [
  { id: 'whatsapp', label: 'WhatsApp', emailAllowed: true },
  { id: 'instagram', label: 'Instagram', emailAllowed: true },
  { id: 'facebook', label: 'Facebook (Messenger)', emailAllowed: true },
  // Un avviso via email per un'email arriverebbe nella stessa casella letta dall'agente.
  { id: 'email', label: 'Email', emailAllowed: false },
  { id: 'web', label: 'Chat del sito', emailAllowed: true },
] as const

export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number]['id']
export type ChannelPref = { push: boolean; email: boolean }
export type NotifyPrefs = Record<NotifyChannel, ChannelPref>

const KEY = 'notify_prefs:'
const CHANNEL_IDS = NOTIFY_CHANNELS.map((c) => c.id) as NotifyChannel[]
const emailAllowed = (channel: NotifyChannel) => NOTIFY_CHANNELS.find((c) => c.id === channel)?.emailAllowed ?? false

export const isNotifyChannel = (value: unknown): value is NotifyChannel => typeof value === 'string' && (CHANNEL_IDS as string[]).includes(value)

/**
 * Come prima di queste preferenze: l'admin riceve push per tutto ed email per tutto
 * (tranne le email); il dipendente riceve push (se attiva le notifiche sul suo
 * dispositivo) e nessuna email finche' non la sceglie.
 */
export function defaultPrefs(isAdmin: boolean): NotifyPrefs {
  return Object.fromEntries(CHANNEL_IDS.map((c) => [c, { push: true, email: isAdmin && emailAllowed(c) }])) as NotifyPrefs
}

function clean(raw: unknown, isAdmin: boolean): NotifyPrefs {
  const prefs = defaultPrefs(isAdmin)
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  for (const c of CHANNEL_IDS) {
    const v = value[c] as Partial<ChannelPref> | undefined
    if (v && typeof v === 'object') {
      if (typeof v.push === 'boolean') prefs[c].push = v.push
      if (typeof v.email === 'boolean') prefs[c].email = v.email && emailAllowed(c)
    }
  }
  return prefs
}

const keyOf = (email: string) => `${KEY}${email.trim().toLowerCase()}`

export async function readPrefs(email: string): Promise<NotifyPrefs> {
  const isAdmin = isAdminEmail(email)
  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', keyOf(email)).maybeSingle()
  try {
    return clean(data?.value ? JSON.parse(data.value) : {}, isAdmin)
  } catch {
    return defaultPrefs(isAdmin)
  }
}

/** Cambia push e/o email di un canale; restituisce tutte le preferenze aggiornate. */
export async function setChannelPref(email: string, channel: NotifyChannel, patch: Partial<ChannelPref>): Promise<NotifyPrefs> {
  const prefs = await readPrefs(email)
  if (typeof patch.push === 'boolean') prefs[channel].push = patch.push
  if (typeof patch.email === 'boolean') prefs[channel].email = patch.email && emailAllowed(channel)
  const { error } = await supabaseAdmin
    .from('app_settings')
    .upsert({ key: keyOf(email), value: JSON.stringify(prefs), updated_at: new Date().toISOString() })
  if (error) throw new Error(`preferenze notifiche: ${error.message}`)
  return prefs
}

/** Chi vede i Messaggi: gli admin e i dipendenti attivi con il permesso di vederli. */
export async function inboxPeople(): Promise<{ email: string; isAdmin: boolean }[]> {
  const people = new Map<string, boolean>(ADMIN_EMAILS.map((e) => [e.toLowerCase(), true]))
  try {
    const [{ data: members }, perms] = await Promise.all([
      supabaseAdmin.from('chat_members').select('user_id, email, is_active').eq('is_active', true),
      allPermissions(),
    ])
    for (const m of (members || []) as { user_id: string; email: string | null }[]) {
      const email = (m.email || '').trim().toLowerCase()
      if (!email || people.has(email)) continue
      if (hasCap(perms.get(m.user_id), 'inbox', 'view')) people.set(email, false)
    }
  } catch (error) {
    // Senza l'elenco dei dipendenti gli avvisi arrivano almeno agli admin.
    console.error('notifiche: elenco dipendenti non letto', error instanceof Error ? error.message.slice(0, 160) : error)
  }
  return Array.from(people, ([email, isAdmin]) => ({ email, isAdmin }))
}

/** A chi mandare l'avviso di un messaggio su questo canale: push e email, secondo le scelte di ognuno. */
export async function notifyRecipients(channel: NotifyChannel): Promise<{ push: string[]; email: string[] }> {
  const people = await inboxPeople()
  const { data } = await supabaseAdmin
    .from('app_settings')
    .select('key, value')
    .in('key', people.map((p) => keyOf(p.email)))
  const stored = new Map((data || []).map((r) => [r.key as string, r.value as string]))
  const push: string[] = []
  const email: string[] = []
  for (const p of people) {
    let prefs: NotifyPrefs
    try {
      prefs = clean(JSON.parse(stored.get(keyOf(p.email)) || '{}'), p.isAdmin)
    } catch {
      prefs = defaultPrefs(p.isAdmin)
    }
    if (prefs[channel].push) push.push(p.email)
    if (prefs[channel].email && emailAllowed(channel)) email.push(p.email)
  }
  return { push, email }
}
