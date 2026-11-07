import { readSetting, updateSetting } from '@/lib/settings-store'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { callAIPaced } from '@/lib/ai'
import { parseJsonObject } from '@/lib/tool-step'
import { FIELD_ID_RE, docTexts, emptyFieldLabels, fieldIdsIn, renderPdf, type DocField, type DocSection, type DocSignature, type FieldParty, type StructuredDoc } from '@/lib/pdf-doc'
import { isHidden, loadHidden } from '@/lib/inbox-hidden'
import { dropPartyLines, ensureParties, hideRecipientValues, stripPartiesSection, tidyFields, withPartiesSection } from '@/lib/contract-parties'
import { DELIVERY_DAYS, ESSENTIAL_EXCHANGE, ESSENTIAL_OBJECT, dateInSource, deliveryText, ensureTerms, formatCollabDate, readTerms, validLocal, type DeliveryDays } from '@/lib/contract-terms'

// Documenti della super chat (contratti, preventivi, accordi, lettere) scritti
// dall'AI a partire da una conversazione della casella Messaggi (Instagram,
// Facebook, email, WhatsApp, chat del sito) e dai dati di Facevoice AI.
// Si salva il documento strutturato (JSON), non il PDF: il PDF si crea a ogni
// apertura dalla route riservata all'amministratore. Ogni modifica e' una nuova
// versione; le vecchie restano scaricabili.
//
// app_settings:
//   assistant_doc:<id>  -> documento con le sue versioni (al massimo 8, ognuna limitata)
//   assistant_docs      -> elenco degli ultimi 50 documenti (i piu' vecchi si cancellano)

export const DOC_KINDS = ['contratto', 'preventivo', 'accordo', 'lettera', 'altro'] as const
export type DocKind = (typeof DOC_KINDS)[number]
export const DOC_KIND_LABEL: Record<DocKind, string> = {
  contratto: 'Contratto',
  preventivo: 'Preventivo',
  accordo: 'Accordo',
  lettera: 'Lettera',
  altro: 'Documento',
}

/**
 * Frase da dire una volta nella risposta e mostrata sulla scheda e nella pagina del
 * contratto di chi lo crea. Mai nel PDF e mai nella pagina di chi lo riceve.
 */
export const DOC_DISCLAIMER = 'Non sono un avvocato: fai controllare il documento da un professionista prima di firmarlo o inviarlo.'
/** Avviso breve in fondo a ogni pagina del PDF. */
// L'avviso legale resta solo in chat (richiesta del titolare): nel PDF niente piè di pagina oltre ai numeri di pagina.
export const PDF_FOOTER = ''

/** Dati della nostra azienda: gli unici dati di Facevoice che il documento puo' usare. */
export const BUSINESS = {
  name: 'Facevoice AI',
  address: 'Via Vito Di Stefano 32, 90049 Terrasini (PA)',
  vat: '07272010823',
  person: 'Luca Corrao',
  site: 'www.facevoice.ai',
  email: 'luca@facevoice.ai',
  /** Foro competente dei contratti (sede a Terrasini, provincia di Palermo). */
  court: 'Palermo',
}

export const PLATFORM_LABEL: Record<string, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  whatsapp: 'WhatsApp',
  email: 'Email',
  web: 'Chat del sito',
}
const CONV_PLATFORMS = ['instagram', 'facebook', 'whatsapp', 'email', 'web']

const DOC_PREFIX = 'assistant_doc:'
const INDEX_KEY = 'assistant_docs'
export const MAX_DOCUMENTS = 50
const MAX_VERSIONS = 8
/** Testo massimo di un documento (tutti i campi insieme): sta comodo nel salvataggio. */
const MAX_DOC_CHARS = 60_000
const MAX_RECORD_CHARS = 400_000
export const DOC_ID_RE = /^[a-z0-9]{8,40}$/

export type DocSource = { platform: string; contactId: string; name: string; messages: number; from: string | null; to: string | null }
/** placeholders: etichette degli spazi lasciati vuoti (da compilare a mano o alla firma). */
export type DocVersion = { v: number; at: string; by: string | null; note: string; doc: StructuredDoc; pages: number; placeholders: string[]; fromChat?: string[] }
export type StoredDocument = {
  id: string
  kind: DocKind
  createdAt: string
  updatedAt: string
  createdBy: string | null
  basedOn: DocSource | null
  versions: DocVersion[]
}

/** Scheda del documento nella chat (con "Apri PDF" e "Scarica"). */
export type DocumentCard = {
  kind: 'document'
  docId: string
  version: number
  title: string
  docKind: DocKind
  basedOn: { name: string; platform: string } | null
  pages: number
  placeholders: string[]
  createdAt: string
}

export const newDocId = () => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
export const asDocKind = (value: unknown): DocKind => ((DOC_KINDS as readonly string[]).includes(String(value)) ? (value as DocKind) : 'altro')

function parseDocument(raw: string | null): StoredDocument | null {
  try {
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed.id === 'string' && Array.isArray(parsed.versions) ? (parsed as StoredDocument) : null
  } catch {
    return null
  }
}

type IndexItem = { id: string; title: string; kind: DocKind; at: string }
function parseIndex(raw: string | null): { items: IndexItem[] } {
  try {
    const parsed = raw ? JSON.parse(raw) : null
    return { items: Array.isArray(parsed?.items) ? parsed.items.filter((i: Partial<IndexItem>) => typeof i?.id === 'string') : [] }
  } catch {
    return { items: [] }
  }
}

export async function loadDocument(id: string): Promise<StoredDocument | null> {
  if (!DOC_ID_RE.test(id)) return null
  return parseDocument((await readSetting(`${DOC_PREFIX}${id}`)).value)
}

export const latestVersion = (doc: StoredDocument) => doc.versions[doc.versions.length - 1]
export const findVersion = (doc: StoredDocument, v?: number | null) => (v ? doc.versions.find((x) => x.v === v) : latestVersion(doc)) ?? null

/** Ultimi documenti, dal piu' recente. */
export async function recentDocuments(limit = 10): Promise<IndexItem[]> {
  const index = parseIndex((await readSetting(INDEX_KEY)).value)
  return [...index.items].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit)
}

/** Aggiorna l'elenco (al massimo 50: i documenti piu' vecchi si cancellano). */
async function touchIndex(item: IndexItem) {
  let dropped: string[] = []
  await updateSetting(INDEX_KEY, parseIndex, (index) => {
    const items = [...index.items.filter((i) => i.id !== item.id), item].sort((a, b) => a.at.localeCompare(b.at))
    dropped = items.slice(0, Math.max(0, items.length - MAX_DOCUMENTS)).map((i) => i.id)
    return { items: items.slice(-MAX_DOCUMENTS) }
  })
  if (dropped.length) {
    const { error } = await supabaseAdmin.from('app_settings').delete().in('key', dropped.map((id) => `${DOC_PREFIX}${id}`))
    if (error) console.warn('documenti: pulizia non riuscita:', error.message)
  }
}

/** Versioni entro i limiti: al massimo 8 e un salvataggio non troppo grande (l'ultima resta sempre). */
function capVersions(versions: DocVersion[]): DocVersion[] {
  let list = versions.slice(-MAX_VERSIONS)
  while (list.length > 1 && JSON.stringify(list).length > MAX_RECORD_CHARS) list = list.slice(1)
  return list
}

/**
 * Cancella un documento e la sua voce nell'elenco (con tutte le versioni). Serve quando
 * il contratto nato da questo documento e' firmato da tutti: resta solo la versione firmata.
 */
export async function deleteDocument(id: string): Promise<void> {
  if (!DOC_ID_RE.test(id)) return
  await updateSetting(INDEX_KEY, parseIndex, (index) => (index.items.some((i) => i.id === id) ? { items: index.items.filter((i) => i.id !== id) } : false))
  const { error } = await supabaseAdmin.from('app_settings').delete().eq('key', `${DOC_PREFIX}${id}`)
  if (error) throw new Error(error.message)
}

export async function saveNewDocument(input: {
  kind: DocKind
  doc: StructuredDoc
  by: string | null
  basedOn: DocSource | null
  note: string
  fromChat?: string[]
}): Promise<{ record: StoredDocument; version: DocVersion }> {
  const id = newDocId()
  const now = new Date().toISOString()
  const version: DocVersion = { v: 1, at: now, by: input.by, note: input.note.slice(0, 500), doc: input.doc, pages: pageCount(input.doc), placeholders: extractPlaceholders(input.doc), fromChat: input.fromChat }
  const record: StoredDocument = { id, kind: input.kind, createdAt: now, updatedAt: now, createdBy: input.by, basedOn: input.basedOn, versions: [version] }
  await updateSetting<StoredDocument | null>(`${DOC_PREFIX}${id}`, parseDocument, () => record)
  await touchIndex({ id, title: input.doc.title, kind: input.kind, at: now })
  return { record, version }
}

/** Nuova versione di un documento esistente (le vecchie restano, fino a 8). */
export async function addDocumentVersion(id: string, doc: StructuredDoc, by: string | null, note: string, fromChat?: string[]): Promise<{ record: StoredDocument; version: DocVersion } | null> {
  const now = new Date().toISOString()
  let created: DocVersion | null = null
  const record = await updateSetting<StoredDocument | null>(`${DOC_PREFIX}${id}`, parseDocument, (current) => {
    if (!current) return false
    const v = Math.max(...current.versions.map((x) => x.v), 0) + 1
    created = { v, at: now, by, note: note.slice(0, 500), doc, pages: pageCount(doc), placeholders: extractPlaceholders(doc), fromChat }
    return { ...current, updatedAt: now, versions: capVersions([...current.versions, created]) }
  })
  if (!record || !created) return null
  await touchIndex({ id, title: doc.title, kind: record.kind, at: now })
  return { record, version: created }
}

export function documentCard(record: StoredDocument, version: DocVersion): DocumentCard {
  return {
    kind: 'document',
    docId: record.id,
    version: version.v,
    title: version.doc.title,
    docKind: record.kind,
    basedOn: record.basedOn ? { name: record.basedOn.name, platform: record.basedOn.platform } : null,
    pages: version.pages,
    placeholders: version.placeholders.slice(0, 20),
    createdAt: version.at,
  }
}

/** PDF di una versione (con l'avviso in fondo a ogni pagina). */
export function renderDocumentPdf(version: DocVersion) {
  return renderPdf({ ...version.doc, footer: PDF_FOOTER }, { createdAt: new Date(version.at) })
}

const pageCount = (doc: StructuredDoc) => renderPdf({ ...doc, footer: PDF_FOOTER }).pages

/**
 * Spazi ancora vuoti (da compilare a mano o al momento della firma), senza doppioni.
 * I documenti di prima con "[DA COMPLETARE: …]" nel testo contano allo stesso modo.
 */
export function extractPlaceholders(doc: StructuredDoc): string[] {
  const out: string[] = [...emptyFieldLabels(doc)]
  const legacy = docTexts(doc).join('\n').match(/\[DA COMPLETARE[^\]]*\]/gi) || []
  for (const f of legacy) {
    const label = f.replace(/^\[DA COMPLETARE\s*:?\s*/i, '').replace(/\]$/, '').trim() || 'dato mancante'
    if (!out.some((o) => o.toLowerCase() === label.toLowerCase())) out.push(label.slice(0, 120))
  }
  return out.slice(0, 30)
}

// ---------------------------------------------------------------------
// Pulizia del documento scritto dall'AI
// ---------------------------------------------------------------------

/** Testo pulito: niente markdown (asterischi, cancelletti), spazi normali. */
function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[*•]\s+/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max)
}

const strings = (value: unknown, maxItems: number, maxChars: number): string[] => {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  return list.map((v) => cleanText(v, maxChars)).filter(Boolean).slice(0, maxItems)
}

export const MAX_FIELDS = 40
const FIELD_PARTIES: FieldParty[] = ['creatore', 'destinatario', 'entrambi']
/** Frasi di avviso legale che non vanno mai nel documento (restano solo in chat). */
const DISCLAIMER_TEXT = /non sono un avvocato|fai(?:lo|la)? controllare (?:il documento |la bozza )?da un professionista|non (?:costituisce|è) (?:una )?consulenza legale|bozza preparata con l['’]assistente/i

/** Toglie solo le frasi di avviso legale (il resto del paragrafo resta). */
function stripDisclaimer(text: string): string {
  if (!DISCLAIMER_TEXT.test(text)) return text
  const sentences = text.match(/[^.!?…]+[.!?…]*\s*/g) || [text]
  return sentences
    .filter((x) => !DISCLAIMER_TEXT.test(x))
    .join('')
    .trim()
}

/** Id leggibile per un campo, dall'etichetta ("Codice fiscale di Giusy" -> codice_fiscale_di_giusy). */
export function fieldIdFrom(label: string, taken: Set<string>): string {
  const base =
    label
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 34) || 'dato'
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`.slice(0, 40)
  taken.add(id)
  return id
}

const asParty = (value: unknown): FieldParty => (FIELD_PARTIES.includes(value as FieldParty) ? (value as FieldParty) : 'entrambi')

/** Chi compila un dato, dalla sua etichetta (vecchi segnaposto): "di Facevoice" -> creatore. */
function guessParty(label: string): FieldParty {
  if (/facevoice|fornitore|luca|nostr/i.test(label)) return 'creatore'
  if (/client|destinatari|committente|\bdi\s+[A-Z]/.test(label)) return 'destinatario'
  return 'entrambi'
}

/**
 * Campi puliti: id validi e unici, etichette brevi, al massimo 40. Ogni {{id}} nel testo ha
 * il suo campo (se manca si crea dall'id) e i vecchi "[DA COMPLETARE: …]" diventano campi.
 */
export function normalizeFields(doc: StructuredDoc, rawFields: unknown): StructuredDoc {
  const fields: DocField[] = []
  const taken = new Set<string>()
  for (const raw of (Array.isArray(rawFields) ? rawFields : []).slice(0, MAX_FIELDS)) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const label = cleanText(r.label ?? r.name, 80)
    let id = typeof r.id === 'string' ? r.id.trim().toLowerCase() : ''
    if (!label) continue
    if (!FIELD_ID_RE.test(id) || taken.has(id)) id = fieldIdFrom(label, taken)
    else taken.add(id)
    const value = cleanText(r.value, 300)
    fields.push({ id, label, party: asParty(r.party), ...(value ? { value } : {}) })
  }
  // Vecchi segnaposto -> campi (stessa etichetta = stesso campo).
  const legacy = (text: string) =>
    text.replace(/\[DA COMPLETARE\s*:?\s*([^\]]*)\]/gi, (_m, label: string) => {
      const clean = cleanText(label, 80) || 'Dato da completare'
      const found = fields.find((f) => f.label.toLowerCase() === clean.toLowerCase())
      if (found) return `{{${found.id}}}`
      if (fields.length >= MAX_FIELDS) return '____'
      const field: DocField = { id: fieldIdFrom(clean, taken), label: clean[0].toUpperCase() + clean.slice(1), party: guessParty(clean) }
      fields.push(field)
      return `{{${field.id}}}`
    })
  const fix = (text: string) => legacy(text)
  const next: StructuredDoc = {
    ...doc,
    title: fix(doc.title),
    ...(doc.subtitle ? { subtitle: fix(doc.subtitle) } : {}),
    meta: (doc.meta || []).map(fix),
    sections: doc.sections.map((sec) => ({ ...sec, ...(sec.heading ? { heading: fix(sec.heading) } : {}), paragraphs: sec.paragraphs.map(fix), ...(sec.bullets ? { bullets: sec.bullets.map(fix) } : {}) })),
    ...(doc.signatures ? { signatures: doc.signatures.map((sig) => ({ ...sig, label: fix(sig.label), ...(sig.name ? { name: fix(sig.name) } : {}) })) } : {}),
  }
  // {{id}} senza campo: si crea dall'id, cosi' nel PDF esce come spazio da compilare.
  for (const id of docTexts(next).flatMap(fieldIdsIn)) {
    if (taken.has(id) || fields.length >= MAX_FIELDS) continue
    taken.add(id)
    const label = id.replace(/_/g, ' ')
    fields.push({ id, label: label[0].toUpperCase() + label.slice(1), party: guessParty(label) })
  }
  return fields.length ? { ...next, fields } : { ...next, fields: [] }
}

/** Documento valido e nei limiti, dal JSON dell'AI. null se manca l'essenziale. */
export function sanitizeDoc(value: Record<string, unknown>): { doc: StructuredDoc; fromChat: string[]; truncated?: boolean; proposedAt?: string } | null {
  const title = cleanText(value.title, 140)
  const rawSections = Array.isArray(value.sections) ? value.sections : []
  let budget = MAX_DOC_CHARS
  const take = (list: string[]) => {
    const out: string[] = []
    for (const item of list) {
      if (budget <= 0) break
      const text = item.slice(0, budget)
      budget -= text.length
      out.push(text)
    }
    return out
  }
  const sections: DocSection[] = []
  for (const raw of rawSections.slice(0, 40)) {
    if (!raw || typeof raw !== 'object' || budget <= 0) continue
    const s = raw as Record<string, unknown>
    const heading = cleanText(s.heading ?? s.title, 160)
    // Le frasi di avviso legale non entrano mai nel documento: restano solo in chat.
    const paragraphs = take(strings(s.paragraphs ?? s.text ?? s.content, 25, 4000).map(stripDisclaimer).filter(Boolean))
    const bullets = take(strings(s.bullets ?? s.items, 30, 800).map(stripDisclaimer).filter(Boolean))
    if (!heading && !paragraphs.length && !bullets.length) continue
    const approval = s.specific_approval === true || s.specificApproval === true
    sections.push({ ...(heading ? { heading } : {}), paragraphs, ...(bullets.length ? { bullets } : {}), ...(approval ? { specificApproval: true } : {}) })
  }
  if (!title || !sections.length) return null
  // Troppo lungo: si accorcia senza scrivere avvisi nel documento (lo dice l'assistente in chat).
  const truncated = budget <= 0
  const signatures: DocSignature[] = []
  for (const raw of (Array.isArray(value.signatures) ? value.signatures : []).slice(0, 4)) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const label = cleanText(r.label, 80)
    const name = cleanText(r.name, 120)
    if (!label) continue
    const party = r.party === 'creatore' || r.party === 'destinatario' ? r.party : /facevoice|fornitore/i.test(`${label} ${name}`) ? 'creatore' : 'destinatario'
    signatures.push({ label, ...(name ? { name } : {}), party })
  }
  const subtitle = cleanText(value.subtitle, 200)
  // Data e ora della collaborazione proposte dall'AI (solo se dette chiaramente): si controllano dopo.
  const collab = value.collaborazione && typeof value.collaborazione === 'object' ? (value.collaborazione as Record<string, unknown>) : null
  const proposed = typeof collab?.data_ora === 'string' ? collab.data_ora.trim().slice(0, 16) : ''
  const doc: StructuredDoc = normalizeFields(
    {
      title,
      ...(subtitle ? { subtitle } : {}),
      meta: strings(value.meta, 8, 300).map(stripDisclaimer).filter(Boolean),
      sections,
      ...(signatures.length ? { signatures } : {}),
    },
    value.fields
  )
  return { doc, fromChat: strings(value.from_chat ?? value.fromChat, 15, 300), ...(truncated ? { truncated: true } : {}), ...(validLocal(proposed) ? { proposedAt: proposed } : {}) }
}

// ---------------------------------------------------------------------
// Conversazione su cui si basa il documento
// ---------------------------------------------------------------------

const squash = (text: string) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9@._]+/g, '')

export type ConversationMatch = { platform: string; contactId: string; name: string; last: string; messages: number }

/** Conversazioni della casella (ultimi messaggi): una riga per persona e canale. */
async function conversationList(platform?: string): Promise<ConversationMatch[]> {
  const platforms = platform && CONV_PLATFORMS.includes(platform) ? [platform] : CONV_PLATFORMS
  const { data } = await supabaseAdmin
    .from('social_messages')
    .select('platform, contact_id, contact_name, status, created_at')
    .in('platform', platforms)
    .order('created_at', { ascending: false })
    .limit(4000)
  const map = new Map<string, ConversationMatch>()
  for (const m of (data || []) as { platform: string; contact_id: string; contact_name: string | null; status: string | null; created_at: string }[]) {
    if (m.status === 'rejected' || !m.contact_id) continue
    const key = `${m.platform}:${m.contact_id}`
    const conv = map.get(key)
    if (!conv) map.set(key, { platform: m.platform, contactId: m.contact_id, name: m.contact_name || '', last: m.created_at, messages: 1 })
    else {
      conv.messages++
      if (!conv.name && m.contact_name) conv.name = m.contact_name
    }
  }
  return [...map.values()]
}

/** Account Instagram visti con questo username (dato da Meta, salvato dal collegamento automatico). */
async function instagramIdsFor(username: string): Promise<string[]> {
  try {
    const list = JSON.parse((await readSetting(`identity_ig:${username.toLowerCase()}`)).value || '[]')
    return Array.isArray(list) ? list.map((e: { id?: unknown }) => (typeof e?.id === 'string' ? e.id : '')).filter(Boolean) : []
  } catch {
    return []
  }
}

/**
 * Trova la conversazione con la persona indicata da Luca (nome, @username, email o id),
 * sul canale indicato se c'e'. Piu' persone (o piu' canali) -> options, da far scegliere.
 */
export async function resolveConversation(platform: string | undefined, contact: string | undefined): Promise<{ match?: ConversationMatch; options?: ConversationMatch[]; error?: string }> {
  const query = (contact || '').trim()
  const wanted = platform && CONV_PLATFORMS.includes(platform.toLowerCase()) ? platform.toLowerCase() : undefined
  if (!query) return { error: 'manca la persona: chiedi a Luca con chi è la conversazione (nome, @username o email)' }
  const list = await conversationList(wanted)
  const lower = query.toLowerCase()
  let hits = list.filter((c) => c.contactId.toLowerCase() === lower)
  const username = query.replace(/^@/, '')
  if (!hits.length && /^@?[a-z0-9._]{2,30}$/i.test(query) && (query.startsWith('@') || wanted === 'instagram')) {
    const ids = await instagramIdsFor(username)
    hits = list.filter((c) => c.platform === 'instagram' && (ids.includes(c.contactId) || squash(c.name) === squash(`@${username}`) || squash(c.name) === squash(username)))
  }
  if (!hits.length && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(query)) hits = list.filter((c) => c.contactId.toLowerCase() === lower)
  if (!hits.length) {
    const whole = squash(query.replace(/^@/, ''))
    const words = query.split(/\s+/).map((w) => squash(w.replace(/^@/, ''))).filter((w) => w.length >= 2)
    hits = list.filter((c) => {
      const name = squash(c.name)
      return Boolean(name) && (name.includes(whole) || (words.length > 0 && words.every((w) => name.includes(w))))
    })
  }
  if (!hits.length) {
    return { error: `nessuna conversazione con "${query}"${wanted ? ` su ${PLATFORM_LABEL[wanted] || wanted}` : ''} nella casella Messaggi: dillo a Luca e chiedigli il nome esatto o il canale (puoi anche cercare con list_conversations)` }
  }
  const sorted = hits.sort((a, b) => b.last.localeCompare(a.last))
  if (sorted.length === 1) return { match: sorted[0] }
  return { options: sorted.slice(0, 8) }
}

const ORIGIN_LABEL: Record<string, string> = {
  ai_auto: 'risposta automatica',
  ai_approved: 'risposta AI approvata',
  ai_edited: 'risposta AI modificata e approvata',
  manual: 'scritto a mano',
  manual_app: 'scritto a mano dall’app',
  outreach: 'email della Ricerca clienti',
}

const romeTime = (iso: string) =>
  new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const romeDay = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'long', year: 'numeric' })

const MAX_TRANSCRIPT = 40_000

export type Transcript = { source: DocSource; text: string; omitted: number }

/**
 * Conversazione intera con la persona su quel canale, in ordine: messaggi ricevuti,
 * nostre risposte automatiche e scritte a mano (niente bozze non inviate), con data e ora.
 * Come nella casella: dopo un'eliminazione restano solo i messaggi nuovi.
 */
export async function loadTranscript(platform: string, contactId: string, maxChars = MAX_TRANSCRIPT): Promise<Transcript | null> {
  const read = (columns: string) =>
    supabaseAdmin
      .from('social_messages')
      .select(columns)
      .eq('platform', platform)
      .eq('contact_id', contactId)
      // I piu' recenti (dove di solito si chiudono gli accordi), poi in ordine.
      .order('created_at', { ascending: false })
      .limit(800)
  let { data, error } = await read('direction, kind, body, status, origin, contact_name, created_at')
  // Senza la colonna origin (migrazione non eseguita) si legge lo stesso.
  if (error) ({ data, error } = await read('direction, kind, body, status, contact_name, created_at'))
  if (error) return null
  type Row = { direction: string; kind: string | null; body: string | null; status: string | null; origin?: string | null; contact_name: string | null; created_at: string }
  const hidden = await loadHidden().catch(() => ({}))
  const rows = ((data || []) as unknown as Row[])
    .filter((m) => m.body?.trim() && (m.direction === 'in' || m.status === 'sent') && !isHidden(hidden, platform, contactId, m.created_at))
    .reverse()
  if (!rows.length) return null
  const name = rows.find((m) => m.contact_name)?.contact_name || contactId
  const lines = rows.map((m) => {
    const who = m.direction === 'in' ? name : `Noi${m.origin && ORIGIN_LABEL[m.origin] ? ` (${ORIGIN_LABEL[m.origin]})` : ''}`
    const where = m.kind === 'comment' ? ' · commento pubblico' : ''
    return `[${romeTime(m.created_at)}] ${who}${where}: ${String(m.body).replace(/\s+\n/g, '\n').trim().slice(0, 3000)}`
  })
  // Troppo lunga: l'inizio (come e' nata) e la parte piu' recente.
  let omitted = 0
  let kept = lines
  if (lines.join('\n').length > maxChars) {
    const head = lines.slice(0, 4)
    const tail: string[] = []
    let size = head.join('\n').length
    for (let i = lines.length - 1; i >= head.length; i--) {
      if (size + lines[i].length + 1 > maxChars) break
      tail.unshift(lines[i])
      size += lines[i].length + 1
    }
    omitted = lines.length - head.length - tail.length
    kept = [...head, `(… ${omitted} messaggi intermedi non riportati per lunghezza …)`, ...tail]
  }
  return {
    source: { platform, contactId, name, messages: rows.length, from: rows[0].created_at, to: rows[rows.length - 1].created_at },
    text: kept.join('\n'),
    omitted,
  }
}

export const describeSource = (s: DocSource) =>
  `${s.name} · ${PLATFORM_LABEL[s.platform] || s.platform} (${s.messages} messaggi${s.from && s.to ? `, dal ${romeDay(s.from)} al ${romeDay(s.to)}` : ''})`

// ---------------------------------------------------------------------
// Scrittura con l'AI
// ---------------------------------------------------------------------

const KIND_HINTS: Record<DocKind, string> = {
  contratto:
    'Contratto di prestazione di servizi: premesse (cosa è stato concordato in chat), oggetto, cosa dà e cosa riceve ciascuna parte (causa), durata e rinnovo, consegna dei contenuti (rimanda ai Termini della collaborazione), corrispettivo e modalità di pagamento (solo importi concordati in chat), obblighi del fornitore, obblighi del cliente, proprietà e diritti d’uso dei contenuti (territorio, durata, canali), riservatezza, trattamento dei dati personali (GDPR, Reg. UE 2016/679), responsabilità e limitazioni, recesso e risoluzione, comunicazioni tra le parti, legge applicabile e foro competente, forma e sottoscrizione, firme.',
  preventivo:
    'Preventivo: oggetto, descrizione dei servizi o delle voci, importi solo se concordati in chat (altrimenti uno spazio da compilare), tempi di realizzazione (per la data della collaborazione e la consegna dei contenuti rimanda ai Termini della collaborazione), condizioni di pagamento, validità dell’offerta, cosa non è incluso, modalità di accettazione, firme per accettazione.',
  accordo:
    'Accordo tra le parti (collaborazione o riservatezza, secondo la richiesta): premesse, oggetto, cosa dà e cosa riceve ciascuna parte (causa), impegni di ciascuna parte, durata, consegna dei contenuti (rimanda ai Termini della collaborazione), diritti d’uso dei contenuti (territorio, durata, canali), riservatezza, dati personali, recesso, legge applicabile e foro competente, forma e sottoscrizione, firme.',
  lettera:
    'Lettera formale: mittente, destinatario, luogo e data, oggetto, testo in paragrafi chiari, saluti, firma. Niente clausole contrattuali se non richieste.',
  altro: 'Documento con le sezioni che servono per la richiesta di Luca, chiaro e ordinato.',
}

/** Regole sui dati delle parti: "Le parti" la aggiunge il server (lib/contract-parties), mai l'AI. */
const PARTIES_RULES = `- Dati delle parti: NON scriverli tu. La sezione «Le parti» (Facevoice AI con sede e P.IVA; la controparte con nome e cognome, luogo e data di nascita, codice fiscale, indirizzo di residenza, email, telefono) la aggiunge il sistema in cima al documento, con gli spazi che la controparte compila prima di firmare. Non creare "fields" per questi dati e non scrivere righe "Tra: …" / "E: …" in "meta".
- Il nome del profilo Instagram o Facebook, lo @username, i numeri di telefono o WhatsApp e le email scritti in chat NON sono dati verificati: non usarli mai come dati della controparte e non scriverli nelle clausole (niente "numero WhatsApp 3331234567"). Nelle clausole chiama la controparte in modo generico: «il Cliente», «la Controparte» o «il/la Creator».
- Uno spazio da compilare non va mai subito dopo un dato già scritto: niente "3331234567: {{numero}}", niente "foro di Palermo {{foro}}".
- Foro competente: scrivi sempre «foro di Palermo» (Facevoice AI ha sede a Terrasini, in provincia di Palermo), mai uno spazio da compilare per il foro.`

/**
 * Elementi essenziali dei contratti (art. 1325 c.c.) e «Termini della collaborazione»
 * (lib/contract-terms: li aggiunge il sistema e li sceglie chi crea, mai l'AI da sola).
 */
const ESSENTIALS_RULES = `- Contratti e accordi: devono avere sempre, chiari, gli elementi essenziali dell'art. 1325 c.c.:
  1) l'accordo delle parti: lo danno «Le parti» e le firme (li aggiunge il sistema);
  2) OGGETTO: una sezione «Oggetto» che dice cosa si scambia, determinato o determinabile (servizi, contenuti, quantità, canali);
  3) CAUSA: una clausola che dice cosa dà e cosa riceve ciascuna parte, cioè la funzione economica dello scambio (compenso in denaro, beni o servizi: per esempio una cena in cambio di contenuti UGC);
  4) FORMA: una clausola «Forma e sottoscrizione»: contratto in forma scritta, firmato dalle parti con firma elettronica semplice, con luogo e data della firma (spazio "Luogo e data della firma", party "entrambi").
  Poi le clausole abituali: durata, consegna, compenso e pagamento, diritti d'uso dei contenuti (territorio, durata, canali), recesso, riservatezza, dati personali, legge applicabile e foro competente.
- Solo contratti, accordi e preventivi: la sezione «Termini della collaborazione» (data e ora della collaborazione; termine di consegna dei contenuti: 7, 14 o 30 giorni) la aggiunge il sistema subito dopo «Le parti», e li sceglie chi crea il contratto. Non scriverla tu (nemmeno una sezione con quel titolo), non scrivere date della collaborazione o termini di consegna nel testo e non creare "fields" per loro: nelle clausole scrivi «nella data e ora indicate nei Termini della collaborazione» e «entro il termine di consegna indicato nei Termini della collaborazione». Mai altri termini di consegna.
- Solo contratti, accordi e preventivi: se la conversazione o la richiesta di Luca dicono chiaramente giorno e ora della collaborazione, aggiungi al JSON "collaborazione": {"data_ora": "AAAA-MM-GGTHH:MM"} (ora italiana): è solo una proposta che chi crea può cambiare. Altrimenti non mettere "collaborazione". Mai inventarla.
- Lettere e altri documenti: niente «Termini della collaborazione»; le date dette in chat (anche quella della collaborazione) si scrivono normalmente nel testo.`

/** Regole uguali per ogni documento (tipo e data sono in systemPrompt, in coda). */
const DOC_RULES = `Prepari documenti scritti per Facevoice AI (agenzia di Luca Corrao): contratti, preventivi, accordi, lettere. Scrivi in italiano, con lo stile di un documento legale italiano ma con parole semplici e frasi chiare.

Rispondi SOLO con un JSON valido, senza testo prima o dopo, in questo formato:
{"title": "titolo del documento", "subtitle": "riga sotto il titolo, opzionale", "meta": ["Data: ..."], "sections": [{"heading": "1. Oggetto", "paragraphs": ["..."], "bullets": ["..."], "specific_approval": false}], "fields": [{"id": "iban", "label": "IBAN", "party": "creatore"}, {"id": "luogo_data_firma", "label": "Luogo e data della firma", "party": "entrambi"}], "signatures": [{"label": "Per Facevoice AI", "name": "Luca Corrao", "party": "creatore"}, {"label": "Il Cliente", "party": "destinatario"}], "from_chat": ["punto concordato nella conversazione", "..."]}

Regole obbligatorie:
- Usa SOLO i fatti presenti nella conversazione e nei dati dell'azienda che ti passo. Non aggiungere servizi, prezzi, date o condizioni che nessuno ha detto.
- Non inventare MAI dati personali o economici: codici fiscali, partite IVA del cliente, indirizzi, numeri di documento, IBAN, date, scadenze, importi o prezzi non concordati. Per ognuno lascia uno SPAZIO DA COMPILARE: aggiungi un elemento in "fields" (id breve con lettere minuscole, numeri e _; label breve e chiara, es. "IBAN"; party = chi lo compila: "creatore" per Facevoice AI, anche per date, durate o importi da decidere prima dell'invio; "destinatario" per l'altra parte; "entrambi" solo per un dato che ognuno scrive per sé quando firma, es. luogo e data della firma) e nel testo scrivi {{id}} al posto del dato, per esempio "su IBAN {{iban}}", "a partire dal {{data_inizio}}". Nel PDF lo spazio esce come una linea vuota da compilare a mano o al momento della firma.
${PARTIES_RULES}
${ESSENTIALS_RULES}
- MAI scrivere segnaposto come "[DA COMPLETARE …]", "XXX", "____" o "da definire" nel testo: usa sempre {{id}} con il suo campo. Metti "value" in un campo solo se il dato è scritto chiaramente nella conversazione.
- Niente avvisi legali nel documento (niente "non sono un avvocato", niente "fai controllare da un professionista"): l'avviso resta solo in chat.
- Metti "specific_approval": true sulle clausole che secondo gli artt. 1341 e 1342 c.c. vanno approvate per iscritto in modo specifico (es. limitazioni di responsabilità, recesso, tacito rinnovo, penali, foro competente); false sulle altre.
- Nelle premesse (o in una sezione iniziale) di' chiaramente quali punti sono stati concordati nella conversazione, citando canale e data (es. "come concordato nella conversazione su Instagram del 5 novembre 2026"). Metti gli stessi punti, in breve, in "from_chat".
- I messaggi "Noi" sono nostri (Facevoice AI), sia quelli automatici sia quelli scritti a mano: valgono allo stesso modo.
- Numera le sezioni (1., 2., 3. …). Paragrafi brevi. Niente markdown, niente asterischi, niente emoji.
- Il nome della conversazione serve solo a capire di chi si parla: non è il nome vero della controparte.`

/**
 * Istruzioni per scrivere un documento, divise in due. system: le regole uguali per ogni
 * documento e ogni giorno (con Claude si rileggono dalla cache, anche tra un contratto e un
 * preventivo). systemTail: le due regole che cambiano con la richiesta (le clausole del tipo di
 * documento e la data di oggi), in coda all'elenco delle regole invece che in mezzo. Le regole
 * sono le stesse di prima, con lo stesso testo: cambia solo l'ordine.
 */
/** Contratti, accordi e preventivi hanno i «Termini della collaborazione» (withStandardParties). */
const hasTermsBlock = (kind: DocKind) => kind === 'contratto' || kind === 'accordo' || kind === 'preventivo'

function systemPrompt(kind: DocKind, today: string): { system: string; systemTail: string } {
  const terms = hasTermsBlock(kind)
    ? '- Questo documento ha i «Termini della collaborazione» (li aggiunge il sistema): per data della collaborazione e consegna dei contenuti rimanda a quelli.'
    : '- Questo documento NON ha i «Termini della collaborazione»: se la conversazione o Luca dicono date (anche della collaborazione), scrivile normalmente nel testo.'
  return {
    system: DOC_RULES,
    systemTail: `
- Inserisci le clausole abituali per questo tipo di documento. ${KIND_HINTS[kind]}
${terms}
- La data del documento è oggi: ${today}. Scrivi le date per esteso in italiano (es. 7 novembre 2026).`,
  }
}

function businessBlock(knowledge: string) {
  return [
    `Dati della nostra azienda (usali così come sono): ${BUSINESS.name}, sede in ${BUSINESS.address}, P.IVA ${BUSINESS.vat}, rappresentata da ${BUSINESS.person}, sito ${BUSINESS.site}, email ${BUSINESS.email}.`,
    knowledge ? `Informazioni ufficiali su servizi e prezzi di Facevoice (usale solo se c'entrano con la richiesta; i prezzi valgono solo se confermati nella conversazione):\n${knowledge.slice(0, 5000)}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

const FIX_FORMAT = 'Il messaggio precedente non era un JSON valido del documento. Rispondi di nuovo SOLO con il JSON del documento intero, nel formato indicato, senza nient’altro.'

/** gaps: elementi essenziali che l'AI non ha scritto nemmeno dopo il promemoria (oggetto, causa): diventati spazi di chi crea. */
type Written = { doc: StructuredDoc; fromChat: string[]; truncated?: boolean; proposedAt?: string; gaps?: EssentialGap[] }

export type EssentialGap = 'oggetto' | 'causa' | 'forma'
const GAP_TEXT: Record<EssentialGap, string> = {
  oggetto: 'una sezione «Oggetto» che dice cosa si scambia (servizi, contenuti, quantità, canali)',
  causa: 'una clausola che dice cosa dà e cosa riceve ciascuna parte (compenso in denaro, beni o servizi)',
  forma: 'una clausola «Forma e sottoscrizione» (forma scritta, firma elettronica semplice, luogo e data della firma)',
}

const headingWords = (s: DocSection) => (s.heading || '').toLowerCase().replace(/^\s*\d+\s*[.)]?\s*/, '')
const sectionText = (s: DocSection) => [...(s.paragraphs || []), ...(s.bullets || [])].join(' ').toLowerCase()
/** Forma scritta o firma elettronica dette davvero (non basta un titolo «Firme» o "sottoscritto"). */
const FORM_WORDS = /forma scritta|firma elettronica|firmat[oa] elettronicamente/
const isFormSection = (s: DocSection) => FORM_WORDS.test(`${headingWords(s)} ${sectionText(s)}`)

/** Luogo e data della firma: nel testo ("luogo e data") o uno spazio con quell'etichetta usato nel testo (mai quelli di nascita). */
function hasSignPlace(doc: StructuredDoc): boolean {
  const texts = docTexts(doc)
  if (texts.some((t) => /(?:luogo\s+e\s+data|data\s+e\s+luogo)(?!\s+(?:di\s+)?nascita)/i.test(t))) return true
  const used = new Set(texts.flatMap(fieldIdsIn))
  return (doc.fields || []).some((f) => used.has(f.id) && /luogo/i.test(f.label) && /data/i.test(f.label) && !/nascit/i.test(f.label))
}

/**
 * Elementi essenziali (art. 1325 c.c.) che il contratto non ha: una sezione «Oggetto», una
 * clausola su cosa da' e riceve ciascuna parte (causa), la clausola sulla forma (forma scritta
 * o firma elettronica, con luogo e data della firma).
 */
export function essentialGaps(doc: StructuredDoc): EssentialGap[] {
  const sections = doc.sections
  const out: EssentialGap[] = []
  if (!sections.some((s) => /\boggetto\b/.test(headingWords(s)))) out.push('oggetto')
  const causa = sections.some(
    (s) =>
      /corrispettiv|compens|\bcausa\b|scambio|controprestazion|prestazioni delle parti|obblighi delle parti|impegni delle parti|cosa (?:da|dà|riceve)/.test(headingWords(s)) ||
      /\bin cambio\b|\ba fronte d|\bcorrispettivo\b|\bcompenso\b|\bin contropartita\b|\bcome controprestazione\b|cosa d[aà] e cosa riceve/.test(sectionText(s))
  )
  if (!causa) out.push('causa')
  if (!sections.some(isFormSection) || !hasSignPlace(doc)) out.push('forma')
  return out
}

const essentialsReminder = (gaps: EssentialGap[]) =>
  `Nel contratto mancano elementi essenziali (art. 1325 c.c.): ${gaps.map((g) => GAP_TEXT[g]).join('; ')}. Riscrivi il documento INTERO aggiungendoli, nello stesso formato JSON, senza inventare fatti: un dato che nessuno ha detto diventa uno spazio da compilare ({{id}} in "fields"). Rispondi SOLO con il JSON.`

/** Spazio "Luogo e data della firma" (di ciascun firmatario): quello che c'e' gia' o uno nuovo. */
function signPlaceField(fields: DocField[]): string {
  const place = fields.find((f) => f.party === 'entrambi' && /luogo/i.test(f.label) && /data/i.test(f.label) && !/nascit/i.test(f.label))
  if (place) return place.id
  const id = fieldIdFrom('luogo_data_firma', new Set(fields.map((f) => f.id)))
  fields.push({ id, label: 'Luogo e data della firma', party: 'entrambi' })
  return id
}

/**
 * Forma e sottoscrizione ancora mancante dopo il secondo tentativo (controllata sul testo come
 * sara' salvato): la clausola standard (non e' un fatto, e' come si firma qui: forma scritta,
 * firma elettronica semplice, luogo e data). Se la clausola sulla forma c'e' ma senza luogo e
 * data, si aggiunge solo quella riga.
 */
function withFormClause(doc: StructuredDoc): StructuredDoc {
  const fields = [...(doc.fields || [])]
  const form = doc.sections.findIndex(isFormSection)
  if (form >= 0) {
    const id = signPlaceField(fields)
    const sections = doc.sections.map((s, i) => (i === form ? { ...s, paragraphs: [...(s.paragraphs || []), `Luogo e data della firma: {{${id}}}.`] } : s))
    return { ...doc, fields, sections }
  }
  const id = signPlaceField(fields)
  const n = doc.sections.length + 1
  return {
    ...doc,
    fields,
    sections: [...doc.sections, { heading: `${n}. Forma e sottoscrizione`, paragraphs: [`Il presente contratto è redatto in forma scritta ed è sottoscritto dalle parti con firma elettronica semplice. Luogo e data della firma: {{${id}}}.`] }],
  }
}

/**
 * Oggetto o causa ancora mancanti dopo il promemoria: mai inventati, diventano spazi di chi crea
 * (obbligatori per la sua firma) in una sezione «Oggetto» (quella che c'e' o una nuova in cima).
 */
function withEssentialFields(doc: StructuredDoc, gaps: EssentialGap[]): StructuredDoc {
  const wantObject = gaps.includes('oggetto')
  const wantExchange = gaps.includes('causa')
  if (!wantObject && !wantExchange) return doc
  const fields = [...(doc.fields || [])]
  const add = (spec: { id: string; label: string }) => {
    if (!fields.some((f) => f.id === spec.id)) fields.push({ id: spec.id, label: spec.label, party: 'creatore' })
  }
  const lines: string[] = []
  if (wantObject) {
    add(ESSENTIAL_OBJECT)
    lines.push(`Oggetto del contratto: {{${ESSENTIAL_OBJECT.id}}}.`)
  }
  if (wantExchange) {
    add(ESSENTIAL_EXCHANGE)
    lines.push(`Cosa dà e cosa riceve ciascuna parte: {{${ESSENTIAL_EXCHANGE.id}}}.`)
  }
  const at = doc.sections.findIndex((s) => /\boggetto\b/.test(headingWords(s)))
  const sections =
    at >= 0
      ? doc.sections.map((s, i) => (i === at ? { ...s, paragraphs: [...(s.paragraphs || []), ...lines] } : s))
      : [{ heading: 'Oggetto', paragraphs: lines }, ...doc.sections]
  return { ...doc, fields, sections }
}

/**
 * Chiede il documento all'AI (JSON). check: per contratti e accordi, gli elementi essenziali
 * che mancano (sul testo come sara' salvato); se ne manca qualcuno si riprova UNA volta con un
 * promemoria. Se mancano ancora, la forma si aggiunge con la clausola standard e oggetto e
 * causa diventano spazi di chi crea (mai inventati).
 */
async function askDocument(prompt: { system: string; systemTail: string }, user: string, check?: (doc: StructuredDoc) => EssentialGap[]): Promise<Written> {
  const accept = (v: Record<string, unknown>) => typeof v.title === 'string' && Array.isArray(v.sections)
  const messages: { role: 'user' | 'assistant'; content: string }[] = [{ role: 'user', content: user }]
  let formatErrors = 0
  let first: Written | null = null
  const finish = (w: Written): Written => {
    const gaps = check ? check(w.doc) : []
    if (!gaps.length) return w
    const doc = withEssentialFields(gaps.includes('forma') ? withFormClause(w.doc) : w.doc, gaps)
    const left = gaps.filter((g) => g !== 'forma')
    return { ...w, doc, ...(left.length ? { gaps: left } : {}) }
  }
  while (true) {
    const result = await callAIPaced(messages, prompt.system, {
      feature: 'super_chat_documenti',
      temperature: 0.3,
      maxOutputTokens: 8000,
      json: true,
      systemTail: prompt.systemTail,
    })
    const raw = result.message || ''
    const parsed = parseJsonObject(raw, accept)
    const clean = parsed ? sanitizeDoc(parsed) : null
    if (clean) {
      const gaps = check && !first ? check(clean.doc) : []
      if (!gaps.length) return finish(first && check && check(clean.doc).length > check(first.doc).length ? first : clean)
      // Un solo promemoria sugli elementi essenziali.
      first = clean
      messages.push({ role: 'assistant', content: raw.slice(0, 20_000) }, { role: 'user', content: essentialsReminder(gaps) })
      continue
    }
    if (++formatErrors >= 2) {
      if (first) return finish(first)
      throw new Error('non sono riuscito a scrivere il documento in un formato valido: riprova')
    }
    messages.push({ role: 'assistant', content: raw.slice(0, 4000) }, { role: 'user', content: FIX_FORMAT })
  }
}

const todayText = () => new Date().toLocaleDateString('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'long', year: 'numeric' })

/**
 * Contratti, accordi e preventivi: spazi messi bene (mai dopo un dato, foro di Palermo) e
 * sezione «Le parti» in cima con i dati standard delle parti (lib/contract-parties), mai
 * lasciati all'AI. I valori dei dati personali scritti dall'AI vengono dalla chat (non
 * verificati) e si tolgono sempre; in una nuova versione (previous) tornano solo quelli gia'
 * salvati, sullo stesso campo.
 */
function withStandardParties(written: Written, kind: DocKind, previous: StructuredDoc | null, terms: TermsPrefill = {}): Written {
  if (kind !== 'contratto' && kind !== 'accordo' && kind !== 'preventivo') return written
  const creator = { name: BUSINESS.name, address: BUSINESS.address, vat: BUSINESS.vat, person: BUSINESS.person }
  const cleared = ensureParties(dropPartyLines(written.doc), creator, { claim: true, clear: true })
  const kept = previous ? carryFieldValues(cleared, previous) : cleared
  // «Termini della collaborazione»: spazi di chi crea (valori gia' scelti o dati da Luca, altrimenti vuoti).
  const before = previous ? readTerms(previous) : null
  const values = { date: before?.date.value || termsDateValue(terms.at), days: before?.days.value || (terms.days ? deliveryText(terms.days) : '') }
  const doc = ensureTerms(ensureParties(tidyFields(kept, { court: BUSINESS.court }), creator, { claim: true }), values)
  return { ...written, doc: withPartiesSection(doc, creator) }
}

/**
 * Valori iniziali dei «Termini della collaborazione» dati da Luca (data e ora locali, giorni).
 * saidAt: data e ora scritte da Luca nei suoi messaggi (vale se l'AI non ne propone una vera).
 */
export type TermsPrefill = { at?: string | null; days?: DeliveryDays | null; saidAt?: string | null }
const termsDateValue = (local?: string | null) => (local && formatCollabDate(local)) || ''
export const isDeliveryDays = (n: unknown): n is DeliveryDays => (DELIVERY_DAYS as readonly unknown[]).includes(n)

/**
 * Scrive un documento nuovo dalla conversazione (o solo dalla richiesta, se non c'e' una
 * conversazione). Contratti e accordi: elementi essenziali controllati (un promemoria se
 * mancano). terms: data e ora e termine di consegna dati da Luca (valori iniziali dei Termini
 * della collaborazione); senza, la data proposta dall'AI vale solo se e' scritta davvero nella
 * richiesta o nella conversazione.
 */
export async function writeDocument(input: {
  kind: DocKind
  title?: string
  instructions: string
  transcript: Transcript | null
  knowledge: string
  terms?: TermsPrefill
}): Promise<Written> {
  const t = input.transcript
  const user = [
    `Tipo di documento: ${input.kind}`,
    input.title ? `Titolo chiesto da Luca: ${input.title}` : '',
    `Richiesta di Luca: ${input.instructions}`,
    businessBlock(input.knowledge),
    t
      ? `Conversazione con ${t.source.name} su ${PLATFORM_LABEL[t.source.platform] || t.source.platform} (${t.source.messages} messaggi, in ordine, ora italiana):\n${t.text}`
      : 'Nessuna conversazione collegata: usa solo la richiesta di Luca e i dati dell’azienda, con spazi da compilare ({{id}} e "fields") per tutto il resto.',
  ]
    .filter(Boolean)
    .join('\n\n')
  const contractLike = input.kind === 'contratto' || input.kind === 'accordo'
  // Elementi essenziali controllati sul testo come sara' salvato (dopo «Le parti» e la pulizia).
  const check = (doc: StructuredDoc) => essentialGaps(withStandardParties({ doc, fromChat: [] }, input.kind, null).doc)
  const written = await askDocument(systemPrompt(input.kind, todayText()), user, contractLike ? check : undefined)
  const source = `${input.instructions}\n${t?.text || ''}`
  const proposed = written.proposedAt && dateInSource(written.proposedAt, source) ? written.proposedAt : null
  return withStandardParties(written, input.kind, null, { at: input.terms?.at || proposed || input.terms?.saidAt || null, days: input.terms?.days ?? null })
}

/** Nuova versione: il documento attuale con la modifica chiesta da Luca, il resto identico. */
export async function reviseDocument(input: {
  kind: DocKind
  current: StructuredDoc
  instructions: string
  transcript: Transcript | null
  knowledge: string
}): Promise<Written> {
  const { footer: _footer, ...current } = input.current
  const t = input.transcript
  const user = [
    `Documento attuale (JSON):\n${JSON.stringify(stripPartiesSection(hideRecipientValues(current), { loose: true })).slice(0, 70_000)}`,
    `Modifica chiesta da Luca: ${input.instructions}`,
    'Restituisci il documento INTERO con la modifica, nello stesso formato JSON. Lascia identico tutto quello che Luca non ha chiesto di cambiare (stessa numerazione, salvo che aggiungere o togliere una clausola la sposti). Tieni gli stessi "fields" e gli stessi {{id}} nel testo (con i loro valori). Le regole sui dati da non inventare valgono anche qui: per un dato nuovo che non è nella conversazione aggiungi un campo in "fields" e scrivi {{id}} nel testo, mai segnaposto come [DA COMPLETARE].',
    businessBlock(input.knowledge),
    t ? `Conversazione di riferimento con ${t.source.name} su ${PLATFORM_LABEL[t.source.platform] || t.source.platform}:\n${t.text}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  const written = await askDocument(systemPrompt(input.kind, todayText()), user)
  return withStandardParties({ ...written, doc: carryFieldValues(written.doc, input.current) }, input.kind, input.current)
}

/** Valori gia' compilati che l'AI ha perso riscrivendo: tornano sullo stesso campo (stesso id). */
export function carryFieldValues(next: StructuredDoc, previous: StructuredDoc): StructuredDoc {
  const old = new Map((previous.fields || []).filter((f) => f.value?.trim()).map((f) => [f.id, f.value!]))
  if (!old.size || !next.fields?.length) return next
  return { ...next, fields: next.fields.map((f) => (!f.value?.trim() && old.has(f.id) ? { ...f, value: old.get(f.id) } : f)) }
}
