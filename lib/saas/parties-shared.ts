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

/**
 * Di che dato di identita' parla un campo scritto dall'AI (dall'id e dall'etichetta), per non
 * ripeterlo in «Le parti»: solo i campi della stessa parte. Profilo, @username o nome d'arte no.
 */
export function identityKind(field: { id: string; label: string; party: string }): IdentityKind | null {
  const w = words(`${field.id} ${field.label}`)
  if (/ (instagram|profilo|username|handle|account|nickname|arte|social|tiktok|youtube) /.test(w)) return null
  if (field.party === 'destinatario') {
    if (/ (e ?mail|pec) /.test(w)) return 'email'
    if (/ (telefono|telefonico|cellulare|cell|tel|whatsapp|phone|mobile) /.test(w)) return 'telefono'
    if (/ (codice fiscale|cod fisc|c f|cf) /.test(w)) return 'cf'
    if (/ (ragione sociale|partita iva|p iva|piva|vat|azienda|societa|ditta) /.test(w)) return 'azienda'
    if (/ (nascita|nato|nata) /.test(w)) return 'nascita'
    if (/ (indirizzo|residenza|residente|domicilio|via) /.test(w)) return 'indirizzo'
    if (/ (nome|nominativo|cognome) /.test(w)) return 'nome'
  } else if (field.party === 'creatore') {
    if (/ (partita iva|p iva|piva|vat) /.test(w)) return 'piva'
    if (/ (sede|indirizzo) /.test(w) && !/ (e ?mail|pec) /.test(w)) return 'sede'
  }
  return null
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
