// Dati delle parti dei contratti (beta): la parte comune al server e alle pagine (nessuna
// dipendenza, si puo' usare anche nel browser). Ogni contratto ha in cima «Le parti»: i dati di
// chi lo prepara (nome dello spazio e, se ci sono, P.IVA e sede dalle Istruzioni) e i campi di
// identita' di chi lo riceve, che li scrive lui (nome e cognome veri, codice fiscale, residenza…).
// Il nome del profilo Instagram, lo @username e i numeri o le email scritti in chat non sono dati
// verificati: non diventano mai i dati di una parte.

export type IdentityKind = 'nome' | 'nascita' | 'cf' | 'indirizzo' | 'email' | 'telefono' | 'azienda' | 'piva' | 'sede'
export type IdentityInput = 'text' | 'email' | 'tel'
export type IdentityParty = 'creatore' | 'destinatario'
export type IdentitySpec = {
  kind: IdentityKind
  /** Id del campo standard (se il testo non ha gia' un campo con lo stesso significato). */
  id: string
  label: string
  /** Etichetta quando il dato e' gia' noto (dati dello spazio). */
  short?: string
  party: IdentityParty
  required?: true
  /** Obbligatorio solo se il campo di quest'altro tipo e' vuoto (codice fiscale: non serve se c'e' l'azienda). */
  requiredUnless?: IdentityKind
  input: IdentityInput
  autoComplete?: string
}

/** Campi di chi riceve il contratto, nell'ordine in cui si mostrano. */
export const RECIPIENT_IDENTITY: IdentitySpec[] = [
  { kind: 'nome', id: 'parte_nome', label: 'Nome e cognome', party: 'destinatario', required: true, input: 'text', autoComplete: 'name' },
  { kind: 'nascita', id: 'parte_nascita', label: 'Luogo e data di nascita', party: 'destinatario', input: 'text' },
  { kind: 'cf', id: 'parte_cf', label: 'Codice fiscale', party: 'destinatario', requiredUnless: 'azienda', input: 'text' },
  { kind: 'indirizzo', id: 'parte_indirizzo', label: 'Indirizzo di residenza', party: 'destinatario', required: true, input: 'text', autoComplete: 'street-address' },
  { kind: 'email', id: 'parte_email', label: 'Email', party: 'destinatario', input: 'email', autoComplete: 'email' },
  { kind: 'telefono', id: 'parte_telefono', label: 'Telefono', party: 'destinatario', input: 'tel', autoComplete: 'tel' },
  { kind: 'azienda', id: 'parte_azienda', label: 'Ragione sociale e P.IVA (se azienda)', party: 'destinatario', input: 'text', autoComplete: 'organization' },
]

/** Dati di chi prepara il contratto che possono mancare nello spazio di lavoro (li scrive il titolare). */
export const CREATOR_IDENTITY: IdentitySpec[] = [
  { kind: 'piva', id: 'titolare_piva', label: 'P.IVA o codice fiscale', short: 'P.IVA', party: 'creatore', input: 'text' },
  { kind: 'sede', id: 'titolare_sede', label: 'Indirizzo della sede', short: 'Sede', party: 'creatore', input: 'text', autoComplete: 'street-address' },
]

const words = (text: string) =>
  ` ${text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9@]+/g, ' ')
    .trim()} `

/** Campi dell'altra parte che non sono suoi dati di identita' anche se dicono "nome" o "indirizzo" (consegna, brand, conto…). */
const NOT_RECIPIENT_IDENTITY = / (consegna|consegne|spedizione|spedire|ritiro|brand|marchio|locale|negozio|ristorante|evento|conto|intestatario|intestataria|banca|bancario|iban|fatturazione|prodotto|prodotti|progetto|campagna|hotel|struttura) /
/** Campi del titolare che non sono la sua sede o la sua P.IVA (consegna, evento, dati dell'altra parte…). */
const NOT_CREATOR_IDENTITY = / (consegna|consegne|spedizione|ritiro|evento|fatturazione|cliente|creator|destinatario|destinataria|controparte|influencer) /
const ROLE = '(?:creator|controparte|cliente|influencer|destinatario|destinataria|collaboratore|collaboratrice)'
const NAME_LABEL = new RegExp(`^nome(?: (?:del|della|dello|di))? ${ROLE}$`)
const ADDRESS_LABEL = new RegExp(`^indirizzo(?: completo)?(?: (?:del|della|dello|di) ${ROLE})?$`)

/**
 * Di che dato di identita' parla un campo scritto dall'AI (dall'id e dall'etichetta), per non
 * ripeterlo in «Le parti»: solo i campi della stessa parte e solo se e' chiaro (es. "Nome e
 * cognome", "Codice fiscale", "Residenza"). "Nome del brand", "Indirizzo di consegna" o "Nome
 * intestatario del conto" no: restano campi del testo. Profilo, @username o nome d'arte mai.
 */
export function identityKind(field: { id: string; label: string; party: string }): IdentityKind | null {
  const w = words(`${field.id} ${field.label}`)
  const label = words(field.label).trim()
  if (/ (instagram|profilo|username|handle|account|nickname|arte|social|tiktok|youtube) /.test(w)) return null
  if (field.party === 'destinatario') {
    if (NOT_RECIPIENT_IDENTITY.test(w)) return null
    if (/ (e ?mail|pec) /.test(w)) return 'email'
    if (/ (telefono|telefonico|cellulare|cell|tel|whatsapp|phone|mobile) /.test(w)) return 'telefono'
    if (/ (codice fiscale|cod fisc|c f|cf) /.test(w)) return 'cf'
    if (/ (ragione sociale|denominazione sociale|partita iva|p iva|piva|vat) /.test(w) || /^(?:nome (?:dell |della |del |di )?)?(?:azienda|societa|ditta|impresa)$/.test(label)) return 'azienda'
    if (/ (nascita|nato|nata) /.test(w)) return 'nascita'
    if ((/ (residenza|residente|domicilio|domiciliato|domiciliata) /.test(w) || ADDRESS_LABEL.test(label)) && !/ sede /.test(w)) return 'indirizzo'
    if (/ (nome e cognome|cognome e nome|nome cognome|nominativo|nome completo) /.test(w) || NAME_LABEL.test(label) || label === 'nome') return 'nome'
  } else if (field.party === 'creatore') {
    if (NOT_CREATOR_IDENTITY.test(w)) return null
    if (/ (partita iva|p iva|piva|vat) /.test(w)) return 'piva'
    if (/ (sede|indirizzo) /.test(w) && !/ (e ?mail|pec) /.test(w)) return 'sede'
  }
  return null
}

/**
 * Campi "di entrambi" che ognuno scrive per se': luogo e data della firma (un valore per parte).
 * Gli altri (es. data del pagamento) sono un valore solo, uguale per tutti.
 */
export function perSigner(field: { id: string; label: string }): boolean {
  const w = words(`${field.id} ${field.label}`)
  const label = words(field.label).trim()
  return (/ (firma|firmato|sottoscrizione) /.test(w) && / (luogo|data|citta|giorno) /.test(w)) || ['data', 'luogo', 'luogo e data', 'data e luogo'].includes(label)
}

const CF_RE = /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-EHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/
const VAT_RE = /^\d{11}$/

/** Controllo gentile del dato scritto (non blocca la firma): una frase se sembra sbagliato, altrimenti null. */
export function identityWarning(kind: string | undefined, value: string | undefined): string | null {
  const v = (value || '').trim()
  if (!v || !kind) return null
  if (kind === 'cf') {
    const x = v.replace(/[\s.-]+/g, '').toUpperCase()
    return CF_RE.test(x) || VAT_RE.test(x) ? null : 'Controlla il codice fiscale: di solito ha 16 caratteri (o 11 cifre per un’azienda).'
  }
  if (kind === 'email') return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v) ? null : 'Controlla l’email: sembra scritta male.'
  if (kind === 'telefono') return v.replace(/\D/g, '').length >= 6 ? null : 'Controlla il numero di telefono.'
  if (kind === 'piva') {
    const x = v.replace(/[\s.-]+/g, '').toUpperCase().replace(/^IT/, '')
    return VAT_RE.test(x) || CF_RE.test(x) ? null : 'Controlla la partita IVA: di solito ha 11 cifre.'
  }
  return null
}

export type RequiredField = { id: string; label: string; required?: boolean; requiredUnless?: string }

/** Etichette dei campi obbligatori ancora vuoti (requiredUnless: id del campo che li rende facoltativi). */
export function missingRequired(fields: RequiredField[], valueOf: (id: string) => string | undefined): string[] {
  const empty = (id: string) => !(valueOf(id) || '').trim()
  return fields.filter((f) => empty(f.id) && (f.required || (f.requiredUnless ? empty(f.requiredUnless) : false))).map((f) => f.label)
}

// --- Termini della collaborazione ------------------------------------------------------------------
// Subito dopo «Le parti», in ogni contratto: data e ora della collaborazione e termine di consegna
// dei contenuti (7, 14 o 30 giorni dalla data della collaborazione). Li sceglie chi prepara il
// contratto (campi suoi: si bloccano con la sua firma e li copre la sua impronta); chi lo riceve li
// vede e basta. "Nessuna data stabilita" / "Nessun termine" sono una scelta, stampata cosi'.
// Valori salvati: "AAAA-MM-GGTHH:MM" (ora italiana, come <input type="datetime-local">) o "nessuna";
// "7", "14", "30" o "nessuno".

export type TermKind = 'collab_at' | 'delivery_days'
export const TERMS_HEADING = 'Termini della collaborazione'
export const NO_DATE = 'nessuna'
export const NO_DAYS = 'nessuno'
export const DELIVERY_DAYS = ['7', '14', '30'] as const
export type TermSpec = { kind: TermKind; id: string; label: string }
export const TERM_SPECS: TermSpec[] = [
  { kind: 'collab_at', id: 'termini_data', label: 'Data e ora della collaborazione' },
  { kind: 'delivery_days', id: 'termini_consegna', label: 'Termine di consegna dei contenuti' },
]
export const isTermKind = (kind: unknown): kind is TermKind => kind === 'collab_at' || kind === 'delivery_days'

const LOCAL_DT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/
const WEEKDAYS = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato']
export const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']

/** "AAAA-MM-GGTHH:MM" che esiste davvero (niente 31 aprile, niente 25:00). */
export function validLocalDateTime(value: string): boolean {
  const m = value.match(LOCAL_DT)
  if (!m) return false
  const [y, mo, d, h, mi] = m.slice(1).map(Number)
  if (y < 2000 || y > 2100 || h > 23 || mi > 59) return false
  const date = new Date(Date.UTC(y, mo - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
}

/**
 * Valore di un termine scritto nella pagina, pulito: "" (vuoto), il valore valido, oppure null
 * (non valido: non si salva). Data: "AAAA-MM-GGTHH:MM" o "nessuna"; consegna: 7, 14, 30 o "nessuno".
 */
export function cleanTermValue(kind: TermKind, raw: unknown): string | null {
  const v = typeof raw === 'string' ? raw.trim().toLowerCase() : typeof raw === 'number' ? String(raw) : ''
  if (!v) return ''
  if (kind === 'collab_at') {
    if (v === NO_DATE) return NO_DATE
    const value = v.toUpperCase().slice(0, 16)
    return validLocalDateTime(value) ? value : null
  }
  if (v === NO_DAYS) return NO_DAYS
  return (DELIVERY_DAYS as readonly string[]).includes(v) ? v : null
}

/** "sabato 15 novembre 2026, ore 20:30" da "2026-11-15T20:30" (ora italiana, senza conversioni). */
export function collabAtText(value: string): string {
  if (value === NO_DATE) return 'Nessuna data stabilita'
  const m = value.match(LOCAL_DT)
  if (!m || !validLocalDateTime(value)) return ''
  const [y, mo, d] = m.slice(1, 4).map(Number)
  const weekday = WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]
  return `${weekday} ${d} ${MONTHS[mo - 1]} ${y}, ore ${m[4]}:${m[5]}`
}

/** "entro 7 giorni dalla data della collaborazione" (o "Nessun termine"). */
export function deliveryText(value: string): string {
  if (value === NO_DAYS) return 'Nessun termine'
  return (DELIVERY_DAYS as readonly string[]).includes(value) ? `entro ${value} giorni dalla data della collaborazione` : ''
}

/** Un termine come si stampa ("" se non e' ancora scelto o non e' valido). */
export function termText(kind: TermKind, value: string | undefined): string {
  const v = cleanTermValue(kind, value || '')
  if (!v) return ''
  return kind === 'collab_at' ? collabAtText(v) : deliveryText(v)
}
