import { supabaseAdmin } from '@/lib/supabase-admin'
import { readSetting, updateSetting } from '@/lib/settings-store'
import { GRAPH_VERSION, getSystemToken } from '@/lib/meta/graph'
import {
  CONSENT_NO_ID,
  CONSENT_YES_ID,
  DEFAULT_SETTINGS,
  hasMarketingConsent,
  isConsentYes,
  lastDays,
  normalizePhone,
  normalizeSettings,
  parseCsv,
  parseTemplate,
  romeDay,
  romeMonth,
  summarizeCosts,
  contactLanguage,
  visibleTags,
  withLanguageTag,
  waIdOf,
  type ConsentSource,
  type CostRow,
  type CostSummary,
  type WaContact,
  type WaSettings,
  type WaTemplate,
} from '@/lib/wa-shared'

// Campagne WhatsApp, parte server: impostazioni, chiamate a Meta, modelli,
// contattabili con il loro consenso e costi. Le campagne vere e proprie (invio a
// lotti, stati, risposte) sono in lib/wa-campaigns.ts.
//
// app_settings:
//   wa_settings      -> limite giornaliero, budget mensile, prezzi, testo della richiesta di consenso
//   wa_templates     -> modelli approvati letti da Meta (ultima sincronizzazione)
//   wa_pricing_cache -> costi reali letti da Meta (al massimo una lettura all'ora)

export const SETUP_MESSAGE = 'Esegui prima lo SQL delle campagne WhatsApp (supabase/migrations/2026-11-08_wa_campaigns.sql).'
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`

export class WaError extends Error {
  constructor(message: string, public status = 400, public setup = false) {
    super(message)
  }
}

type DbError = { code?: string; message?: string } | null | undefined

export function isMissingSetup(error: DbError): boolean {
  if (!error) return false
  if (['42P01', 'PGRST205'].includes(error.code || '')) return true
  return /wa_(contacts|campaigns|campaign_recipients)/.test(error.message || '') && /does not exist|schema cache|could not find/i.test(error.message || '')
}

export function check(error: DbError, what: string) {
  if (!error) return
  if (isMissingSetup(error)) throw new WaError(SETUP_MESSAGE, 503, true)
  console.error(`whatsapp: ${what}:`, error.code || '', (error.message || '').slice(0, 200))
  throw new WaError('Qualcosa non è andato: riprova.', 500)
}

/** Le tabelle delle campagne ci sono? (false finche' lo SQL non e' stato eseguito) */
export async function tablesReady(): Promise<boolean> {
  const { error } = await supabaseAdmin.from('wa_campaigns').select('id').limit(1)
  if (!error) return true
  if (isMissingSetup(error)) return false
  console.error('whatsapp: controllo tabelle:', error.message)
  return false
}

export const nowIso = () => new Date().toISOString()

/** Tutte le righe (PostgREST ne da' al massimo 1000 per volta). */
export async function selectAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: DbError }>, what: string, max = 50000): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < max; from += 1000) {
    const { data, error } = await build(from, from + 999)
    check(error, what)
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return out
}

// ---------------------------------------------------------------------
// Impostazioni
// ---------------------------------------------------------------------

const SETTINGS_KEY = 'wa_settings'
const parseJson = (raw: string | null): any => {
  try {
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/** Impostazioni in uso: variabili d'ambiente > valori salvati > valori predefiniti. */
export async function loadSettings(): Promise<WaSettings> {
  const stored = normalizeSettings(parseJson((await readSetting(SETTINGS_KEY).catch(() => ({ value: null }))).value))
  return {
    ...stored,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || stored.phoneNumberId || DEFAULT_SETTINGS.phoneNumberId,
    wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim() || stored.wabaId || DEFAULT_SETTINGS.wabaId,
  }
}

export async function saveSettings(patch: Record<string, unknown>): Promise<WaSettings> {
  const allowed = ['dailyCap', 'monthlyBudget', 'prices', 'consentText', 'phoneNumberId', 'wabaId']
  await updateSetting(SETTINGS_KEY, parseJson, (current) => {
    const base = normalizeSettings(current)
    const next: Record<string, unknown> = { ...base }
    for (const k of allowed) if (patch[k] !== undefined) next[k] = k === 'prices' ? { ...base.prices, ...(patch.prices as object) } : patch[k]
    return normalizeSettings(next)
  })
  return loadSettings()
}

// ---------------------------------------------------------------------
// Meta (Graph API)
// ---------------------------------------------------------------------

export type GraphResult = { ok: true; data: any } | { ok: false; code: number | null; message: string; status: number }

export async function graphCall(method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = 15000): Promise<GraphResult> {
  const token = getSystemToken()
  if (!token) return { ok: false, code: null, message: 'Token WhatsApp non configurato (WHATSAPP_ACCESS_TOKEN)', status: 0 }
  try {
    const res = await fetch(`${GRAPH}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data?.error) {
      const e = data?.error || {}
      const details = e.error_data?.details ? ` (${String(e.error_data.details).slice(0, 200)})` : ''
      return { ok: false, code: typeof e.code === 'number' ? e.code : null, message: `${e.message || `HTTP ${res.status}`}${details}`, status: res.status }
    }
    return { ok: true, data }
  } catch (error) {
    return { ok: false, code: null, message: error instanceof Error ? error.message : String(error), status: 0 }
  }
}

export type WaSendResult = { id: string } | { error: string; code: number | null; transient: boolean }

/** Errori per cui conviene riprovare piu' tardi (limiti di velocita', servizio non disponibile). */
const TRANSIENT_CODES = new Set([1, 2, 4, 80007, 130429, 131016, 131048, 131056, 133004])

function sendResult(res: GraphResult): WaSendResult {
  if (res.ok) {
    const id = res.data?.messages?.[0]?.id
    return id ? { id } : { error: 'Meta non ha restituito l’id del messaggio', code: null, transient: false }
  }
  return { error: res.message, code: res.code, transient: res.status === 0 || res.status >= 500 || (res.code !== null && TRANSIENT_CODES.has(res.code)) }
}

export async function sendTemplateMessage(settings: WaSettings, to: string, template: { name: string; language: string }, components: unknown[]): Promise<WaSendResult> {
  const res = await graphCall('POST', `${settings.phoneNumberId}/messages`, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: waIdOf(to),
    type: 'template',
    template: { name: template.name, language: { code: template.language }, ...(components.length ? { components } : {}) },
  })
  return sendResult(res)
}

export async function sendTextMessage(settings: WaSettings, to: string, text: string): Promise<WaSendResult> {
  return sendResult(
    await graphCall('POST', `${settings.phoneNumberId}/messages`, { messaging_product: 'whatsapp', recipient_type: 'individual', to: waIdOf(to), type: 'text', text: { body: text.slice(0, 4000) } })
  )
}

/** Domanda con due bottoni (Si' / No): solo entro 24 ore dal suo ultimo messaggio. */
export async function sendConsentQuestion(settings: WaSettings, to: string, text: string): Promise<WaSendResult> {
  return sendResult(
    await graphCall('POST', `${settings.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: waIdOf(to),
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: text.slice(0, 1024) },
        action: {
          buttons: [
            { type: 'reply', reply: { id: CONSENT_YES_ID, title: 'Sì, va bene' } },
            { type: 'reply', reply: { id: CONSENT_NO_ID, title: 'No, grazie' } },
          ],
        },
      },
    })
  )
}

/** Salva un messaggio mandato da qui nella casella Messaggi (cosi' si vede ed entra nello storico dell'AI). */
export async function logOutgoing(settings: WaSettings, phone: string, name: string | null, body: string, sent: WaSendResult) {
  const { error } = await supabaseAdmin.from('social_messages').insert({
    platform: 'whatsapp',
    kind: 'message',
    contact_id: waIdOf(phone),
    contact_name: name,
    direction: 'out',
    external_id: 'id' in sent ? sent.id : null,
    channel_account_id: settings.phoneNumberId,
    body,
    status: 'id' in sent ? 'sent' : 'failed',
    error_message: 'error' in sent ? sent.error.slice(0, 500) : null,
  })
  if (error) console.warn('whatsapp: messaggio non salvato in casella:', error.message)
}

// ---------------------------------------------------------------------
// Modelli
// ---------------------------------------------------------------------

const TEMPLATES_KEY = 'wa_templates'
export type TemplatesState = { syncedAt: string | null; items: WaTemplate[]; error?: string | null }

export async function loadTemplates(): Promise<TemplatesState> {
  const raw = parseJson((await readSetting(TEMPLATES_KEY).catch(() => ({ value: null }))).value)
  return { syncedAt: raw?.syncedAt ?? null, items: Array.isArray(raw?.items) ? raw.items : [], error: raw?.error ?? null }
}

/** Legge da Meta tutti i modelli (anche non approvati: si mostrano, ma si usano solo gli APPROVED). */
export async function syncTemplates(): Promise<TemplatesState> {
  const settings = await loadSettings()
  const items: WaTemplate[] = []
  let path: string | null = `${settings.wabaId}/message_templates?fields=id,name,language,category,status,components,parameter_format&limit=100`
  let error: string | null = null
  for (let page = 0; path && page < 10; page++) {
    const res = await graphCall('GET', path)
    if (!res.ok) {
      error = res.message
      break
    }
    for (const raw of res.data?.data || []) {
      const t = parseTemplate(raw)
      if (t) items.push(t)
    }
    const next: string | undefined = res.data?.paging?.next
    path = next ? next.replace(/^https:\/\/graph\.facebook\.com\/v[\d.]+\//, '') : null
  }
  if (error && !items.length) {
    const previous = await loadTemplates()
    const state = { ...previous, error }
    await updateSetting(TEMPLATES_KEY, parseJson, () => state)
    throw new WaError(`Modelli non letti da Meta: ${error}`, 502)
  }
  items.sort((a, b) => a.name.localeCompare(b.name) || a.language.localeCompare(b.language))
  const state: TemplatesState = { syncedAt: nowIso(), items, error }
  await updateSetting(TEMPLATES_KEY, parseJson, () => state)
  return state
}

export async function findTemplate(name: string, language?: string): Promise<WaTemplate | null> {
  const { items } = await loadTemplates()
  const n = name.trim().toLowerCase()
  const same = items.filter((t) => t.name.toLowerCase() === n)
  if (language) return same.find((t) => t.language === language) || null
  // Senza lingua: l'italiano approvato, se c'e' (le altre lingue arrivano per destinatario).
  const approved = same.filter((t) => t.status === 'APPROVED')
  return approved.find((t) => t.language.toLowerCase().split(/[_-]/)[0] === 'it') || approved[0] || same[0] || null
}

// ---------------------------------------------------------------------
// Contattabili
// ---------------------------------------------------------------------

const CONTACT_COLS = 'id, phone, name, company, sector, tags, consent_source, consent_at, consent_note, consent_requested_at, consent_declined_at, status, unsubscribed_at, last_inbound_at, lead_id, consent_log, created_at'

export async function listContacts(): Promise<WaContact[]> {
  return selectAll<WaContact>((a, b) => supabaseAdmin.from('wa_contacts').select(CONTACT_COLS).order('created_at', { ascending: false }).range(a, b) as any, 'contatti')
}

export async function findContactByPhone(phone: string): Promise<WaContact | null> {
  const { data, error } = await supabaseAdmin.from('wa_contacts').select(CONTACT_COLS).eq('phone', phone).maybeSingle()
  check(error, 'contatto')
  return (data as WaContact) || null
}

export async function findContact(idOrPhone: string): Promise<WaContact | null> {
  const phone = normalizePhone(idOrPhone)
  if (phone && !/^[0-9a-f-]{36}$/i.test(idOrPhone)) return findContactByPhone(phone)
  const { data, error } = await supabaseAdmin.from('wa_contacts').select(CONTACT_COLS).eq('id', idOrPhone).maybeSingle()
  check(error, 'contatto')
  return (data as WaContact) || null
}

const cleanTags = (v: unknown): string[] =>
  [...new Set((Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;|]/) : []).map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 20).map((t) => t.slice(0, 40))
const text = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

export type NewContact = {
  phone: unknown
  name?: unknown
  company?: unknown
  sector?: unknown
  tags?: unknown
  note?: unknown
  /** "Ho il consenso di questa persona": obbligatorio per manuale, import e leads. */
  consent?: unknown
  source: Exclude<ConsentSource, 'ha_scritto' | 'risposta_si'>
  leadId?: string | null
  by?: string | null
}

/**
 * Aggiunge (o aggiorna) un contattabile con consenso esplicito. Senza la casella del
 * consenso e una nota non si salva niente. Un disiscritto resta disiscritto: per
 * riattivarlo serve resubscribeContact (nuovo consenso, deciso a mano).
 */
export async function addContact(input: NewContact): Promise<{ contact: WaContact; created: boolean; note?: string }> {
  if (input.consent !== true) throw new WaError('Spunta «Ho il consenso di questa persona»: senza consenso non si può aggiungere.')
  const note = text(input.note, 500)
  if (!note) throw new WaError('Scrivi come hai avuto il consenso (es. «me l’ha chiesto a voce il 3/11»).')
  const phone = normalizePhone(input.phone)
  if (!phone) throw new WaError('Numero non valido: scrivilo con il prefisso (es. +39 333 1234567).')
  const at = nowIso()
  const event = { at, event: `consenso: ${input.source}`, note: `${note}${input.by ? ` (da ${input.by})` : ''}` }
  const existing = await findContactByPhone(phone)
  if (existing) {
    const patch: Record<string, unknown> = {
      name: existing.name || text(input.name),
      company: existing.company || text(input.company),
      sector: text(input.sector, 80) || existing.sector,
      tags: [...new Set([...(existing.tags || []), ...cleanTags(input.tags)])],
      lead_id: existing.lead_id || input.leadId || null,
      updated_at: at,
    }
    if (existing.status === 'attivo' && !hasMarketingConsent(existing)) {
      Object.assign(patch, { consent_source: input.source, consent_at: at, consent_note: note, consent_log: [...(existing.consent_log || []), event] })
    }
    const { data, error } = await supabaseAdmin.from('wa_contacts').update(patch).eq('id', existing.id).select(CONTACT_COLS).single()
    check(error, 'aggiornamento contatto')
    return { contact: data as WaContact, created: false, ...(existing.status === 'disiscritto' ? { note: 'è disiscritto: resta escluso dalle campagne' } : {}) }
  }
  const row = {
    phone,
    name: text(input.name),
    company: text(input.company),
    sector: text(input.sector, 80),
    tags: cleanTags(input.tags),
    consent_source: input.source,
    consent_at: at,
    consent_note: note,
    status: 'attivo',
    lead_id: input.leadId || null,
    consent_log: [event],
  }
  const { data, error } = await supabaseAdmin.from('wa_contacts').insert(row).select(CONTACT_COLS).single()
  if (error?.code === '23505') return addContact(input)
  check(error, 'nuovo contatto')
  return { contact: data as WaContact, created: true }
}

/** Import CSV: colonne telefono e consenso obbligatorie (nome, azienda, settore, tag, nota facoltative). */
export async function importCsv(csv: string, defaults: { note?: unknown; consent?: unknown; tags?: unknown; by?: string | null }) {
  if (defaults.consent !== true) throw new WaError('Conferma che tutte le persone con «sì» nella colonna consenso ti hanno dato il consenso.')
  const { headers, rows } = parseCsv(csv)
  const col = (...names: string[]) => headers.find((h) => names.includes(h))
  const phoneCol = col('telefono', 'phone', 'numero', 'cellulare', 'whatsapp')
  const consentCol = col('consenso', 'consent', 'opt_in', 'optin', 'opt-in')
  if (!phoneCol) throw new WaError('Nel CSV manca la colonna «telefono».')
  if (!consentCol) throw new WaError('Nel CSV manca la colonna «consenso» (sì/no): senza non si importa niente.')
  if (rows.length > 5000) throw new WaError('Massimo 5000 righe per volta.')
  const nameCol = col('nome', 'name')
  const companyCol = col('azienda', 'company', 'ditta')
  const sectorCol = col('settore', 'sector', 'categoria')
  const tagsCol = col('tag', 'tags', 'etichette')
  const noteCol = col('nota', 'note', 'fonte_consenso', 'come')
  const result = { added: 0, updated: 0, skippedNoConsent: 0, invalid: 0, errors: [] as string[] }
  for (const [i, r] of rows.entries()) {
    if (!isConsentYes(r[consentCol])) {
      result.skippedNoConsent++
      continue
    }
    if (!normalizePhone(r[phoneCol])) {
      result.invalid++
      continue
    }
    try {
      const res = await addContact({
        phone: r[phoneCol],
        name: nameCol ? r[nameCol] : null,
        company: companyCol ? r[companyCol] : null,
        sector: sectorCol ? r[sectorCol] : null,
        tags: [...cleanTags(defaults.tags), ...cleanTags(tagsCol ? r[tagsCol] : '')],
        note: (noteCol && r[noteCol]) || text(defaults.note, 300) || 'consenso indicato nel file importato',
        consent: true,
        source: 'import',
        by: defaults.by,
      })
      if (res.created) result.added++
      else result.updated++
    } catch (error) {
      if (result.errors.length < 5) result.errors.push(`riga ${i + 2}: ${error instanceof Error ? error.message : 'errore'}`)
    }
  }
  return result
}

/** Schede del Motore clienti con telefono: si aggiungono solo con la casella del consenso. */
export async function addLeads(leadIds: unknown, opts: { note?: unknown; consent?: unknown; tags?: unknown; by?: string | null }) {
  const ids = (Array.isArray(leadIds) ? leadIds : []).filter((x): x is string => typeof x === 'string').slice(0, 200)
  if (!ids.length) throw new WaError('Scegli almeno un contatto.')
  if (opts.consent !== true) throw new WaError('Spunta «Ho il consenso di queste persone»: senza consenso non si possono aggiungere.')
  const { data, error } = await supabaseAdmin.from('leads').select('id, name, phone, search_query').in('id', ids)
  if (error) throw new WaError('Contatti del Motore clienti non letti.', 500)
  const out = { added: 0, updated: 0, noPhone: [] as string[] }
  for (const lead of data || []) {
    if (!normalizePhone(lead.phone)) {
      out.noPhone.push(lead.name)
      continue
    }
    const sector = typeof lead.search_query === 'string' ? lead.search_query.replace(/\s+(a|in|di)?\s*[A-ZÀ-Ý][\wà-ÿ']+$/u, '').trim() || lead.search_query : null
    const res = await addContact({ phone: lead.phone, name: lead.name, company: lead.name, sector, tags: opts.tags, note: opts.note, consent: true, source: 'manuale', leadId: lead.id, by: opts.by })
    if (res.created) out.added++
    else out.updated++
  }
  return out
}

export async function searchLeads(q: string) {
  let query = supabaseAdmin.from('leads').select('id, name, phone, search_query, status').not('phone', 'is', null).order('created_at', { ascending: false }).limit(50)
  if (q.trim()) query = query.ilike('name', `%${q.trim().replace(/[%_]/g, '')}%`)
  const { data, error } = await query
  if (error) throw new WaError('Contatti del Motore clienti non letti.', 500)
  return (data || []).map((l) => ({ id: l.id, name: l.name, phone: l.phone, sector: l.search_query, valid: Boolean(normalizePhone(l.phone)) }))
}

export async function updateContact(id: string, patch: Record<string, unknown>) {
  const next: Record<string, unknown> = { updated_at: nowIso() }
  if (patch.name !== undefined) next.name = text(patch.name)
  if (patch.company !== undefined) next.company = text(patch.company)
  if (patch.sector !== undefined) next.sector = text(patch.sector, 80)
  if (patch.tags !== undefined || patch.language !== undefined) {
    // La lingua sta tra i tag ("lingua:en", vedi wa-shared): non si perde modificando i tag.
    const contact = await findContact(id)
    if (!contact) throw new WaError('Contatto non trovato.', 404)
    const tags = patch.tags !== undefined ? visibleTags(cleanTags(patch.tags)).slice(0, 19) : visibleTags(contact.tags)
    const cur = contactLanguage(contact)
    if (patch.language === undefined) next.tags = withLanguageTag(tags, cur.lang, cur.manual)
    else if (patch.language === 'auto' || patch.language === null) next.tags = withLanguageTag(tags, null, false)
    else next.tags = withLanguageTag(tags, String(patch.language).toLowerCase(), true)
  }
  const { data, error } = await supabaseAdmin.from('wa_contacts').update(next).eq('id', id).select(CONTACT_COLS).maybeSingle()
  check(error, 'modifica contatto')
  if (!data) throw new WaError('Contatto non trovato.', 404)
  return data as WaContact
}

/** Disiscrive (a mano, o per STOP / errore 131050 di Meta). Da quel momento non riceve piu' campagne. */
export async function unsubscribe(contact: Pick<WaContact, 'id' | 'consent_log' | 'status'>, why: string) {
  if (contact.status === 'disiscritto') return
  const at = nowIso()
  const { error } = await supabaseAdmin
    .from('wa_contacts')
    .update({ status: 'disiscritto', unsubscribed_at: at, updated_at: at, consent_log: [...(contact.consent_log || []), { at, event: 'disiscritto', note: why.slice(0, 300) }] })
    .eq('id', contact.id)
  check(error, 'disiscrizione')
  // Messaggi ancora in coda per lui: non partono piu'.
  await supabaseAdmin.from('wa_campaign_recipients').update({ status: 'skipped', skip_reason: 'disiscritto' }).eq('contact_id', contact.id).eq('status', 'queued')
}

/** Riattiva un disiscritto: solo con un consenso nuovo, spuntato e descritto. */
export async function resubscribe(id: string, opts: { consent?: unknown; note?: unknown; by?: string | null }) {
  if (opts.consent !== true) throw new WaError('Spunta «Ho di nuovo il consenso di questa persona».')
  const note = text(opts.note, 500)
  if (!note) throw new WaError('Scrivi come hai avuto di nuovo il consenso.')
  const contact = await findContact(id)
  if (!contact) throw new WaError('Contatto non trovato.', 404)
  const at = nowIso()
  const { error } = await supabaseAdmin
    .from('wa_contacts')
    .update({ status: 'attivo', unsubscribed_at: null, consent_source: 'manuale', consent_at: at, consent_note: note, updated_at: at, consent_log: [...(contact.consent_log || []), { at, event: 'riattivato con nuovo consenso', note: `${note}${opts.by ? ` (da ${opts.by})` : ''}` }] })
    .eq('id', id)
  check(error, 'riattivazione')
}

/** Ultimo messaggio ricevuto da questo numero su WhatsApp (per la finestra di 24 ore). */
export async function lastInboundAt(phone: string): Promise<{ at: string; name: string | null } | null> {
  const { data } = await supabaseAdmin
    .from('social_messages')
    .select('created_at, contact_name')
    .eq('platform', 'whatsapp')
    .eq('contact_id', waIdOf(phone))
    .eq('direction', 'in')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ? { at: data.created_at, name: data.contact_name ?? null } : null
}

const WINDOW_MS = 24 * 3600_000

/** Controlli prima della richiesta di consenso (anche per la scheda della super chat). */
export async function consentRequestCheck(idOrPhone: string): Promise<{ ok: true; phone: string; name: string | null; lastAt: string; contact: WaContact | null } | { ok: false; error: string }> {
  const contact = await findContact(idOrPhone)
  const phone = contact?.phone || normalizePhone(idOrPhone)
  if (!phone) return { ok: false, error: 'numero non valido' }
  if (contact?.status === 'disiscritto') return { ok: false, error: 'ha chiesto di non ricevere più messaggi: non si può chiedere il consenso' }
  if (contact && hasMarketingConsent(contact)) return { ok: false, error: 'ha già dato il consenso' }
  const last = await lastInboundAt(phone)
  if (!last) return { ok: false, error: 'non ci ha mai scritto su WhatsApp: la richiesta si manda solo a chi ci ha scritto' }
  if (Date.now() - Date.parse(last.at) > WINDOW_MS) return { ok: false, error: 'il suo ultimo messaggio ha più di 24 ore: WhatsApp non permette di scrivergli liberamente. Aspetta che ti scriva di nuovo' }
  return { ok: true, phone, name: contact?.name || last.name, lastAt: last.at, contact }
}

/** Manda la domanda di consenso (con i bottoni Si'/No) a chi ci ha scritto nelle ultime 24 ore. */
export async function requestConsent(idOrPhone: string, opts: { text?: string; by?: string | null } = {}): Promise<{ ok: true; phone: string } | { ok: false; error: string; retryable: boolean }> {
  const checked = await consentRequestCheck(idOrPhone)
  if (!checked.ok) return { ...checked, retryable: false }
  const settings = await loadSettings()
  let contact = checked.contact
  if (!contact) {
    // Ci ha scritto prima che esistessero i contattabili: si crea ora come "ha scritto".
    const { data, error } = await supabaseAdmin
      .from('wa_contacts')
      .insert({ phone: checked.phone, name: checked.name, consent_source: 'ha_scritto', consent_note: 'Ha scritto per primo su WhatsApp', status: 'attivo', last_inbound_at: checked.lastAt, consent_log: [{ at: nowIso(), event: 'ha_scritto' }] })
      .select(CONTACT_COLS)
      .single()
    check(error && error.code !== '23505' ? error : null, 'nuovo contatto')
    contact = (data as WaContact) || (await findContactByPhone(checked.phone))
  }
  const body = (opts.text?.trim() || settings.consentText).replace(/\{nome\}/g, (checked.name || '').split(/\s+/)[0] || '').replace(/\s+,/g, ',').replace(/^Ciao ,/, 'Ciao,')
  const sent = await sendConsentQuestion(settings, checked.phone, body)
  await logOutgoing(settings, checked.phone, checked.name, `${body}\n[Bottoni: Sì, va bene · No, grazie]`, sent)
  if ('error' in sent) return { ok: false, error: `invio non riuscito: ${sent.error}`, retryable: sent.transient }
  if (contact) {
    const at = nowIso()
    await supabaseAdmin
      .from('wa_contacts')
      .update({ consent_requested_at: at, updated_at: at, consent_log: [...(contact.consent_log || []), { at, event: 'richiesta di consenso inviata', ...(opts.by ? { note: `da ${opts.by}` } : {}) }] })
      .eq('id', contact.id)
  }
  return { ok: true, phone: checked.phone }
}

// ---------------------------------------------------------------------
// Costi
// ---------------------------------------------------------------------

const PRICING_KEY = 'wa_pricing_cache'
export type RealPricing = { status: 'ok'; fetchedAt: string; currency: string; days: Record<string, number> } | { status: 'error'; fetchedAt: string; message: string }

/** Costi reali da Meta (pricing_analytics, giornalieri, ultimi 60 giorni). Al massimo una lettura all'ora. */
export async function realPricing(force = false): Promise<RealPricing | null> {
  const cached = parseJson((await readSetting(PRICING_KEY).catch(() => ({ value: null }))).value) as RealPricing | null
  if (cached && !force && Date.now() - Date.parse(cached.fetchedAt) < 3600_000) return cached
  const settings = await loadSettings()
  const end = Math.floor(Date.now() / 1000)
  const start = end - 60 * 86400
  const fields = `currency,pricing_analytics.start(${start}).end(${end}).granularity(DAILY).dimensions(["PRICING_CATEGORY"])`
  const res = await graphCall('GET', `${settings.wabaId}?fields=${encodeURIComponent(fields)}`, undefined, 8000)
  let value: RealPricing
  if (!res.ok) value = { status: 'error', fetchedAt: nowIso(), message: res.message }
  else value = parsePricingAnalytics(res.data)
  await updateSetting(PRICING_KEY, parseJson, () => value).catch(() => undefined)
  return value
}

export function parsePricingAnalytics(data: any): RealPricing {
  const days: Record<string, number> = {}
  const groups: any[] = data?.pricing_analytics?.data || []
  for (const g of groups) {
    for (const p of g?.data_points || []) {
      const cost = Number(p?.cost)
      if (!Number.isFinite(cost) || typeof p?.start !== 'number') continue
      const day = romeDay(p.start * 1000)
      days[day] = Math.round(((days[day] || 0) + cost) * 10000) / 10000
    }
  }
  return { status: 'ok', fetchedAt: nowIso(), currency: typeof data?.currency === 'string' ? data.currency : 'EUR', days }
}

export type CostRowFull = CostRow & { name?: string }

/** Righe inviate negli ultimi 13 mesi (per costi per campagna, giorno e mese). */
export async function costRows(sinceDays = 400): Promise<CostRow[]> {
  const since = new Date(Date.now() - sinceDays * 86400_000).toISOString()
  return selectAll<CostRow>(
    (a, b) =>
      supabaseAdmin
        .from('wa_campaign_recipients')
        .select('campaign_id, status, sent_at, delivered_at, read_at, pricing_category, billable')
        .gte('sent_at', since)
        .order('sent_at', { ascending: true })
        .range(a, b) as any,
    'costi'
  )
}

export type CostOverview = {
  month: string
  estimatedMonth: number
  realMonth: number | null
  currency: string
  realError: string | null
  realFetchedAt: string | null
  days: { date: string; estimated: number; real: number | null }[]
  campaigns: (CostSummary & { id: string; name: string; category: string; replies: number })[]
  budget: number
  budgetUsedPct: number | null
  prices: WaSettings['prices']
}

export async function costOverview(opts: { forceReal?: boolean; withReal?: boolean } = {}): Promise<CostOverview> {
  const settings = await loadSettings()
  const [rows, campaignsRes, replies] = await Promise.all([
    costRows(),
    supabaseAdmin.from('wa_campaigns').select('id, name, template_category, created_at').order('created_at', { ascending: false }).limit(500),
    supabaseAdmin.from('wa_campaign_recipients').select('campaign_id').not('replied_at', 'is', null).limit(50000),
  ])
  check(campaignsRes.error, 'campagne')
  const campaigns = (campaignsRes.data || []) as { id: string; name: string; template_category: string }[]
  const cat = new Map(campaigns.map((c) => [c.id, c.template_category]))
  const sum = summarizeCosts(rows, (id) => cat.get(id) || 'MARKETING', settings.prices)
  const replyCount = new Map<string, number>()
  for (const r of (replies.data || []) as { campaign_id: string }[]) replyCount.set(r.campaign_id, (replyCount.get(r.campaign_id) || 0) + 1)
  const month = romeMonth(Date.now())
  const real = opts.withReal === false ? null : await realPricing(opts.forceReal).catch(() => null)
  const realDays = real?.status === 'ok' ? real.days : null
  const realMonth = realDays ? Math.round(Object.entries(realDays).filter(([d]) => d.startsWith(month)).reduce((s, [, v]) => s + v, 0) * 10000) / 10000 : null
  const estimatedMonth = sum.byMonth.get(month) || 0
  const used = Math.max(estimatedMonth, realMonth || 0)
  return {
    month,
    estimatedMonth,
    realMonth,
    currency: real?.status === 'ok' ? real.currency : 'EUR',
    realError: real?.status === 'error' ? real.message : null,
    realFetchedAt: real?.fetchedAt ?? null,
    days: lastDays(30).map((date) => ({ date, estimated: sum.byDay.get(date) || 0, real: realDays ? realDays[date] ?? 0 : null })),
    campaigns: campaigns
      .filter((c) => sum.byCampaign.has(c.id) || replyCount.has(c.id))
      .map((c) => ({
        id: c.id,
        name: c.name,
        category: c.template_category,
        replies: replyCount.get(c.id) || 0,
        ...(sum.byCampaign.get(c.id) || { sent: 0, delivered: 0, read: 0, failed: 0, estimated: 0, maxIfAllDelivered: 0 }),
      })),
    budget: settings.monthlyBudget,
    budgetUsedPct: settings.monthlyBudget > 0 ? Math.round((used / settings.monthlyBudget) * 1000) / 10 : null,
    prices: settings.prices,
  }
}
