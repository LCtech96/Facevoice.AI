import { supabaseAdmin } from '@/lib/supabase-admin'
import type { Member } from '@/lib/meta/identities'

// Conversazioni eliminate dalla casella (swipe in Messaggi). Come su WhatsApp:
// spariscono dall'elenco, e se il contatto riscrive ricompaiono con i soli
// messaggi nuovi. I messaggi restano nel database (statistiche, assistente).

const KEY = 'inbox_hidden'

/** "platform:contactId" -> data dell'eliminazione */
export type HiddenMap = Record<string, string>

export const memberKey = (platform: string, contactId: string) => `${platform}:${contactId}`

export async function loadHidden(): Promise<HiddenMap> {
  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', KEY).maybeSingle()
  try {
    return data?.value ? (JSON.parse(data.value) as HiddenMap) : {}
  } catch {
    return {}
  }
}

async function saveHidden(map: HiddenMap) {
  await supabaseAdmin.from('app_settings').upsert({ key: KEY, value: JSON.stringify(map), updated_at: new Date().toISOString() })
}

/** Il messaggio e' precedente all'eliminazione della sua conversazione? */
export function isHidden(map: HiddenMap, platform: string, contactId: string, createdAt: string) {
  const at = map[memberKey(platform, contactId)]
  return Boolean(at && createdAt <= at)
}

/** Elimina dalla casella; restituisce i valori precedenti per l'annullamento. */
export async function hideMembers(members: Member[]) {
  const map = await loadHidden()
  const previous: Record<string, string | null> = {}
  const now = new Date().toISOString()
  for (const m of members) {
    const k = memberKey(m.platform, m.contactId)
    previous[k] = map[k] ?? null
    map[k] = now
  }
  await saveHidden(map)
  return previous
}

/** Annulla: rimette i valori di prima dell'eliminazione. */
export async function restoreHidden(previous: Record<string, string | null>) {
  const map = await loadHidden()
  for (const [k, v] of Object.entries(previous)) {
    if (typeof k !== 'string' || !k.includes(':')) continue
    if (v === null) delete map[k]
    else if (typeof v === 'string') map[k] = v
  }
  await saveHidden(map)
}
