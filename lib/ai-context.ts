import { supabaseAdmin } from '@/lib/supabase-admin'

// Istruzioni dell'AI modificabili dalla pagina Memoria (Canali e AI). Ogni blocco
// ha un testo predefinito scritto nel codice; Luca puo' sostituirlo, svuotarlo
// (= disattivato) o rimetterlo com'era. Le modifiche stanno in app_settings
// (ai_context:<id>) e valgono per tutte le risposte da quel momento.
// I segnaposto {{NOME}} vengono riempiti dal codice al momento dell'uso.

export type ContextSection = {
  id: string
  title: string
  /** Dove viene usato, detto in parole semplici. */
  usedFor: string
  group: 'social' | 'email' | 'contatti' | 'sito'
  defaultText: string
  /** Pezzi che non si possono togliere: servono al codice per funzionare. */
  mustContain?: string[]
}

const PREFIX = 'ai_context:'
const TTL_MS = 30_000
const registry = new Map<string, ContextSection>()
let cache: { at: number; values: Map<string, string> } | null = null

/** Registra un blocco (chiamato dai file che lo usano, al caricamento). */
export function defineSection(section: ContextSection): ContextSection {
  registry.set(section.id, section)
  return section
}

export const listSections = () => [...registry.values()]
export const getSection = (id: string) => registry.get(id)

async function overrides(): Promise<Map<string, string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.values
  const values = new Map<string, string>()
  const { data, error } = await supabaseAdmin.from('app_settings').select('key, value').like('key', `${PREFIX}%`)
  if (!error) for (const row of data || []) values.set(row.key.slice(PREFIX.length), row.value)
  cache = { at: Date.now(), values }
  return values
}

const fill = (text: string, vars?: Record<string, string>) =>
  vars ? text.replace(/\{\{([A-Z_]+)\}\}/g, (match, name) => (name in vars ? vars[name] : match)) : text

/** Testo in uso per il blocco: quello modificato da Luca o il predefinito. Vuoto = disattivato. */
export async function sectionText(section: ContextSection, vars?: Record<string, string>): Promise<string> {
  const custom = await overrides().catch(() => new Map<string, string>())
  return fill(custom.has(section.id) ? custom.get(section.id)! : section.defaultText, vars)
}

export async function sectionState(id: string): Promise<{ text: string; custom: boolean }> {
  const section = registry.get(id)
  const custom = await overrides()
  return { text: custom.get(id) ?? section?.defaultText ?? '', custom: custom.has(id) }
}

/** Salva la versione di Luca (null = torna al predefinito). Errore se toglie un pezzo obbligatorio. */
export async function saveSection(id: string, text: string | null) {
  const section = registry.get(id)
  if (!section) throw new Error('Blocco sconosciuto')
  if (text === null) {
    await supabaseAdmin.from('app_settings').delete().eq('key', `${PREFIX}${id}`)
  } else {
    const missing = text.trim() ? (section.mustContain || []).filter((piece) => !text.includes(piece)) : []
    if (missing.length) throw new Error(`Non puoi togliere: ${missing.join(', ')} (serve al sito per funzionare)`)
    if (!text.trim() && section.mustContain?.length) throw new Error('Questo blocco non si può disattivare: serve al sito per funzionare')
    await supabaseAdmin
      .from('app_settings')
      .upsert({ key: `${PREFIX}${id}`, value: text.slice(0, 30_000), updated_at: new Date().toISOString() })
  }
  cache = null
}
