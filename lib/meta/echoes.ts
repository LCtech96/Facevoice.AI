import { createHash } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { readSetting, updateSetting } from '@/lib/settings-store'
import { ensureMessageEchoes, fetchContactProfile } from '@/lib/meta/graph'

// Messaggi che l'account invia da solo, fuori dalla nostra API: il primo messaggio scritto a
// mano dall'app di Instagram o di Facebook (o da Meta Business Suite) e le risposte a mano.
// Meta li rimanda al webhook come "eco" (is_echo): la persona e' il DESTINATARIO. Si salvano
// come messaggi nostri, scritti a mano, cosi' l'AI li legge come contesto. Mai una risposta AI,
// mai verifica dell'identita' o collegamento automatico: non sono parole del cliente.

/** Origine dei messaggi scritti a mano dall'app (Instagram, Messenger, Business Suite). */
export const APP_ORIGIN = 'manual_app'

const SEND_PREFIX = 'meta_send:'
/** Per quanto un nostro invio con la Graph API riconosce la sua eco. */
const SEND_TTL_MS = 15 * 60_000
/** Senza segno dell'invio si aspetta un attimo: la riga del nostro invio puo' essere in salvataggio. */
const RECHECK_MS = 2_500
const ECHO_CHECK_KEY = 'meta_echo_subscription'
const ECHO_CHECK_EVERY_MS = 86_400_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()
const digest = (text: string) => createHash('sha256').update(normalize(text)).digest('hex').slice(0, 24)
/** contactId null: risposta privata a un commento, il destinatario lo sa solo Meta. */
const sendKey = (platform: string, contactId: string | null, text: string) => `${SEND_PREFIX}${platform}:${contactId ?? '*'}:${digest(text)}`

/** Prima di un invio con la Graph API: la sua eco non e' un messaggio scritto a mano. Mai bloccante. */
export async function noteApiSend(platform: string, contactId: string | null, text: string): Promise<void> {
  if (!normalize(text)) return
  const now = new Date().toISOString()
  const { error } = await supabaseAdmin.from('app_settings').upsert({ key: sendKey(platform, contactId, text), value: now, updated_at: now })
  if (error) console.warn('eco: invio non segnato:', error.message)
  // Pulizia dei segni vecchi (ogni invio ne lascia uno), ogni tanto.
  if (Math.random() < 0.1) {
    await supabaseAdmin
      .from('app_settings')
      .delete()
      .like('key', `${SEND_PREFIX}%`)
      .lt('updated_at', new Date(Date.now() - 86_400_000).toISOString())
  }
}

/** Questo testo per questa persona e' partito da poco con la Graph API (risposta AI o dalla casella)? */
export async function isApiSend(platform: string, contactId: string, text: string): Promise<boolean> {
  if (!normalize(text)) return false
  const { data, error } = await supabaseAdmin
    .from('app_settings')
    .select('key, value')
    .in('key', [sendKey(platform, contactId, text), sendKey(platform, null, text)])
  if (error) return false
  const since = Date.now() - SEND_TTL_MS
  return (data || []).some((row) => Date.parse(row.value) >= since)
}

async function messageStored(mid: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from('social_messages').select('id').eq('external_id', mid).limit(1)
  return Boolean(data?.length)
}

/** Una nostra risposta con lo stesso testo e' in invio o appena partita (es. approvata dalla casella). */
async function ourRowWithText(platform: string, contactId: string, text: string): Promise<boolean> {
  const wanted = normalize(text)
  if (!wanted) return false
  const { data } = await supabaseAdmin
    .from('social_messages')
    .select('body, status, created_at')
    .eq('platform', platform)
    .eq('contact_id', contactId)
    .eq('direction', 'out')
    .in('status', ['sending', 'sent'])
    .order('created_at', { ascending: false })
    .limit(20)
  const recent = Date.now() - SEND_TTL_MS
  return (data || []).some(
    (row) => normalize(String(row.body || '')) === wanted && (row.status === 'sending' || Date.parse(row.created_at) >= recent)
  )
}

/** Nome gia' noto della persona, altrimenti quello del profilo Meta. */
export async function contactNameFor(platform: 'facebook' | 'instagram', contactId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('social_messages')
    .select('contact_name')
    .eq('platform', platform)
    .eq('contact_id', contactId)
    .not('contact_name', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (data?.contact_name) return data.contact_name
  const profile = await fetchContactProfile(platform, contactId).catch(() => ({ name: null, username: null }))
  return profile.name || (profile.username ? `@${profile.username}` : null)
}

type InsertError = { code?: string; message: string } | null

/**
 * Inserisce messaggi nostri o storici; se manca la colonna origin si salvano lo stesso.
 * ignoreDuplicates: i doppioni (es. salvati intanto da un webhook) si saltano, uno per uno.
 * Insert semplice, senza ON CONFLICT: vale con il vincolo su external_id da solo o per spazio di lavoro.
 */
export async function insertMessages(rows: Record<string, unknown>[], options: { ignoreDuplicates?: boolean } = {}): Promise<{ error: InsertError }> {
  const write = async (values: Record<string, unknown>[]): Promise<{ error: InsertError }> => {
    const { error } = await supabaseAdmin.from('social_messages').insert(values)
    if (error?.code !== '23505' || !options.ignoreDuplicates) return { error }
    for (const value of values) {
      const { error: single } = await supabaseAdmin.from('social_messages').insert(value)
      if (single && single.code !== '23505') return { error: single }
    }
    return { error: null }
  }
  const { error } = await write(rows)
  if (error?.code === '42703') return write(rows.map(({ origin: _origin, ...rest }) => rest))
  return { error }
}

const ATTACHMENT_LABEL: Record<string, string> = {
  image: 'una foto',
  video: 'un video',
  audio: 'un vocale',
  file: 'un file',
  share: 'un post',
  ig_post: 'un post',
  ig_reel: 'un reel',
  reel: 'un reel',
}

function attachmentText(attachments: { type?: string }[] | undefined): string {
  const items = (attachments || []).slice(0, 3)
  if (!items.length) return ''
  return `[Abbiamo inviato ${items.map((a) => ATTACHMENT_LABEL[a.type || ''] || 'un allegato').join(', ')}]`
}

/** Ora vera dell'invio (timestamp di Meta), se credibile; altrimenti adesso. */
function eventTime(timestamp: number | undefined): string {
  const now = Date.now()
  if (typeof timestamp === 'number' && timestamp > now - 7 * 86_400_000 && timestamp < now + 5 * 60_000) return new Date(timestamp).toISOString()
  return new Date(now).toISOString()
}

/**
 * Le risposte automatiche di Meta (risposte istantanee e messaggi di assenza di Business Suite) arrivano
 * anch'esse come eco, entro un paio di secondi dal messaggio della persona: non sono il team che risponde.
 */
export const AUTOMATIC_REPLY_GRACE_MS = 4_000
/** Il messaggio della persona si salva qualche secondo dopo la sua ora su Meta (profilo, allegati letti dall'AI). */
const INCOMING_SAVE_LAG_MS = 60_000

/**
 * Messaggio "dall'app" (ora di Meta sentAt) che sembra una risposta automatica di Meta: c'e' un messaggio
 * della persona salvato poco prima (entro la grazia) o poco dopo (ritardo di salvataggio).
 */
export function looksAutomaticReply(sentAt: number, incoming: number[]): boolean {
  return incoming.some((at) => sentAt - at < AUTOMATIC_REPLY_GRACE_MS && at - sentAt <= INCOMING_SAVE_LAG_MS)
}

/** Ore dei messaggi della persona vicini a sentAt (quelli che possono far sembrare automatico un messaggio dall'app). */
export async function incomingTimesAround(platform: string, contactId: string, sentAt: number): Promise<number[]> {
  const { data } = await supabaseAdmin
    .from('social_messages')
    .select('created_at')
    .eq('platform', platform)
    .eq('contact_id', contactId)
    .eq('direction', 'in')
    .eq('kind', 'message')
    .gte('created_at', new Date(sentAt - AUTOMATIC_REPLY_GRACE_MS).toISOString())
    .lte('created_at', new Date(sentAt + INCOMING_SAVE_LAG_MS).toISOString())
    .limit(20)
  return (data || []).map((row) => Date.parse(row.created_at))
}

/**
 * Risposte AI ancora in bozza per questa conversazione: chi scrive a mano prende in carico
 * la conversazione, la bozza (ormai superata) non parte piu' (niente doppie risposte).
 * Se dopo il messaggio a mano la persona ha gia' riscritto, restano le bozze per quel nuovo messaggio.
 */
async function cancelPendingReplies(platform: string, contactId: string, sentAt: string): Promise<number> {
  const { data: newer } = await supabaseAdmin
    .from('social_messages')
    .select('created_at')
    .eq('platform', platform)
    .eq('contact_id', contactId)
    .eq('direction', 'in')
    .gt('created_at', sentAt)
    .order('created_at', { ascending: true })
    .limit(1)
  let query = supabaseAdmin
    .from('social_messages')
    .update({ status: 'rejected', error_message: 'Annullata: hai risposto tu dall’app' })
    .eq('platform', platform)
    .eq('contact_id', contactId)
    .eq('direction', 'out')
    .eq('kind', 'message')
    .eq('status', 'pending')
  if (newer?.[0]?.created_at) query = query.lt('created_at', newer[0].created_at)
  const { data, error } = await query.select('id')
  if (error) {
    console.error(`${platform} eco: bozze non annullate:`, error.message)
    return 0
  }
  return data?.length ?? 0
}

export type EchoInput = {
  platform: 'facebook' | 'instagram'
  /** entry.id del webhook: la nostra Pagina o il nostro Instagram. */
  accountId: string | null
  /** recipient.id: la persona a cui abbiamo scritto. */
  contactId: string
  mid: string
  text?: string | null
  attachments?: { type?: string }[]
  /** Millisecondi, come li manda Meta. */
  timestamp?: number
  appId?: string | number | null
}

export type EchoResult = 'stored' | 'known' | 'api' | 'ignored'

/**
 * Eco di un messaggio inviato dal nostro account. Se e' una nostra risposta via API (gia'
 * salvata o in invio) si ignora; altrimenti e' scritta a mano dall'app e si salva come
 * messaggio nostro. Annulla le bozze AI in attesa per quella conversazione.
 */
export async function recordEcho(input: EchoInput): Promise<EchoResult> {
  const { platform, contactId, mid } = input
  if (!mid || !contactId || contactId === input.accountId) return 'ignored'
  const text = (input.text || '').trim()
  const body = (text || attachmentText(input.attachments)).slice(0, 4000)
  if (!body) return 'ignored'

  if (await messageStored(mid)) return 'known'
  const ownApp = process.env.META_APP_ID?.trim()
  if (ownApp && input.appId != null && String(input.appId) === ownApp) return 'api'
  if (text && (await isApiSend(platform, contactId, text))) return 'api'
  if (text && (await ourRowWithText(platform, contactId, text))) return 'api'
  // Nessun segno: per sicurezza si ricontrolla tra un attimo (la riga del nostro invio puo' arrivare ora).
  await sleep(RECHECK_MS)
  if (await messageStored(mid)) return 'known'
  if (text && (await ourRowWithText(platform, contactId, text))) return 'api'

  const sentAt = eventTime(input.timestamp)
  const { error } = await insertMessages([
    {
      platform,
      kind: 'message',
      contact_id: contactId,
      contact_name: await contactNameFor(platform, contactId),
      direction: 'out',
      external_id: mid,
      channel_account_id: input.accountId,
      body,
      status: 'sent',
      origin: APP_ORIGIN,
      created_at: sentAt,
    },
  ])
  if (error) {
    if (error.code === '23505') return 'known'
    console.error(`${platform} eco: non salvata:`, error.message)
    return 'ignored'
  }

  // Risposta automatica di Meta: si salva (l'AI la vede) ma non e' una presa in carico, le bozze restano.
  if (looksAutomaticReply(Date.parse(sentAt), await incomingTimesAround(platform, contactId, Date.parse(sentAt)))) {
    console.log(`${platform} eco: sembra una risposta automatica di Meta, bozze AI lasciate`)
    return 'stored'
  }
  const cancelled = await cancelPendingReplies(platform, contactId, sentAt)
  if (cancelled) console.log(`${platform} eco: hai risposto a mano, ${cancelled} bozz${cancelled === 1 ? 'a' : 'e'} AI annullat${cancelled === 1 ? 'a' : 'e'}`)
  return 'stored'
}

/** Dopo `since` il team ha gia' risposto a mano (dall'app o dalla casella)? Allora l'AI non risponde. */
export async function manualReplySince(platform: string, contactId: string, since: string): Promise<boolean> {
  const after = new Date(Date.parse(since) + AUTOMATIC_REPLY_GRACE_MS).toISOString()
  const { data, error } = await supabaseAdmin
    .from('social_messages')
    .select('id')
    .eq('platform', platform)
    .eq('contact_id', contactId)
    .eq('direction', 'out')
    .eq('kind', 'message')
    .eq('status', 'sent')
    .in('origin', [APP_ORIGIN, 'manual'])
    .gt('created_at', after)
    .limit(1)
  return !error && Boolean(data?.length)
}

let echoCheckedAt = 0

type Stamp = { at: string } | null

/** Ora salvata con updateSetting (JSON). */
const parseStamp = (raw: string | null): Stamp => {
  try {
    const value = raw ? JSON.parse(raw) : null
    return typeof value?.at === 'string' ? { at: value.at } : null
  } catch {
    return null
  }
}

/**
 * Una volta al giorno: la Pagina deve mandarci le eco (campo message_echoes). Se manca lo
 * aggiunge ai campi gia' attivi. Mai bloccante.
 */
export async function ensureEchoSubscription(): Promise<void> {
  if (Date.now() - echoCheckedAt < ECHO_CHECK_EVERY_MS) return
  echoCheckedAt = Date.now()
  try {
    const due = (stamp: Stamp) => Date.now() - (Date.parse(stamp?.at || '') || 0) >= ECHO_CHECK_EVERY_MS
    if (!due(parseStamp((await readSetting(ECHO_CHECK_KEY)).value))) return
    // Una sola funzione alla volta fa il controllo: stesso oggetto restituito = salvato da questa.
    const claim: Stamp = { at: new Date().toISOString() }
    const saved = await updateSetting<Stamp>(ECHO_CHECK_KEY, parseStamp, (current) => (due(current) ? claim : false)).catch(() => null)
    if (saved !== claim) return
    const result = await ensureMessageEchoes()
    if (result === 'added') console.log('meta: campo message_echoes aggiunto alla Pagina (eco dei messaggi scritti a mano)')
    else if (typeof result === 'object') console.warn('meta: controllo eco della Pagina non riuscito:', result.error)
  } catch (error) {
    console.warn('meta: controllo eco della Pagina non riuscito:', error instanceof Error ? error.message : error)
  }
}
