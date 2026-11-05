import { supabaseAdmin } from '@/lib/supabase-admin'
import type { WorkspaceDb } from '@/lib/workspace-db'
import { listConnections, readConnectionSecret, type Connection } from './connections'
import { GRAPH, type MetaSecret } from './meta'
import { IG_GRAPH, instagramLoginToken } from './instagram'

// Storico delle chat Messenger e Direct letto da Meta. Serve quando il primo
// messaggio l'ha scritto il cliente a mano dall'app (Meta non permette i DM di
// marketing automatici): prima della risposta dell'AI si leggono gli ultimi
// messaggi della conversazione e si salvano quelli che mancano, cosi' l'AI sa
// cosa abbiamo proposto e continua da li'.

/** Messaggi in uscita scritti a mano dall'app di Instagram/Facebook (o da Business Suite). */
export const APP_ORIGIN = 'manual_app'

/**
 * Le risposte automatiche di Meta (risposta istantanea, messaggio di assenza,
 * domande frequenti) arrivano anche loro come messaggi "dall'app", pochi secondi
 * dopo il messaggio della persona: non sono una persona che risponde e non
 * fermano l'AI. Ore confrontate: quelle di Meta (messaggi ricevuti e dall'app).
 */
export const AUTOMATIC_REPLY_GRACE_MS = 5_000
/** Margine sugli orari: lo storico di Meta ha i secondi, i webhook i millisecondi. */
const CLOCK_FUZZ_MS = 1_000

/** Il messaggio dall'app (ora sentAt) sembra la risposta automatica di Meta a uno di questi messaggi ricevuti (ore)? */
export function looksAutomatic(sentAt: number, incoming: number[]): boolean {
  return incoming.some((at) => sentAt - at > -CLOCK_FUZZ_MS && sentAt - at < AUTOMATIC_REPLY_GRACE_MS)
}

/** Dopo il messaggio dall'app (ora sentAt) la persona ha scritto ancora? Allora si risponde al suo messaggio nuovo. */
export function wroteAfter(sentAt: number, incoming: number[]): boolean {
  return incoming.some((at) => at - sentAt > CLOCK_FUZZ_MS)
}

/** Ora del webhook data da Meta (millisecondi, o secondi), se credibile; altrimenti adesso. */
export function metaEventTime(timestamp: unknown): string {
  const now = Date.now()
  let ms = typeof timestamp === 'string' && timestamp.trim() !== '' ? Number(timestamp) : typeof timestamp === 'number' ? timestamp : NaN
  if (Number.isFinite(ms) && ms < 1e12) ms *= 1000
  return new Date(Number.isFinite(ms) && ms > now - 7 * 86_400_000 && ms < now + 5 * 60_000 ? ms : now).toISOString()
}

const HISTORY_PREFIX = 'meta_history:'
/** Con messaggi nostri gia' salvati si rilegge lo storico al massimo ogni 30 minuti. */
const RESYNC_MS = 30 * 60_000
/** Senza messaggi nostri (es. conversazione nuova): non piu' di una lettura al minuto. */
const MIN_GAP_MS = 60_000
const TIMEOUT_MS = 5_000
/** Messaggi della persona piu' recenti di cosi': il loro webhook e' probabilmente in arrivo (e li salva con la loro risposta). */
const IN_FLIGHT_MS = 2 * 60_000
const FIELDS = 'messages.limit(20){id,message,from,to,created_time}'

export type GraphMessage = {
  id?: string
  message?: string
  created_time?: string
  from?: { id?: string; username?: string; name?: string }
  to?: { data?: Array<{ id?: string }> }
}

const historyKey = (workspaceId: string, platform: string, contactId: string) => `${HISTORY_PREFIX}${workspaceId}:${platform}:${contactId}`

/** "2026-11-05T10:00:00+0000" (formato di Meta) -> millisecondi. */
export function graphTime(value: string | undefined): number | null {
  if (!value) return null
  const ms = Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
  return Number.isFinite(ms) ? ms : null
}

async function getJson<T>(url: string, token: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.error) throw new Error(data?.error?.message || `Meta HTTP ${res.status}`)
  return data as T
}

type ConversationList = { data?: Array<{ id?: string; messages?: { data?: GraphMessage[] } }> }

/** Ultimi messaggi (fino a 20) della chat con questa persona, dal piu' recente. */
export async function fetchConversation(connection: Connection, contactId: string): Promise<GraphMessage[]> {
  const signal = AbortSignal.timeout(TIMEOUT_MS)
  const igToken = await instagramLoginToken(connection)
  let base: string
  let token: string
  let path: string
  if (igToken) {
    // Instagram collegato con l'accesso di Instagram.
    base = IG_GRAPH
    token = igToken
    path = `/me/conversations?${new URLSearchParams({ platform: 'instagram', user_id: contactId, fields: FIELDS })}`
  } else {
    // Pagina Facebook (Messenger) o Instagram collegato tramite la Pagina.
    const secret = await readConnectionSecret<MetaSecret>(connection.id)
    base = GRAPH
    token = secret.pageToken
    const owner = secret.pageId || connection.external_id
    path = `/${owner}/conversations?${new URLSearchParams({ platform: connection.platform === 'instagram' ? 'instagram' : 'messenger', user_id: contactId, fields: FIELDS })}`
  }
  const list = await getJson<ConversationList>(`${base}${path}`, token, signal)
  const conversation = list.data?.[0]
  if (!conversation) return []
  if (conversation.messages?.data) return conversation.messages.data
  // Alcune versioni non espandono i messaggi nell'elenco: si chiedono alla conversazione.
  if (!conversation.id) return []
  const detail = await getJson<{ messages?: { data?: GraphMessage[] } }>(`${base}/${conversation.id}?${new URLSearchParams({ fields: FIELDS })}`, token, signal)
  return detail.messages?.data || []
}

type StoredRow = { external_id: string | null; direction: 'in' | 'out'; body: string; created_at: string; contact_name: string | null }

const sameText = (a: string, b: string) => a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim()

/**
 * Righe da salvare per i messaggi di Meta che mancano. Doppioni esclusi per id e,
 * se gli id non coincidono, per testo e orario vicino. I messaggi ricevuti negli
 * ultimi 2 minuti non si salvano: arrivano dal loro webhook (e cosi' ricevono la
 * loro risposta).
 */
export function historyRows(
  messages: GraphMessage[],
  input: { platform: string; contactId: string; accountId: string; ownIds: string[]; contactName: string | null; existing: StoredRow[] },
  nowMs = Date.now()
): Record<string, unknown>[] {
  const known = new Set(input.existing.map((row) => row.external_id).filter(Boolean))
  const own = new Set(input.ownIds.filter(Boolean))
  const rows: Record<string, unknown>[] = []
  const now = new Date(nowMs).toISOString()
  // Ricevuti dopo l'ultimo salvato (webhook perso): restano "nuovi" nell'omnichat.
  const newestIn = Math.max(0, ...input.existing.filter((row) => row.direction === 'in').map((row) => new Date(row.created_at).getTime() || 0))
  for (const m of messages) {
    if (!m.id || known.has(m.id)) continue
    const at = graphTime(m.created_time)
    if (at === null) continue
    const fromId = m.from?.id
    const toIds = (m.to?.data || []).map((t) => t.id)
    const out = fromId ? (own.has(fromId) ? true : fromId === input.contactId ? false : toIds.includes(input.contactId)) : toIds.includes(input.contactId)
    const text = (m.message || '').trim()
    const body = (text || '[allegato]').slice(0, 4000)
    if (!out && nowMs - at < IN_FLIGHT_MS) continue
    const duplicate = input.existing.some((row) => {
      if (row.direction !== (out ? 'out' : 'in')) return false
      const gap = Math.abs(new Date(row.created_at).getTime() - at)
      // In arrivo il testo salvato puo' avere in coda la descrizione degli allegati.
      return out ? gap < 24 * 3600_000 && sameText(row.body, body) : gap < 10 * 60_000 && (sameText(row.body, body) || (text !== '' && row.body.startsWith(text)))
    })
    if (duplicate) continue
    known.add(m.id)
    rows.push({
      platform: input.platform,
      kind: 'message',
      direction: out ? 'out' : 'in',
      contact_id: input.contactId,
      contact_name: input.contactName,
      external_id: m.id,
      channel_account_id: input.accountId,
      body,
      created_at: new Date(at).toISOString(),
      status: out ? 'sent' : null,
      origin: out ? APP_ORIGIN : null,
      // Messaggi vecchi della chat: non contano come "nuovi" nell'omnichat.
      read_at: out || at > newestIn ? null : now,
    })
  }
  return rows
}

/**
 * Prima di una risposta dell'AI: legge lo storico della chat da Meta se non
 * abbiamo ancora messaggi nostri salvati (o se l'ultima lettura e' di oltre 30
 * minuti fa) e salva quelli che mancano. Al massimo 5 secondi; gli errori non
 * fermano mai la risposta. Restituisce quanti messaggi ha aggiunto.
 */
export async function syncConversationHistory(
  db: WorkspaceDb,
  input: { platform: string; contactId: string; accountId: string | null; contactName: string | null }
): Promise<number> {
  if (input.platform !== 'facebook' && input.platform !== 'instagram') return 0
  try {
    const key = historyKey(db.workspaceId, input.platform, input.contactId)
    const [{ data: last }, { count: outgoing }] = await Promise.all([
      supabaseAdmin.from('app_settings').select('value').eq('key', key).maybeSingle(),
      db
        .from('social_messages')
        .select('id', { count: 'exact', head: true })
        .eq('platform', input.platform)
        .eq('contact_id', input.contactId)
        .eq('kind', 'message')
        .eq('direction', 'out')
        .eq('status', 'sent'),
    ])
    const lastAt = last?.value ? new Date(last.value as string).getTime() || 0 : 0
    const age = Date.now() - lastAt
    if (age < (outgoing ? RESYNC_MS : MIN_GAP_MS)) return 0

    const connections = (await listConnections(db, input.platform as 'facebook' | 'instagram')).filter((c) => c.status !== 'disconnected')
    const connection = connections.find((c) => c.external_id === input.accountId) || connections[0]
    if (!connection) return 0
    // Segnata prima della lettura: due risposte insieme non leggono due volte.
    const stamp = new Date().toISOString()
    await supabaseAdmin.from('app_settings').upsert({ key, value: stamp, updated_at: stamp }, { onConflict: 'key' })

    const messages = await fetchConversation(connection, input.contactId)
    if (!messages.length) return 0
    const { data: existing } = await db
      .from('social_messages')
      .select('external_id, direction, body, created_at, contact_name')
      .eq('platform', input.platform)
      .eq('contact_id', input.contactId)
      .eq('kind', 'message')
      .order('created_at', { ascending: false })
      .limit(100)
    const stored = (existing || []) as StoredRow[]
    const meta = (connection.meta || {}) as { pageId?: string }
    const rows = historyRows(messages, {
      platform: input.platform,
      contactId: input.contactId,
      accountId: connection.external_id,
      ownIds: [connection.external_id, meta.pageId || '', input.accountId || ''],
      contactName: input.contactName || stored.find((row) => row.contact_name)?.contact_name || null,
      existing: stored,
    })
    if (!rows.length) return 0
    const { data, error } = await db
      .from('social_messages')
      .upsert(rows, { onConflict: 'workspace_id,external_id', ignoreDuplicates: true })
      .select('id')
    if (error) {
      console.warn(`saas storico ${input.platform}: non salvato (${error.message})`)
      return 0
    }
    const added = data?.length ?? rows.length
    console.log(`saas storico ${input.platform}: ${added} messaggi aggiunti alla conversazione (spazio ${db.workspaceId.slice(0, 8)})`)
    return added
  } catch (error) {
    console.warn(`saas storico ${input.platform}:`, error instanceof Error ? error.message : error)
    return 0
  }
}
