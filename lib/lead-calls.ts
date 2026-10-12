import { supabaseAdmin } from '@/lib/supabase-admin'

// Telefonate fatte alle schede della Ricerca clienti (casella "Chiamato").
// Una riga di app_settings per scheda (lead_call:<id> -> data della chiamata):
// piu' caselle spuntate in fretta non si sovrascrivono a vicenda.

const PREFIX = 'lead_call:'

export type CallMap = Record<string, string>

export async function loadCalls(): Promise<CallMap> {
  const map: CallMap = {}
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('app_settings')
      .select('key, value')
      .like('key', `${PREFIX}%`)
      .range(from, from + 999)
    if (error) throw error
    for (const row of data || []) map[row.key.slice(PREFIX.length)] = row.value
    if (!data || data.length < 1000) break
  }
  return map
}

/** Segna (o toglie) la chiamata; restituisce la data salvata o null. */
export async function setCalled(leadId: string, called: boolean): Promise<string | null> {
  const key = `${PREFIX}${leadId}`
  if (!called) {
    await supabaseAdmin.from('app_settings').delete().eq('key', key)
    return null
  }
  const now = new Date().toISOString()
  // ignoreDuplicates: se era gia' segnata resta la data della prima chiamata.
  await supabaseAdmin.from('app_settings').upsert({ key, value: now, updated_at: now }, { onConflict: 'key', ignoreDuplicates: true })
  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', key).maybeSingle()
  return data?.value ?? now
}

/** Aggiunge called_at alle schede. */
export async function withCalls<T extends { id: string }>(leads: T[]): Promise<(T & { called_at: string | null })[]> {
  const map = await loadCalls().catch(() => ({}) as CallMap)
  return leads.map((l) => ({ ...l, called_at: map[l.id] ?? null }))
}
