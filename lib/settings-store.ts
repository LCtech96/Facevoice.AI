import { supabaseAdmin } from '@/lib/supabase-admin'

// Valori JSON in app_settings modificati in modo sicuro anche da piu' funzioni
// insieme: si salva solo se nessun altro ha salvato dopo la lettura (confronto
// su updated_at), altrimenti si rilegge e si rifa' la modifica.

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Valore grezzo e "timbro" (updated_at) della versione letta. */
export async function readSetting(key: string): Promise<{ value: string | null; stamp: string | null }> {
  const { data, error } = await supabaseAdmin.from('app_settings').select('value, updated_at').eq('key', key).maybeSingle()
  if (error) throw new Error(error.message)
  return { value: data?.value ?? null, stamp: data?.updated_at ?? null }
}

/**
 * Legge, modifica e salva. fn riceve il valore letto (gia' interpretato da parse)
 * e restituisce il nuovo valore da salvare, oppure false per non salvare niente.
 */
export async function updateSetting<T>(key: string, parse: (raw: string | null) => T, fn: (current: T) => T | false): Promise<T> {
  let lastError = 'valore occupato'
  for (let attempt = 0; attempt < 10; attempt++) {
    const { value: raw, stamp } = await readSetting(key)
    const current = parse(raw)
    const next = fn(current)
    if (next === false) return current
    const value = JSON.stringify(next)
    // Il nuovo timbro deve essere sempre successivo a quello letto.
    const updatedAt = new Date(Math.max(Date.now(), stamp ? new Date(stamp).getTime() + 1 : 0)).toISOString()
    if (stamp === null) {
      const { error } = await supabaseAdmin.from('app_settings').insert({ key, value, updated_at: updatedAt })
      if (!error) return next
      lastError = error.message
    } else {
      const { data, error } = await supabaseAdmin
        .from('app_settings')
        .update({ value, updated_at: updatedAt })
        .eq('key', key)
        .eq('updated_at', stamp)
        .select('key')
      if (error) throw new Error(error.message)
      if (data?.length) return next
    }
    await sleep(40 + Math.random() * 160)
  }
  throw new Error(`Salvataggio non riuscito (${key}): ${lastError}`)
}
