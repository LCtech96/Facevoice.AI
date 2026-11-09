// Campagne WhatsApp: tipi e funzioni pure, usati sia dal server sia dalla pagina
// /admin/whatsapp. Niente accessi al database qui.
//
// Regole (policy WhatsApp e art. 130 Codice privacy): ai messaggi promozionali
// (categoria MARKETING) servono un consenso esplicito e lo stato "attivo"; chi ci
// ha solo scritto (ha_scritto) riceve risposte di servizio, non campagne. Chi
// scrive STOP non riceve piu' niente.

import { replyLanguage } from '@/lib/reply-language'
import { mediaHeaderParameter, mediaKindOfHeader, mediaLinkProblem } from '@/lib/wa-media-shared'

export const WA_DEFAULT_PHONE_NUMBER_ID = '1416651248198066'
export const WA_DEFAULT_WABA_ID = '1140709422252960'
export const WA_DISPLAY_NUMBER = '+39 351 420 6353'
export const WA_MANAGER_URL = `https://business.facebook.com/wa/manage/message-templates/?waba_id=${WA_DEFAULT_WABA_ID}`

export const CONSENT_SOURCES = ['ha_scritto', 'modulo_sito', 'manuale', 'import', 'risposta_si'] as const
export type ConsentSource = (typeof CONSENT_SOURCES)[number]
export const CONSENT_LABEL: Record<ConsentSource, string> = {
  ha_scritto: 'Ci ha scritto (solo servizio)',
  modulo_sito: 'Modulo del sito',
  manuale: 'Aggiunto a mano con consenso',
  import: 'Importato da CSV con consenso',
  risposta_si: 'Ha risposto Sì alla richiesta',
}

export type WaContact = {
  id: string
  phone: string
  name: string | null
  company: string | null
  sector: string | null
  tags: string[]
  consent_source: ConsentSource
  consent_at: string
  consent_note: string | null
  consent_requested_at: string | null
  consent_declined_at: string | null
  status: 'attivo' | 'disiscritto'
  unsubscribed_at: string | null
  last_inbound_at: string | null
  lead_id: string | null
  consent_log: { at: string; event: string; note?: string }[]
  created_at: string
}

export type TemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
export type TemplateVariable = { key: string; where: 'header' | 'body'; name: string }
export type WaTemplate = {
  id: string
  name: string
  language: string
  category: TemplateCategory | string
  status: string
  headerFormat: string | null
  headerText: string | null
  body: string
  footer: string | null
  buttons: { type: string; text: string }[]
  variables: TemplateVariable[]
  /** NAMED: variabili con nome ({{nome}}); POSITIONAL: {{1}}, {{2}}. */
  parameterFormat: 'NAMED' | 'POSITIONAL'
  /** Motivo per cui da qui non si puo' usare (es. bottone con link variabile). */
  unsupported: string | null
  components: unknown[]
  /**
   * Solo nella copia salvata con la campagna: le altre lingue approvate dello stesso modello,
   * scelte per ogni destinatario secondo la sua lingua (vedi pickTemplateVersion).
   */
  versions?: WaTemplate[]
}

/** Valore di una variabile: nome del contatto (con testo di riserva) o testo fisso. */
export type VariableMapping = { type: 'nome' | 'fisso'; value: string }

export type CampaignStatus = 'scheduled' | 'sending' | 'paused' | 'completed' | 'cancelled'
export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  scheduled: 'Programmata',
  sending: 'In invio',
  paused: 'In pausa',
  completed: 'Completata',
  cancelled: 'Annullata',
}
export type RecipientStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped'
export const RECIPIENT_STATUS_LABEL: Record<RecipientStatus, string> = {
  queued: 'In coda',
  sending: 'In invio',
  sent: 'Inviato',
  delivered: 'Consegnato',
  read: 'Letto',
  failed: 'Non riuscito',
  skipped: 'Saltato',
}

export type Audience = { tags?: string[]; sector?: string; contactIds?: string[] }

export type WaCampaign = {
  id: string
  name: string
  template_name: string
  template_language: string
  template_category: string
  template_snapshot: WaTemplate
  variables: Record<string, VariableMapping>
  audience: Audience
  status: CampaignStatus
  paused_reason: string | null
  scheduled_at: string
  started_at: string | null
  completed_at: string | null
  created_by: string | null
  total: number
  created_at: string
}

export type Prices = { marketing: number; utility: number; authentication: number; service: number }
/** Stima per l'Italia, in euro per messaggio consegnato: da verificare sulla tabella prezzi di Meta. */
export const DEFAULT_PRICES: Prices = { marketing: 0.0691, utility: 0.03, authentication: 0.03, service: 0 }
export const PRICES_NOTE = 'stima — verifica sulla tabella prezzi Meta'

export type WaSettings = {
  phoneNumberId: string
  wabaId: string
  dailyCap: number
  /** Euro al mese; 0 = nessun limite. */
  monthlyBudget: number
  prices: Prices
  /** Testo della richiesta di consenso ({nome} = nome del contatto). */
  consentText: string
}
export const DEFAULT_CONSENT_TEXT =
  'Ciao {nome}, posso mandarti ogni tanto su WhatsApp novità e offerte di Facevoice AI? Puoi smettere quando vuoi scrivendo STOP.'
export const DEFAULT_SETTINGS: WaSettings = {
  phoneNumberId: WA_DEFAULT_PHONE_NUMBER_ID,
  wabaId: WA_DEFAULT_WABA_ID,
  dailyCap: 250,
  monthlyBudget: 0,
  prices: DEFAULT_PRICES,
  consentText: DEFAULT_CONSENT_TEXT,
}

const num = (v: unknown, fallback: number, min = 0, max = 1e6) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(',', '.')) : NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

/** Impostazioni salvate, completate con i valori predefiniti (mai errori). */
export function normalizeSettings(raw: unknown): Omit<WaSettings, 'phoneNumberId' | 'wabaId'> & { phoneNumberId: string | null; wabaId: string | null } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const p = (r.prices && typeof r.prices === 'object' ? r.prices : {}) as Record<string, unknown>
  const id = (v: unknown) => (typeof v === 'string' && /^\d{5,30}$/.test(v.trim()) ? v.trim() : null)
  return {
    phoneNumberId: id(r.phoneNumberId),
    wabaId: id(r.wabaId),
    dailyCap: Math.round(num(r.dailyCap, DEFAULT_SETTINGS.dailyCap, 1, 100000)),
    monthlyBudget: num(r.monthlyBudget, 0, 0, 100000),
    prices: {
      marketing: num(p.marketing, DEFAULT_PRICES.marketing, 0, 10),
      utility: num(p.utility, DEFAULT_PRICES.utility, 0, 10),
      authentication: num(p.authentication, DEFAULT_PRICES.authentication, 0, 10),
      service: num(p.service, DEFAULT_PRICES.service, 0, 10),
    },
    consentText: typeof r.consentText === 'string' && r.consentText.trim() ? r.consentText.trim().slice(0, 900) : DEFAULT_CONSENT_TEXT,
  }
}

// ---------------------------------------------------------------------
// Numeri di telefono
// ---------------------------------------------------------------------

/** Numero in formato internazionale (+39...), o null se non e' un numero valido. Senza prefisso: Italia. */
export function normalizePhone(input: unknown): string | null {
  if (typeof input !== 'string' && typeof input !== 'number') return null
  let s = String(input).trim().replace(/[\s.\-()/]/g, '')
  if (!s) return null
  if (s.startsWith('00')) s = `+${s.slice(2)}`
  if (!s.startsWith('+')) {
    const digits = s.replace(/\D/g, '')
    if (digits !== s) return null
    if (/^3\d{8,9}$/.test(digits) || /^0\d{5,10}$/.test(digits)) s = `+39${digits}`
    else if (/^39\d{9,11}$/.test(digits)) s = `+${digits}`
    else s = `+${digits}`
  }
  if (!/^\+[1-9]\d{7,14}$/.test(s)) return null
  return s
}

/** Numero come lo vuole WhatsApp (solo cifre). */
export const waIdOf = (phone: string) => phone.replace(/\D/g, '')

// ---------------------------------------------------------------------
// Consenso e disiscrizione
// ---------------------------------------------------------------------

export function hasMarketingConsent(c: Pick<WaContact, 'status' | 'consent_source'>): boolean {
  return c.status === 'attivo' && c.consent_source !== 'ha_scritto'
}

/** Puo' ricevere un modello di questa categoria? Motivo se no. */
export function eligibilityFor(c: Pick<WaContact, 'status' | 'consent_source' | 'phone'>, category: string): { ok: true } | { ok: false; reason: string } {
  if (c.status !== 'attivo') return { ok: false, reason: 'disiscritto' }
  if (!normalizePhone(c.phone)) return { ok: false, reason: 'numero_non_valido' }
  const cat = String(category).toUpperCase()
  if (cat === 'AUTHENTICATION') return { ok: false, reason: 'categoria_non_ammessa' }
  if (cat === 'MARKETING' && !hasMarketingConsent(c)) return { ok: false, reason: 'senza_consenso' }
  return { ok: true }
}

export const SKIP_LABEL: Record<string, string> = {
  disiscritto: 'disiscritto',
  numero_non_valido: 'numero non valido',
  senza_consenso: 'senza consenso ai messaggi promozionali',
  categoria_non_ammessa: 'categoria non ammessa nelle campagne',
  contatto_tolto: 'contatto tolto dalla lista',
  annullata: 'campagna annullata',
}

const normalizeWords = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const STOP_EXACT = new Set(['stop', 'basta', 'cancellami', 'disiscrivimi', 'unsubscribe', 'stop grazie', 'basta grazie', 'non scrivermi piu', 'non scrivetemi piu', 'non mi scrivere piu'])
const STOP_PHRASES = ['non scrivermi piu', 'non scrivetemi piu', 'non mi scrivere piu', 'cancellami', 'disiscrivimi', 'toglimi dalla lista', 'non voglio piu ricevere']
const STOP_BUTTONS = new Set(['stop', 'non mi interessa', 'interrompi', 'disiscriviti', 'annulla iscrizione', 'stop promotions', 'stop promozioni'])

/**
 * Richiesta di non ricevere piu' messaggi: STOP, basta, cancellami, non scrivermi piu'
 * (messaggio intero, o frase chiara in un messaggio breve), oppure il bottone
 * "Non mi interessa" / "Stop" di un modello.
 */
export function isOptOut(text: string | null | undefined, fromButton = false): boolean {
  if (!text) return false
  const t = normalizeWords(text)
  if (!t) return false
  if (fromButton && (STOP_BUTTONS.has(t) || /\bstop\b/.test(t))) return true
  if (STOP_EXACT.has(t)) return true
  return t.length <= 80 && STOP_PHRASES.some((p) => t.includes(p))
}

export const CONSENT_YES_ID = 'wa_consent_yes'
export const CONSENT_NO_ID = 'wa_consent_no'
const YES = new Set(['si', 'sì', 'si grazie', 'si va bene', 'va bene', 'ok', 'okay', 'certo', 'si certo', 'accetto', 'yes', 'si volentieri', 'volentieri', 'ok grazie', 'perfetto'])
const NO = new Set(['no', 'no grazie', 'non grazie', 'nope'])

/** Risposta alla richiesta di consenso: 'yes', 'no' o null se non e' una risposta chiara. */
export function consentAnswer(text: string | null | undefined, buttonId?: string | null): 'yes' | 'no' | null {
  if (buttonId === CONSENT_YES_ID) return 'yes'
  if (buttonId === CONSENT_NO_ID) return 'no'
  if (!text) return null
  const t = normalizeWords(text)
  if (YES.has(t)) return 'yes'
  if (NO.has(t)) return 'no'
  return null
}

// ---------------------------------------------------------------------
// Modelli (template)
// ---------------------------------------------------------------------

const PLACEHOLDER_RE = /\{\{\s*([\w]+)\s*\}\}/g

function placeholders(text: string | null | undefined): string[] {
  if (!text) return []
  const seen: string[] = []
  for (const m of text.matchAll(PLACEHOLDER_RE)) if (!seen.includes(m[1])) seen.push(m[1])
  return seen
}

/** Un modello come arriva da GET /{waba_id}/message_templates, in forma semplice. */
export function parseTemplate(raw: any): WaTemplate | null {
  if (!raw || typeof raw.name !== 'string') return null
  const components: any[] = Array.isArray(raw.components) ? raw.components : []
  const find = (type: string) => components.find((c) => String(c?.type).toUpperCase() === type)
  const header = find('HEADER')
  const body = find('BODY')
  const footer = find('FOOTER')
  const buttonsComp = find('BUTTONS')
  const headerFormat = header ? String(header.format || 'TEXT').toUpperCase() : null
  const headerText = header && headerFormat === 'TEXT' ? String(header.text || '') : null
  const buttons: { type: string; text: string; url?: string }[] = Array.isArray(buttonsComp?.buttons)
    ? buttonsComp.buttons.map((b: any) => ({ type: String(b?.type || ''), text: String(b?.text || ''), ...(b?.url ? { url: String(b.url) } : {}) }))
    : []
  const variables: TemplateVariable[] = [
    ...placeholders(headerText).map((name) => ({ key: `header:${name}`, where: 'header' as const, name })),
    ...placeholders(body?.text).map((name) => ({ key: `body:${name}`, where: 'body' as const, name })),
  ]
  let unsupported: string | null = null
  if (buttons.some((b) => b.type.toUpperCase() === 'URL' && b.url && placeholders(b.url).length)) unsupported = 'ha un bottone con link variabile'
  else if (buttons.some((b) => ['OTP', 'COPY_CODE', 'FLOW', 'CATALOG', 'MPM'].includes(b.type.toUpperCase()))) unsupported = 'ha un bottone di tipo non gestito da qui'
  else if (headerFormat && !['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerFormat)) unsupported = `intestazione ${headerFormat.toLowerCase()} non gestita`
  if (headerFormat && headerFormat !== 'TEXT') variables.unshift({ key: 'header:media', where: 'header', name: 'link del file' })
  return {
    id: String(raw.id || ''),
    name: raw.name,
    language: String(raw.language || 'it'),
    category: String(raw.category || '').toUpperCase(),
    status: String(raw.status || '').toUpperCase(),
    headerFormat,
    headerText,
    body: String(body?.text || ''),
    footer: footer?.text ? String(footer.text) : null,
    buttons: buttons.map(({ type, text }) => ({ type, text })),
    variables,
    parameterFormat: String(raw.parameter_format || '').toUpperCase() === 'NAMED' ? 'NAMED' : 'POSITIONAL',
    unsupported,
    components,
  }
}

const firstName = (name: string | null | undefined) => (name || '').trim().split(/\s+/)[0] || ''

/** Valore di una variabile per un contatto (mai vuoto: Meta rifiuta i parametri vuoti). */
export function variableValue(mapping: VariableMapping | undefined, contact: { name: string | null }): string {
  if (!mapping) return '-'
  if (mapping.type === 'nome') return firstName(contact.name) || mapping.value.trim() || 'ciao'
  return mapping.value.trim() || '-'
}

/** Variabili non impostate o impostate male (vuoto = tutto a posto). */
export function missingVariables(template: WaTemplate, variables: Record<string, VariableMapping>): string[] {
  return template.variables
    .filter((v) => {
      const m = variables[v.key]
      if (!m || (m.type !== 'nome' && m.type !== 'fisso')) return true
      if (v.key === 'header:media') return m.type !== 'fisso' || Boolean(mediaLinkProblem(template.headerFormat, m.value))
      return m.type === 'fisso' && !m.value.trim()
    })
    .map((v) => (v.key === 'header:media' ? mediaLinkProblem(template.headerFormat, variables[v.key]?.value) || 'file dell’intestazione' : `{{${v.name}}}`))
}

/** components per POST /messages (type template). */
export function buildTemplateComponents(template: WaTemplate, variables: Record<string, VariableMapping>, contact: { name: string | null }): unknown[] {
  const out: unknown[] = []
  const named = template.parameterFormat === 'NAMED'
  const param = (v: TemplateVariable) => ({ type: 'text', text: variableValue(variables[v.key], contact).slice(0, 1000), ...(named ? { parameter_name: v.name } : {}) })
  const mediaKind = mediaKindOfHeader(template.headerFormat)
  if (mediaKind) {
    // Intestazione con immagine, video o PDF: il file va dato a ogni invio (link pubblico).
    const link = variables['header:media']?.value?.trim() || ''
    out.push({ type: 'header', parameters: [mediaHeaderParameter(mediaKind, link)] })
  } else {
    const hv = template.variables.filter((v) => v.where === 'header')
    if (hv.length) out.push({ type: 'header', parameters: hv.map(param) })
  }
  const bv = template.variables.filter((v) => v.where === 'body')
  if (bv.length) out.push({ type: 'body', parameters: bv.map(param) })
  return out
}

/** Testo del messaggio come lo vede il contatto (anteprima). */
export function renderPreview(template: WaTemplate, variables: Record<string, VariableMapping>, contact: { name: string | null }): string {
  const fill = (text: string, where: 'header' | 'body') =>
    text.replace(PLACEHOLDER_RE, (_, name) => variableValue(variables[`${where}:${name}`], contact))
  return [template.headerText ? fill(template.headerText, 'header') : '', fill(template.body, 'body'), template.footer || '']
    .filter(Boolean)
    .join('\n\n')
}

// ---------------------------------------------------------------------
// Lingua del contatto e versione del modello
// ---------------------------------------------------------------------
//
// La lingua si salva tra i tag del contatto (nessuna colonna nuova): "lingua:en" se
// riconosciuta dai suoi messaggi, "lingua:en:manuale" se scelta a mano (non cambia piu'
// da sola). "lingua:altro:manuale" = nessuna lingua precisa: si usa quella predefinita.

export const LANGUAGE_LABEL: Record<string, string> = { it: 'Italiano', en: 'Inglese', es: 'Spagnolo', fr: 'Francese', de: 'Tedesco', pt: 'Portoghese', altro: 'Altra (lingua predefinita)' }
const LANG_TAG_RE = /^lingua:([a-z]{2}|altro)(:manuale)?$/
const NAME_TO_CODE: Record<string, string> = { italiano: 'it', inglese: 'en', spagnolo: 'es', francese: 'fr', tedesco: 'de', portoghese: 'pt' }

/** "en_US" -> "en". */
export const languageBase = (code: string | null | undefined) => String(code || '').toLowerCase().split(/[_-]/)[0]

export function contactLanguage(c: { tags?: string[] | null }): { lang: string | null; manual: boolean } {
  for (const t of c.tags || []) {
    const m = LANG_TAG_RE.exec(t)
    if (m) return { lang: m[1] === 'altro' ? null : m[1], manual: Boolean(m[2]) }
  }
  return { lang: null, manual: false }
}

/** Tag con la lingua aggiornata. lang null e manual false: lingua tolta (torna automatica). */
export function withLanguageTag(tags: string[] | null | undefined, lang: string | null, manual: boolean): string[] {
  const rest = (tags || []).filter((t) => !t.startsWith('lingua:'))
  if (manual) return [...rest, `lingua:${lang && LANGUAGE_LABEL[lang] ? lang : 'altro'}:manuale`]
  return lang ? [...rest, `lingua:${lang}`] : rest
}

/** Tag da mostrare (senza quello della lingua, che ha il suo campo). */
export const visibleTags = (tags: string[] | null | undefined) => (tags || []).filter((t) => !t.startsWith('lingua:'))

/** Lingua di un messaggio ricevuto (it, en, es, fr, de, pt) o null se non e' chiara (es. "ok"). */
export function detectContactLanguage(text: string | null | undefined): string | null {
  const name = replyLanguage(text)
  return name ? NAME_TO_CODE[name] || null : null
}

/**
 * Versione del modello per un destinatario: quella nella sua lingua, se approvata;
 * altrimenti quella nella lingua predefinita della campagna.
 */
export function pickTemplateVersion(template: WaTemplate, contactLang: string | null): WaTemplate {
  if (!contactLang) return template
  const all = [template, ...(template.versions || [])]
  const exact = all.find((t) => t.language.toLowerCase() === contactLang.toLowerCase())
  return exact || all.find((t) => languageBase(t.language) === contactLang) || template
}

/**
 * Altre lingue dello stesso modello usabili con le stesse variabili: approvate, stessa
 * categoria e stessa intestazione. Le altre si scartano con il motivo.
 */
export function templateVersions(all: WaTemplate[], main: WaTemplate, variables: Record<string, VariableMapping>): { versions: WaTemplate[]; excluded: { language: string; reason: string }[] } {
  const versions: WaTemplate[] = []
  const excluded: { language: string; reason: string }[] = []
  for (const t of all) {
    if (t.name !== main.name || t.language === main.language) continue
    const reason =
      t.status !== 'APPROVED'
        ? `non approvata (${t.status})`
        : t.unsupported
          ? t.unsupported
          : t.category !== main.category
            ? `categoria diversa (${t.category})`
            : (t.headerFormat || 'NONE') !== (main.headerFormat || 'NONE') && (mediaKindOfHeader(t.headerFormat) || mediaKindOfHeader(main.headerFormat))
              ? 'intestazione diversa'
              : missingVariables(t, variables).length
                ? `variabili diverse (${missingVariables(t, variables).join(', ')})`
                : null
    if (reason) excluded.push({ language: t.language, reason })
    else versions.push({ ...t, versions: undefined })
  }
  return { versions, excluded }
}

/** Quanti destinatari ricevono ogni lingua. */
export function languageSplit(template: WaTemplate, contacts: { tags?: string[] | null }[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const c of contacts) {
    const v = pickTemplateVersion(template, contactLanguage(c).lang)
    out[v.language] = (out[v.language] || 0) + 1
  }
  return out
}

// ---------------------------------------------------------------------
// Costi
// ---------------------------------------------------------------------

export function priceFor(prices: Prices, category: string | null | undefined): number {
  const c = String(category || '').toLowerCase()
  if (c === 'marketing' || c === 'marketing_lite') return prices.marketing
  if (c === 'utility') return prices.utility
  if (c === 'authentication' || c === 'authentication_international') return prices.authentication
  if (c === 'service') return prices.service
  return prices.marketing
}

export type CostRow = {
  campaign_id: string
  status: string
  sent_at: string | null
  delivered_at: string | null
  read_at?: string | null
  pricing_category?: string | null
  billable?: boolean | null
}

/** Giorno in ora italiana (AAAA-MM-GG). */
export const romeDay = (iso: string | number | Date) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' })
export const romeMonth = (iso: string | number | Date) => romeDay(iso).slice(0, 7)

/**
 * Meta addebita i modelli consegnati: costo stimato = consegnati x prezzo della categoria
 * (quella data da Meta nello stato, se c'e', altrimenti quella della campagna).
 * Un messaggio "letto" senza conferma di consegna conta come consegnato.
 */
export function deliveredCost(row: CostRow, campaignCategory: string, prices: Prices): number {
  if (row.billable === false) return 0
  if (!['delivered', 'read'].includes(row.status) && !row.delivered_at) return 0
  return priceFor(prices, row.pricing_category || campaignCategory)
}

export type CostSummary = {
  sent: number
  delivered: number
  read: number
  failed: number
  estimated: number
  /** Massimo se tutti gli inviati venissero consegnati. */
  maxIfAllDelivered: number
}

export function summarizeCosts(rows: CostRow[], categoryOf: (campaignId: string) => string, prices: Prices) {
  const byCampaign = new Map<string, CostSummary>()
  const byDay = new Map<string, number>()
  const byMonth = new Map<string, number>()
  for (const r of rows) {
    const cat = categoryOf(r.campaign_id)
    const s = byCampaign.get(r.campaign_id) || { sent: 0, delivered: 0, read: 0, failed: 0, estimated: 0, maxIfAllDelivered: 0 }
    const wasSent = Boolean(r.sent_at) && r.status !== 'failed'
    if (wasSent) {
      s.sent++
      s.maxIfAllDelivered += r.billable === false ? 0 : priceFor(prices, r.pricing_category || cat)
    }
    if (r.status === 'failed') s.failed++
    if (r.status === 'read') s.read++
    const cost = deliveredCost(r, cat, prices)
    if (r.status === 'delivered' || r.status === 'read' || r.delivered_at) {
      s.delivered++
      const when = r.delivered_at || r.read_at || r.sent_at
      if (when && cost) {
        byDay.set(romeDay(when), (byDay.get(romeDay(when)) || 0) + cost)
        byMonth.set(romeMonth(when), (byMonth.get(romeMonth(when)) || 0) + cost)
      }
    }
    s.estimated += cost
    byCampaign.set(r.campaign_id, s)
  }
  const round = (n: number) => Math.round(n * 10000) / 10000
  for (const s of byCampaign.values()) {
    s.estimated = round(s.estimated)
    s.maxIfAllDelivered = round(s.maxIfAllDelivered)
  }
  for (const [k, v] of byDay) byDay.set(k, round(v))
  for (const [k, v] of byMonth) byMonth.set(k, round(v))
  return { byCampaign, byDay, byMonth }
}

export const formatEur = (n: number, digits = 2) =>
  new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: digits, maximumFractionDigits: Math.max(digits, 4) }).format(n || 0)

/** Ultimi n giorni (ora italiana), dal piu' vecchio a oggi. */
export function lastDays(n: number, now = Date.now()): string[] {
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) out.push(romeDay(now - i * 86400_000))
  return [...new Set(out)]
}

/** "2026-11-09T10:00" ora italiana -> ISO UTC (gestisce l'ora legale). */
export function romeLocalToIso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(local.trim())
  if (!m) return null
  const [y, mo, d, h, mi] = m.slice(1).map(Number)
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  // Differenza tra Roma e UTC in quel momento (1 o 2 ore).
  const offsetAt = (ms: number) => {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms))
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
    return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute')) - ms
  }
  const first = guess - offsetAt(guess)
  const ms = guess - offsetAt(first)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/** CSV semplice (virgola o punto e virgola, virgolette). Prima riga = intestazioni. */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  if (!lines.length) return { headers: [], rows: [] }
  const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ','
  const split = (line: string) => {
    const out: string[] = []
    let cur = ''
    let quoted = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"'
          i++
        } else if (ch === '"') quoted = false
        else cur += ch
      } else if (ch === '"') quoted = true
      else if (ch === sep) {
        out.push(cur)
        cur = ''
      } else cur += ch
    }
    out.push(cur)
    return out.map((v) => v.trim())
  }
  const headers = split(lines[0]).map((h) => h.toLowerCase())
  const rows = lines.slice(1).map((l) => {
    const cells = split(l)
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']))
  })
  return { headers, rows }
}

/** Valore della colonna consenso che vale come "si'". */
export const isConsentYes = (v: string | undefined) => /^(si|sì|s|yes|y|true|1|x|ok)$/i.test((v || '').trim())
