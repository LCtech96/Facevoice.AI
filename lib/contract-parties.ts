import { docTexts, fieldIdsIn, type DocField, type DocSection, type DocSignature, type StructuredDoc } from '@/lib/pdf-doc'

// Dati delle parti dei contratti ("Le parti"), messi dal server e non lasciati all'AI.
// Il nome del profilo Instagram, lo @username, i numeri e le email scritti in chat non
// sono dati verificati: la controparte scrive i suoi dati veri (nome e cognome, codice
// fiscale, indirizzo...) negli spazi qui sotto prima di firmare. I dati di chi crea il
// contratto vengono dall'azienda; quello che manca diventa uno spazio di chi crea.
// Niente codice del server: lo usano anche le pagine nel browser.

export const PARTIES_HEADING = 'Le parti'

export type PartyRole = 'nome' | 'nascita' | 'cf' | 'indirizzo' | 'email' | 'telefono' | 'azienda'
export type RoleSpec = { role: PartyRole; id: string; label: string; required: boolean; input: 'text' | 'email' | 'tel'; autoComplete: string }

/** Dati della controparte, in quest'ordine (id riservati per quelli che l'AI non ha gia' messo). */
export const RECIPIENT_ROLES: RoleSpec[] = [
  { role: 'nome', id: 'parte_nome', label: 'Nome e cognome', required: true, input: 'text', autoComplete: 'name' },
  { role: 'nascita', id: 'parte_nascita', label: 'Luogo e data di nascita', required: false, input: 'text', autoComplete: 'off' },
  // Obbligatorio per le persone (per un'azienda basta "Ragione sociale e P.IVA").
  { role: 'cf', id: 'parte_cf', label: 'Codice fiscale', required: true, input: 'text', autoComplete: 'off' },
  { role: 'indirizzo', id: 'parte_indirizzo', label: 'Indirizzo di residenza', required: true, input: 'text', autoComplete: 'street-address' },
  { role: 'email', id: 'parte_email', label: 'Email', required: false, input: 'email', autoComplete: 'email' },
  { role: 'telefono', id: 'parte_telefono', label: 'Telefono', required: false, input: 'tel', autoComplete: 'tel' },
  { role: 'azienda', id: 'parte_azienda', label: 'Ragione sociale e P.IVA (se azienda)', required: false, input: 'text', autoComplete: 'organization' },
]

/** Dati di chi crea il contratto che l'azienda non ha: diventano spazi di chi crea. */
export const CREATOR_SPECS = [
  { key: 'address', id: 'parte_c_sede', label: 'Sede' },
  { key: 'vat', id: 'parte_c_piva', label: 'P.IVA' },
] as const

export type CreatorInfo = { name: string; address?: string; vat?: string; person?: string }

const squash = (s: string) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** Parole che indicano chi crea il contratto: quei dati non sono della controparte. */
const CREATOR_WORDS = /\b(facevoice|fornitore|agenzia|prestatore)\b/
/** Parole che indicano la controparte ("Codice fiscale del cliente", "Nome del/della Creator"). */
const RECIPIENT_WORDS = '(cliente|controparte|creator|creatrice|collaboratore|collaboratrice|committente|influencer|contraente|sottoscrittore|sottoscrittrice|firmatario|firmataria|destinatario|destinataria|ospite|professionista|lavoratore|lavoratrice)'
const NAMES_RECIPIENT = new RegExp(`\\b${RECIPIENT_WORDS}\\b`)
/** Nome di una persona: "Nome e cognome", "Nome completo (del cliente)", "Nominativo", "Nome cliente"; mai "Nome della struttura". */
const PERSON_NAME = new RegExp(
  `^(?:(?:nome e cognome|nome cognome|cognome e nome|nome completo|nominativo|generalita)(?: .+)?|nome(?: (?:del|della|dello|dell|di)(?: (?:del|della|dello|dell))?)? ${RECIPIENT_WORDS}(?: .+)?)$`
)
/** Nomi di cose, non di persone: "Nome del B&B", "Nome del profilo Instagram"... */
const NOT_A_PERSON = /\b(struttura|b b|bnb|hotel|locale|attivita|negozio|ristorante|profilo|account|pagina|canale|brand|marchio|progetto|evento|prodotto|sito|dominio|campagna|servizio)\b/

/** Che dato della controparte e' un campo, dal suo id o dalla sua etichetta (null: nessuno). */
export function roleOf(field: Pick<DocField, 'id' | 'label'>): PartyRole | null {
  const own = RECIPIENT_ROLES.find((r) => r.id === field.id)
  if (own) return own.role
  const label = squash(field.label)
  const text = ` ${label} ${squash(field.id.replace(/_/g, ' '))} `
  if (CREATOR_WORDS.test(text) || /\bpec\b/.test(text)) return null
  if (/\b(e ?mail|mail)\b/.test(text)) return 'email'
  if (/\b(telefono|tel|cellulare|cell|whatsapp)\b/.test(text)) return 'telefono'
  if (/\b(codice fiscale|cf|c f)\b/.test(text)) return 'cf'
  if (/\b(nascita|nato|nata)\b/.test(text)) return 'nascita'
  if (/\b(ragione sociale|partita iva|p iva|piva|societa|azienda|impresa)\b/.test(text)) return 'azienda'
  if (/\b(residenza|residente|domicilio|indirizzo)\b/.test(text) && !/\b(ip|web|sito|consegna)\b/.test(text)) return 'indirizzo'
  // Nel dubbio nessuno: si aggiunge "Nome e cognome" (un doppione non fa danni, un nome mancante si').
  if (PERSON_NAME.test(label) && !NOT_A_PERSON.test(label)) return 'nome'
  return null
}

/** Dato di un firmatario (luogo e data della firma, sua email o telefono): ognuno scrive il suo. Gli altri dati "entrambi" sono termini del contratto. */
export function isSignerField(field: Pick<DocField, 'id' | 'label'>): boolean {
  const role = roleOf(field)
  if (role) return role === 'email' || role === 'telefono'
  const text = squash(`${field.label} ${field.id.replace(/_/g, ' ')}`)
  return /\b(firma|firme|firmato|sottoscrizione|sottoscritto)\b/.test(text) || /\bluogo\b.*\bdata\b|\bdata\b.*\bluogo\b/.test(text)
}

/**
 * Contratto non ancora firmato: un dato "entrambi" che non e' di un firmatario (data di
 * inizio, durata, foro...) e' un termine del contratto e lo scrive chi crea, nel testo.
 * Restituisce lo stesso oggetto se non cambia niente.
 */
export function termsToCreator(doc: StructuredDoc): StructuredDoc {
  if (!doc.fields?.some((f) => f.party === 'entrambi' && !isSignerField(f))) return doc
  return { ...doc, fields: doc.fields.map((f) => (f.party === 'entrambi' && !isSignerField(f) ? { ...f, party: 'creatore' as const } : f)) }
}

/** Per ogni dato della controparte, il campo che lo contiene (prima quelli riservati, poi quelli dell'AI). */
export function partyRoles(doc: Pick<StructuredDoc, 'fields'>): Partial<Record<PartyRole, string>> {
  const out: Partial<Record<PartyRole, string>> = {}
  const fields = doc.fields || []
  for (const spec of RECIPIENT_ROLES) if (fields.some((f) => f.id === spec.id)) out[spec.role] = spec.id
  for (const f of fields) {
    if (f.party !== 'destinatario') continue
    const role = roleOf(f)
    if (role && !out[role]) out[role] = f.id
  }
  return out
}

export type EnsureOptions = {
  /** Nessuno ha firmato: un dato personale segnato "entrambi" diventa della controparte. */
  claim?: boolean
  /** Toglie i valori messi dall'AI nei dati della controparte (vengono dalla chat: non verificati). */
  clear?: boolean
  /** Aggiunge gli spazi di chi crea per i dati dell'azienda che mancano (solo se nessuno ha firmato). */
  creatorFields?: boolean
}

/**
 * Aggiunge i dati delle parti che mancano come spazi da compilare, senza doppioni: un
 * campo dell'AI con lo stesso significato (nome, codice fiscale, indirizzo...) resta e
 * vale come quello standard. Non tocca il testo. Restituisce lo stesso oggetto se non cambia niente.
 */
export function ensureParties(doc: StructuredDoc, creator: CreatorInfo, opts: EnsureOptions = {}): StructuredDoc {
  let fields = [...(doc.fields || [])]
  let changed = false
  // Gli spazi riservati ai dati della controparte sono sempre suoi (anche se l'AI li segna di un altro).
  fields = fields.map((f) => {
    if (f.party === 'destinatario' || !RECIPIENT_ROLES.some((r) => r.id === f.id)) return f
    changed = true
    return { ...f, party: 'destinatario' as const }
  })
  if (opts.claim) {
    fields = fields.map((f) => {
      const role = f.party === 'entrambi' || f.party === 'creatore' ? roleOf(f) : null
      if (!role) return f
      // "entrambi": un dato personale e' della controparte (email e telefono possono essere di tutti e due).
      // "creatore": solo se l'etichetta nomina la controparte ("Codice fiscale del cliente").
      if (f.party === 'entrambi' ? role === 'email' || role === 'telefono' : CREATOR_SPECS.some((x) => x.id === f.id) || !NAMES_RECIPIENT.test(squash(`${f.label} ${f.id.replace(/_/g, ' ')}`))) return f
      changed = true
      const { value: _creatorValue, ...rest } = f
      return { ...rest, party: 'destinatario' as const }
    })
  }
  const roles = partyRoles({ fields })
  if (opts.clear) {
    const ids = new Set(Object.values(roles))
    fields = fields.map((f) => {
      if (!ids.has(f.id) || !f.value) return f
      changed = true
      const { value: _unverified, ...rest } = f
      return rest
    })
  }
  const taken = new Set(fields.map((f) => f.id))
  for (const spec of RECIPIENT_ROLES) {
    if (roles[spec.role] || taken.has(spec.id)) continue
    fields.push({ id: spec.id, label: spec.label, party: 'destinatario' })
    taken.add(spec.id)
    changed = true
  }
  if (opts.creatorFields) {
    for (const spec of CREATOR_SPECS) {
      if (creator[spec.key]?.trim() || taken.has(spec.id)) continue
      fields.push({ id: spec.id, label: spec.label, party: 'creatore' })
      taken.add(spec.id)
      changed = true
    }
  }
  return changed ? { ...doc, fields } : doc
}

/** Sezione "Le parti" (in cima al contratto): "Tra: <chi crea>" ed "E:" con i dati della controparte. */
export function partiesSection(doc: Pick<StructuredDoc, 'fields'>, creator: CreatorInfo): DocSection {
  const fields = doc.fields || []
  const has = (id: string) => fields.some((f) => f.id === id)
  const address = creator.address?.trim() ? `con sede in ${creator.address.trim()}` : has('parte_c_sede') ? 'sede: {{parte_c_sede}}' : ''
  const vat = creator.vat?.trim() ? `P.IVA ${creator.vat.trim()}` : has('parte_c_piva') ? 'P.IVA: {{parte_c_piva}}' : ''
  const person = creator.person?.trim() ? `rappresentata da ${creator.person.trim()}` : ''
  const roles = partyRoles(doc)
  const bullets = RECIPIENT_ROLES.flatMap((spec) => {
    const field = fields.find((f) => f.id === roles[spec.role])
    // "Etichetta: {{id}}": vuoto esce "Etichetta: ____", compilato "Etichetta: valore".
    return field ? [`${capitalize(field.label)}: {{${field.id}}}`] : []
  })
  return { heading: PARTIES_HEADING, paragraphs: [[`Tra: ${creator.name}`, address, vat, person].filter(Boolean).join(', '), 'E:'], bullets }
}

const PARTIES_HEADING_RE = /^\s*(\d+\s*[.)]?\s*)?le parti\s*$/i

/**
 * Toglie la sezione "Le parti" scritta da qui (nei documenti e' nel testo, nei contratti si
 * aggiunge mostrandoli), anche se l'AI l'ha numerata ("1. Le parti"). loose: anche una
 * "Le parti" che comincia con "Tra:" scritta in altro modo (testo da preparare, mai un testo
 * gia' firmato).
 */
export function stripPartiesSection<T extends StructuredDoc>(doc: T, opts: { loose?: boolean } = {}): T {
  const generated = (s: DocSection) =>
    PARTIES_HEADING_RE.test(s.heading || '') &&
    /^\s*Tra\s*:/i.test(s.paragraphs?.[0] || '') &&
    (opts.loose || (s.paragraphs.length === 2 && s.paragraphs[1].trim() === 'E:' && Boolean(s.bullets?.length) && s.bullets!.every((b) => /^.+: \{\{[a-z0-9_]{1,40}\}\}$/.test(b))))
  return doc.sections.some(generated) ? { ...doc, sections: doc.sections.filter((s) => !generated(s)) } : doc
}

/**
 * Testo non ancora firmato: via le righe "Tra: …" / "E: …" in "meta" e una "Le parti"
 * scritta dall'AI (ci pensa la sezione «Le parti»), e i campi che restano senza posto nel
 * testo (es. "Cognome" accanto al nome di Instagram). Restano i dati delle parti, che si
 * vedono in «Le parti». Restituisce lo stesso oggetto se non cambia niente.
 */
export function dropPartyLines(doc: StructuredDoc): StructuredDoc {
  const partyLine = (m: string) => /^\s*(Tra|E)\s*:/i.test(m)
  const stripped = stripPartiesSection(doc, { loose: true })
  const meta = (stripped.meta || []).filter((m) => !partyLine(m))
  if (stripped === doc && meta.length === (doc.meta || []).length) return doc
  const gone = new Set([...(doc.meta || []).filter(partyLine), ...doc.sections.filter((s) => !stripped.sections.includes(s)).flatMap((s) => [s.heading || '', ...(s.paragraphs || []), ...(s.bullets || [])])].flatMap(fieldIdsIn))
  const next: StructuredDoc = { ...stripped, ...(doc.meta ? { meta } : {}) }
  const used = new Set(docTexts(next).flatMap(fieldIdsIn))
  // Dati delle parti (anche quelli che passeranno alla controparte, es. "Codice fiscale del cliente" segnato di chi crea): restano.
  const kept = new Set<string>([...Object.values(partyRoles(ensureParties(next, { name: '' }, { claim: true }))), ...CREATOR_SPECS.map((x) => x.id)] as string[])
  return { ...next, fields: (next.fields || []).filter((f) => !gone.has(f.id) || used.has(f.id) || kept.has(f.id)) }
}

/** Nome della controparte sotto la sua linea di firma: lo spazio "Nome e cognome" (mai il nome della chat). */
export function recipientNameToken(doc: Pick<StructuredDoc, 'fields'>): string | null {
  const id = partyRoles(doc).nome
  return id ? `{{${id}}}` : null
}

/** Documento da firmare (non ancora contratto): "Le parti" in cima al testo e il nome giusto sotto la firma. */
export function withPartiesSection(doc: StructuredDoc, creator: CreatorInfo): StructuredDoc {
  const base = stripPartiesSection(doc)
  const token = recipientNameToken(base)
  const signatures = base.signatures?.map((s: DocSignature, i, all) => {
    const theirs = s.party === 'destinatario' || (!s.party && i === all.length - 1 && all.length > 1)
    return theirs && token ? { ...s, name: token } : s
  })
  return { ...base, sections: [partiesSection(base, creator), ...base.sections], ...(signatures ? { signatures } : {}) }
}

/** Testo da mandare all'AI senza i dati scritti dalla controparte (non servono per riscrivere; tornano dopo, per id). */
export function hideRecipientValues(doc: StructuredDoc): StructuredDoc {
  return doc.fields?.some((f) => f.party === 'destinatario' && f.value) ? { ...doc, fields: doc.fields.map((f) => (f.party === 'destinatario' ? { id: f.id, label: f.label, party: f.party } : f)) } : doc
}

// ---------------------------------------------------------------------
// Pulizia degli spazi messi male dall'AI
// ---------------------------------------------------------------------

/** Un dato gia' scritto (telefono, email, @username, sito) seguito subito da uno spazio da compilare. */
const VALUE_THEN_FIELD = /(\+?\d[\d .\/-]{6,}\d|[\w.+-]+@[\w-]+\.[\w.]+|@[A-Za-z0-9._]{2,30}|https?:\/\/\S+|www\.\S+)(\s*[:–-]\s*|\s+)\{\{\s*([a-z0-9_]{1,40})\s*\}\}/g
const DATE_LIKE = /^\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}$/

/**
 * La citta' del foro al posto dello spazio, con le parole giuste per la frase prima:
 * "il foro di {{x}}" / "Foro competente: {{x}}" -> "Palermo"; "competente il {{x}}" -> "foro di
 * Palermo"; "come foro competente {{x}}" -> "quello di Palermo"; "il Tribunale {{x}}" -> "di
 * Palermo"; altrimenti ("è competente in via esclusiva {{x}}") -> "il foro di Palermo".
 */
export function courtWords(before: string, court: string): string {
  // Solo la frase in cui sta lo spazio.
  const tail = (before.split(/[.;:!?](?=\s|$)/).pop() ?? '').toLowerCase()
  if (/(\b(di|del|della)|:)\s*$/.test(before.toLowerCase())) return court
  if (/\bl['’]\s*$/.test(tail)) return `autorità giudiziaria di ${court}`
  if (/\b(il|lo|la)\s*$/.test(tail)) return `foro di ${court}`
  if (/\b(foro|tribunale)\s+competente\s*$/.test(tail) || /\b(foro|tribunale)\b.*(^|\s)(è|e'|sarà|sara|sia|resta|rimane)\s*$/.test(tail)) return `quello di ${court}`
  if (/\b(foro|tribunale)\b/.test(tail)) return `di ${court}`
  return `il foro di ${court}`
}

const isCourtField = (f: Pick<DocField, 'id' | 'label'>) => /\b(foro|tribunale|giurisdizione)\b/.test(squash(`${f.label} ${f.id.replace(/_/g, ' ')}`))

function mapTexts(doc: StructuredDoc, fn: (text: string) => string): StructuredDoc {
  return {
    ...doc,
    title: fn(doc.title),
    ...(doc.subtitle ? { subtitle: fn(doc.subtitle) } : {}),
    ...(doc.meta ? { meta: doc.meta.map(fn) } : {}),
    sections: doc.sections.map((s) => ({ ...s, ...(s.heading ? { heading: fn(s.heading) } : {}), paragraphs: (s.paragraphs || []).map(fn), ...(s.bullets ? { bullets: s.bullets.map(fn) } : {}) })),
  }
}

/**
 * Regole che non si lasciano all'AI: mai uno spazio da compilare subito dopo un dato
 * ("3331234567: ____" esce senza la linea), e il foro competente e' una citta' vera
 * (quella di chi crea, se si sa) invece di uno spazio; se la frase la nomina gia', lo
 * spazio si toglie. courts: false lascia stare il foro. Restituisce lo stesso oggetto se non cambia niente.
 */
export function tidyFields(doc: StructuredDoc, opts: { court?: string; courts?: boolean } = {}): StructuredDoc {
  const byId = new Map((doc.fields || []).map((f) => [f.id, f]))
  const empty = (id: string) => {
    const f = byId.get(id)
    return !f || !f.value?.trim()
  }
  const touched = new Set<string>()
  let next = mapTexts(doc, (text) =>
    text.replace(VALUE_THEN_FIELD, (all, value: string, _sep: string, id: string) => {
      if (/^\+?\d/.test(value) && ((value.match(/\d/g) || []).length < 8 || DATE_LIKE.test(value.trim()))) return all
      if (!empty(id)) return all
      touched.add(id)
      return value
    })
  )
  const court = opts.court?.trim()
  const courts = opts.courts === false ? [] : (doc.fields || []).filter((f) => isCourtField(f) && !f.value?.trim()).map((f) => f.id)
  if (courts.length) {
    next = mapTexts(next, (text) => {
      let out = text
      for (const id of courts) {
        // "davanti a {{foro}}" -> "davanti al foro di Palermo".
        if (court) {
          out = out.replace(new RegExp(`\\b([Aa])\\s+\\{\\{\\s*${id}\\s*\\}\\}`, 'g'), (_all: string, a: string) => {
            touched.add(id)
            return `${a}l foro di ${court}`
          })
        }
        out = out.replace(new RegExp(`(\\s*)\\{\\{\\s*${id}\\s*\\}\\}`, 'g'), (all: string, space: string, offset: number, whole: string) => {
          const before = whole.slice(0, offset)
          // "foro di Palermo {{foro}}": la citta' c'e' gia', lo spazio si toglie.
          if (/\b(foro|tribunale) (di|del|della) [A-ZÀ-Ý][^\s,.;:]*(?: [A-ZÀ-Ý][^\s,.;:]*)*\s*$/u.test(before)) {
            touched.add(id)
            return ''
          }
          if (!court) return all
          touched.add(id)
          return `${space}${courtWords(before, court)}`
        })
      }
      return out
    })
    // Senza citta' nota il foro resta uno spazio, ma di chi crea il contratto.
    if (!court) next = { ...next, fields: (next.fields || []).map((f) => (courts.includes(f.id) && f.party !== 'creatore' ? { ...f, party: 'creatore' as const } : f)) }
  }
  // Campi rimasti senza posto nel testo dopo la pulizia: si tolgono.
  const used = new Set(docTexts(next).flatMap(fieldIdsIn))
  const out = touched.size ? { ...next, fields: (next.fields || []).filter((f) => !touched.has(f.id) || used.has(f.id)) } : next
  return JSON.stringify(out) === JSON.stringify(doc) ? doc : out
}

// ---------------------------------------------------------------------
// Compilazione (pagina del link e pagina di chi crea)
// ---------------------------------------------------------------------

/** Valore scritto da una persona: una riga, senza parentesi graffe (non diventa mai un campo), al massimo 300 caratteri. */
export function cleanValue(value: unknown, max = 300): string {
  return typeof value === 'string'
    ? value
        .replace(/[\u0000-\u001f\u007f{}]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max)
    : ''
}

export type DataEntry = { id: string; label: string; required: boolean; role?: PartyRole }

/** Dati obbligatori ancora vuoti. Il codice fiscale non serve se c'e' "Ragione sociale e P.IVA". */
export function missingData<T extends DataEntry>(entries: T[], valueOf: (id: string) => string): T[] {
  const company = entries.find((e) => e.role === 'azienda')
  const isCompany = Boolean(company && valueOf(company.id).trim())
  return entries.filter((e) => (e.role === 'cf' ? !isCompany : e.required) && !valueOf(e.id).trim())
}

/** Codice fiscale scritto male? (16 caratteri come RSSMRA80A01H501U, o 11 cifre di una partita IVA). Solo un avviso. */
export function taxCodeLooksWrong(value: string): boolean {
  const v = String(value || '').replace(/\s+/g, '').toUpperCase()
  if (!v) return false
  return !(/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(v) || /^\d{11}$/.test(v))
}

export const TAX_CODE_HINT = 'Controlla il codice fiscale: di solito ha 16 caratteri, oppure 11 cifre se è una partita IVA.'

/** Campo per la pagina: tipo di tastiera e completamento automatico giusti. */
export function inputSpec(role: PartyRole | undefined): Pick<RoleSpec, 'input' | 'autoComplete'> {
  const spec = RECIPIENT_ROLES.find((r) => r.role === role)
  return spec ? { input: spec.input, autoComplete: spec.autoComplete } : { input: 'text', autoComplete: 'off' }
}
