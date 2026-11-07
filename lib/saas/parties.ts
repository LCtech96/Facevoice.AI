import type { PdfSection } from '@/lib/pdf-doc'
import type { DocContent, DocField } from './documents'
import { CREATOR_IDENTITY, RECIPIENT_IDENTITY, TERMS_HEADING, TERM_SPECS, identityKind, isTermKind, termText, type IdentityInput, type IdentityKind, type IdentitySpec, type TermKind } from './parties-shared'

// «Le parti» dei contratti (beta), messe dal server e non lasciate all'AI: in cima a ogni
// documento da firmare (contratto, accordo, preventivo e ogni documento condiviso come contratto)
// "Tra:" i dati di chi lo prepara (nome dello spazio; P.IVA e sede se sono nelle Istruzioni,
// altrimenti campi che scrive il titolare) "e:" i campi di identita' di chi lo riceve (nome e
// cognome, luogo e data di nascita, codice fiscale, residenza, email, telefono, azienda), che
// scrive lui dalla pagina del link. Un campo che l'AI ha gia' creato con lo stesso significato
// (es. "cf_giusy" con etichetta "Codice fiscale") si usa al posto di quello standard: mai due volte.
// Qui solo funzioni pure (nessun accesso al database): le usano lib/saas/contracts.ts e, per il
// PDF del documento, lib/saas/documents.ts.
// Subito dopo «Le parti», «Termini della collaborazione» (sempre, messi dal server): data e ora della
// collaborazione e termine di consegna dei contenuti, due campi di chi prepara il contratto.

export const PARTIES_HEADING = 'Le parti'
/** Tipi di documento che hanno sempre «Le parti» (anche prima di diventare un contratto). */
export const CONTRACT_KINDS: readonly string[] = ['contratto', 'accordo', 'preventivo']
const BLANK = '_'.repeat(28)

/** Chi prepara il documento: nome dello spazio e i dati trovati nelle Istruzioni. */
export type CreatorIdentity = { name: string; vat?: string; address?: string; city?: string; court?: string }

export type PartyLine = {
  kind: IdentityKind | 'denominazione' | TermKind
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
/**
 * legacyBoth: contratti di prima firmati per primo dal destinatario (i campi di entrambi nel testo erano suoi).
 * terms: «Termini della collaborazione» (data e ora, termine di consegna): campi standard di chi prepara
 * il contratto. Mancano solo nei contratti di prima gia' firmati (si aggiungono con una nuova versione).
 */
export type Parties = { v: 1; creator: PartyLine[]; recipient: PartyLine[]; legacyBoth?: 'destinatario'; terms?: PartyLine[] }
/** Prefill dei termini (dalla chat dell'Assistente o proposti dall'AI): valori gia' puliti. */
export type TermsPrefill = { at?: string; days?: string }

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
const STREET_RE_ALL = new RegExp(`(?<![\\p{L}])${STREET}\\s+${STREET_WORD}(?:\\s+${STREET_WORD}){0,6}?\\s*,?\\s*(?:n\\.?\\s*)?\\d{1,4}[A-Za-z]?(?![\\p{L}\\d])`, 'gu')
const AFTER_STREET_RE = new RegExp(`^\\s*[,–-]?\\s*(\\d{5})\\s+(${CITY_WORD})(?:\\s*\\(([A-Z]{2})\\))?`, 'u')
const CAP_CITY_RE = new RegExp(`(?<!\\d)(\\d{5})\\s+(${CITY_WORD})\\s*\\(([A-Z]{2})\\)`, 'u')
const COURT_RE = new RegExp(`(?<![\\p{L}])(?:[Ff]oro|[Tt]ribunale)\\s+(?:competente\\s+)?(?:è\\s+quello\\s+)?di\\s+(${CITY_WORD})`, 'u')
const CAPOLUOGO = `(${CAPOLUOGHI.map(escapeRe).join('|')})(?![\\p{L}])`
/** "Sede a Palermo", "con sede legale in Roma", "siamo a Palermo": la citta' della sede detta chiaramente. */
const SEAT_RE = new RegExp(`(?<![\\p{L}])(?:[Ss]ede(?:\\s+legale|\\s+operativa)?|[Ss]iamo|[Cc]i\\s+trovi(?:te)?|[Ss]i\\s+trova|[Ss]ituat[ao])\\s*(?::|\\s(?:a|ad|in))\\s+${CAPOLUOGO}`, 'u')
/** Indirizzo con l'etichetta subito prima ("Sede: Via Roma 10", "indirizzo: Corso Italia 5"). */
const LABELLED_ADDRESS = /(?:sede(?:\s+legale|\s+operativa)?|indirizzo)\s*(?::|\s(?:in|a|è))?\s*$/i
const VAT_RE = /(?<![\p{L}])(?:p\.?\s?iva|partita\s+iva|vat)(?![\p{L}])[^0-9\n]{0,15}((?:IT)?\s?\d{11})(?!\d)/iu

/**
 * Dati di chi prepara il documento dalle Istruzioni: P.IVA, indirizzo della sede, citta' e citta'
 * del foro. Solo quando sono scritti chiaramente: l'indirizzo con CAP e citta' (o con "Sede:" /
 * "Indirizzo:" prima), il foro scritto ("Foro di Palermo"), dalla provincia o dal CAP dell'indirizzo,
 * oppure la sede detta chiaramente ("sede a Palermo", "Pizzeria Gusto a Palermo"). Una citta'
 * nominata per altro ("la vera pizza di Napoli", "spediamo da Milano") non conta. Quello che non si
 * trova resta vuoto: diventa un campo che scrive il titolare.
 */
export function creatorFromInstructions(name: string, text: string): CreatorIdentity {
  const t = String(text || '').slice(0, 8000)
  const out: CreatorIdentity = { name: String(name || '').trim().slice(0, 120) }
  const vat = t.match(VAT_RE)
  if (vat) out.vat = vat[1].replace(/\s+/g, '').replace(/^IT/i, '')
  let province = ''
  for (const street of t.matchAll(STREET_RE_ALL)) {
    const at = street.index ?? 0
    const rest = t.slice(at + street[0].length).match(AFTER_STREET_RE)
    if (!rest && !LABELLED_ADDRESS.test(t.slice(Math.max(0, at - 30), at))) continue
    out.address = `${street[0].replace(/\s+/g, ' ').trim()}${rest ? `, ${rest[1]} ${rest[2]}${rest[3] ? ` (${rest[3]})` : ''}` : ''}`.slice(0, 200)
    if (rest) {
      out.city = rest[2]
      province = rest[3] || ''
    }
    break
  }
  if (!out.city) {
    const cap = t.match(CAP_CITY_RE)
    if (cap) {
      out.city = cap[2]
      province = cap[3]
    }
  }
  const explicit = t.match(COURT_RE)?.[1]
  const business = out.name.length >= 3 ? t.match(new RegExp(`(?<![\\p{L}])${escapeRe(out.name)}\\s*,?\\s(?:a|ad|in)\\s+${CAPOLUOGO}`, 'u'))?.[1] : undefined
  const seat = t.match(SEAT_RE)?.[1] || business
  out.court = explicit || (province && PROVINCES[province]) || (out.city && CAPOLUOGHI.includes(out.city) ? out.city : '') || seat || undefined
  if (!out.city && seat) out.city = seat
  if (!out.court) delete out.court
  if (!out.city) delete out.city
  return out
}

// --- Blocco delle parti --------------------------------------------------------------------------

/**
 * «Le parti» per questo testo: campi standard, oppure i campi dell'AI con lo stesso significato
 * (ognuno usato una volta sola, solo della stessa parte; mai un campo messo subito dopo un dato
 * gia' scritto, come «3313738940: [[numero]]»). prefill: valori per i campi del titolare scritti
 * dall'AI quando il dato e' gia' nelle Istruzioni (es. la P.IVA).
 */
export function buildParties(content: DocContent, creator: CreatorIdentity): { parties: Parties; prefill: Record<string, string> } {
  const fields = content.fields || []
  const ids = new Set(fields.map((f) => f.id))
  const taken = afterValueIds(content)
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
  // Termini della collaborazione: sempre campi standard (mai quelli dell'AI), obbligatori.
  const terms: PartyLine[] = TERM_SPECS.map((spec) => ({ kind: spec.kind, label: spec.label, party: 'creatore', id: unique(spec.id), std: true, required: true }))
  return { parties: { v: 1, creator: creatorLines, recipient, terms }, prefill }
}

/** Righe dei termini della collaborazione (nessuna nei contratti di prima gia' firmati). */
export const termLines = (p: Parties): PartyLine[] => p.terms || []
/** Id del campo di un termine. */
export const termId = (p: Parties, kind: TermKind): string | undefined => termLines(p).find((l) => l.kind === kind)?.id
/** Lo stesso blocco senza i termini (contratti di prima gia' firmati: non si cambia quello che e' stato firmato). */
export const withoutTerms = (p: Parties): Parties => {
  if (!p.terms) return p
  const { terms: _terms, ...rest } = p
  return rest
}

export const partyLines = (p: Parties): PartyLine[] => [...p.creator, ...p.recipient, ...termLines(p)]

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

/**
 * «Le parti» nel PDF: "Tra:" con i dati di chi prepara il documento, "e:" con quelli dell'altra parte;
 * poi «Termini della collaborazione» (valueOf da' i termini gia' scritti in parole: "sabato 15 …").
 */
export function partiesPdfSections(p: Parties, valueOf: (id: string) => string | undefined): PdfSection[] {
  const terms = termLines(p)
  return [
    { heading: PARTIES_HEADING, paragraphs: ['Tra:'], bullets: p.creator.map((l) => partyLineText(l, valueOf)).filter(Boolean) },
    { paragraphs: ['e:'], bullets: p.recipient.map((l) => partyLineText(l, valueOf)) },
    ...(terms.length ? [{ heading: TERMS_HEADING, paragraphs: [], bullets: terms.map((l) => partyLineText(l, valueOf)) }] : []),
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
export function documentParties(kind: string, content: DocContent, creator: CreatorIdentity, terms: TermsPrefill = {}): { sections: PdfSection[]; content: DocContent } | null {
  if (!CONTRACT_KINDS.includes(kind) || content.sections[0]?.heading === PARTIES_HEADING) return null
  const { parties, prefill } = buildParties(content, creator)
  const byId = new Map((content.fields || []).map((f) => [f.id, f]))
  const hidden = hiddenInExtras(parties, content)
  // Termini gia' scelti in chat (data e ora, consegna): in parole, come nel contratto.
  const termValue = new Map(termLines(parties).flatMap((l) => (l.id && isTermKind(l.kind) ? [[l.id, termText(l.kind, l.kind === 'collab_at' ? terms.at : terms.days)] as const] : [])))
  return {
    sections: partiesPdfSections(parties, (id) => (termValue.has(id) ? termValue.get(id) : byId.get(id)?.value || prefill[id])),
    content: { ...content, fields: (content.fields || []).filter((f) => !hidden.has(f.id)) },
  }
}

// --- Campo subito dopo un dato ---------------------------------------------------------------------

/** "3313738940: [[campo]]", "giusy@x.it: [[campo]]", "@giusy: [[campo]]": un dato gia' scritto e poi una riga vuota. */
const AFTER_VALUE = /((?:\+?\d[\d .\/-]{4,}\d)|(?:[^\s@:;,()«»"]+@[^\s@:;,()«»"]+\.[a-z]{2,})|(?:(?<![\p{L}\d])@[A-Za-z0-9._]{2,}))(\s*:\s*)\[\[([a-z0-9_]{1,40})\]\]/giu

/** Campi messi subito dopo un dato gia' scritto (contratti di prima gia' firmati): mai dati di identita', mai caselle. */
export function afterValueIds(content: DocContent): Set<string> {
  const out = new Set<string>()
  for (const text of textsOf(content)) for (const m of text.matchAll(AFTER_VALUE)) out.add(m[3])
  return out
}

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

// --- Pulizia del testo dei contratti -------------------------------------------------------------

/**
 * Testo di un contratto: via le righe «Tra: …» / «E: …» sotto il titolo (le parti sono in «Le
 * parti») e il nome scritto sotto la firma dell'altra parte (il nome del profilo non e' un dato
 * verificato: sotto la firma va il nome e cognome che scrive lei). I campi restano.
 */
export function withoutPartyLines(content: DocContent): DocContent {
  const meta = content.meta.filter((m) => !/^\s*(?:tra|fra)\b|^\s*e\s*:/i.test(m))
  const signatures = content.signatures.map((s, k) => (k === 1 && s.name && !/\[\[[a-z0-9_]{1,40}\]\]/.test(s.name) ? { label: s.label } : s))
  return meta.length === content.meta.length && signatures.every((s, k) => s === content.signatures[k]) ? content : { ...content, meta, signatures }
}

/** Contratto, accordo o preventivo scritto dall'AI: senza righe «Tra:/E:» ne' il nome del profilo sotto la firma. */
export const cleanContractContent = (kind: string, content: DocContent): DocContent => (CONTRACT_KINDS.includes(kind) ? withoutPartyLines(content) : content)

/**
 * Testo senza «Le parti» in cima (documento di un contratto firmato, con i dati scritti dalle
 * persone): quello che si manda all'AI per cambiare il documento non contiene mai quei dati.
 */
export function withoutParties(content: DocContent): DocContent {
  if (content.sections[0]?.heading !== PARTIES_HEADING) return content
  let k = 1
  while (k < content.sections.length && !content.sections[k].heading && content.sections[k].paragraphs[0] === 'e:') k++
  // «Termini della collaborazione» subito dopo: anche loro scritti dal sistema, non dall'AI.
  if (content.sections[k]?.heading === TERMS_HEADING) k++
  return { ...content, sections: content.sections.slice(k) }
}
