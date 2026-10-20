import { supabaseAdmin } from '@/lib/supabase-admin'
import type { Lead } from '@/lib/leads'

// Rubrica contatti: tutte le attivita' e persone della tabella leads, sia quelle
// trovate con le ricerche (Google Maps) sia quelle inserite a mano dalla pagina
// Contatti o dalla super chat. L'origine si legge da search_query: per le
// ricerche e' la frase cercata, per gli inserimenti a mano una di queste etichette.

export const SOURCE_MANUAL = 'Inserito a mano'
export const SOURCE_CHAT = 'Super chat'

export const CONTACT_FIELDS = ['name', 'phone', 'email', 'website', 'address', 'instagram', 'facebook', 'notes'] as const
export type ContactField = (typeof CONTACT_FIELDS)[number]
export type ContactInput = Partial<Record<ContactField, string | null>>

export function contactSource(lead: Pick<Lead, 'search_query' | 'place_id'>): 'search' | 'manual' | 'chat' {
  if (lead.search_query === SOURCE_CHAT) return 'chat'
  if (lead.search_query === SOURCE_MANUAL || !lead.place_id) return 'manual'
  return 'search'
}

const clean = (value: unknown, max = 300) => {
  if (typeof value !== 'string') return null
  const text = value.trim().slice(0, max)
  return text || null
}

const digits = (phone: string) => phone.replace(/\D/g, '').slice(-9)

/** Valori validi dei campi (testi puliti, email in minuscolo, sito con https). */
export function cleanContact(input: Record<string, unknown>): ContactInput {
  const out: ContactInput = {}
  for (const field of CONTACT_FIELDS) {
    if (!(field in input)) continue
    out[field] = clean(input[field], field === 'notes' ? 2000 : 300)
  }
  if (out.email) out.email = out.email.toLowerCase()
  if (out.website && !/^https?:\/\//i.test(out.website)) out.website = `https://${out.website}`
  return out
}

/** Contatto gia' presente con la stessa email, lo stesso telefono o lo stesso nome. */
async function findExisting(contact: ContactInput): Promise<Lead | null> {
  if (contact.email) {
    const email = contact.email.replace(/[\\%_]/g, (c) => `\\${c}`)
    const { data } = await supabaseAdmin.from('leads').select('*').ilike('email', email).limit(1).maybeSingle()
    if (data) return data as Lead
  }
  if (contact.phone && digits(contact.phone).length >= 8) {
    const tail = digits(contact.phone)
    const { data } = await supabaseAdmin.from('leads').select('*').not('phone', 'is', null).limit(2000)
    const match = (data || []).find((l) => l.phone && digits(l.phone) === tail)
    if (match) return match as Lead
  }
  if (contact.name) {
    // Nome esatto (senza maiuscole): % e _ non devono fare da jolly.
    const exact = contact.name.replace(/[\\%_]/g, (c) => `\\${c}`)
    const { data } = await supabaseAdmin.from('leads').select('*').ilike('name', exact).limit(1).maybeSingle()
    if (data) return data as Lead
  }
  return null
}

/**
 * Aggiunge un contatto. Se esiste gia' (stessa email, telefono o nome) non lo
 * duplica: completa solo i campi che mancavano e aggiunge le note in coda.
 */
export async function addContact(input: Record<string, unknown>, source: string): Promise<{ lead: Lead; created: boolean }> {
  const contact = cleanContact(input)
  if (!contact.name) throw new Error('Serve almeno il nome del contatto.')

  const existing = await findExisting(contact)
  if (existing) {
    const updates: Record<string, string> = {}
    for (const field of CONTACT_FIELDS) {
      const value = contact[field]
      if (!value || field === 'name') continue
      if (field === 'notes') updates.notes = existing.notes ? `${existing.notes}\n${value}` : value
      else if (!existing[field]) updates[field] = value
    }
    if (!Object.keys(updates).length) return { lead: existing, created: false }
    const { data, error } = await supabaseAdmin.from('leads').update(updates).eq('id', existing.id).select('*').single()
    if (error) throw new Error(error.message)
    return { lead: data as Lead, created: false }
  }

  const { data, error } = await supabaseAdmin
    .from('leads')
    .insert({ ...contact, search_query: source, status: 'new' })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return { lead: data as Lead, created: true }
}
