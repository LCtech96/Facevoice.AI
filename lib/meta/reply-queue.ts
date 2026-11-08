import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { readSetting, updateSetting } from '@/lib/settings-store'
import type { VerifyPhase } from '@/lib/identity-verify'

// Risposte automatiche ai messaggi privati (Instagram, Messenger, WhatsApp) con l'invio
// automatico acceso: non si risponde a ogni messaggio. Molti scrivono a pezzi: si aspetta
// almeno 30 secondi dall'ULTIMO messaggio della persona e si manda una risposta sola per
// tutti (con un tetto: primo messaggio + 3 minuti, poi la risposta parte comunque).
// Funziona senza processi sempre accesi: ogni risposta in attesa e' una riga di app_settings
// (dm_reply:<canale>:<persona>) con l'ora prevista. La manda chi arriva per primo all'ora
// giusta: l'attesa dentro il webhook (after, fino a 45 secondi) o il cron di ogni minuto.
// La riga si "prende" con un confronto sul timbro (settings-store): webhook e cron insieme
// non la mandano mai due volte. La risposta si scrive al momento dell'invio
// (sendSeriesReply in lib/meta/agent.ts), cosi' copre tutti i messaggi arrivati nel frattempo.
// Bozze da approvare, commenti, email e controrisposte restano come prima: subito, una per messaggio.

export type DmPlatform = 'instagram' | 'facebook' | 'whatsapp'
/** Canali in cui le risposte automatiche ai messaggi privati aspettano la fine della serie. */
export const BATCHED_PLATFORMS: readonly string[] = ['instagram', 'facebook', 'whatsapp']

/** Attesa minima dopo l'ultimo messaggio della persona. */
export const MIN_DELAY_MS = 30_000
/** Variazione casuale dell'attesa: solo in piu' (da 0 a +20%), mai sotto il minimo. */
const JITTER = 0.2
/** Tetto di una serie di messaggi: dal primo messaggio, poi la risposta parte comunque. */
export const SERIES_CAP_MS = 3 * 60_000
/** Dentro il webhook si aspettano le risposte previste entro questo tempo; le altre le manda il cron. */
export const WEBHOOK_WAIT_MS = 45_000
/** Una risposta "presa" da piu' di 3 minuti si considera abbandonata (funzione interrotta): si riprova. */
const CLAIM_STALE_MS = 3 * 60_000
const MAX_ATTEMPTS = 3
const PREFIX = 'dm_reply:'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))

/**
 * Verifica dell'identita' raccolta dai messaggi della serie (ognuno controllato all'arrivo,
 * vedi handleIncoming): cosa dire nella risposta (phase) e hold se un controllo non e' riuscito.
 */
export type SeriesIdentity = { phase?: VerifyPhase; linked?: false; hold?: true }

/** Messaggi arrivati mentre la risposta della serie era in invio: alla fine si rimettono in coda. */
type Arrival = SeriesIdentity & { messageId: string; firstAt: number; lastAt: number; times?: number[]; text?: true }

/** Ore dei messaggi della serie tenute (le piu' recenti). */
const MAX_TIMES = 20
const addTime = (times: number[] | undefined, at: number) => [...(times || []), at].slice(-MAX_TIMES)

export type QueueItem = SeriesIdentity & {
  platform: DmPlatform
  contactId: string
  /** Ultimo messaggio messo in coda (all'invio si risponde a tutti quelli dopo la nostra ultima risposta). */
  messageId: string
  /** Ora del primo messaggio della serie (di Meta, se c'e'): le risposte a mano del team dopo quest'ora fermano l'invio. */
  firstAt: number
  /** Ore dei messaggi della serie: una risposta "dall'app" pochi secondi dopo uno di questi e' quella automatica di Meta. */
  times?: number[]
  /** Ultimo messaggio messo in coda (ora del server). */
  lastAt: number
  dueAt: number
  /** Almeno un messaggio della serie con testo; senza, la risposta e' quella fissa per foto e vocali. */
  text?: true
  more?: Arrival | null
  claimId?: string | null
  claimedAt?: number | null
  attempts?: number
}

export type EnqueueInput = {
  platform: DmPlatform
  contactId: string
  messageId: string
  /** Ora del messaggio (ms): quella di Meta se credibile, altrimenti quella di salvataggio. */
  at: number
  text: boolean
  /** Allegato subito dopo un altro allegato (burstGuard): non apre una risposta nuova, sposta solo quella in attesa. */
  quiet?: boolean
  identity: SeriesIdentity
}

export const queueKey = (platform: string, contactId: string) => `${PREFIX}${platform}:${contactId}`

export function parseItem(raw: string | null): QueueItem | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as QueueItem
    if (!v || typeof v.contactId !== 'string' || typeof v.platform !== 'string' || typeof v.dueAt !== 'number' || typeof v.firstAt !== 'number') return null
    return v
  } catch {
    return null
  }
}

/** Attesa con la variazione casuale (da 0 a +20%: mai meno del minimo). */
export const withJitter = (ms: number, random = Math.random()) => Math.round(ms * (1 + Math.min(Math.max(random, 0), 1) * JITTER))

const claimedNow = (item: QueueItem, now: number) => Boolean(item.claimId && item.claimedAt && now - item.claimedAt < CLAIM_STALE_MS)

/**
 * Cosa dire nella risposta: vale il passo dell'ultimo messaggio, ma un seguito "debole"
 * non cancella un passo che non ha ancora avuto risposta (es. la verifica appena aperta
 * resta "start" anche se il messaggio dopo da solo direbbe "chiedi di nuovo i dati").
 */
const WEAKER_AFTER: Partial<Record<VerifyPhase, VerifyPhase>> = { ask_again: 'start', wait_code: 'code_wrong', data_received: 'code_expired' }

export function mergeIdentity(prev: SeriesIdentity, next: SeriesIdentity): SeriesIdentity {
  let phase = prev.phase
  let linked = prev.linked
  if (next.phase && next.phase !== 'none' && !(prev.phase && WEAKER_AFTER[next.phase] === prev.phase)) {
    phase = next.phase
    linked = next.linked
  }
  const out: SeriesIdentity = {}
  if (phase && phase !== 'none') out.phase = phase
  if (phase === 'verified_now' && linked === false) out.linked = false
  if (prev.hold || next.hold) out.hold = true
  return out
}

const identityOf = (s: SeriesIdentity): SeriesIdentity => mergeIdentity({}, s)

/**
 * Nuovo messaggio: nuova risposta in coda, oppure (se ce n'e' gia' una in attesa) l'invio
 * si sposta a "adesso + attesa", ma mai oltre il tetto della serie. Se la risposta e' in
 * invio proprio ora resta di chi la invia: il messaggio si segna (more) e alla fine chi la
 * invia lo rimette in coda, se la risposta appena scritta non lo copriva.
 */
export function nextQueueItem(current: QueueItem | null, input: EnqueueInput, now: number, random = Math.random()): QueueItem | false {
  const text = input.text ? (true as const) : undefined
  if (current && claimedNow(current, now)) {
    if (input.quiet) return false
    const prev = current.more
    return {
      ...current,
      more: {
        ...mergeIdentity(prev || {}, input.identity),
        messageId: input.messageId,
        firstAt: prev?.firstAt ?? input.at,
        lastAt: now,
        times: addTime(prev?.times, input.at),
        ...(prev?.text || text ? { text: true as const } : {}),
      },
    }
  }
  if (current && !current.claimId) {
    const merged = mergeIdentity(current, input.identity)
    const pushed = Math.min(now + withJitter(MIN_DELAY_MS, random), current.firstAt + SERIES_CAP_MS)
    return {
      ...current,
      phase: merged.phase,
      linked: merged.linked,
      hold: merged.hold,
      messageId: input.messageId,
      lastAt: now,
      dueAt: Math.max(current.dueAt, pushed),
      times: addTime(current.times, input.at),
      text: current.text || text,
    }
  }
  // burstGuard: un allegato dopo un altro (gia' risposto) non apre una risposta nuova.
  if (!current && input.quiet) return false
  // Nessuna in coda, oppure presa da una funzione che si e' interrotta: si riparte (con i messaggi della serie interrotta).
  const merged = current ? mergeIdentity(mergeIdentity(identityOf(current), current.more || {}), input.identity) : identityOf(input.identity)
  return {
    platform: input.platform,
    contactId: input.contactId,
    messageId: input.messageId,
    firstAt: current ? Math.min(current.firstAt, input.at) : input.at,
    lastAt: now,
    dueAt: now + withJitter(MIN_DELAY_MS, random),
    times: addTime([...(current?.times || []), ...(current?.more?.times || [])], input.at),
    ...merged,
    ...(current?.text || current?.more?.text || text ? { text: true as const } : {}),
    more: null,
    claimId: null,
    claimedAt: null,
    attempts: current?.attempts ?? 0,
  }
}

/** Mette in coda (o sposta) la risposta a questo messaggio. Restituisce la chiave della riga, o null se non serve rispondere. */
export async function enqueueDmReply(input: EnqueueInput): Promise<string | null> {
  const key = queueKey(input.platform, input.contactId)
  const item = await updateSetting(key, parseItem, (current) => nextQueueItem(current, input, Date.now()))
  return item ? key : null
}

const nextStamp = (stamp: string | null) => new Date(Math.max(Date.now(), stamp ? Date.parse(stamp) + 1 : 0)).toISOString()

/** Cancella la riga solo se e' ancora quella letta (nessuno l'ha cambiata nel frattempo). */
async function deleteIfUnchanged(key: string, stamp: string | null): Promise<boolean> {
  if (!stamp) return false
  const { data, error } = await supabaseAdmin.from('app_settings').delete().eq('key', key).eq('updated_at', stamp).select('key')
  return !error && Boolean(data?.length)
}

async function latestIncomingAt(platform: string, contactId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('social_messages')
    .select('created_at')
    .eq('platform', platform)
    .eq('contact_id', contactId)
    .eq('kind', 'message')
    .eq('direction', 'in')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data?.created_at as string | undefined) ?? null
}

/**
 * Fine dell'invio: se intanto e' arrivato un messaggio nuovo non coperto dalla risposta
 * appena scritta (coveredAt = ora dell'ultimo messaggio della persona che la risposta ha
 * letto) si rimette in coda, altrimenti la riga si cancella.
 */
async function finish(key: string, claimId: string, coveredAt: string | null) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { value, stamp } = await readSetting(key)
    const item = parseItem(value)
    if (!item || item.claimId !== claimId) return
    const more = item.more
    let requeue = false
    if (more) {
      const latest = await latestIncomingAt(item.platform, item.contactId)
      requeue = Boolean(latest && (!coveredAt || Date.parse(latest) > Date.parse(coveredAt)))
    }
    if (more && requeue) {
      const now = Date.now()
      const next: QueueItem = {
        platform: item.platform,
        contactId: item.contactId,
        messageId: more.messageId,
        firstAt: more.firstAt,
        lastAt: more.lastAt,
        dueAt: Math.max(now, Math.min(more.lastAt + withJitter(MIN_DELAY_MS), more.firstAt + SERIES_CAP_MS)),
        times: more.times || [],
        ...identityOf(more),
        ...(more.text ? { text: true as const } : {}),
        more: null,
        claimId: null,
        claimedAt: null,
        attempts: 0,
      }
      const { data } = await supabaseAdmin
        .from('app_settings')
        .update({ value: JSON.stringify(next), updated_at: nextStamp(stamp) })
        .eq('key', key)
        .eq('updated_at', stamp as string)
        .select('key')
      if (data?.length) return
    } else if (await deleteIfUnchanged(key, stamp)) return
    await sleep(50 + Math.random() * 150)
  }
}

export type ProcessResult = 'sent' | 'draft' | 'none' | 'cancelled' | 'failed' | 'waiting' | 'busy'

/**
 * Invia la risposta in coda se e' l'ora. La riga si "prenota" con un confronto sul timbro:
 * due funzioni insieme (webhook e cron) non la mandano mai due volte.
 */
export async function processQueuedReply(key: string): Promise<ProcessResult> {
  const claimId = randomUUID()
  const claimedAt = Date.now()
  let item: QueueItem | null
  try {
    item = await updateSetting(key, parseItem, (current) => {
      if (!current || claimedNow(current, claimedAt) || current.dueAt > claimedAt) return false
      return { ...current, claimId, claimedAt, attempts: (current.attempts ?? 0) + 1 }
    })
  } catch {
    return 'busy'
  }
  if (!item) return 'none'
  if (item.claimId !== claimId) return claimedNow(item, Date.now()) ? 'busy' : 'waiting'

  const claimed = item
  let coveredAt: string | null = null
  try {
    if ((claimed.attempts ?? 0) > MAX_ATTEMPTS) {
      console.log(`${claimed.platform} message: risposta in coda annullata (troppi tentativi)`)
      return 'cancelled'
    }
    // Import al momento: agent.ts usa questo modulo per mettere in coda.
    const { sendSeriesReply } = await import('@/lib/meta/agent')
    const outcome = await sendSeriesReply(claimed)
    coveredAt = outcome.coveredAt
    return outcome.status
  } catch (error) {
    console.error(`${claimed.platform} message: risposta in coda non riuscita:`, error instanceof Error ? error.message : error)
    return 'failed'
  } finally {
    await finish(key, claimId, coveredAt).catch((error) =>
      console.error(`${claimed.platform} message: coda risposte (fine):`, error instanceof Error ? error.message : error)
    )
  }
}

/**
 * Dentro il webhook (after): aspetta le risposte in coda di questi messaggi e le invia
 * all'ora prevista, se arriva entro deadline. Il resto lo fa il cron.
 */
export async function waitForDmReplies(keys: string[], deadline = Date.now() + WEBHOOK_WAIT_MS): Promise<void> {
  await Promise.all(
    [...new Set(keys)].map(async (key) => {
      for (let round = 0; round < 40; round++) {
        let item: QueueItem | null
        try {
          item = parseItem((await readSetting(key)).value)
        } catch {
          return
        }
        if (!item) return
        const now = Date.now()
        // In invio da un'altra funzione: si ricontrolla tra poco (puo' rimettere in coda un messaggio nuovo).
        const wakeAt = claimedNow(item, now) ? now + 3_000 : item.dueAt
        if (wakeAt > deadline) return
        if (wakeAt > now) {
          await sleep(wakeAt - now + 5)
          continue
        }
        const result = await processQueuedReply(key)
        if (result === 'none') return
        if (result === 'waiting' || result === 'busy') await sleep(500)
      }
    })
  )
}

/**
 * Dal cron di ogni minuto: invia le risposte in coda arrivate all'ora prevista (anche quelle
 * rimaste "prese" da una funzione interrotta). Con horizonMs aspetta anche quelle in scadenza
 * entro quel tempo. Restituisce quante sono partite.
 */
export async function processDueDmReplies(options: { horizonMs?: number; limit?: number } = {}): Promise<number> {
  const { data, error } = await supabaseAdmin.from('app_settings').select('key, value').like('key', `${PREFIX}%`).limit(500)
  if (error || !data?.length) return 0
  const now = Date.now()
  const horizon = now + (options.horizonMs ?? 0)
  const due = data
    .map((row) => ({ key: row.key as string, item: parseItem(row.value as string) }))
    .filter((row): row is { key: string; item: QueueItem } => Boolean(row.item) && row.key.startsWith(PREFIX))
    .filter(({ item }) => item.dueAt <= horizon && !claimedNow(item, now))
    .sort((a, b) => a.item.dueAt - b.item.dueAt)
    .slice(0, options.limit ?? 9)
  let sent = 0
  // Poche alla volta: ognuna chiama l'AI.
  const queue = [...due]
  await Promise.all(
    Array.from({ length: Math.min(3, queue.length) }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        await sleep(next.item.dueAt - Date.now() + 5)
        const result = await processQueuedReply(next.key).catch(() => 'failed' as const)
        if (result === 'sent') sent++
      }
    })
  )
  return sent
}
