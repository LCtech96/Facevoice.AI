import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'crypto'
import { readSetting, updateSetting } from '@/lib/settings-store'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { SITE_URL } from '@/lib/seo/site'
import { BUSINESS, DOC_KIND_LABEL, carryFieldValues, latestVersion, loadDocument, normalizeFields, sanitizeDoc, type DocKind } from '@/lib/assistant-documents'
import { emptyFieldLabels, fillText, renderPdf, type DocField, type DocSection, type DocSignature, type StructuredDoc } from '@/lib/pdf-doc'
import { CHANNEL_LABEL, SHARE_CHANNELS, STATUS_LABEL, type ContractStatus, type ShareChannel } from '@/lib/contract-text'

// Contratti del sito (area admin): un documento della super chat diventa un contratto
// quando lo si condivide o lo si apre nella pagina Contratti. Chi lo riceve lo apre da
// un link unico (www.facevoice.ai/c/<token>) solo con il PIN scelto da Luca, chiede
// modifiche o firma (tre accettazioni separate, nome scritto e firma col dito). Quando
// hanno firmato tutti e due resta solo la versione firmata con i dati minimi della firma.
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
}
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
async function mutate(id: string, fn: (c: Contract) => Contract): Promise<Contract> {
  if (!CONTRACT_ID_RE.test(id)) throw new ContractError('Contratto non trovato.', 404)
  let failure: ContractError | null = null
  const saved = await updateSetting<Contract | null>(KEY(id), parseContract, (current) => {
    failure = null
    if (!current) {
      failure = new ContractError('Contratto non trovato.', 404)
      return false
    }
    try {
      const next = fn(structuredClone(current))
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
  await touchIndex(saved)
  return saved
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
  const doc = normalizeFields(version.doc, version.doc.fields || [])
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
    creator: { name: BUSINESS.name, address: BUSINESS.address, vat: BUSINESS.vat, person: BUSINESS.person, email: BUSINESS.email },
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

/** Le due caselle di firma: chi crea e chi riceve (con la firma disegnata, se c'e'). */
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
    { label: theirs?.label || 'Il destinatario', name: theirs?.name || c.recipient.name, party: 'destinatario', ...drawn('destinatario') },
  ]
}

/** Pagina finale "Registro delle firme": parti, ora, IP, dispositivo, dichiarazioni, impronte. */
function signatureRegister(c: Contract): DocSection[] {
  if (!c.final) return []
  const out: DocSection[] = [
    {
      heading: 'Registro delle firme',
      paragraphs: [
        `Contratto: ${fillText(c.version.doc.title, c.version.doc.fields)} (versione ${c.version.n}).`,
        `Parti: ${c.creator.name}, ${c.creator.address}, P.IVA ${c.creator.vat}; ${c.recipient.name}.`,
        'Tipo di firma: firma elettronica semplice, con tre accettazioni separate, nome scritto e firma tracciata a mano sullo schermo. Orari in ora italiana (Europe/Rome).',
      ],
    },
  ]
  for (const party of ['creatore', 'destinatario'] as Party[]) {
    const s = c.signatures[party]
    if (!s) continue
    out.push({
      heading: party === 'creatore' ? `Firma di ${c.creator.name}` : `Firma di ${c.recipient.name}`,
      paragraphs: [`Nome scritto: ${s.name}`, `Data e ora: ${romeFull(s.at)}`, `Indirizzo IP: ${s.ip}`, `Dispositivo: ${s.device}`, 'Dichiarazioni accettate una per una:'],
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
export function contractDoc(c: Contract): StructuredDoc {
  const d = c.version.doc
  const sections = [...d.sections]
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
    fields: d.fields || [],
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

export function signaturesHash(signatures: Contract['signatures']): string {
  const list = (['creatore', 'destinatario'] as Party[])
    .map((p) => signatures[p])
    .filter((s): s is ContractSignature => Boolean(s))
    .map((s) => ({ party: s.party, name: s.name, at: s.at, ip: s.ip, device: s.device, statements: s.statements, strokes: s.strokes, versionId: s.versionId }))
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
 * Dati che una parte puo' compilare al momento della firma: i suoi ancora vuoti e quelli
 * comuni ancora vuoti, ma i comuni solo finche' l'altra parte non ha firmato. Dopo, la
 * firma dell'altra parte finirebbe su un dato deciso da uno solo: restano da compilare
 * a mano (o con una nuova versione, che toglie le firme).
 */
export function fieldsToSign(c: Pick<Contract, 'version' | 'signatures'>, party: Party): DocField[] {
  const otherSigned = Boolean(c.signatures[party === 'creatore' ? 'destinatario' : 'creatore'])
  return (c.version.doc.fields || []).filter((f) => !f.value?.trim() && (f.party === party || (f.party === 'entrambi' && !otherSigned)))
}

/** Valori dei campi che chi firma puo' compilare ora (vedi fieldsToSign). */
function signerValues(c: Contract, party: Party, raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object') return out
  const allowed = new Set(fieldsToSign(c, party).map((f) => f.id))
  for (const f of c.version.doc.fields || []) {
    const v = (raw as Record<string, unknown>)[f.id]
    if (typeof v !== 'string' || !v.trim() || f.value?.trim()) continue
    // Pagina aperta prima che l'altra parte firmasse: un dato comune non si compila piu'.
    if (f.party === 'entrambi' && !allowed.has(f.id)) throw new ContractError('Il contratto è cambiato mentre lo leggevi: ricarica la pagina e rileggilo prima di firmare.', 409)
    if (allowed.has(f.id)) out[f.id] = v.replace(/\s+/g, ' ').trim().slice(0, MAX_FIELD_VALUE)
  }
  return out
}

/**
 * Firma di una parte: tre accettazioni tutte vere, nome scritto, firma disegnata non
 * vuota, sulla versione mostrata (se il contratto e' cambiato si rifiuta: va ricaricato).
 */
export async function signContract(id: string, party: Party, input: SignInput): Promise<{ contract: Contract; completed: boolean }> {
  const name = String(input.name || '').replace(/\s+/g, ' ').trim()
  if (name.length < 3 || name.length > MAX_SIGNER_NAME) throw new ContractError('Scrivi il tuo nome e cognome per firmare.')
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
    const values = signerValues(c, party, input.values)
    const fields = (c.version.doc.fields || []).map((f) => (values[f.id] ? { ...f, value: values[f.id] } : f))
    const doc = { ...c.version.doc, fields }
    const changed = Object.keys(values).length > 0
    const at = now()
    const signature: ContractSignature = {
      party,
      at,
      name,
      strokes,
      ip: input.ip,
      device: deviceOf(input.userAgent),
      userAgent: input.userAgent.slice(0, 300),
      statements: statementsFor(doc),
      versionId: c.version.id,
      versionN: c.version.n,
    }
    let next: Contract = {
      ...c,
      // I dati compilati alla firma cambiano il contenuto: l'altra parte firma la versione nuova.
      version: changed ? { ...c.version, id: newId('v'), doc } : c.version,
      signatures: { ...c.signatures, [party]: signature },
      events: addEvent(c, 'firma', party, `${name}${changed ? ` (compilati ${Object.keys(values).length} dati)` : ''}`),
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
function finalize(c: Contract): Contract {
  const at = now()
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

/** Chi crea compila i suoi dati (e quelli comuni) finche' nessuno ha firmato. */
export async function setCreatorFields(id: string, values: Record<string, unknown>): Promise<Contract> {
  return mutate(id, (c) => {
    if (c.status === 'annullato' || c.final) throw new ContractError('Il contratto non si può più cambiare.', 409)
    if (c.signatures.creatore || c.signatures.destinatario) throw new ContractError('Qualcuno ha già firmato: i dati si compilano al momento della firma o con una nuova versione.', 409)
    let changed = false
    const fields = (c.version.doc.fields || []).map((f) => {
      if (!(f.id in values) || f.party === 'destinatario') return f
      const raw = values[f.id]
      const value = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim().slice(0, MAX_FIELD_VALUE) : ''
      if ((f.value || '') === value) return f
      changed = true
      const { value: _old, ...rest } = f
      return value ? { ...rest, value } : rest
    })
    if (!changed) return c
    return { ...c, version: { ...c.version, id: newId('v'), doc: { ...c.version.doc, fields } }, events: addEvent(c, 'dati_compilati', 'creatore') }
  })
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
    const doc = cleanIncomingDoc(input.doc, c.version.doc)
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
// Notifiche (campanella)
// ---------------------------------------------------------------------

export type NoteKind = 'modifica' | 'firma_destinatario' | 'completato'
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

export function creatorView(c: Contract, origin: string, withLink = false) {
  const doc = contractDoc(c)
  return {
    id: c.id,
    docId: c.docId,
    kind: DOC_KIND_LABEL[c.kind] || 'Documento',
    title: c.version.doc.title,
    heading: `Contratto tra ${c.creator.name} e ${c.recipient.name}`,
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
  }
}

export type CreatorView = ReturnType<typeof creatorView>

/** Pagina del link: niente segreti, niente avvisi legali per chi crea, niente dati interni. */
export function publicView(c: Contract) {
  const doc = contractDoc(c)
  const mine = c.signatures.destinatario
  const theirs = c.signatures.creatore
  return {
    heading: `Contratto tra ${c.creator.name} e ${c.recipient.name}`,
    creatorName: c.creator.name,
    recipientName: c.recipient.name,
    greeting: firstName(c.recipient.name),
    status: c.status,
    statusLabel: STATUS_LABEL[c.status],
    versionId: c.version.id,
    versionN: c.version.n,
    updated: Boolean(c.updatedAt_notice && !mine),
    doc,
    sections: c.version.doc.sections.map((s) => (s.heading ? fillText(s.heading, c.version.doc.fields) : '')).filter(Boolean),
    /** Dati che chi riceve compila (i suoi e quelli comuni ancora vuoti, finche' l'altra parte non ha firmato). */
    myFields: fieldsToSign(c, 'destinatario').map((f) => ({ id: f.id, label: f.label })),
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
