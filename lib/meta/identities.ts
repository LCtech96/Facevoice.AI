import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'

export type Member = { platform: string; contactId: string }

// Ogni funzione e' tollerante: se la tabella non esiste ancora, si comporta
// come se nessun contatto fosse collegato, cosi' la casella continua a funzionare.

export function memberKey(m: Member) {
  return `${m.platform}:${m.contactId}`
}

/** Mappa "platform:contactId" -> person_id per tutti i contatti collegati. */
export async function loadIdentityMap(): Promise<Map<string, string>> {
  const { data, error } = await supabaseAdmin.from('social_identities').select('platform, contact_id, person_id')
  const map = new Map<string, string>()
  if (error) return map
  for (const row of data || []) map.set(`${row.platform}:${row.contact_id}`, row.person_id)
  return map
}

async function membersOfPerson(personId: string): Promise<Member[]> {
  const { data } = await supabaseAdmin
    .from('social_identities')
    .select('platform, contact_id')
    .eq('person_id', personId)
  return (data || []).map((r) => ({ platform: r.platform, contactId: r.contact_id }))
}

/**
 * Una chiave di conversazione e' "person:<uuid>" (contatti collegati) oppure
 * "<platform>:<contactId>" (contatto singolo). Ritorna tutti gli account inclusi.
 */
export async function resolveKey(key: string): Promise<Member[]> {
  if (key.startsWith('person:')) return membersOfPerson(key.slice('person:'.length))
  const sep = key.indexOf(':')
  if (sep <= 0) return []
  return [{ platform: key.slice(0, sep), contactId: key.slice(sep + 1) }]
}

/** Tutti gli account della stessa persona del contatto dato (incluso se stesso). */
export async function linkedMembers(platform: string, contactId: string): Promise<Member[]> {
  const { data, error } = await supabaseAdmin
    .from('social_identities')
    .select('person_id')
    .eq('platform', platform)
    .eq('contact_id', contactId)
    .maybeSingle()
  if (error || !data) return [{ platform, contactId }]
  const members = await membersOfPerson(data.person_id)
  return members.length ? members : [{ platform, contactId }]
}

/** Chiave di conversazione per un contatto (per link nelle notifiche). */
export async function conversationKeyFor(platform: string, contactId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('social_identities')
    .select('person_id')
    .eq('platform', platform)
    .eq('contact_id', contactId)
    .maybeSingle()
  return !error && data ? `person:${data.person_id}` : `${platform}:${contactId}`
}

/** Unisce tutti gli account di due conversazioni in un'unica persona. */
export async function linkConversations(keyA: string, keyB: string): Promise<{ key?: string; error?: string }> {
  const [a, b] = await Promise.all([resolveKey(keyA), resolveKey(keyB)])
  if (!a.length || !b.length) return { error: 'Conversazione non trovata' }

  const personId = keyA.startsWith('person:')
    ? keyA.slice(7)
    : keyB.startsWith('person:')
      ? keyB.slice(7)
      : randomUUID()

  const rows = [...a, ...b].map((m) => ({ platform: m.platform, contact_id: m.contactId, person_id: personId }))
  const { error } = await supabaseAdmin.from('social_identities').upsert(rows, { onConflict: 'platform,contact_id' })
  if (error) return { error: error.message }
  return { key: `person:${personId}` }
}

/** Separa un account dalla persona a cui era collegato. */
export async function unlinkMember(m: Member) {
  const { data } = await supabaseAdmin
    .from('social_identities')
    .select('person_id')
    .eq('platform', m.platform)
    .eq('contact_id', m.contactId)
    .maybeSingle()
  await supabaseAdmin.from('social_identities').delete().eq('platform', m.platform).eq('contact_id', m.contactId)

  // Una "persona" con un solo account rimasto non ha piu' senso: la sciogliamo.
  if (data?.person_id) {
    const rest = await membersOfPerson(data.person_id)
    if (rest.length === 1) {
      await supabaseAdmin.from('social_identities').delete().eq('person_id', data.person_id)
    }
  }
}
