import { supabaseAdmin } from '@/lib/supabase-admin'
import { readSetting, updateSetting } from '@/lib/settings-store'
import { deliver, setOrigin, type OutgoingTarget } from '@/lib/meta/agent'

// Risposte automatiche alle persone che abbiamo contattato noi per primi (email
// della Ricerca clienti e dell'automazione giornaliera). Interruttore separato da
// quello della casella Messaggi. Con l'automatico acceso ogni risposta ricevuta
// ha sempre una controrisposta, che parte dopo qualche minuto (come una persona):
// fino ad allora resta in Messaggi come bozza, e Luca puo' cambiarla o fermarla.

const SETTINGS_KEY = 'outreach_reply:settings'
const SCHEDULE_PREFIX = 'outreach_auto:'
/** Attesa prima dell'invio automatico. */
const DELAY_MS: [number, number] = [4 * 60_000, 12 * 60_000]
/** Oltre queste risposte automatiche in 24 ore alla stessa persona si passa alla bozza. */
const MAX_AUTO_PER_DAY = 3

export type OutreachReplySettings = {
  auto: boolean
  /** Esempi di conversazioni scelti da Luca: l'AI ne prende il metodo. */
  strategy: string
}

const DEFAULTS: OutreachReplySettings = { auto: false, strategy: '' }

const parse = (raw: string | null): OutreachReplySettings => {
  try {
    const value = raw ? JSON.parse(raw) : {}
    return { auto: value.auto === true, strategy: typeof value.strategy === 'string' ? value.strategy.slice(0, 20_000) : '' }
  } catch {
    return { ...DEFAULTS }
  }
}

export const loadOutreachReplySettings = async () => parse((await readSetting(SETTINGS_KEY)).value)

export function saveOutreachReplySettings(input: Partial<OutreachReplySettings>) {
  return updateSetting(SETTINGS_KEY, parse, (current) => ({
    auto: typeof input.auto === 'boolean' ? input.auto : current.auto,
    strategy: typeof input.strategy === 'string' ? input.strategy.slice(0, 20_000) : current.strategy,
  }))
}

/** Risposte automatiche gia' inviate a questa persona nelle ultime 24 ore. */
export async function autoRepliesToday(platform: string, contactId: string) {
  const { count } = await supabaseAdmin
    .from('social_messages')
    .select('id', { count: 'exact', head: true })
    .eq('platform', platform)
    .eq('contact_id', contactId)
    .eq('direction', 'out')
    .eq('origin', 'ai_auto')
    .gte('created_at', new Date(Date.now() - 86_400_000).toISOString())
  return count ?? 0
}

export const autoReplyAllowed = async (platform: string, contactId: string) =>
  (await autoRepliesToday(platform, contactId)) < MAX_AUTO_PER_DAY

/** Programma l'invio della bozza tra qualche minuto. */
export async function scheduleAutoSend(messageId: string) {
  const at = new Date(Date.now() + DELAY_MS[0] + Math.random() * (DELAY_MS[1] - DELAY_MS[0])).toISOString()
  await supabaseAdmin.from('app_settings').upsert({ key: `${SCHEDULE_PREFIX}${messageId}`, value: at, updated_at: new Date().toISOString() })
  return at
}

/** Dal cron di ogni minuto: invia le controrisposte arrivate all'ora prevista. */
export async function sendDueOutreachReplies(): Promise<number> {
  const { data } = await supabaseAdmin.from('app_settings').select('key, value').like('key', `${SCHEDULE_PREFIX}%`).limit(200)
  let sent = 0
  for (const row of data || []) {
    if (new Date(row.value).getTime() > Date.now()) continue
    const id = row.key.slice(SCHEDULE_PREFIX.length)
    // Solo se e' ancora una bozza: se Luca l'ha gia' inviata, cambiata o scartata, non si tocca.
    const { data: locked } = await supabaseAdmin
      .from('social_messages')
      .update({ status: 'sending' })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id, platform, kind, contact_id, channel_account_id, reply_to, body')
      .maybeSingle()
    await supabaseAdmin.from('app_settings').delete().eq('key', row.key)
    if (!locked) continue
    const result = await deliver(locked as OutgoingTarget, String(locked.body || ''))
    await supabaseAdmin
      .from('social_messages')
      .update({ status: result.error ? 'failed' : 'sent', error_message: result.error ?? null, external_id: result.id ?? null })
      .eq('id', id)
    if (!result.error) {
      await setOrigin(id, 'ai_auto')
      sent++
    } else console.error('outreach auto reply:', result.error)
  }
  return sent
}
