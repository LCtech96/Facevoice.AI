import { supabaseAdmin } from '@/lib/supabase-admin'
import { updateSetting } from '@/lib/settings-store'
import { fetchConversationHistory } from '@/lib/meta/graph'
import { APP_ORIGIN, contactNameFor, insertMessages, isApiSend } from '@/lib/meta/echoes'

// Storico della chat letto da Meta prima di una risposta AI: se il primo messaggio l'ha
// scritto Luca a mano dall'app (e l'eco non e' arrivata, es. prima di questa funzione),
// l'AI lo vede comunque. Si salvano solo i messaggi mancanti. Mai bloccante.

const SYNC_PREFIX = 'meta_history_sync:'
/** Storico riletto al massimo ogni 30 minuti per conversazione... */
const SYNC_EVERY_MS = 30 * 60_000
/** ...o dopo 2 minuti se non c'e' ancora nessun nostro messaggio salvato. */
const SYNC_EMPTY_EVERY_MS = 2 * 60_000
/** Messaggi della persona piu' recenti di cosi': il loro webhook e' probabilmente in arrivo. */
const IN_FLIGHT_MS = 2 * 60_000
/** Stesso testo e stessa direzione entro questo tempo: e' lo stesso messaggio gia' salvato. */
const SAME_MESSAGE_MS = 10 * 60_000
const GRAPH_TIMEOUT_MS = 5_000

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()

type Stamp = { at: string } | null

const parseStamp = (raw: string | null): Stamp => {
  try {
    const value = raw ? JSON.parse(raw) : null
    return typeof value?.at === 'string' ? { at: value.at } : null
  } catch {
    return null
  }
}

/** Prende il turno della sincronizzazione (una sola funzione alla volta per conversazione). */
async function claimSync(platform: string, contactId: string): Promise<boolean> {
  const { data: ours } = await supabaseAdmin
    .from('social_messages')
    .select('id')
    .eq('platform', platform)
    .eq('contact_id', contactId)
    .eq('direction', 'out')
    .eq('kind', 'message')
    .eq('status', 'sent')
    .limit(1)
  const every = ours?.length ? SYNC_EVERY_MS : SYNC_EMPTY_EVERY_MS
  // Stesso oggetto restituito = salvato da questa chiamata (non da un'altra nello stesso istante).
  const claim: Stamp = { at: new Date().toISOString() }
  const saved = await updateSetting<Stamp>(`${SYNC_PREFIX}${platform}:${contactId}`, parseStamp, (last) =>
    Date.now() - (Date.parse(last?.at || '') || 0) < every ? false : claim
  )
  return saved === claim
}

/**
 * Legge da Meta gli ultimi messaggi della conversazione e salva quelli mancanti
 * (doppioni esclusi per id del messaggio, i nostri segnati come scritti a mano).
 */
export async function syncConversationHistory(platform: 'facebook' | 'instagram', contactId: string): Promise<{ added: number; skipped?: string }> {
  if (!(await claimSync(platform, contactId))) return { added: 0, skipped: 'letto da poco' }

  const history = await fetchConversationHistory(platform, contactId, GRAPH_TIMEOUT_MS)
  if ('error' in history) {
    console.warn(`${platform} storico da Meta non letto:`, history.error)
    return { added: 0, skipped: history.error }
  }
  if (!history.messages.length) return { added: 0 }

  const own = new Set(history.ownIds)
  // Su Instagram serve anche l'id del nostro account Instagram: se non si e' letto, e' nostro cio' che non viene dalla persona.
  const ownComplete = platform !== 'instagram' || own.size > 1
  const ids = history.messages.map((m) => m.id)
  const [{ data: known }, { data: existing }] = await Promise.all([
    supabaseAdmin.from('social_messages').select('external_id').in('external_id', ids),
    supabaseAdmin
      .from('social_messages')
      .select('direction, body, status, created_at, channel_account_id')
      .eq('platform', platform)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(200),
  ])
  const knownIds = new Set((known || []).map((row) => row.external_id))
  const rows = existing || []
  const accountId = rows.find((row) => row.channel_account_id)?.channel_account_id ?? history.ownIds[history.ownIds.length - 1] ?? null

  const missing: Record<string, unknown>[] = []
  let name: string | null | undefined
  for (const message of history.messages) {
    if (knownIds.has(message.id)) continue
    // Mittente sconosciuto (o mancante): non si sa chi l'ha scritto, non si salva.
    const from = message.fromId
    const direction = !from ? null : own.has(from) ? 'out' : from === contactId ? 'in' : ownComplete ? null : 'out'
    if (!direction) continue
    const text = message.text.trim()
    const at = message.createdAt || new Date().toISOString()
    const time = Date.parse(at)
    // Messaggio della persona appena arrivato: lo salva il suo webhook (con la risposta AI).
    if (direction === 'in' && Date.now() - time < IN_FLIGHT_MS) continue
    // Nostro invio via API appena partito: lo salva chi l'ha inviato, con la sua origine.
    if (direction === 'out' && text && (await isApiSend(platform, contactId, text))) continue
    const wanted = normalize(text)
    const duplicate = rows.some(
      (row) =>
        row.direction === direction &&
        (direction === 'in' || row.status === 'sent' || row.status === 'sending') &&
        normalize(String(row.body || '')) === wanted &&
        Math.abs(Date.parse(row.created_at) - time) < SAME_MESSAGE_MS
    )
    if (duplicate) continue
    if (name === undefined) name = await contactNameFor(platform, contactId)
    missing.push({
      platform,
      kind: 'message',
      contact_id: contactId,
      contact_name: name,
      direction,
      external_id: message.id,
      channel_account_id: accountId,
      body: (text || '[allegato]').slice(0, 4000),
      created_at: at,
      ...(direction === 'out'
        ? { status: 'sent', origin: APP_ORIGIN }
        : // Messaggi vecchi della persona: si vedono nella conversazione ma non contano come non letti.
          { read_at: new Date().toISOString() }),
    })
  }
  if (!missing.length) return { added: 0 }

  const { error } = await insertMessages(missing, { ignoreDuplicates: true })
  if (error) {
    console.error(`${platform} storico da Meta non salvato:`, error.message)
    return { added: 0, skipped: error.message }
  }
  console.log(`${platform} storico da Meta: ${missing.length} messaggi aggiunti alla conversazione`)
  return { added: missing.length }
}
