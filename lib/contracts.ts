import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'crypto'
import { readSetting, updateSetting } from '@/lib/settings-store'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { SITE_URL } from '@/lib/seo/site'
import { BUSINESS, DOC_KIND_LABEL, carryFieldValues, latestVersion, loadDocument, normalizeFields, sanitizeDoc, type DocKind } from '@/lib/assistant-documents'
import { BLANK_LINE, emptyFieldLabels, fillText, renderPdf, type DocField, type DocSection, type DocSignature, type StructuredDoc } from '@/lib/pdf-doc'
import { cleanValue, dropPartyLines, ensureParties, inputSpec, isSignerField, missingData, partiesSection, partyRoles, recipientNameToken, stripPartiesSection, termsToCreator, tidyFields, CREATOR_SPECS, RECIPIENT_ROLES, type CreatorInfo, type DataEntry, type PartyRole } from '@/lib/contract-parties'
import { CHANNEL_LABEL, SHARE_CHANNELS, STATUS_LABEL, type ContractStatus, type ShareChannel } from '@/lib/contract-text'
import { TERMS_CLAUSES_HEADING, TERMS_DATE_ID, TERMS_HEADING, ensureTerms, isEssentialId, isTermsId, normalizeTermValue, readTerms, termsSection, type TermsInfo } from '@/lib/contract-terms'

// Contratti del sito (area admin): un documento della super chat diventa un contratto
// quando lo si condivide o lo si apre nella pagina Contratti. Chi lo riceve lo apre da
// un link unico (www.facevoice.ai/c/<token>) solo con il PIN scelto da Luca, chiede
// modifiche o firma (tre accettazioni separate, nome scritto e firma col dito). Quando
// hanno firmato tutti e due resta solo la versione firmata con i dati minimi della firma.
//
// Dati delle parti ("Le parti", lib/contract-parties): la controparte scrive i suoi dati
// veri (nome e cognome, codice fiscale, indirizzo...) nella pagina del link, salvati
// mentre scrive. Sono suoi e fanno parte della SUA firma: non entrano nell'impronta del
// testo firmato da chi crea (bodyHash), quindi compilarli dopo la firma di chi crea non
// la invalida. Ogni firma salva l'impronta del testo e quella dei dati di chi firma (con i
// valori al momento della firma); il PDF finale li stampa nel registro delle firme.
//
// «Termini della collaborazione» (lib/contract-terms): subito dopo «Le parti», data e ora
// della collaborazione e termine di consegna dei contenuti (7, 14 o 30 giorni), scelti da chi
// crea. Sono suoi spazi nel testo: entrano nell'impronta che firma, si bloccano alla sua firma
// e finiscono nel registro. Senza tutti e due il contratto non si condivide e non si firma.
//
// Sicurezza: del link si salva solo lo SHA-256 (per trovarlo) e una copia cifrata con
// un segreto del server (per "Copia link"); del PIN solo un hash scrypt con sale. Il PIN
// non passa mai dall'AI, dalla chat, dal messaggio inviato o dai log.
//
// app_settings:
//   contract:site:<id>      -> contratto (versione attuale, richieste, firme, link, eventi)
//   contracts:site          -> elenco (al massimo 300)
//   contract_link:<sha256>  -> { scope, id, gen } per aprire il link
//   contract_notes:site     -> notifiche della campanella (al massimo 60)
//   contract_guard:site     -> tentativi di PIN sbagliati degli ultimi 15 minuti

export const SCOPE = 'site'
const KEY = (id: string) => `contract:${SCOPE}:${id}`
const INDEX_KEY = `contracts:${SCOPE}`
const LINK_PREFIX = 'contract_link:'
const NOTES_KEY = `contract_notes:${SCOPE}`
const GUARD_KEY = `contract_guard:${SCOPE}`

export const CONTRACT_ID_RE = /^k[a-z0-9]{8,40}$/
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/
export const PIN_RE = /^[A-Za-z0-9]{4,12}$/
export const MAX_CONTRACTS = 300
const MAX_REQUESTS = 30
const MAX_OPEN_REQUESTS = 10
const MAX_EVENTS = 80
const MAX_PREVIOUS = 3
const MAX_NOTES = 60
const MAX_RECORD_CHARS = 700_000
export const MAX_REQUEST_CHARS = 2000
export const MAX_NOTE_CHARS = 500
export const MAX_FIELD_VALUE = 300
export const MAX_SIGNER_NAME = 120
/** Firma: tratti e punti massimi dopo la semplificazione. */
export const MAX_STROKES = 60
export const MAX_POINTS = 2500
export const PIN_WINDOW_MS = 15 * 60_000
export const PIN_MAX_PER_LINK = 5
export const PIN_MAX_PER_IP = 20
export const LINK_COOKIE = 'fv_contratto'
export const LINK_COOKIE_TTL_S = 2 * 3600

export { CONTRACT_STATUSES, STATUS_LABEL, SHARE_CHANNELS, CHANNEL_LABEL, SIGNATURE_NOTE } from '@/lib/contract-text'
export type { ContractStatus, ShareChannel } from '@/lib/contract-text'

export type Party = 'creatore' | 'destinatario'
export type ContractVersion = { id: string; n: number; at: string; doc: StructuredDoc; note: string }
export type RequestStatus = 'aperta' | 'accettata' | 'modificata' | 'rifiutata'
export type ChangeRequest = { id: string; at: string; versionN: number; section?: string; text: string; status: RequestStatus; note?: string; decidedAt?: string }
export type ContractSignature = {
  party: Party
  at: string
  name: string
  strokes: number[][]
  ip: string
  device: string
  userAgent: string
  statements: string[]
  versionId: string
  versionN: number
  /** Impronta del testo firmato (testo, dati di chi crea, nomi dei campi; non i dati della controparte). */
  bodyHash?: string
  /** Impronta dei dati scritti da chi firma, con i valori al momento della firma (data). */
  dataHash?: string
  data?: SignedDatum[]
}
export type SignedDatum = { id: string; label: string; value: string }
export type ShareInfo = { gen: string; tokenHash: string; tokenEnc: string; pinHash: string; createdAt: string; channel: ShareChannel; to: string; revokedAt?: string }
export type ContractEvent = { at: string; kind: string; by: Party | 'sistema'; detail?: string }
export type Contract = {
  id: string
  scope: typeof SCOPE
  docId: string | null
  kind: DocKind
  createdAt: string
  updatedAt: string
  createdBy: string | null
  creator: { name: string; address: string; vat: string; person: string; email: string }
  recipient: { name: string; email?: string; platform?: string; contactId?: string }
  status: ContractStatus
  version: ContractVersion
  /** Versioni di prima (al massimo 3): si cancellano quando il contratto e' firmato da tutti. */
  previous: ContractVersion[]
  requests: ChangeRequest[]
  signatures: Partial<Record<Party, ContractSignature>>
  share: ShareInfo | null
  events: ContractEvent[]
  /** Il contratto e' cambiato dopo l'invio: chi lo riceve vede "contratto aggiornato". */
  updatedAt_notice?: string
  final?: { at: string; contentHash: string; signaturesHash: string; requestsDeleted: number; versionsDeleted: number }
  /** Dati "entrambi" (es. luogo e data della firma): ognuno scrive il suo, finche' non firma. */
  signerData?: Partial<Record<Party, Record<string, string>>>
  /** Da quando il contratto ha la sezione "Le parti" (i contratti vecchi la ricevono all'apertura). */
  partiesAt?: string
  /**
   * Aperture del link: l'ultima avvisata a chi crea (condivisione, versione, ora: niente avvisi
   * doppi) e seenAt, l'ultima apertura vista (salvata al massimo ogni pochi minuti).
   */
  opened?: { gen: string; versionN: number; at: string; seenAt?: string }
}

export type IndexItem = { id: string; title: string; recipient: string; status: ContractStatus; docId: string | null; at: string; createdAt: string }

export class ContractError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

const now = () => new Date().toISOString()
const sha256 = (text: string | Buffer) => createHash('sha256').update(text).digest('hex')
export const newContractId = () => `k${Date.now().toString(36)}${randomUUID().replace(/-/g, '').slice(0, 10)}`
const newId = (prefix: string) => `${prefix}${randomUUID().replace(/-/g, '').slice(0, 14)}`

// ---------------------------------------------------------------------
// Lettura e salvataggio
// ---------------------------------------------------------------------

function parseContract(raw: string | null): Contract | null {
  try {
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed.id === 'string' && parsed.version?.doc ? (parsed as Contract) : null
  } catch {
    return null
  }
}

function parseIndex(raw: string | null): { items: IndexItem[] } {
  try {
    const parsed = raw ? JSON.parse(raw) : null
    return { items: Array.isArray(parsed?.items) ? parsed.items.filter((i: Partial<IndexItem>) => typeof i?.id === 'string') : [] }
  } catch {
    return { items: [] }
  }
}

export async function loadContract(id: string): Promise<Contract | null> {
  if (!CONTRACT_ID_RE.test(id)) return null
  return parseContract((await readSetting(KEY(id))).value)
}

export async function listContracts(): Promise<IndexItem[]> {
  const index = parseIndex((await readSetting(INDEX_KEY)).value)
  return [...index.items].sort((a, b) => b.at.localeCompare(a.at))
}

const indexItem = (c: Contract): IndexItem => ({ id: c.id, title: c.version.doc.title, recipient: c.recipient.name, status: c.status, docId: c.docId, at: c.updatedAt, createdAt: c.createdAt })

async function touchIndex(c: Contract) {
  await updateSetting(INDEX_KEY, parseIndex, (index) => ({ items: [...index.items.filter((i) => i.id !== c.id), indexItem(c)].slice(-MAX_CONTRACTS) }))
}

/** Stato che deriva da firme, richieste e link (annullato resta annullato). */
export function deriveStatus(c: Pick<Contract, 'status' | 'signatures' | 'requests' | 'share'>): ContractStatus {
  if (c.status === 'annullato') return 'annullato'
  if (c.signatures.creatore && c.signatures.destinatario) return 'firmato'
  if (c.requests.some((r) => r.status === 'aperta')) return 'modifica_richiesta'
  if (c.signatures.creatore || c.signatures.destinatario) return 'in_firma'
  if (c.share && !c.share.revokedAt) return 'inviato'
  return 'bozza'
}

const addEvent = (c: Contract, kind: string, by: ContractEvent['by'], detail?: string): ContractEvent[] =>
  [...c.events, { at: now(), kind, by, ...(detail ? { detail: detail.slice(0, 200) } : {}) }].slice(-MAX_EVENTS)

/**
 * Modifica sicura del contratto (salvataggio con confronto, come le altre impostazioni).
 * fn lancia ContractError per rifiutare; restituisce il contratto nuovo.
 */
async function mutate(id: string, fn: (c: Contract) => Contract, opts: { index?: boolean } = {}): Promise<Contract> {
  if (!CONTRACT_ID_RE.test(id)) throw new ContractError('Contratto non trovato.', 404)
  let failure: ContractError | null = null
  const saved = await updateSetting<Contract | null>(KEY(id), parseContract, (current) => {
    failure = null
    if (!current) {
      failure = new ContractError('Contratto non trovato.', 404)
      return false
    }
    try {
      // Contratti di prima: ricevono i dati delle parti prima di ogni modifica (testo e firme restano).
      const next = fn(structuredClone(withParties(current)))
      next.status = deriveStatus(next)
      next.updatedAt = now()
      if (JSON.stringify(next).length > MAX_RECORD_CHARS) throw new ContractError('Il contratto è troppo grande per essere salvato: accorcia il testo.', 413)
      return next
    } catch (error) {
      failure = error instanceof ContractError ? error : new ContractError(error instanceof Error ? error.message : 'Errore', 500)
      return false
    }
  })
  if (failure) throw failure
  if (!saved) throw new ContractError('Contratto non trovato.', 404)
  if (opts.index !== false) await touchIndex(saved)
  return saved
}

// ---------------------------------------------------------------------
// Dati delle parti ("Le parti")
// ---------------------------------------------------------------------

const creatorInfo = (c: Pick<Contract, 'creator'>): CreatorInfo => ({ name: c.creator.name, address: c.creator.address, vat: c.creator.vat, person: c.creator.person })
const anySigned = (c: Pick<Contract, 'signatures'>) => Boolean(c.signatures.creatore || c.signatures.destinatario)

/** Firmato dalla controparte con le regole di prima (la sua firma non ha i suoi dati): i suoi dati non si raccolgono piu'. */
const signedBeforeParties = (c: Pick<Contract, 'signatures'>) => {
  const s = c.signatures.destinatario
  return Boolean(s && !s.bodyHash && !s.data)
}

/**
 * Contratto con i dati delle parti: se mancano (contratti di prima) si aggiungono come
 * spazi della controparte, senza cambiare il testo, la versione o le firme. Finche'
 * nessuno ha firmato si toglie anche lo spazio messo subito dopo un dato (es. dopo un
 * numero di telefono non verificato), le righe "Tra:" / "E:" (ci pensa «Le parti») e un
 * dato "entrambi" che e' un termine del contratto passa a chi crea. I contratti firmati da
 * tutti o annullati restano come sono, e anche quelli gia' firmati dalla controparte con le
 * regole di prima (non potrebbe piu' scrivere i suoi dati: per averli serve una nuova versione).
 * Finche' nessuno ha firmato riceve anche gli spazi vuoti dei «Termini della collaborazione»;
 * dopo una firma no (cambierebbe il testo firmato): lo dice termsState (upgrade).
 */
export function withParties(c: Contract): Contract {
  if (c.final || c.status === 'annullato') return c
  const unsigned = !anySigned(c)
  let next = c
  if (!signedBeforeParties(c)) {
    const tidy = unsigned ? dropPartyLines(tidyFields(c.version.doc, { courts: false })) : c.version.doc
    const ensured = ensureParties(tidy, creatorInfo(c), { claim: unsigned, creatorFields: unsigned })
    const doc = unsigned ? termsToCreator(ensured) : ensured
    if (doc !== c.version.doc || !c.partiesAt) next = { ...c, version: doc === c.version.doc ? c.version : { ...c.version, doc }, partiesAt: c.partiesAt || now() }
  }
  // «Termini della collaborazione»: spazi vuoti di chi crea, solo se nessuno ha firmato
  // (dopo una firma servirebbe cambiare il testo firmato: lo fa solo una nuova versione).
  if (unsigned) {
    const doc = ensureTerms(next.version.doc)
    if (doc !== next.version.doc) next = { ...next, version: { ...next.version, doc } }
  }
  return next
}

/**
 * Stato dei «Termini della collaborazione»: upgrade = il contratto non li ha e qualcuno ha
 * gia' firmato (serve una nuova versione, le firme si rifanno); missing = da scegliere.
 * ready: si puo' condividere e firmare.
 */
export function termsState(contract: Contract): TermsInfo & { upgrade: boolean; ready: boolean } {
  const c = withParties(contract)
  const info = readTerms(c.version.doc)
  const closed = Boolean(c.final) || c.status === 'annullato'
  const upgrade = !closed && !info.present
  return { ...info, upgrade, ready: closed || (info.present && info.missing.length === 0) }
}

export const TERMS_UPGRADE_NOTE = 'Mancano data/ora e termine di consegna: crea una nuova versione (le firme si rifanno)'

/** Messaggio per chi vuole condividere o firmare senza i termini (null: a posto). */
export function termsProblem(c: Contract, action: 'condividere' | 'firmare'): string | null {
  const t = termsState(c)
  if (t.upgrade) return `${TERMS_UPGRADE_NOTE}.`
  if (!t.missing.length) return null
  return `Prima di ${action} scegli nei Termini della collaborazione: ${t.missing.map((m) => m.toLowerCase()).join(' e ')}${t.missing.includes('Termine di consegna dei contenuti') ? ' (7, 14 o 30 giorni)' : ''}.`
}

/**
 * Apertura del contratto (pagina di chi crea o del link): se mancano i dati delle parti
 * si salvano subito, senza cambiare data di modifica, versione o firme.
 */
export async function openContract(id: string): Promise<Contract | null> {
  if (!CONTRACT_ID_RE.test(id)) return null
  return updateSetting<Contract | null>(KEY(id), parseContract, (current) => {
    if (!current) return false
    const next = withParties(current)
    if (next === current) return false
    const before = new Set((current.version.doc.fields || []).map((f) => f.id))
    const added = (next.version.doc.fields || []).filter((f) => !before.has(f.id))
    const parties = added.filter((f) => !isTermsId(f.id)).length
    let out = next
    if (parties > 0) out = { ...out, events: addEvent(out, 'dati_parti', 'sistema', `${parties} spazi per i dati delle parti`) }
    if (added.some((f) => isTermsId(f.id))) out = { ...out, events: addEvent(out, 'termini', 'sistema', 'data e ora della collaborazione e termine di consegna, da scegliere') }
    // Una sezione del testo con lo stesso titolo dei termini (clausole vere) resta intera, col titolo nuovo: si dice.
    const clauses = (d: StructuredDoc) => d.sections.filter((x) => (x.heading || '').endsWith(TERMS_CLAUSES_HEADING)).length
    const renamed = clauses(next.version.doc) - clauses(current.version.doc)
    if (renamed > 0) out = { ...out, events: addEvent(out, 'termini', 'sistema', `sezione «${TERMS_HEADING}» del testo rinominata «${TERMS_CLAUSES_HEADING}» (testo uguale)`) }
    return out
  })
}

/**
 * Testo del contratto pronto per essere salvato (nessuno ha firmato): senza la sezione "Le
 * parti" e le righe "Tra:" / "E:" scritte nel documento, spazi messi bene, dati delle parti
 * garantiti, termini "entrambi" (data di inizio, durata...) scritti da chi crea.
 */
function prepareBody(doc: StructuredDoc, creator: CreatorInfo, clear: boolean): StructuredDoc {
  const base = dropPartyLines(doc)
  // Prima si tolgono i valori della chat (cosi' uno spazio dopo un dato si riconosce come vuoto), poi la pulizia.
  const cleared = clear ? ensureParties(base, creator, { claim: true, clear: true }) : base
  return ensureTerms(termsToCreator(ensureParties(tidyFields(cleared, { court: BUSINESS.court }), creator, { claim: true, creatorFields: true })))
}

/**
 * I dati della controparte li scrive solo lei (pagina del link o firma): in una nuova
 * versione i valori dei suoi campi vengono dal contratto salvato (stesso id), mai dal testo
 * mandato (proposta dell'AI o pagina aperta prima che lei li cambiasse).
 */
function keepRecipientValues(doc: StructuredDoc, current: StructuredDoc): StructuredDoc {
  const saved = new Map((current.fields || []).filter((f) => f.party === 'destinatario' && f.value?.trim()).map((f) => [f.id, f.value as string]))
  return {
    ...doc,
    fields: (doc.fields || []).map((f) => {
      if (f.party !== 'destinatario') return f
      const { value: _sent, ...rest } = f
      const value = saved.get(f.id)
      return value ? { ...rest, value } : rest
    }),
  }
}

/** Valore di un dato della controparte (nome, codice fiscale...) gia' scritto, o ''. */
function identityValue(c: Pick<Contract, 'version'>, role: PartyRole): string {
  const id = partyRoles(c.version.doc)[role]
  return id ? (c.version.doc.fields || []).find((f) => f.id === id)?.value?.trim() || '' : ''
}

/** Nome della controparte: quello che ha scritto nei suoi dati, altrimenti quello dato alla condivisione. */
const recipientLabel = (c: Contract, fallback = c.recipient.name) => identityValue(c, 'nome') || fallback

export type FillEntry = DataEntry & { party: DocField['party']; kind: 'body' | 'own'; value: string; input: 'text' | 'email' | 'tel'; autoComplete: string }

/**
 * Dati di una parte (senza guardare se ha gia' firmato): per chi riceve i suoi (prima
 * quelli di "Le parti") e la sua parte dei dati "entrambi"; per chi crea i suoi, che sono
 * nel testo e si fermano alla prima firma di chi riceve, e la sua parte dei dati "entrambi".
 */
function dataEntries(c: Contract, party: Party): FillEntry[] {
  const fields = c.version.doc.fields || []
  const roles = partyRoles(c.version.doc)
  const roleById = new Map(Object.entries(roles).map(([role, id]) => [id as string, role as PartyRole]))
  const rank = (id: string) => {
    const role = roleById.get(id)
    return role ? RECIPIENT_ROLES.findIndex((r) => r.role === role) : RECIPIENT_ROLES.length
  }
  const own = c.signerData?.[party] || {}
  const out: FillEntry[] = []
  if (party === 'destinatario') {
    const mine = fields.filter((f) => f.party === 'destinatario').sort((a, b) => rank(a.id) - rank(b.id))
    for (const f of mine) {
      const role = roleById.get(f.id)
      out.push({ id: f.id, label: f.label, party: f.party, kind: 'own', value: f.value || '', role, required: Boolean(role && RECIPIENT_ROLES.find((r) => r.role === role)?.required), ...inputSpec(role) })
    }
  } else if (!c.signatures.destinatario) {
    for (const f of fields.filter((x) => x.party === 'creatore')) {
      out.push({ id: f.id, label: f.label, party: f.party, kind: 'body', value: f.value || '', required: CREATOR_SPECS.some((x) => x.id === f.id) || isTermsId(f.id) || isEssentialId(f.id), ...inputSpec(undefined) })
    }
  }
  // "Entrambi" di un firmatario (luogo e data della firma...): ognuno il suo. Gli altri sono termini del contratto (di chi crea).
  for (const f of fields) {
    if (f.party === 'entrambi' && !f.value?.trim() && isSignerField(f)) out.push({ id: f.id, label: f.label, party: f.party, kind: 'own', value: own[f.id] || '', required: false, ...inputSpec(undefined) })
  }
  return out
}

/** Dati che una parte puo' scrivere o cambiare adesso (niente dopo la sua firma). */
export function fillable(c: Contract, party: Party): FillEntry[] {
  if (c.final || c.status === 'annullato' || c.signatures[party]) return []
  return dataEntries(c, party)
}

/** Dati obbligatori ancora vuoti di una parte (etichette). */
export function missingFor(c: Contract, party: Party): string[] {
  const entries = fillable(c, party)
  const byId = new Map(entries.map((e) => [e.id, e.value]))
  return missingData(entries, (id) => byId.get(id) || '').map((e) => e.label)
}

/**
 * Scrive i dati mandati da una parte (solo quelli che puo' scrivere adesso; gli altri si
 * ignorano). Un dato di chi crea arrivato da una pagina vecchia, dopo la firma di chi
 * riceve, fa ricaricare. bodyChanged: e' cambiato un dato che sta nel testo (di chi crea).
 */
function applyValues(c: Contract, party: Party, raw: unknown): { contract: Contract; bodyChanged: boolean; changed: number } {
  const none = { contract: c, bodyChanged: false, changed: 0 }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return none
  const entries = new Map(fillable(c, party).map((e) => [e.id, e]))
  let fields = c.version.doc.fields || []
  const own = { ...(c.signerData?.[party] || {}) }
  let bodyChanged = false
  let changed = 0
  for (const [id, raw2] of Object.entries(raw as Record<string, unknown>).slice(0, 80)) {
    if (typeof raw2 !== 'string') continue
    let value = cleanValue(raw2, MAX_FIELD_VALUE)
    const entry = entries.get(id)
    if (isTermsId(id) && party === 'creatore') {
      // Termini della collaborazione (solo chi crea): una data e ora vera (o "nessuna") e 7, 14 o 30 giorni (o "nessun termine").
      const normal = normalizeTermValue(id, value)
      if (normal === null) throw new ContractError(id === TERMS_DATE_ID ? 'Data e ora della collaborazione non valide.' : 'Il termine di consegna può essere 7, 14 o 30 giorni (oppure nessun termine).')
      value = normal
    }
    if (!entry) {
      const f = fields.find((x) => x.id === id)
      if (party === 'creatore' && f?.party === 'creatore' && value && (f.value || '') !== value) throw new ContractError('Il contratto è cambiato mentre lo leggevi: ricarica la pagina e rileggilo prima di firmare.', 409)
      continue
    }
    if (entry.value === value) continue
    changed++
    if (entry.party === 'entrambi') {
      if (value) own[id] = value
      else delete own[id]
      continue
    }
    if (entry.kind === 'body') bodyChanged = true
    fields = fields.map((f) => {
      if (f.id !== id) return f
      const { value: _old, ...rest } = f
      return value ? { ...rest, value } : rest
    })
  }
  if (!changed) return none
  return { contract: { ...c, version: { ...c.version, doc: { ...c.version.doc, fields } }, signerData: { ...(c.signerData || {}), [party]: own } }, bodyChanged, changed }
}

/**
 * Dati scritti da chi firma, al momento della firma (per il registro e la sua impronta). Per
 * chi crea anche i «Termini della collaborazione» (data e ora, termine di consegna) che firma.
 */
function signedData(c: Contract, party: Party): SignedDatum[] {
  const terms = party === 'creatore' ? (c.version.doc.fields || []).filter((f) => isTermsId(f.id)).map((f) => ({ id: f.id, label: f.label, value: f.value?.trim() || '' })) : []
  return [
    ...terms,
    ...dataEntries(c, party)
      .filter((e) => e.kind === 'own')
      .map((e) => ({ id: e.id, label: e.label, value: e.value })),
  ]
}

/** "Entrambi": ognuno il suo valore; nel testo escono tutti e due con il nome di chi l'ha scritto. */
function shownFields(c: Contract): DocField[] {
  const data = c.signerData || {}
  const other = recipientLabel(c, 'la controparte')
  return (c.version.doc.fields || []).map((f) => {
    if (f.party !== 'entrambi' || f.value?.trim() || !isSignerField(f)) return f
    const mine = data.creatore?.[f.id]?.trim() || ''
    const theirs = data.destinatario?.[f.id]?.trim() || ''
    if (!mine && !theirs) return f
    return { ...f, value: mine && theirs && mine === theirs ? mine : `${mine || BLANK_LINE} (${c.creator.name}); ${theirs || BLANK_LINE} (${other})` }
  })
}

/** Dati che la controparte ha scritto (anche dopo la sua firma), per la pagina di chi crea. */
function recipientData(c: Contract) {
  return dataEntries(c, 'destinatario').map((e) => ({ id: e.id, label: e.label, value: e.value, required: e.required, ...(e.role ? { role: e.role } : {}), shared: e.party === 'entrambi' }))
}

// ---------------------------------------------------------------------
// Creazione dal documento
// ---------------------------------------------------------------------

/** Contratto gia' nato da questo documento (non annullato), se c'e'. */
export async function contractForDocument(docId: string): Promise<IndexItem | null> {
  return (await listContracts()).find((i) => i.docId === docId && i.status !== 'annullato') ?? null
}

function guessRecipientName(doc: StructuredDoc, fallback: string | null): string {
  if (fallback?.trim()) return fallback.trim().slice(0, 120)
  const sig = (doc.signatures || []).find((s) => s.party === 'destinatario' || !/facevoice/i.test(`${s.label} ${s.name || ''}`))
  const name = sig?.name && !/\{\{/.test(sig.name) ? sig.name : ''
  return (name || 'Destinatario').slice(0, 120)
}

/**
 * Il documento diventa un contratto (una volta sola: se c'e' gia', si riapre quello).
 * Si parte dall'ultima versione del documento.
 */
export async function contractFromDocument(docId: string, by: string | null): Promise<Contract> {
  const existing = await contractForDocument(docId)
  if (existing) {
    const c = await loadContract(existing.id)
    if (c) return c
  }
  const record = await loadDocument(docId)
  if (!record) throw new ContractError('Documento non trovato.', 404)
  const version = latestVersion(record)
  const creator = { name: BUSINESS.name, address: BUSINESS.address, vat: BUSINESS.vat, person: BUSINESS.person, email: BUSINESS.email }
  // Dati delle parti dal server: i valori dei dati personali scritti dall'AI vengono dalla chat (non verificati) e si tolgono.
  const doc = prepareBody(normalizeFields(version.doc, version.doc.fields || []), creator, true)
  const list = await listContracts()
  if (list.length >= MAX_CONTRACTS) {
    // Pieno: si fa posto togliendo la bozza o l'annullato piu' vecchio (mai i firmati).
    const old = [...list].reverse().find((i) => i.status === 'bozza' || i.status === 'annullato')
    if (!old) throw new ContractError(`Hai già ${MAX_CONTRACTS} contratti: cancella qualche bozza prima di crearne altri.`, 409)
    await deleteContractRecord(old.id)
  }
  const at = now()
  const source = record.basedOn
  const c: Contract = {
    id: newContractId(),
    scope: SCOPE,
    docId: record.id,
    kind: record.kind,
    createdAt: at,
    updatedAt: at,
    createdBy: by,
    creator,
    recipient: {
      name: guessRecipientName(doc, source?.name ?? null),
      ...(source?.platform === 'email' ? { email: source.contactId.toLowerCase() } : {}),
      ...(source ? { platform: source.platform, contactId: source.contactId } : {}),
    },
    status: 'bozza',
    version: { id: newId('v'), n: 1, at, doc, note: 'dal documento' },
    previous: [],
    requests: [],
    signatures: {},
    share: null,
    events: [{ at, kind: 'creato', by: 'creatore', detail: `dal documento «${doc.title.slice(0, 80)}»` }],
    partiesAt: at,
  }
  await updateSetting<Contract | null>(KEY(c.id), parseContract, () => c)
  await touchIndex(c)
  return c
}

/** Nome, email e canale di chi riceve (dalla pagina Contratti o dalla condivisione). */
export async function setRecipient(id: string, input: { name?: string; email?: string | null; platform?: string; contactId?: string }): Promise<Contract> {
  return mutate(id, (c) => {
    const name = typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ').trim().slice(0, 120) : undefined
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : input.email
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ContractError('Email non valida.')
    return {
      ...c,
      recipient: {
        ...c.recipient,
        ...(name ? { name } : {}),
        ...(email ? { email } : email === null ? { email: undefined } : {}),
        ...(input.platform && input.contactId ? { platform: input.platform, contactId: input.contactId.slice(0, 200) } : {}),
      },
    }
  })
}

// ---------------------------------------------------------------------
// Testo da mostrare (uguale nella pagina web e nel PDF)
// ---------------------------------------------------------------------

/** Titoli delle clausole da approvare in modo specifico (artt. 1341 e 1342 c.c.). */
export function approvalTitles(doc: StructuredDoc): string[] {
  return doc.sections
    .map((s, i) => (s.specificApproval ? fillText(s.heading || `Clausola ${i + 1}`, doc.fields) : ''))
    .filter(Boolean)
    .slice(0, 20)
}

export const STATEMENT_READ = 'Ho letto integralmente il contratto e ne accetto tutti i punti'
export const STATEMENT_SIGN = 'Firmo con firma elettronica semplice e confermo che i dati inseriti sono veri'
export function statementApproval(titles: string[]) {
  return titles.length ? `Approvo specificamente le clausole indicate (artt. 1341 e 1342 c.c.): ${titles.join('; ')}` : 'Approvo ogni punto del contratto, uno per uno'
}
export const statementsFor = (doc: StructuredDoc) => [STATEMENT_READ, statementApproval(approvalTitles(doc)), STATEMENT_SIGN]

const romeFull = (iso: string) =>
  new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })

/** Le due caselle di firma: chi crea e chi riceve (con la firma disegnata, se c'e'). Sotto la linea della controparte il suo "Nome e cognome". */
function signatureBoxes(c: Contract): DocSignature[] {
  const sigs = c.version.doc.signatures || []
  const mine = sigs.find((s) => s.party === 'creatore') || sigs.find((s) => /facevoice/i.test(`${s.label} ${s.name || ''}`))
  const theirs = sigs.find((s) => s !== mine && s.party !== 'creatore')
  const drawn = (p: Party) => {
    const s = c.signatures[p]
    return s ? { signed: { name: s.name, at: s.at, strokes: s.strokes } } : {}
  }
  return [
    { label: mine?.label || `Per ${c.creator.name}`, name: mine?.name || c.creator.person, party: 'creatore', ...drawn('creatore') },
    { label: theirs?.label || 'Il destinatario', name: (c.partiesAt && recipientNameToken(c.version.doc)) || theirs?.name || c.recipient.name, party: 'destinatario', ...drawn('destinatario') },
  ]
}

/** Controparte per il registro: nome, ragione sociale, codice fiscale e residenza che ha scritto. */
function recipientSummary(c: Contract): string {
  const v = (role: PartyRole) => identityValue(c, role)
  return [v('nome') || c.recipient.name, v('azienda'), v('cf') && `codice fiscale ${v('cf')}`, v('indirizzo') && `residente in ${v('indirizzo')}`].filter(Boolean).join(', ')
}

/** Pagina finale "Registro delle firme": parti, ora, IP, dispositivo, dati scritti, dichiarazioni, impronte. */
function signatureRegister(c: Contract): DocSection[] {
  if (!c.final) return []
  const out: DocSection[] = [
    {
      heading: 'Registro delle firme',
      paragraphs: [
        `Contratto: ${fillText(c.version.doc.title, c.version.doc.fields)} (versione ${c.version.n}).`,
        `Parti: ${c.creator.name}, ${c.creator.address}, P.IVA ${c.creator.vat}; ${recipientSummary(c)}.`,
        'Tipo di firma: firma elettronica semplice, con tre accettazioni separate, nome scritto e firma tracciata a mano sullo schermo. Orari in ora italiana (Europe/Rome).',
      ],
    },
  ]
  for (const party of ['creatore', 'destinatario'] as Party[]) {
    const s = c.signatures[party]
    if (!s) continue
    out.push({
      heading: party === 'creatore' ? `Firma di ${c.creator.name}` : `Firma di ${s.name}`,
      paragraphs: [
        `Nome scritto: ${s.name}`,
        `Data e ora: ${romeFull(s.at)}`,
        `Indirizzo IP: ${s.ip}`,
        `Dispositivo: ${s.device}`,
        // Dati scritti da chi firma, come erano al momento della firma.
        ...(s.data?.length ? [`Dati scritti da chi firma: ${s.data.map((d) => `${d.label}: ${d.value || 'non scritto'}`).join('; ')}.`] : []),
        ...(s.bodyHash ? [`Impronta del testo firmato (SHA-256): ${s.bodyHash}`] : []),
        ...(s.dataHash ? [`Impronta dei dati scritti (SHA-256): ${s.dataHash}`] : []),
        'Dichiarazioni accettate una per una:',
      ],
      bullets: s.statements,
    })
  }
  out.push({
    heading: 'Impronte di controllo (SHA-256)',
    paragraphs: [`Contenuto finale del contratto: ${c.final.contentHash}`, `Firme: ${c.final.signaturesHash}`, `Completato il ${romeFull(c.final.at)}.`],
  })
  return out
}

/** Documento da mostrare: testo, approvazione specifica, caselle di firma ed eventuale registro. */
export function contractDoc(contract: Contract): StructuredDoc {
  const c = withParties(contract)
  const d = stripPartiesSection(c.version.doc)
  // "Le parti" in cima (dopo titolo e righe sotto): chi crea e i dati della controparte; subito dopo i «Termini della collaborazione».
  const sections = [...(c.partiesAt ? [partiesSection(d, creatorInfo(c))] : []), ...(readTerms(d).present ? [termsSection()] : []), ...d.sections]
  const titles = approvalTitles(d)
  if (titles.length) {
    sections.push({
      heading: 'Approvazione specifica delle clausole',
      paragraphs: [`Ai sensi e per gli effetti degli artt. 1341 e 1342 del Codice civile, le parti dichiarano di aver letto e di approvare specificamente le seguenti clausole: ${titles.join('; ')}.`],
    })
  }
  const register = signatureRegister(c)
  return {
    title: d.title,
    ...(d.subtitle ? { subtitle: d.subtitle } : {}),
    meta: d.meta || [],
    sections,
    fields: shownFields(c),
    signatures: signatureBoxes(c),
    ...(register.length ? { appendix: register } : {}),
  }
}

/** Contenuto che conta per l'impronta: testo e dati compilati (non le firme). */
export function contentHash(doc: StructuredDoc): string {
  const canonical = {
    title: doc.title,
    subtitle: doc.subtitle || '',
    meta: doc.meta || [],
    sections: doc.sections.map((s) => ({ heading: s.heading || '', paragraphs: s.paragraphs || [], bullets: s.bullets || [], approval: Boolean(s.specificApproval) })),
    fields: (doc.fields || []).map((f) => ({ id: f.id, label: f.label, party: f.party, value: f.value || '' })),
  }
  return sha256(JSON.stringify(canonical))
}

/**
 * Impronta del testo firmato: testo, dati di chi crea (anche quelli dell'azienda in "Le
 * parti") e nomi dei campi "entrambi". Non i dati della controparte (sono suoi e fanno parte
 * della sua firma) e non i valori "entrambi" dei firmatari (ognuno il suo). Resta uguale quando la
 * controparte scrive i suoi dati dopo la firma di chi crea, e nel contratto finale.
 */
export function bodyHash(c: Pick<Contract, 'version' | 'creator'>): string {
  const d = stripPartiesSection(c.version.doc)
  const canonical = {
    title: d.title,
    subtitle: d.subtitle || '',
    meta: d.meta || [],
    sections: d.sections.map((s) => ({ heading: s.heading || '', paragraphs: s.paragraphs || [], bullets: s.bullets || [], approval: Boolean(s.specificApproval) })),
    creator: { name: c.creator.name, address: c.creator.address || '', vat: c.creator.vat || '', person: c.creator.person || '' },
    // Valori "entrambi" di un firmatario: ognuno il suo (fuori). Un termine "entrambi" di prima: nel testo.
    fields: (d.fields || []).filter((f) => f.party !== 'destinatario').map((f) => ({ id: f.id, label: f.label, party: f.party, value: f.party === 'entrambi' && isSignerField(f) ? '' : f.value || '' })),
  }
  return sha256(JSON.stringify(canonical))
}

/** Impronta dei dati scritti da chi firma (con i valori di quel momento). */
export const dataHash = (data: SignedDatum[]) => sha256(JSON.stringify(data.map((d) => ({ id: d.id, label: d.label, value: d.value }))))

export function signaturesHash(signatures: Contract['signatures']): string {
  const list = (['creatore', 'destinatario'] as Party[])
    .map((p) => signatures[p])
    .filter((s): s is ContractSignature => Boolean(s))
    .map((s) => ({
      party: s.party,
      name: s.name,
      at: s.at,
      ip: s.ip,
      device: s.device,
      statements: s.statements,
      strokes: s.strokes,
      versionId: s.versionId,
      ...(s.bodyHash ? { bodyHash: s.bodyHash } : {}),
      ...(s.dataHash ? { dataHash: s.dataHash } : {}),
    }))
  return sha256(JSON.stringify(list))
}

export function contractPdf(c: Contract) {
  const watermark = c.status === 'firmato' ? undefined : c.status === 'annullato' ? 'ANNULLATO – non valido' : 'BOZZA – non firmato'
  return renderPdf(contractDoc(c), { createdAt: new Date(c.final?.at || c.version.at), ...(watermark ? { watermark } : {}) })
}

// ---------------------------------------------------------------------
// Firma disegnata col dito
// ---------------------------------------------------------------------

type Pt = [number, number]
/** Ramer-Douglas-Peucker: toglie i punti che non cambiano la forma (tolleranza in millesimi). */
function simplify(points: Pt[], epsilon: number): Pt[] {
  if (points.length < 3) return points
  const [ax, ay] = points[0]
  const [bx, by] = points[points.length - 1]
  const len = Math.hypot(bx - ax, by - ay) || 1
  let maxDist = 0
  let index = 0
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i]
    const dist = Math.abs((by - ay) * px - (bx - ax) * py + bx * ay - by * ax) / len
    if (dist > maxDist) {
      maxDist = dist
      index = i
    }
  }
  if (maxDist <= epsilon) return [points[0], points[points.length - 1]]
  return [...simplify(points.slice(0, index + 1), epsilon).slice(0, -1), ...simplify(points.slice(index), epsilon)]
}

/**
 * Tratti puliti: numeri interi da 0 a 1000, semplificati, entro i limiti. null se la
 * firma e' vuota (nessun tratto vero: almeno 2 punti e un segno largo o alto abbastanza).
 */
export function cleanStrokes(input: unknown): number[][] | null {
  if (!Array.isArray(input)) return null
  const out: number[][] = []
  let total = 0
  let minX = 1000
  let maxX = 0
  let minY = 1000
  let maxY = 0
  for (const raw of input.slice(0, MAX_STROKES * 2)) {
    if (!Array.isArray(raw) || out.length >= MAX_STROKES || total >= MAX_POINTS) break
    const pts: Pt[] = []
    for (let i = 0; i + 1 < Math.min(raw.length, 4000); i += 2) {
      const x = Number(raw[i])
      const y = Number(raw[i + 1])
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      pts.push([Math.round(Math.min(1000, Math.max(0, x))), Math.round(Math.min(1000, Math.max(0, y)))])
    }
    if (!pts.length) continue
    const simple = simplify(pts, 2.5).slice(0, Math.max(1, MAX_POINTS - total))
    total += simple.length
    for (const [x, y] of simple) {
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
    out.push(simple.flat())
  }
  if (!out.length || total < 2 || (maxX - minX < 15 && maxY - minY < 15)) return null
  return out
}

/** Sistema e browser dal user agent, in parole semplici ("Safari su iPhone"). */
export function deviceOf(ua: string): string {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'sistema sconosciuto'
  const browser = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'browser'
  return `${browser} su ${os}`
}

export type SignInput = {
  versionId: string
  name: string
  accepted: unknown
  strokes: unknown
  values?: unknown
  ip: string
  userAgent: string
}

/**
 * Firma di una parte: tre accettazioni tutte vere, firma disegnata non vuota, i dati
 * obbligatori di chi firma (per chi riceve: nome e cognome, codice fiscale, indirizzo),
 * sulla versione mostrata (se il testo e' cambiato si rifiuta: va ricaricato). Chi riceve
 * firma col nome e cognome che ha scritto nei suoi dati. I dati di chi riceve non sono nel
 * testo firmato da chi crea: scriverli dopo la firma di chi crea non la invalida.
 */
export async function signContract(id: string, party: Party, input: SignInput): Promise<{ contract: Contract; completed: boolean }> {
  const typed = String(input.name || '').replace(/\s+/g, ' ').trim()
  const accepted = Array.isArray(input.accepted) ? input.accepted : []
  if (accepted.length !== 3 || !accepted.every((a) => a === true)) throw new ContractError('Per firmare servono tutte e tre le conferme.')
  const strokes = cleanStrokes(input.strokes)
  if (!strokes) throw new ContractError('Fai la tua firma col dito nel riquadro.')
  let completed = false
  const saved = await mutate(id, (c) => {
    if (c.status === 'annullato') throw new ContractError('Questo contratto è stato annullato.', 409)
    if (c.status === 'firmato' || c.final) throw new ContractError('Il contratto è già firmato da tutti.', 409)
    if (c.signatures[party]) throw new ContractError('Hai già firmato questo contratto.', 409)
    if (input.versionId !== c.version.id) throw new ContractError('Il contratto è cambiato mentre lo leggevi: ricarica la pagina e rileggilo prima di firmare.', 409)
    if (party === 'destinatario' && (!c.share || c.share.revokedAt)) throw new ContractError('Link non valido.', 404)
    const applied = applyValues(c, party, input.values)
    // I dati di chi crea sono nel testo: compilati alla firma, l'altra parte firma la versione nuova.
    let next: Contract = applied.bodyChanged ? { ...applied.contract, version: { ...applied.contract.version, id: newId('v') } } : applied.contract
    // Termini della collaborazione: chi crea non firma senza (o senza la sezione: nuova versione); chi riceve
    // non firma termini vuoti, ne' un contratto di prima senza termini (si completa con la nuova versione).
    const terms = termsState(next)
    if (party === 'creatore') {
      const problem = termsProblem(next, 'firmare')
      if (problem) throw new ContractError(problem, terms.upgrade ? 409 : 400)
    } else if (!terms.ready) {
      throw new ContractError(`Il contratto non è ancora pronto: ${c.creator.name} deve scegliere data e termine di consegna. Riprova più tardi.`, 409)
    }
    const missing = missingFor(next, party)
    if (missing.length) throw new ContractError(`Prima di firmare scrivi: ${missing.join(', ')}.`)
    const name = (party === 'destinatario' && identityValue(next, 'nome')) || typed
    if (name.length < 3 || name.length > MAX_SIGNER_NAME) throw new ContractError('Scrivi il tuo nome e cognome per firmare.')
    const body = bodyHash(next)
    const other = c.signatures[party === 'creatore' ? 'destinatario' : 'creatore']
    // L'altra parte ha firmato questo stesso testo (succede sempre: il testo si blocca alla prima firma).
    if (other?.bodyHash && other.bodyHash !== body) throw new ContractError('Il contratto è cambiato mentre lo leggevi: ricarica la pagina e rileggilo prima di firmare.', 409)
    const data = signedData(next, party)
    const at = now()
    const signature: ContractSignature = {
      party,
      at,
      name,
      strokes,
      ip: input.ip,
      device: deviceOf(input.userAgent),
      userAgent: input.userAgent.slice(0, 300),
      statements: statementsFor(next.version.doc),
      versionId: next.version.id,
      versionN: next.version.n,
      bodyHash: body,
      data,
      dataHash: dataHash(data),
    }
    next = {
      ...next,
      signatures: { ...next.signatures, [party]: signature },
      events: addEvent(c, 'firma', party, `${name}${applied.changed ? ` (compilati ${applied.changed} dati)` : ''}`),
    }
    if (next.signatures.creatore && next.signatures.destinatario) {
      completed = true
      next = finalize(next)
    }
    return next
  })
  return { contract: saved, completed }
}

/**
 * Firmato da tutti: impronte del contenuto e delle firme; si cancellano le versioni di
 * prima e le richieste di modifica (restano solo i conteggi e gli eventi minimi).
 */
function finalize(signed: Contract): Contract {
  const at = now()
  // I valori "entrambi" di tutti e due entrano nel testo finale (e nella sua impronta).
  const c: Contract = { ...signed, version: { ...signed.version, doc: { ...signed.version.doc, fields: shownFields(signed) } }, signerData: undefined }
  const final = {
    at,
    contentHash: contentHash(c.version.doc),
    signaturesHash: signaturesHash(c.signatures),
    requestsDeleted: c.requests.length,
    versionsDeleted: c.previous.length,
  }
  return {
    ...c,
    previous: [],
    requests: [],
    updatedAt_notice: undefined,
    final,
    // Eventi minimi: niente testi delle richieste, solo cosa e quando.
    events: addEvent({ ...c, events: c.events.map((e) => ({ at: e.at, kind: e.kind, by: e.by, ...(e.kind === 'firma' || e.kind === 'creato' || e.kind.startsWith('link') ? { detail: e.detail } : {}) })) }, 'completato', 'sistema'),
  }
}

// ---------------------------------------------------------------------
// Dati da compilare, richieste di modifica, nuove versioni
// ---------------------------------------------------------------------

/**
 * Chi crea compila i suoi dati: quelli nel testo finche' nessuno ha firmato, la sua parte
 * dei dati "entrambi" finche' non firma lui.
 */
export async function setCreatorFields(id: string, values: Record<string, unknown>): Promise<Contract> {
  return mutate(id, (c) => {
    if (c.status === 'annullato' || c.final) throw new ContractError('Il contratto non si può più cambiare.', 409)
    if (c.signatures.creatore) throw new ContractError('Hai già firmato: i tuoi dati non si cambiano più.', 409)
    if (c.signatures.destinatario) {
      const sent = (f: DocField) => {
        const v = cleanValue(values[f.id], MAX_FIELD_VALUE)
        return isTermsId(f.id) ? normalizeTermValue(f.id, v) ?? v : v
      }
      const body = (c.version.doc.fields || []).some((f) => f.party === 'creatore' && f.id in values && sent(f) !== (f.value || ''))
      if (body) throw new ContractError(`${recipientLabel(c)} ha già firmato: i dati nel testo non si cambiano più (serve una nuova versione).`, 409)
    }
    const { contract, bodyChanged, changed } = applyValues(c, 'creatore', values)
    if (!changed) return c
    return { ...contract, version: bodyChanged ? { ...contract.version, id: newId('v') } : contract.version, events: addEvent(c, 'dati_compilati', 'creatore') }
  })
}

/**
 * Dati della controparte dalla pagina del link, salvati mentre scrive (bozza): si vedono
 * subito nel testo e nella pagina di chi crea. Si possono cambiare fino alla sua firma,
 * anche dopo la firma di chi crea (non sono nel testo che ha firmato).
 */
export async function saveRecipientData(id: string, values: unknown): Promise<Contract> {
  return mutate(
    id,
    (c) => {
      if (c.status === 'annullato' || c.final) throw new ContractError('Il contratto non si può più cambiare.', 409)
      if (!c.share || c.share.revokedAt) throw new ContractError('Link non valido.', 404)
      if (c.signatures.destinatario) throw new ContractError('Hai già firmato: i tuoi dati non si cambiano più.', 409)
      return applyValues(c, 'destinatario', values).contract
    },
    { index: false }
  )
}

/** "Richiedi modifica" dalla pagina del link. */
export async function addChangeRequest(id: string, input: { text: unknown; section?: unknown }): Promise<{ contract: Contract; request: ChangeRequest }> {
  const text = typeof input.text === 'string' ? input.text.trim().slice(0, MAX_REQUEST_CHARS) : ''
  if (text.length < 3) throw new ContractError('Scrivi cosa vorresti cambiare.')
  const section = typeof input.section === 'string' ? input.section.trim().slice(0, 160) : ''
  let created: ChangeRequest | null = null
  const contract = await mutate(id, (c) => {
    if (c.status === 'annullato' || c.final) throw new ContractError('Il contratto non si può più cambiare.', 409)
    if (!c.share || c.share.revokedAt) throw new ContractError('Link non valido.', 404)
    if (c.requests.filter((r) => r.status === 'aperta').length >= MAX_OPEN_REQUESTS) throw new ContractError('Hai già inviato molte richieste: aspetta la risposta prima di mandarne altre.', 429)
    if (section && !c.version.doc.sections.some((s) => s.heading && fillText(s.heading, c.version.doc.fields) === section)) throw new ContractError('Sezione non trovata.')
    created = { id: newId('r'), at: now(), versionN: c.version.n, ...(section ? { section } : {}), text, status: 'aperta' }
    // Si tengono le ultime 30: prima si tolgono quelle gia' decise.
    let requests = [...c.requests, created]
    while (requests.length > MAX_REQUESTS) {
      const i = requests.findIndex((r) => r.status !== 'aperta')
      requests.splice(i >= 0 ? i : 0, 1)
    }
    return { ...c, requests, events: addEvent(c, 'modifica_richiesta', 'destinatario', section || undefined) }
  })
  return { contract, request: created! }
}

/** "Rifiuta": il testo resta com'e'; la nota (facoltativa) si vede nella pagina del link. */
export async function rejectRequest(id: string, requestId: string, note: unknown): Promise<Contract> {
  const clean = typeof note === 'string' ? note.trim().slice(0, MAX_NOTE_CHARS) : ''
  return mutate(id, (c) => {
    const r = c.requests.find((x) => x.id === requestId)
    if (!r) throw new ContractError('Richiesta non trovata.', 404)
    if (r.status !== 'aperta') throw new ContractError('Questa richiesta ha già una risposta.', 409)
    return {
      ...c,
      requests: c.requests.map((x) => (x.id === requestId ? { ...x, status: 'rifiutata' as const, decidedAt: now(), ...(clean ? { note: clean } : {}) } : x)),
      events: addEvent(c, 'modifica_rifiutata', 'creatore'),
    }
  })
}

/** Documento mandato dalla pagina (anteprima AI o modifica a mano): ripulito come quello dell'AI. */
export function cleanIncomingDoc(raw: unknown, current: StructuredDoc): StructuredDoc {
  if (!raw || typeof raw !== 'object') throw new ContractError('Testo del contratto mancante.')
  const r = raw as Record<string, unknown>
  const clean = sanitizeDoc({
    ...r,
    sections: Array.isArray(r.sections) ? r.sections.map((s) => (s && typeof s === 'object' ? { ...(s as object), specific_approval: (s as DocSection).specificApproval ?? (s as Record<string, unknown>).specific_approval } : s)) : r.sections,
    fields: r.fields ?? current.fields,
    signatures: r.signatures ?? current.signatures,
  })
  if (!clean) throw new ContractError('Il testo del contratto non è valido: manca il titolo o il testo.')
  return carryFieldValues(clean.doc, current)
}

/**
 * Nuova versione (modifica accettata o fatta a mano): le firme gia' date si cancellano,
 * chi riceve vede "contratto aggiornato". requestId: la richiesta a cui risponde.
 */
export async function applyNewVersion(id: string, input: { doc: unknown; requestId?: string; mode: 'accettata' | 'modificata'; note?: string; by: string | null; baseVersionId?: string }): Promise<Contract> {
  return mutate(id, (c) => {
    if (c.status === 'annullato' || c.final) throw new ContractError('Il contratto non si può più cambiare.', 409)
    // baseVersionId: la versione da cui e' partita la modifica (se nel frattempo e' cambiata, si rifiuta).
    if (input.baseVersionId && input.baseVersionId !== c.version.id) throw new ContractError('Il contratto è cambiato nel frattempo: riapri la sua pagina.', 409)
    const request = input.requestId ? c.requests.find((r) => r.id === input.requestId) : null
    if (input.requestId && !request) throw new ContractError('Richiesta non trovata.', 404)
    if (request && request.status !== 'aperta') throw new ContractError('Questa richiesta ha già una risposta.', 409)
    // Dati delle parti garantiti (anche se l'AI li ha tolti); i valori gia' scritti restano. Quelli della controparte: sempre quelli salvati.
    const doc = keepRecipientValues(carryFieldValues(prepareBody(cleanIncomingDoc(input.doc, c.version.doc), creatorInfo(c), false), c.version.doc), c.version.doc)
    const at = now()
    const hadSignatures = Boolean(c.signatures.creatore || c.signatures.destinatario)
    return {
      ...c,
      previous: [...c.previous, c.version].slice(-MAX_PREVIOUS),
      version: { id: newId('v'), n: c.version.n + 1, at, doc, note: (input.note || (request ? `richiesta di modifica ${input.mode}` : 'modifica di Luca')).slice(0, 300) },
      signatures: {},
      requests: request ? c.requests.map((r) => (r.id === request.id ? { ...r, status: input.mode, decidedAt: at } : r)) : c.requests,
      ...(c.share ? { updatedAt_notice: at } : {}),
      events: addEvent(c, 'nuova_versione', 'creatore', `versione ${c.version.n + 1}${hadSignatures ? ', firme cancellate' : ''}`),
    }
  })
}

/**
 * Contratto di prima gia' firmato senza i «Termini della collaborazione»: nuova versione con
 * gli spazi (vuoti) di data e ora e termine di consegna. Il testo firmato non cambia mai da
 * solo: qui lo chiede chi crea, e le firme si rifanno.
 */
export async function addTermsVersion(id: string): Promise<Contract> {
  return mutate(id, (c) => {
    if (c.status === 'annullato' || c.final) throw new ContractError('Il contratto non si può più cambiare.', 409)
    if (readTerms(c.version.doc).present) throw new ContractError('I Termini della collaborazione ci sono già.', 409)
    const at = now()
    const hadSignatures = anySigned(c)
    return {
      ...c,
      previous: [...c.previous, c.version].slice(-MAX_PREVIOUS),
      version: { id: newId('v'), n: c.version.n + 1, at, doc: ensureTerms(c.version.doc), note: 'aggiunti i Termini della collaborazione' },
      signatures: {},
      ...(c.share ? { updatedAt_notice: at } : {}),
      events: addEvent(c, 'nuova_versione', 'creatore', `versione ${c.version.n + 1}, aggiunti i Termini della collaborazione${hadSignatures ? ', firme cancellate' : ''}`),
    }
  })
}

/** Annulla: il link smette di funzionare, il contratto resta in elenco come annullato. */
export async function cancelContract(id: string): Promise<Contract> {
  let oldHash: string | null = null
  const c = await mutate(id, (c) => {
    if (c.final) throw new ContractError('Un contratto firmato da tutti non si annulla da qui.', 409)
    oldHash = c.share && !c.share.revokedAt ? c.share.tokenHash : null
    return { ...c, status: 'annullato', share: c.share ? { ...c.share, revokedAt: c.share.revokedAt || now() } : null, events: addEvent(c, 'annullato', 'creatore') }
  })
  if (oldHash) await dropLinkKey(oldHash)
  return c
}

async function deleteContractRecord(id: string) {
  const c = await loadContract(id)
  if (c?.share) await dropLinkKey(c.share.tokenHash)
  await supabaseAdmin.from('app_settings').delete().eq('key', KEY(id))
  await updateSetting(INDEX_KEY, parseIndex, (index) => ({ items: index.items.filter((i) => i.id !== id) }))
  await updateSetting(NOTES_KEY, parseNotes, (n) => (n.items.some((i) => i.contractId === id) ? { items: n.items.filter((i) => i.contractId !== id) } : false))
}

/** Cancella una bozza (o un annullato) senza firme. I contratti firmati non si cancellano. */
export async function deleteDraft(id: string): Promise<void> {
  const c = await loadContract(id)
  if (!c) throw new ContractError('Contratto non trovato.', 404)
  if (!(c.status === 'bozza' || c.status === 'annullato') || c.signatures.creatore || c.signatures.destinatario || c.final) {
    throw new ContractError('Si possono cancellare solo le bozze non firmate (o i contratti annullati).', 409)
  }
  await deleteContractRecord(id)
}

// ---------------------------------------------------------------------
// Link unico e PIN
// ---------------------------------------------------------------------

const scryptAsync = (password: string, salt: Buffer, keylen: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCallback(password, salt, keylen, options, (error, key) => (error ? reject(error) : resolve(key))))
const SCRYPT = { N: 16384, r: 8, p: 1 }
/** Il PIN non distingue maiuscole e minuscole (sul telefono la prima lettera spesso diventa maiuscola). */
const normPin = (pin: string) => pin.trim().toUpperCase()

export async function hashPin(pin: string): Promise<string> {
  if (!PIN_RE.test(pin.trim())) throw new ContractError('Il PIN deve avere da 4 a 12 caratteri, solo lettere e numeri.')
  const salt = randomBytes(16)
  const key = await scryptAsync(normPin(pin), salt, 32, SCRYPT)
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt' || typeof pin !== 'string' || !PIN_RE.test(pin.trim())) return false
  const [, n, r, p, salt, hash] = parts
  const expected = Buffer.from(hash, 'base64')
  const key = await scryptAsync(normPin(pin), Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) })
  return key.length === expected.length && timingSafeEqual(key, expected)
}

/** Segreto del server (lo stesso dei cookie dei PDF), diverso per ogni uso. */
function serverKey(purpose: string): Buffer | null {
  const base = (process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  return base ? createHmac('sha256', base).update(purpose).digest() : null
}

export const tokenHashOf = (token: string) => sha256(`contract-link:${token}`)

/** Copia del link per "Copia link": cifrata con il segreto del server (senza segreto, in chiaro: senza PIN non apre niente). */
function sealToken(token: string): string {
  const key = serverKey('contract-link-seal')
  if (!key) return `plain.${token}`
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${data.toString('base64url')}`
}

function openToken(sealed: string): string | null {
  try {
    if (sealed.startsWith('plain.')) return sealed.slice(6)
    const [v, iv, tag, data] = sealed.split('.')
    const key = serverKey('contract-link-seal')
    if (v !== 'v1' || !key) return null
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    const token = Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
    return TOKEN_RE.test(token) ? token : null
  } catch {
    return null
  }
}

/** Dominio dei link: sul sito vero sempre www.facevoice.ai, nelle anteprime quello della richiesta. */
export function linkOrigin(requestOrigin?: string | null): string {
  if (process.env.VERCEL_ENV === 'production') return SITE_URL
  if (requestOrigin && /^https?:\/\/[\w.:-]+$/.test(requestOrigin)) return requestOrigin
  return process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : SITE_URL
}

export const contractLink = (origin: string, token: string) => `${origin}/c/${token}`

/** Link attivo da copiare di nuovo (solo per chi crea). */
export function currentLink(c: Contract, origin: string): string | null {
  if (!c.share || c.share.revokedAt) return null
  const token = openToken(c.share.tokenEnc)
  return token ? contractLink(origin, token) : null
}

function parseLinkRef(raw: string | null): { scope: string; id: string; gen: string } | null {
  try {
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed.id === 'string' && typeof parsed.gen === 'string' ? parsed : null
  } catch {
    return null
  }
}

async function dropLinkKey(tokenHash: string) {
  await supabaseAdmin.from('app_settings').delete().eq('key', `${LINK_PREFIX}${tokenHash}`)
}

/**
 * Link nuovo con il PIN scelto da Luca (ogni condivisione cambia link e PIN: il link di
 * prima smette di funzionare). Restituisce il token in chiaro SOLO a chi deve mandarlo.
 */
export async function createShareLink(id: string, input: { pin: string; channel: ShareChannel; to: string }): Promise<{ token: string; contract: Contract; previous: ShareInfo | null }> {
  if (typeof input.pin !== 'string' || !PIN_RE.test(input.pin.trim())) throw new ContractError('Il PIN deve avere da 4 a 12 caratteri, solo lettere e numeri.')
  if (!SHARE_CHANNELS.includes(input.channel)) throw new ContractError('Canale non valido.')
  const pinHash = await hashPin(input.pin)
  const token = randomBytes(32).toString('base64url')
  const tokenHash = tokenHashOf(token)
  const gen = newId('g')
  let previous: ShareInfo | null = null
  const contract = await mutate(id, (c) => {
    if (c.status === 'annullato') throw new ContractError('Questo contratto è stato annullato.', 409)
    previous = c.share
    const share: ShareInfo = { gen, tokenHash, tokenEnc: sealToken(token), pinHash, createdAt: now(), channel: input.channel, to: input.to.slice(0, 200) }
    return { ...c, share, events: addEvent(c, previous ? 'link_rinnovato' : 'link_creato', 'creatore', CHANNEL_LABEL[input.channel]) }
  })
  await updateSetting(`${LINK_PREFIX}${tokenHash}`, parseLinkRef, () => ({ scope: SCOPE, id, gen }))
  const old = previous as ShareInfo | null
  if (old && old.tokenHash !== tokenHash) await dropLinkKey(old.tokenHash)
  return { token, contract, previous: old }
}

/** Invio non riuscito: il link appena creato si toglie e torna quello di prima. */
export async function undoShareLink(id: string, token: string, previous: ShareInfo | null): Promise<void> {
  const tokenHash = tokenHashOf(token)
  await dropLinkKey(tokenHash)
  await mutate(id, (c) => (c.share?.tokenHash === tokenHash ? { ...c, share: previous, events: addEvent(c, 'link_non_inviato', 'sistema') } : c)).catch(() => undefined)
  if (previous && !previous.revokedAt) await updateSetting(`${LINK_PREFIX}${previous.tokenHash}`, parseLinkRef, () => ({ scope: SCOPE, id, gen: previous.gen }))
}

/** "Revoca link": chi ha il link non lo apre piu'. */
export async function revokeLink(id: string): Promise<Contract> {
  let hash: string | null = null
  const c = await mutate(id, (c) => {
    if (!c.share || c.share.revokedAt) throw new ContractError('Non c’è un link attivo.', 409)
    hash = c.share.tokenHash
    return { ...c, share: { ...c.share, revokedAt: now() }, events: addEvent(c, 'link_revocato', 'creatore') }
  })
  if (hash) await dropLinkKey(hash)
  return c
}

/** Contratto aperto da un link valido e non revocato (altrimenti null: "Link non valido"). */
export async function contractByToken(token: string): Promise<Contract | null> {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null
  const tokenHash = tokenHashOf(token)
  const ref = parseLinkRef((await readSetting(`${LINK_PREFIX}${tokenHash}`)).value)
  if (!ref || ref.scope !== SCOPE) return null
  const c = await loadContract(ref.id)
  if (!c || !c.share || c.share.revokedAt || c.share.tokenHash !== tokenHash || c.share.gen !== ref.gen || c.status === 'annullato') return null
  return c
}

// Cookie dopo il PIN giusto: firmato, valido 2 ore, solo per quel link (e per quella condivisione).
const cookieSig = (key: Buffer, tokenHash: string, gen: string, exp: number) => createHmac('sha256', key).update(`${tokenHash}.${gen}.${exp}`).digest('base64url')

export function signLinkCookie(share: ShareInfo, at = Date.now()): string | null {
  const key = serverKey('contract-link-cookie')
  if (!key) return null
  const exp = Math.floor(at / 1000) + LINK_COOKIE_TTL_S
  return `${exp}.${cookieSig(key, share.tokenHash, share.gen, exp)}`
}

export function verifyLinkCookie(value: string | undefined | null, share: ShareInfo, at = Date.now()): boolean {
  const key = serverKey('contract-link-cookie')
  if (!key || !value) return false
  const [expText, sig] = value.split('.')
  const exp = Number(expText)
  if (!sig || !Number.isFinite(exp) || exp * 1000 < at || exp * 1000 > at + LINK_COOKIE_TTL_S * 1000 + 60_000) return false
  const expected = Buffer.from(cookieSig(key, share.tokenHash, share.gen, exp))
  const given = Buffer.from(sig)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

// Tentativi di PIN: al massimo 5 per link e 20 per indirizzo IP ogni 15 minuti.
type Guard = { link: Record<string, number[]>; ip: Record<string, number[]> }
function parseGuard(raw: string | null): Guard {
  try {
    const parsed = raw ? JSON.parse(raw) : null
    return { link: parsed?.link && typeof parsed.link === 'object' ? parsed.link : {}, ip: parsed?.ip && typeof parsed.ip === 'object' ? parsed.ip : {} }
  } catch {
    return { link: {}, ip: {} }
  }
}

function prune(map: Record<string, number[]>, since: number, maxKeys = 800): Record<string, number[]> {
  const entries = Object.entries(map)
    .map(([k, list]) => [k, (Array.isArray(list) ? list : []).filter((t) => typeof t === 'number' && t > since)] as const)
    .filter(([, list]) => list.length)
    .sort((a, b) => Math.max(...b[1]) - Math.max(...a[1]))
    .slice(0, maxKeys)
  return Object.fromEntries(entries)
}

/** Impronta dell'IP con il segreto del server: nell'archivio non resta l'indirizzo in chiaro. */
const ipKey = (ip: string) => createHmac('sha256', serverKey('contract-ip') || Buffer.from('fv')).update(ip).digest('hex').slice(0, 24)

/**
 * Prenota un tentativo PRIMA di controllare il PIN (cosi' due richieste insieme non
 * superano il limite). blocked: troppi tentativi, minuti di attesa.
 */
export async function reservePinAttempt(tokenHash: string, ip: string, at = Date.now()): Promise<{ ok: true } | { ok: false; minutes: number }> {
  const since = at - PIN_WINDOW_MS
  const lk = tokenHash.slice(0, 24)
  const ik = ipKey(ip)
  let blockedUntil = 0
  await updateSetting(GUARD_KEY, parseGuard, (g) => {
    blockedUntil = 0
    const link = prune(g.link, since)
    const ipMap = prune(g.ip, since)
    const l = link[lk] || []
    const i = ipMap[ik] || []
    if (l.length >= PIN_MAX_PER_LINK) blockedUntil = Math.min(...l) + PIN_WINDOW_MS
    else if (i.length >= PIN_MAX_PER_IP) blockedUntil = Math.min(...i) + PIN_WINDOW_MS
    if (blockedUntil) return false
    return { link: { ...link, [lk]: [...l, at] }, ip: { ...ipMap, [ik]: [...i, at] } }
  })
  if (blockedUntil) return { ok: false, minutes: Math.max(1, Math.ceil((blockedUntil - at) / 60_000)) }
  return { ok: true }
}

/** PIN giusto: il tentativo prenotato non conta e i tentativi sbagliati del link si azzerano. */
export async function clearPinAttempts(tokenHash: string, ip: string): Promise<void> {
  const lk = tokenHash.slice(0, 24)
  const ik = ipKey(ip)
  await updateSetting(GUARD_KEY, parseGuard, (g) => {
    if (!g.link[lk] && !g.ip[ik]) return false
    const link = { ...g.link }
    delete link[lk]
    const ipMap = { ...g.ip, [ik]: (g.ip[ik] || []).slice(0, -1) }
    return { link, ip: ipMap }
  })
}

/** Tentativo sbagliato nel registro del contratto (mai il PIN, mai l'IP). */
export async function noteWrongPin(id: string): Promise<void> {
  await mutate(id, (c) => ({ ...c, events: addEvent(c, 'pin_errato', 'sistema') })).catch(() => undefined)
}

// ---------------------------------------------------------------------
// Link aperto: avviso a chi crea (una volta per condivisione, poi al massimo ogni 6 ore)
// ---------------------------------------------------------------------

export const OPEN_NOTICE_GAP_MS = 6 * 3600_000
/** Ultima apertura per la pagina di chi crea: salvata al massimo ogni 5 minuti (non una scrittura per ogni pagina vista). */
export const OPEN_SEEN_GAP_MS = 5 * 60_000

/**
 * Chi ha ricevuto il link ha aperto il contratto (PIN giusto o pagina riaperta): va avvisato
 * chi crea? Si' la prima volta di ogni condivisione (condividere di nuovo ricomincia), la
 * prima volta dopo una nuova versione («contratto aggiornato»), e poi al massimo ogni 6 ore.
 * L'apertura si salva prima dell'avviso, con il salvataggio a confronto: con due schede
 * aperte insieme vince una sola. Restituisce il contratto se c'e' da avvisare, altrimenti null.
 */
export async function claimOpenNotice(id: string, at = Date.now()): Promise<Contract | null> {
  if (!CONTRACT_ID_RE.test(id)) return null
  let claimed = false
  const saved = await updateSetting<Contract | null>(KEY(id), parseContract, (c) => {
    claimed = false
    // Firmato da tutti (si riapre per scaricare il PDF) o annullato: niente avvisi.
    if (!c || !c.share || c.share.revokedAt || c.final || c.status === 'annullato') return false
    const o = c.opened
    const iso = new Date(at).toISOString()
    const due = !o || o.gen !== c.share.gen || o.versionN !== c.version.n || !(at - Date.parse(o.at) < OPEN_NOTICE_GAP_MS)
    if (!due) {
      // Niente avviso: si aggiorna solo l'ultima apertura vista (al massimo ogni 5 minuti).
      return at - Date.parse(o.seenAt || o.at) < OPEN_SEEN_GAP_MS ? false : { ...c, opened: { ...o, seenAt: iso } }
    }
    claimed = true
    // Niente cambio di data di modifica: aprire non cambia il contratto.
    return { ...c, opened: { gen: c.share.gen, versionN: c.version.n, at: iso, seenAt: iso }, events: addEvent(c, 'link_aperto', 'destinatario') }
  })
  return claimed ? saved : null
}

// ---------------------------------------------------------------------
// Notifiche (campanella)
// ---------------------------------------------------------------------

export type NoteKind = 'aperto' | 'modifica' | 'firma_destinatario' | 'completato'
export type ContractNote = { id: string; at: string; kind: NoteKind; contractId: string; requestId?: string; title: string; read: boolean }

function parseNotes(raw: string | null): { items: ContractNote[] } {
  try {
    const parsed = raw ? JSON.parse(raw) : null
    return { items: Array.isArray(parsed?.items) ? parsed.items.filter((i: Partial<ContractNote>) => typeof i?.id === 'string') : [] }
  } catch {
    return { items: [] }
  }
}

export async function addNote(note: Omit<ContractNote, 'id' | 'at' | 'read'>): Promise<ContractNote> {
  const item: ContractNote = { ...note, title: note.title.slice(0, 160), id: newId('n'), at: now(), read: false }
  await updateSetting(NOTES_KEY, parseNotes, (n) => {
    let items = [...n.items, item]
    // Al massimo 60: prima si tolgono le piu' vecchie gia' lette.
    while (items.length > MAX_NOTES) {
      const i = items.findIndex((x) => x.read)
      items.splice(i >= 0 ? i : 0, 1)
    }
    return { items }
  })
  return item
}

export async function listNotes(): Promise<{ items: ContractNote[]; unread: number }> {
  const items = parseNotes((await readSetting(NOTES_KEY)).value).items.sort((a, b) => b.at.localeCompare(a.at))
  return { items: items.slice(0, 30), unread: items.filter((i) => !i.read).length }
}

/** Segna come lette: alcune (ids), tutte quelle di un contratto, o tutte. */
export async function markNotesRead(input: { ids?: string[]; contractId?: string; all?: boolean }): Promise<number> {
  let count = 0
  await updateSetting(NOTES_KEY, parseNotes, (n) => {
    count = 0
    const items = n.items.map((i) => {
      const hit = !i.read && (input.all || input.ids?.includes(i.id) || (input.contractId && i.contractId === input.contractId))
      if (!hit) return i
      count++
      return { ...i, read: true }
    })
    return count ? { items } : false
  })
  return count
}

// ---------------------------------------------------------------------
// Cosa vede chi crea e cosa vede chi riceve
// ---------------------------------------------------------------------

const firstName = (name: string) => name.split(/\s+/)[0] || name

/** Ultima apertura vista del link attuale (null: il link di adesso non e' ancora stato aperto). */
function lastOpened(c: Contract): string | null {
  const o = c.opened
  if (!o || !c.share || c.share.revokedAt || o.gen !== c.share.gen) return null
  return o.seenAt && o.seenAt > o.at ? o.seenAt : o.at
}

/** Termini della collaborazione per le pagine: valori, cosa manca, se si possono cambiare. */
function termsView(c: Contract) {
  const t = termsState(c)
  return {
    date: t.date,
    days: t.days,
    missing: t.missing,
    upgrade: t.upgrade,
    ready: t.ready,
    /** Si cambiano finche' nessuno ha firmato (dopo: nuova versione). */
    editable: t.present && !c.final && c.status !== 'annullato' && !anySigned(c),
  }
}

export function creatorView(contract: Contract, origin: string, withLink = false) {
  const c = withParties(contract)
  const doc = contractDoc(c)
  // I termini hanno la loro scheda: non tra "I dati di chi crea".
  const mine = fillable(c, 'creatore').filter((e) => !isTermsId(e.id))
  const theirs = recipientData(c)
  return {
    id: c.id,
    docId: c.docId,
    kind: DOC_KIND_LABEL[c.kind] || 'Documento',
    title: c.version.doc.title,
    heading: `Contratto tra ${c.creator.name} e ${recipientLabel(c)}`,
    status: c.status,
    statusLabel: STATUS_LABEL[c.status],
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    creator: c.creator,
    recipient: c.recipient,
    version: { id: c.version.id, n: c.version.n, at: c.version.at, note: c.version.note },
    /** Testo strutturato della versione attuale (per modificarlo a mano). */
    source: c.version.doc,
    doc,
    previous: c.previous.map((v) => ({ n: v.n, at: v.at })),
    fields: (c.version.doc.fields || []) as DocField[],
    missing: emptyFieldLabels(c.version.doc),
    /** Dati che chi crea puo' scrivere adesso: nel testo (finche' nessuno firma) e la sua parte dei dati "entrambi". */
    myFields: mine,
    myMissing: missingFor(c, 'creatore'),
    /** «Termini della collaborazione»: servono per condividere e firmare. */
    terms: termsView(c),
    /** Dati scritti dalla controparte (si aggiornano mentre li scrive). */
    recipientData: theirs,
    recipientWaiting: !c.signatures.destinatario && !theirs.some((d) => d.value.trim()),
    recipientLabel: recipientLabel(c),
    requests: [...c.requests].reverse(),
    signatures: Object.fromEntries(
      (['creatore', 'destinatario'] as Party[]).flatMap((p) => {
        const s = c.signatures[p]
        return s ? [[p, { name: s.name, at: s.at, device: s.device, ip: s.ip, versionN: s.versionN }]] : []
      })
    ) as Partial<Record<Party, { name: string; at: string; device: string; ip: string; versionN: number }>>,
    statements: statementsFor(c.version.doc),
    share: c.share ? { active: !c.share.revokedAt, channel: c.share.channel, to: c.share.to, createdAt: c.share.createdAt, revokedAt: c.share.revokedAt || null } : null,
    ...(withLink ? { link: currentLink(c, origin) } : {}),
    events: [...c.events].reverse().slice(0, 40),
    final: c.final || null,
    canEditFields: !c.final && c.status !== 'annullato' && !c.signatures.creatore && !c.signatures.destinatario,
    canEditOwn: mine.length > 0,
    /** Ultima apertura del link attuale (dopo «Condividi di nuovo» si riparte da zero). */
    lastOpenedAt: lastOpened(c),
  }
}

export type CreatorView = ReturnType<typeof creatorView>

/** Pagina del link: niente segreti, niente avvisi legali per chi crea, niente dati interni. */
export function publicView(contract: Contract) {
  const c = withParties(contract)
  const doc = contractDoc(c)
  const mine = c.signatures.destinatario
  const theirs = c.signatures.creatore
  return {
    heading: `Contratto tra ${c.creator.name} e ${recipientLabel(c)}`,
    creatorName: c.creator.name,
    recipientName: recipientLabel(c),
    greeting: firstName(recipientLabel(c)),
    status: c.status,
    statusLabel: STATUS_LABEL[c.status],
    versionId: c.version.id,
    versionN: c.version.n,
    updated: Boolean(c.updatedAt_notice && !mine),
    /** Termini della collaborazione scelti da chi crea (solo da leggere). Contratto di prima senza termini: da scegliere (nuova versione). */
    terms: (() => {
      const t = termsState(c)
      return t.present ? { date: t.date.value, days: t.days.value, ready: t.missing.length === 0 } : t.upgrade ? { date: '', days: '', ready: false } : null
    })(),
    doc,
    sections: c.version.doc.sections.map((s) => (s.heading ? fillText(s.heading, c.version.doc.fields) : '')).filter(Boolean),
    /** Dati che chi riceve scrive (salvati mentre scrive, fino alla sua firma): prima quelli di "Le parti". */
    myData: fillable(c, 'destinatario').map((e) => ({ id: e.id, label: e.label, value: e.value, required: e.required, ...(e.role ? { role: e.role } : {}), input: e.input, autoComplete: e.autoComplete, shared: e.party === 'entrambi' })),
    missing: missingFor(c, 'destinatario'),
    /** Chi riceve firma con il nome e cognome che ha scritto nei suoi dati. */
    signerName: identityValue(c, 'nome'),
    statements: statementsFor(c.version.doc),
    signed: mine ? { name: mine.name, at: mine.at } : null,
    otherSigned: theirs ? { name: theirs.name, at: theirs.at } : null,
    complete: Boolean(c.final),
    requests: c.requests
      .slice(-10)
      .reverse()
      .map((r) => ({ id: r.id, at: r.at, text: r.text, section: r.section || null, status: r.status, note: r.status === 'rifiutata' ? r.note || null : null })),
    canAct: !c.final && c.status !== 'annullato',
  }
}

export type PublicView = ReturnType<typeof publicView>
