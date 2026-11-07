import type { PdfSection } from '@/lib/pdf-doc'
import type { DocContent, DocField } from './documents'
import { CREATOR_IDENTITY, RECIPIENT_IDENTITY, identityKind, type IdentityInput, type IdentityKind, type IdentitySpec } from './parties-shared'

// «Le parti» dei contratti (beta), messe dal server e non lasciate all'AI: in cima a ogni
// documento da firmare (contratto, accordo, preventivo e ogni documento condiviso come contratto)
// "Tra:" i dati di chi lo prepara (nome dello spazio; P.IVA e sede se sono nelle Istruzioni,
// altrimenti campi che scrive il titolare) "e:" i campi di identita' di chi lo riceve (nome e
// cognome, luogo e data di nascita, codice fiscale, residenza, email, telefono, azienda), che
// scrive lui dalla pagina del link. Un campo che l'AI ha gia' creato con lo stesso significato
// (es. "cf_giusy" con etichetta "Codice fiscale") si usa al posto di quello standard: mai due volte.
// Qui solo funzioni pure (nessun accesso al database): le usano lib/saas/contracts.ts e, per il
// PDF del documento, lib/saas/documents.ts.

export const PARTIES_HEADING = 'Le parti'
/** Tipi di documento che hanno sempre «Le parti» (anche prima di diventare un contratto). */
export const CONTRACT_KINDS: readonly string[] = ['contratto', 'accordo', 'preventivo']
const BLANK = '_'.repeat(28)

/** Chi prepara il documento: nome dello spazio e i dati trovati nelle Istruzioni. */
export type CreatorIdentity = { name: string; vat?: string; address?: string; city?: string; court?: string }

export type PartyLine = {
  kind: IdentityKind | 'denominazione'
  label: string
  party: 'creatore' | 'destinatario'
  /** Dato gia' noto (dello spazio di lavoro). */
  value?: string
  /** Campo da compilare: standard (std) oppure un campo del testo con lo stesso significato. */
  id?: string
  std?: true
  required?: true
  /** Id del campo che rende facoltativo questo (codice fiscale se c'e' l'azienda). */
  requiredUnless?: string
  input?: IdentityInput
  autoComplete?: string
}
/** legacyBoth: contratti di prima firmati per primo dal destinatario (i campi di entrambi nel testo erano suoi). */
export type Parties = { v: 1; creator: PartyLine[]; recipient: PartyLine[]; legacyBoth?: 'destinatario' }

// --- Dati dello spazio dalle Istruzioni ------------------------------------------------------------

/** Sigla della provincia -> citta' del tribunale piu' vicino (capoluogo). */
const PROVINCES: Record<string, string> = Object.fromEntries(
  (
    'AG Agrigento|AL Alessandria|AN Ancona|AO Aosta|AP Ascoli Piceno|AQ L’Aquila|AR Arezzo|AT Asti|AV Avellino|BA Bari|BG Bergamo|BI Biella|BL Belluno|BN Benevento|BO Bologna|BR Brindisi|BS Brescia|BT Trani|BZ Bolzano|CA Cagliari|CB Campobasso|CE Caserta|CH Chieti|CL Caltanissetta|CN Cuneo|CO Como|CR Cremona|CS Cosenza|CT Catania|CZ Catanzaro|EN Enna|FC Forlì|FE Ferrara|FG Foggia|FI Firenze|FM Fermo|FR Frosinone|GE Genova|GO Gorizia|GR Grosseto|IM Imperia|IS Isernia|KR Crotone|LC Lecco|LE Lecce|LI Livorno|LO Lodi|LT Latina|LU Lucca|MB Monza|MC Macerata|ME Messina|MI Milano|MN Mantova|MO Modena|MS Massa|MT Matera|NA Napoli|NO Novara|NU Nuoro|OR Oristano|PA Palermo|PC Piacenza|PD Padova|PE Pescara|PG Perugia|PI Pisa|PN Pordenone|PO Prato|PR Parma|PT Pistoia|PU Pesaro|PV Pavia|PZ Potenza|RA Ravenna|RC Reggio Calabria|RE Reggio Emilia|RG Ragusa|RI Rieti|RM Roma|RN Rimini|RO Rovigo|SA Salerno|SI Siena|SO Sondrio|SP La Spezia|SR Siracusa|SS Sassari|SU Cagliari|SV Savona|TA Taranto|TE Teramo|TN Trento|TO Torino|TP Trapani|TR Terni|TS Trieste|TV Treviso|UD Udine|VA Varese|VB Verbania|VC Vercelli|VE Venezia|VI Vicenza|VR Verona|VT Viterbo|VV Vibo Valentia'
  )
    .split('|')
    .map((p) => [p.slice(0, 2), p.slice(3)])
)
const CAPOLUOGHI = [...new Set(Object.values(PROVINCES))].sort((a, b) => b.length - a.length)
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const CITY_WORD = "[A-ZÀ-Ý][\\p{L}'’]*(?:\\s+[A-ZÀ-Ý][\\p{L}'’]*){0,3}"
const STREET = '(?:Via|Viale|V\\.le|Piazza|P\\.zza|Piazzale|Corso|C\\.so|Largo|Vicolo|Contrada|C\\.da|Strada|Località|Loc\\.|Borgo|Lungomare|Salita|Traversa)'
const STREET_WORD = "(?:[A-ZÀ-Ý0-9][\\p{L}0-9'’.]*|di|del|della|delle|dei|degli|de|d['’]|lo|la|le|il)"
const STREET_RE = new RegExp(`(?<![\\p{L}])${STREET}\\s+${STREET_WORD}(?:\\s+${STREET_WORD}){0,6}?\\s*,?\\s*(?:n\\.?\\s*)?\\d{1,4}[A-Za-z]?(?![\\p{L}\\d])`, 'u')
const AFTER_STREET_RE = new RegExp(`^\\s*[,–-]?\\s*(\\d{5})\\s+(${CITY_WORD})(?:\\s*\\(([A-Z]{2})\\))?`, 'u')
const CAP_CITY_RE = new RegExp(`(?<!\\d)(\\d{5})\\s+(${CITY_WORD})\\s*\\(([A-Z]{2})\\)`, 'u')
const COURT_RE = new RegExp(`(?<![\\p{L}])(?:[Ff]oro|[Tt]ribunale)\\s+(?:competente\\s+)?(?:è\\s+quello\\s+)?di\\s+(${CITY_WORD})`, 'u')
const IN_CITY_RE = new RegExp(`(?:^|[\\s(,])(?:a|ad|in|da|di|sede a|sede in)\\s+(${CAPOLUOGHI.map(escapeRe).join('|')})(?![\\p{L}])`, 'u')
const VAT_RE = /(?<![\p{L}])(?:p\.?\s?iva|partita\s+iva|vat)(?![\p{L}])[^0-9\n]{0,15}((?:IT)?\s?\d{11})(?!\d)/iu

/**
 * Dati di chi prepara il documento dalle Istruzioni: P.IVA, indirizzo della sede, citta' e citta'
 * del foro (scritta nelle Istruzioni, dalla provincia dell'indirizzo, oppure un capoluogo nominato
 * "a Palermo"). Quello che non si trova resta vuoto: diventa un campo che scrive il titolare.
 */
export function creatorFromInstructions(name: string, text: string): CreatorIdentity {
  const t = String(text || '').slice(0, 8000)
  const out: CreatorIdentity = { name: String(name || '').trim().slice(0, 120) }
  const vat = t.match(VAT_RE)
  if (vat) out.vat = vat[1].replace(/\s+/g, '').replace(/^IT/i, '')
  const street = t.match(STREET_RE)
  let province = ''
  if (street) {
    const rest = t.slice((street.index ?? 0) + street[0].length).match(AFTER_STREET_RE)
    out.address = `${street[0].replace(/\s+/g, ' ').trim()}${rest ? `, ${rest[1]} ${rest[2]}${rest[3] ? ` (${rest[3]})` : ''}` : ''}`.slice(0, 200)
    if (rest) {
      out.city = rest[2]
      province = rest[3] || ''
    }
  }
  if (!out.city) {
    const cap = t.match(CAP_CITY_RE)
    if (cap) {
      out.city = cap[2]
      province = cap[3]
    }
  }
  const explicit = t.match(COURT_RE)?.[1]
  const named = t.match(IN_CITY_RE)?.[1]
  out.court = explicit || (province && PROVINCES[province]) || (out.city && CAPOLUOGHI.includes(out.city) ? out.city : '') || named || undefined
  if (!out.city && named) out.city = named
  if (!out.court) delete out.court
  if (!out.city) delete out.city
  return out
}

// --- Blocco delle parti --------------------------------------------------------------------------

/**
 * «Le parti» per questo testo: campi standard, oppure i campi dell'AI con lo stesso significato
 * (ognuno usato una volta sola, solo della stessa parte). prefill: valori per i campi del titolare
 * scritti dall'AI quando il dato e' gia' nelle Istruzioni (es. la P.IVA).
 */
export function buildParties(content: Pick<DocContent, 'fields'>, creator: CreatorIdentity): { parties: Parties; prefill: Record<string, string> } {
  const fields = content.fields || []
  const ids = new Set(fields.map((f) => f.id))
  const taken = new Set<string>()
  const prefill: Record<string, string> = {}
  const unique = (base: string) => {
    let id = base
    for (let n = 2; ids.has(id); n++) id = `${base}_${n}`
    ids.add(id)
    return id
  }
  const match = (spec: IdentitySpec): DocField | undefined => {
    const f = fields.find((x) => !taken.has(x.id) && x.party === spec.party && identityKind(x) === spec.kind)
    if (f) taken.add(f.id)
    return f
  }
  const line = (spec: IdentitySpec, known?: string): PartyLine => {
    const ai = match(spec)
    const base: PartyLine = { kind: spec.kind, label: spec.label, party: spec.party, input: spec.input, ...(spec.autoComplete ? { autoComplete: spec.autoComplete } : {}), ...(spec.required ? { required: true as const } : {}) }
    if (known) {
      if (ai) prefill[ai.id] = known
      return { ...base, label: spec.short || spec.label, value: known }
    }
    return ai ? { ...base, id: ai.id } : { ...base, id: unique(spec.id), std: true }
  }
  const [piva, sede] = CREATOR_IDENTITY
  const creatorLines: PartyLine[] = [
    { kind: 'denominazione', label: 'Denominazione', party: 'creatore', value: creator.name || 'La nostra attività' },
    line(piva, creator.vat),
    line(sede, creator.address),
  ]
  const recipient = RECIPIENT_IDENTITY.map((spec) => line(spec))
  const company = recipient.find((l) => l.kind === 'azienda')
  for (const l of recipient) {
    const spec = RECIPIENT_IDENTITY.find((s) => s.kind === l.kind)
    if (spec?.requiredUnless && company?.id) l.requiredUnless = company.id
  }
  return { parties: { v: 1, creator: creatorLines, recipient }, prefill }
}

export const partyLines = (p: Parties): PartyLine[] => [...p.creator, ...p.recipient]

/** Campi standard (non scritti nel testo) da compilare. */
export const stdFields = (p: Parties): DocField[] => partyLines(p).flatMap((l) => (l.std && l.id ? [{ id: l.id, label: l.label, party: l.party }] : []))

/** Id dei campi usati in «Le parti» (standard e dell'AI). */
export const partyFieldIds = (p: Parties): Set<string> => new Set(partyLines(p).flatMap((l) => (l.id ? [l.id] : [])))

/** Dati dello spazio gia' scritti nel blocco (per rifarlo uguale su una nuova versione del testo). */
export function creatorOf(p: Parties, name: string): CreatorIdentity {
  const known = (kind: IdentityKind) => p.creator.find((l) => l.kind === kind && l.value)?.value
  const vat = known('piva')
  const address = known('sede')
  return { name, ...(vat ? { vat } : {}), ...(address ? { address } : {}) }
}

/** Riga del blocco come si stampa: il dato, oppure "Etichetta: ________". */
export function partyLineText(l: PartyLine, valueOf: (id: string) => string | undefined): string {
  if (l.kind === 'denominazione') return l.value || ''
  const value = l.value || (l.id ? (valueOf(l.id) || '').trim() : '')
  return `${l.label}: ${value || BLANK}`
}

/** «Le parti» nel PDF: "Tra:" con i dati di chi prepara il documento, "e:" con quelli dell'altra parte. */
export function partiesPdfSections(p: Parties, valueOf: (id: string) => string | undefined): PdfSection[] {
  return [
    { heading: PARTIES_HEADING, paragraphs: ['Tra:'], bullets: p.creator.map((l) => partyLineText(l, valueOf)).filter(Boolean) },
    { paragraphs: ['e:'], bullets: p.recipient.map((l) => partyLineText(l, valueOf)) },
  ]
}

const FIELD_TOKEN = /\[\[([a-z0-9_]{1,40})\]\]/g
const textsOf = (content: DocContent) => [content.title, content.subtitle || '', ...content.meta, ...content.sections.flatMap((s) => [s.heading || '', ...s.paragraphs, ...(s.bullets || [])]), ...content.signatures.flatMap((s) => [s.label, s.name || ''])]

/** Campi nominati nel testo. */
export function placedIds(content: DocContent): Set<string> {
  const out = new Set<string>()
  for (const text of textsOf(content)) for (const m of text.matchAll(FIELD_TOKEN)) out.add(m[1])
  return out
}

/** Campi dell'AI usati in «Le parti» e mai nominati nel testo: non vanno ripetuti in "Dati da compilare". */
export function hiddenInExtras(p: Parties, content: DocContent): Set<string> {
  const placed = placedIds(content)
  return new Set([...partyFieldIds(p)].filter((id) => !placed.has(id)))
}

/**
 * PDF del documento dell'Assistente (contratto, accordo, preventivo): «Le parti» in cima e il
 * testo senza i campi gia' in «Le parti». null per gli altri tipi o se il testo le ha gia'
 * (versione firmata, scritta con «Le parti» compilate).
 */
export function documentParties(kind: string, content: DocContent, creator: CreatorIdentity): { sections: PdfSection[]; content: DocContent } | null {
  if (!CONTRACT_KINDS.includes(kind) || content.sections[0]?.heading === PARTIES_HEADING) return null
  const { parties, prefill } = buildParties(content, creator)
  const byId = new Map((content.fields || []).map((f) => [f.id, f]))
  const hidden = hiddenInExtras(parties, content)
  return {
    sections: partiesPdfSections(parties, (id) => byId.get(id)?.value || prefill[id]),
    content: { ...content, fields: (content.fields || []).filter((f) => !hidden.has(f.id)) },
  }
}

// --- Campo subito dopo un dato ---------------------------------------------------------------------

/** "3313738940: [[campo]]", "giusy@x.it: [[campo]]", "@giusy: [[campo]]": un dato gia' scritto e poi una riga vuota. */
const AFTER_VALUE = /((?:\+?\d[\d .\/-]{4,}\d)|(?:[^\s@:;,()«»"]+@[^\s@:;,()«»"]+\.[a-z]{2,})|(?:(?<![\p{L}\d])@[A-Za-z0-9._]{2,}))(\s*:\s*)\[\[([a-z0-9_]{1,40})\]\]/giu

/**
 * Mai un campo da compilare subito dopo un dato gia' scritto (numero, email, @username): il campo
 * si toglie (e sparisce se non e' nominato altrove).
 */
export function dropFieldsAfterValues(content: DocContent): DocContent {
  const dropped = new Set<string>()
  const fix = (text: string) =>
    text.replace(AFTER_VALUE, (_, value: string, _sep: string, id: string) => {
      dropped.add(id)
      return value
    })
  const next: DocContent = {
    ...content,
    title: fix(content.title),
    ...(content.subtitle ? { subtitle: fix(content.subtitle) } : {}),
    meta: content.meta.map(fix),
    sections: content.sections.map((s) => ({ ...s, paragraphs: s.paragraphs.map(fix), ...(s.bullets ? { bullets: s.bullets.map(fix) } : {}) })),
    signatures: content.signatures.map((s) => ({ ...s, label: fix(s.label), ...(s.name ? { name: fix(s.name) } : {}) })),
  }
  if (!dropped.size) return content
  const placed = placedIds(next)
  return { ...next, fields: (next.fields || []).filter((f) => !dropped.has(f.id) || placed.has(f.id)) }
}
