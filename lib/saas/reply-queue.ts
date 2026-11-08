import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { readSetting, updateSetting } from '@/lib/settings-store'
import { workspaceDb, type WorkspaceDb } from '@/lib/workspace-db'
import { workspaceAIBlocked } from '@/lib/usage-limits'
import { listConnections } from './connections'
import { sendMetaSenderAction, type SenderAction } from './meta'
import { APP_ORIGIN, AUTOMATIC_REPLY_GRACE_MS, looksAutomatic, wroteAfter } from './meta-history'
import { respondToMessage, type ReplyOutcome } from './responder'
import { VIDEO_ORIGIN } from './video-replies'

// Ritardo delle risposte automatiche (scelto dal cliente nell'omnichat) e coda
// delle risposte in attesa. Nei messaggi diretti (Instagram, Messenger) si aspetta
// sempre almeno MIN_DM_DELAY_SECONDS dopo l'ultimo messaggio della persona, anche
// con il ritardo a 0: molti scrivono a pezzi e ricevono una sola risposta per tutti.
// Funziona senza processi sempre accesi: ogni risposta
// in attesa e' una riga di app_settings, reply_queue:<spazio>:<canale>:<persona>,
// con l'ora prevista. La manda chi arriva per primo all'ora giusta: l'attesa
// dentro il webhook (ritardi fino a 45 s) o il cron di ogni minuto. La risposta
// si scrive al momento dell'invio, cosi' tiene conto di tutti i messaggi
// arrivati nel frattempo; se nel frattempo ha risposto una persona (a mano
// dall'app o dall'omnichat) non parte. Anche la fonte si sceglie all'invio: se la
// Campagna (campaign.ts) e' accesa per il canale in quel momento si usa lei,
// altrimenti le Istruzioni (spegnerla vale subito anche per le risposte in attesa).

export type DelayUnit = 'secondi' | 'minuti'
export type ReplyDelay = { seconds: number; unit: DelayUnit }

export const MAX_DELAY_SECONDS = 30 * 60
/** Attesa minima delle risposte automatiche nei messaggi diretti, per tutti gli spazi (anche con il ritardo a 0). */
export const MIN_DM_DELAY_SECONDS = 30
/** Fino a questo ritardo la risposta si aspetta anche dentro il webhook; oltre, solo il cron. */
export const AFTER_WAIT_MAX_SECONDS = 45
/** Variazione casuale del ritardo: solo in piu' (da 0 a +20%), mai sotto il ritardo scelto o il minimo. */
const JITTER = 0.2
/** Tetto di una serie di messaggi: primo messaggio + 2 volte il ritardo, almeno 3 minuti; poi la risposta parte comunque. */
const SERIES_CAP_MIN_MS = 3 * 60_000
/** Una risposta "presa" da qualcuno da piu' di 3 minuti si considera abbandonata (funzione interrotta). */
const CLAIM_STALE_MS = 3 * 60_000
/** Meta permette di rispondere entro 24 ore dall'ultimo messaggio della persona: si tiene 1 ora di margine. */
const META_WINDOW_MS = 23 * 3600_000
/** Con un ritardo da almeno 10 secondi la persona vede "sta scrivendo..." prima della risposta. */
const TYPING_FROM_MS = 10_000
const MAX_ATTEMPTS = 3

const DELAY_PREFIX = 'reply_delay:'
const QUEUE_PREFIX = 'reply_queue:'
/** Canali in cui le risposte automatiche ai messaggi possono aspettare (non i commenti). */
const DELAYED_PLATFORMS = ['instagram', 'facebook', 'email']
const META_PLATFORMS = ['instagram', 'facebook']

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))

// --- Impostazione -------------------------------------------------------------------

export const NO_DELAY: ReplyDelay = { seconds: 0, unit: 'secondi' }

/** Valore e unita' dal modulo: null se non valido. 0 = subito, massimo 30 minuti. */
export function normalizeDelay(value: unknown, unit: unknown): ReplyDelay | null {
  if (unit !== 'minuti' && unit !== 'secondi') return null
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value.replace(',', '.')) : NaN
  if (!Number.isFinite(n) || n < 0) return null
  const seconds = Math.round(unit === 'minuti' ? n * 60 : n)
  if (seconds > MAX_DELAY_SECONDS) return null
  return { seconds, unit }
}

export function parseDelay(raw: string | null | undefined): ReplyDelay {
  if (!raw) return NO_DELAY
  try {
    const value = JSON.parse(raw) as { seconds?: unknown; unit?: unknown }
    const seconds = Number(value.seconds)
    if (!Number.isFinite(seconds) || seconds <= 0) return { ...NO_DELAY, unit: value.unit === 'minuti' ? 'minuti' : 'secondi' }
    return { seconds: Math.min(MAX_DELAY_SECONDS, Math.round(seconds)), unit: value.unit === 'minuti' ? 'minuti' : 'secondi' }
  } catch {
    return NO_DELAY
  }
}

/** Ritardo che vale davvero (secondi): nei messaggi diretti almeno MIN_DM_DELAY_SECONDS, l'email come scelto (anche 0). */
export function effectiveDelaySeconds(platform: string, seconds: number): number {
  return META_PLATFORMS.includes(platform) ? Math.max(seconds, MIN_DM_DELAY_SECONDS) : seconds
}

export async function readReplyDelay(workspaceId: string): Promise<ReplyDelay> {
  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', `${DELAY_PREFIX}${workspaceId}`).maybeSingle()
  return parseDelay((data?.value as string | undefined) ?? null)
}

export async function saveReplyDelay(workspaceId: string, delay: ReplyDelay): Promise<ReplyDelay> {
  const now = new Date().toISOString()
  const { error } = await supabaseAdmin
    .from('app_settings')
    .upsert({ key: `${DELAY_PREFIX}${workspaceId}`, value: JSON.stringify(delay), updated_at: now }, { onConflict: 'key' })
  if (error) throw new Error(`ritardo non salvato: ${error.message}`)
  return delay
}

// --- Coda ---------------------------------------------------------------------------

export type QueueItem = {
  workspaceId: string
  platform: string
  contactId: string
  /** Ultimo messaggio ricevuto messo in coda (all'invio si risponde comunque al piu' recente). */
  messageId: string
  triggerMid: string | null
  /** Primo messaggio ricevuto della serie: le risposte a mano dopo quest'ora fermano l'invio. */
  firstAt: number
  dueAt: number
  delayMs: number
  claimId?: string | null
  claimedAt?: number | null
  attempts?: number
}

export const queueKey = (workspaceId: string, platform: string, contactId: string) => `${QUEUE_PREFIX}${workspaceId}:${platform}:${contactId}`

export function parseItem(raw: string | null): QueueItem | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as QueueItem
    if (!v || typeof v.workspaceId !== 'string' || typeof v.contactId !== 'string' || typeof v.dueAt !== 'number') return null
    return v
  } catch {
    return null
  }
}

/** Ritardo con la variazione casuale (da 0 a +20%: mai meno del ritardo). */
export const withJitter = (ms: number, random = Math.random()) => Math.round(ms * (1 + random * JITTER))

/** Ora oltre la quale una serie di messaggi non sposta piu' l'invio. */
export const seriesCap = (firstAt: number, delayMs: number) => firstAt + Math.max(2 * delayMs, SERIES_CAP_MIN_MS)

const claimedNow = (item: QueueItem, now: number) => Boolean(item.claimId && item.claimedAt && now - item.claimedAt < CLAIM_STALE_MS)

/**
 * Nuovo messaggio ricevuto: nuova risposta in coda, oppure (se ce n'e' gia' una
 * in attesa) si sposta l'invio a "adesso + ritardo", ma mai oltre il tetto della
 * serie (seriesCap: primo messaggio + 2 volte il ritardo, almeno 3 minuti). Se la
 * risposta e' in invio proprio ora resta di chi la invia, ma si segna il messaggio
 * nuovo (cambia il timbro): alla fine chi la invia rilegge la riga, vede il messaggio
 * nuovo e rimette in coda (una risposta sola per lui, anche se arriva all'ultimo istante).
 */
export function nextQueueItem(
  current: QueueItem | null,
  input: { workspaceId: string; platform: string; contactId: string; messageId: string; triggerMid: string | null; delayMs: number },
  now: number,
  random = Math.random()
): QueueItem | false {
  if (current && claimedNow(current, now)) return { ...current, messageId: input.messageId, triggerMid: input.triggerMid }
  if (current && !current.claimId) {
    // Il ritardo di adesso (es. il minimo dei messaggi diretti) vale anche per la serie gia' in coda.
    const delayMs = Math.max(current.delayMs, input.delayMs)
    const pushed = Math.min(now + withJitter(delayMs, random), seriesCap(current.firstAt, delayMs))
    return { ...current, messageId: input.messageId, triggerMid: input.triggerMid, delayMs, dueAt: Math.max(current.dueAt, pushed) }
  }
  // Nessuna in coda, oppure presa da una funzione che si e' interrotta: si riparte.
  return { ...input, firstAt: now, dueAt: now + withJitter(input.delayMs, random), claimId: null, claimedAt: null, attempts: current?.attempts ?? 0 }
}

export type ScheduleResult = { status: 'queued'; key: string; dueAt: number; delayMs: number } | { status: 'now'; outcome: ReplyOutcome }

async function metaConnection(db: WorkspaceDb, platform: string, accountId: string | null) {
  if (!META_PLATFORMS.includes(platform)) return null
  const accounts = await listConnections(db, platform as 'facebook' | 'instagram')
  return accounts.find((c) => c.external_id === accountId) || accounts[0] || null
}

/** "Visto" / "sta scrivendo..." quando e' facile; nessun errore arriva a chi chiama. */
async function senderAction(db: WorkspaceDb, platform: string, accountId: string | null, contactId: string, action: SenderAction) {
  try {
    const connection = await metaConnection(db, platform, accountId)
    if (connection) await sendMetaSenderAction(connection, contactId, action)
  } catch {}
}

/**
 * Messaggio appena ricevuto: con l'invio automatico la risposta va in coda (nei
 * messaggi diretti sempre, almeno MIN_DM_DELAY_SECONDS; l'email solo con un ritardo
 * scelto), altrimenti si prepara subito (anche le bozze da approvare).
 */
export async function scheduleReply(db: WorkspaceDb, messageId: string): Promise<ScheduleResult> {
  const now = async () => ({ status: 'now' as const, outcome: await respondToMessage(db, messageId) })
  const { data: message } = await db
    .from('social_messages')
    .select('id, platform, kind, direction, contact_id, external_id, channel_account_id')
    .eq('id', messageId)
    .maybeSingle()
  if (!message || message.direction !== 'in' || message.kind === 'comment' || !DELAYED_PLATFORMS.includes(message.platform as string)) return now()
  const [{ data: channel }, delay] = await Promise.all([
    db.from('social_channels').select('automation_enabled, reply_mode').eq('platform', message.platform).maybeSingle(),
    readReplyDelay(db.workspaceId),
  ])
  const seconds = effectiveDelaySeconds(message.platform as string, delay.seconds)
  if (!channel?.automation_enabled || channel.reply_mode !== 'auto' || seconds <= 0) return now()

  const key = queueKey(db.workspaceId, message.platform as string, message.contact_id as string)
  const input = {
    workspaceId: db.workspaceId,
    platform: message.platform as string,
    contactId: message.contact_id as string,
    messageId: message.id as string,
    triggerMid: (message.external_id as string | null) ?? null,
    delayMs: seconds * 1000,
  }
  let item: QueueItem | null
  try {
    item = await updateSetting(key, parseItem, (current) => nextQueueItem(current, input, Date.now()))
  } catch (error) {
    // Coda non disponibile: meglio rispondere subito che non rispondere.
    console.error('saas coda risposte:', error instanceof Error ? error.message : error)
    return now()
  }
  if (!item) return now()
  await senderAction(db, input.platform, message.channel_account_id as string | null, input.contactId, 'mark_seen')
  return { status: 'queued', key, dueAt: item.dueAt, delayMs: item.delayMs }
}

/** Cancella la riga solo se e' ancora quella letta (nessuno l'ha cambiata nel frattempo). */
async function deleteIfUnchanged(key: string, stamp: string | null): Promise<boolean> {
  if (!stamp) return false
  const { data, error } = await supabaseAdmin.from('app_settings').delete().eq('key', key).eq('updated_at', stamp).select('key')
  return !error && Boolean(data?.length)
}

/** Una persona ha risposto a mano: la risposta automatica in attesa non parte. */
export async function cancelQueuedReply(workspaceId: string, platform: string, contactId: string): Promise<boolean> {
  const key = queueKey(workspaceId, platform, contactId)
  for (let attempt = 0; attempt < 5; attempt++) {
    const { value, stamp } = await readSetting(key)
    const item = parseItem(value)
    if (!item) return false
    // In invio proprio ora: si ferma da sola (controlla le risposte a mano prima di partire).
    if (claimedNow(item, Date.now())) return false
    if (await deleteIfUnchanged(key, stamp)) return true
  }
  return false
}

type IncomingRow = { id: string; created_at: string; channel_account_id: string | null }

async function latestIncoming(db: WorkspaceDb, platform: string, contactId: string): Promise<IncomingRow | null> {
  const { data } = await db
    .from('social_messages')
    .select('id, created_at, channel_account_id')
    .eq('platform', platform)
    .eq('contact_id', contactId)
    .eq('kind', 'message')
    .eq('direction', 'in')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as IncomingRow | null) ?? null
}

/**
 * Dopo il primo messaggio della serie ha risposto una persona (dall'app, dall'omnichat
 * o dalla casella)? Dall'app non contano le risposte automatiche di Meta (pochi secondi
 * dopo un messaggio della persona) ne' i messaggi a cui la persona ha gia' risposto
 * (si risponde al suo messaggio nuovo).
 */
export async function humanReplied(db: WorkspaceDb, item: Pick<QueueItem, 'platform' | 'contactId' | 'firstAt'>): Promise<boolean> {
  const since = new Date(item.firstAt).toISOString()
  const { data: rows } = await db
    .from('social_messages')
    .select('origin, created_at')
    .eq('platform', item.platform)
    .eq('contact_id', item.contactId)
    .eq('kind', 'message')
    .eq('direction', 'out')
    .in('status', ['sent', 'sending'])
    .or('origin.is.null,origin.neq.ai_auto')
    .gte('created_at', since)
    .limit(50)
  // I video risposte partono con la risposta automatica: non sono di una persona.
  const replies = (rows || []).filter((row) => row.origin !== VIDEO_ORIGIN)
  if (!replies.length) return false
  if (replies.some((row) => row.origin !== APP_ORIGIN)) return true
  const { data: incoming } = await db
    .from('social_messages')
    .select('created_at')
    .eq('platform', item.platform)
    .eq('contact_id', item.contactId)
    .eq('kind', 'message')
    .eq('direction', 'in')
    .gte('created_at', new Date(item.firstAt - AUTOMATIC_REPLY_GRACE_MS).toISOString())
    .limit(200)
  const times = (incoming || []).map((row) => new Date(row.created_at as string).getTime())
  return replies.some((row) => {
    const at = new Date(row.created_at as string).getTime()
    return !looksAutomatic(at, times) && !wroteAfter(at, times)
  })
}

/** Perche' la risposta in coda non deve partire (null = puo' partire). */
async function cancelReason(db: WorkspaceDb, item: QueueItem, latest: IncomingRow | null): Promise<string | null> {
  if (!latest) return 'nessun messaggio a cui rispondere'
  const { data: channel } = await db.from('social_channels').select('automation_enabled, reply_mode').eq('platform', item.platform).maybeSingle()
  if (!channel?.automation_enabled || channel.reply_mode !== 'auto') return 'il canale non è più in automatico'
  if (await workspaceAIBlocked(item.workspaceId)) return 'AI del piano finita'
  if (await humanReplied(db, item)) return 'ha già risposto una persona'
  if (META_PLATFORMS.includes(item.platform) && Date.now() - new Date(latest.created_at).getTime() > META_WINDOW_MS) return 'oltre le 24 ore di Meta'
  if ((item.attempts ?? 0) > MAX_ATTEMPTS) return 'troppi tentativi'
  return null
}

/**
 * Fine dell'invio: se intanto e' arrivato un messaggio nuovo (non coperto dalla
 * risposta appena scritta) si rimette in coda, altrimenti la riga si cancella.
 */
async function finish(db: WorkspaceDb, key: string, claimId: string, coveredAt: string | null) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { value, stamp } = await readSetting(key)
    const item = parseItem(value)
    if (!item || item.claimId !== claimId) return
    const latest = coveredAt ? await latestIncoming(db, item.platform, item.contactId) : null
    if (latest && coveredAt && new Date(latest.created_at).getTime() > new Date(coveredAt).getTime()) {
      const now = Date.now()
      const next: QueueItem = { ...item, messageId: latest.id, firstAt: now, dueAt: now + withJitter(item.delayMs), claimId: null, claimedAt: null, attempts: 0 }
      const { data } = await supabaseAdmin
        .from('app_settings')
        .update({ value: JSON.stringify(next), updated_at: new Date(Math.max(now, new Date(stamp || 0).getTime() + 1)).toISOString() })
        .eq('key', key)
        .eq('updated_at', stamp as string)
        .select('key')
      if (data?.length) return
    } else if (await deleteIfUnchanged(key, stamp)) return
    await sleep(50 + Math.random() * 150)
  }
}

export type ProcessResult = 'sent' | 'draft' | 'skipped' | 'cancelled' | 'failed' | 'waiting' | 'busy' | 'none'

/**
 * Invia la risposta in coda se e' l'ora. La riga si "prenota" con un confronto
 * sul timbro (settings-store): webhook e cron insieme non la mandano mai due volte.
 */
export async function processQueuedReply(key: string): Promise<ProcessResult> {
  const claimId = randomUUID()
  const claimedAt = Date.now()
  let item: QueueItem | null
  try {
    item = await updateSetting(key, parseItem, (current) => {
      if (!current) return false
      if (claimedNow(current, claimedAt) || current.dueAt > claimedAt + 1000) return false
      return { ...current, claimId, claimedAt, attempts: (current.attempts ?? 0) + 1 }
    })
  } catch {
    return 'busy'
  }
  if (!item) return 'none'
  if (item.claimId !== claimId) return item.claimId && claimedNow(item, Date.now()) ? 'busy' : 'waiting'

  const db = workspaceDb(item.workspaceId)
  const claimed = item
  // Messaggi arrivati dopo quest'ora (anche se la risposta si annulla) tornano in coda alla fine.
  let coveredAt: string | null = new Date(claimedAt).toISOString()
  try {
    const latest = await latestIncoming(db, claimed.platform, claimed.contactId)
    if (latest) coveredAt = latest.created_at
    const reason = await cancelReason(db, claimed, latest)
    if (reason || !latest) {
      console.log(`saas coda risposte: annullata (${reason}) spazio ${claimed.workspaceId.slice(0, 8)} ${claimed.platform}`)
      return 'cancelled'
    }
    if (claimed.delayMs >= TYPING_FROM_MS) await senderAction(db, claimed.platform, latest.channel_account_id, claimed.contactId, 'typing_on')
    // Scritta adesso: copre tutti i messaggi arrivati durante l'attesa.
    const outcome = await respondToMessage(db, latest.id, { stillWanted: async () => !(await humanReplied(db, claimed)) })
    console.log(`saas coda risposte: ${outcome.status}${outcome.reason ? ` (${outcome.reason})` : ''} spazio ${claimed.workspaceId.slice(0, 8)} ${claimed.platform}`)
    return outcome.status === 'sent' ? 'sent' : outcome.status === 'pending' ? 'draft' : outcome.status === 'failed' ? 'failed' : 'skipped'
  } catch (error) {
    console.error('saas coda risposte:', error instanceof Error ? error.message : error)
    return 'failed'
  } finally {
    await finish(db, key, claimId, coveredAt).catch((error) => console.error('saas coda risposte (fine):', error instanceof Error ? error.message : error))
  }
}

/**
 * Dentro il webhook (after): aspetta le risposte in coda con ritardo breve e le
 * invia all'ora prevista, finche' c'e' tempo (deadline). Il resto lo fa il cron.
 */
export async function waitForQueuedReplies(keys: string[], deadline: number): Promise<void> {
  await Promise.all(
    [...new Set(keys)].map(async (key) => {
      for (let round = 0; round < 40; round++) {
        const item = parseItem((await readSetting(key).catch(() => ({ value: null }))).value)
        if (!item || item.delayMs > AFTER_WAIT_MAX_SECONDS * 1000) return
        const now = Date.now()
        const wakeAt = claimedNow(item, now) ? now + 3_000 : item.dueAt
        if (wakeAt > deadline) return
        if (wakeAt > now) {
          await sleep(wakeAt - now)
          continue
        }
        const result = await processQueuedReply(key)
        if (result === 'none') return
        if (result === 'waiting') await sleep(500)
      }
    })
  )
}

/**
 * Dal cron (e, se il cron non gira, dai webhook e dall'omnichat aperta): invia le
 * risposte in coda arrivate all'ora prevista. Con horizonMs aspetta anche quelle
 * in scadenza entro quel tempo (il cron passa ogni minuto: cosi' partono puntuali).
 */
export async function processDueReplies(options: { workspaceId?: string; horizonMs?: number; limit?: number } = {}): Promise<number> {
  const prefix = `${QUEUE_PREFIX}${options.workspaceId ? `${options.workspaceId}:` : ''}`
  const { data, error } = await supabaseAdmin.from('app_settings').select('key, value').like('key', `${prefix}%`).limit(500)
  if (error || !data?.length) return 0
  const now = Date.now()
  const horizon = now + (options.horizonMs ?? 0)
  const due = data
    .map((row) => ({ key: row.key as string, item: parseItem(row.value as string) }))
    .filter((row): row is { key: string; item: QueueItem } => Boolean(row.item) && row.key.startsWith(QUEUE_PREFIX))
    .filter(({ item }) => item.dueAt <= horizon && !claimedNow(item, now))
    .sort((a, b) => a.item.dueAt - b.item.dueAt)
    .slice(0, options.limit ?? 25)
  let sent = 0
  // Poche alla volta: ognuna chiama l'AI.
  const queue = [...due]
  await Promise.all(
    Array.from({ length: Math.min(4, queue.length) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        await sleep(next.item.dueAt - Date.now())
        const result = await processQueuedReply(next.key).catch(() => 'failed' as const)
        if (result === 'sent') sent++
      }
    })
  )
  return sent
}
