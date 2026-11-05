import { supabaseAdmin } from '@/lib/supabase-admin'
import { updateSetting } from '@/lib/settings-store'

// Chi ha scritto telefono, email e Instagram di una scheda Clienti. Serve al collegamento
// automatico delle conversazioni (lib/meta/auto-link): vale un dato scritto da una persona del
// team nella scheda, mai uno aggiunto in automatico (lettura del sito, super chat), che resta
// solo un suggerimento. Nessuna tabella nuova: app_settings
//   lead_field_origin:<leadId> -> { phone?: { value, by, at }, email?: ..., instagram?: ... }
// Il dato vale solo finche' la scheda ha ancora quel valore.

const PREFIX = 'lead_field_origin:'
export const ORIGIN_FIELDS = ['phone', 'email', 'instagram'] as const
export type OriginField = (typeof ORIGIN_FIELDS)[number]
export type OriginEntry = { value: string; by: 'staff' | 'auto'; at: string }
export type LeadOrigin = Partial<Record<OriginField, OriginEntry>>

function parseOrigin(raw: string | null): LeadOrigin {
  if (!raw) return {}
  try {
    const value = JSON.parse(raw)
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as LeadOrigin) : {}
  } catch {
    return {}
  }
}

/** Annota chi ha scritto questi campi della scheda (vuoto: l'annotazione si toglie). Solo telefono, email, Instagram. */
export async function noteLeadFields(leadId: string, fields: Record<string, unknown>, by: OriginEntry['by']): Promise<void> {
  const changed = ORIGIN_FIELDS.filter((f) => f in fields && fields[f] !== undefined)
  if (!leadId || !changed.length) return
  const at = new Date().toISOString()
  await updateSetting(`${PREFIX}${leadId}`, parseOrigin, (current) => {
    const next: LeadOrigin = { ...current }
    for (const field of changed) {
      const value = typeof fields[field] === 'string' ? (fields[field] as string).trim() : ''
      if (value) next[field] = { value, by, at }
      else delete next[field]
    }
    return next
  })
}

/** Annotazioni della scheda (errore = eccezione: chi la usa per collegare non deve andare avanti). */
export async function loadLeadOrigin(leadId: string): Promise<LeadOrigin> {
  const { data, error } = await supabaseAdmin.from('app_settings').select('value').eq('key', `${PREFIX}${leadId}`).maybeSingle()
  if (error) throw new Error(error.message)
  return parseOrigin(data?.value ?? null)
}
