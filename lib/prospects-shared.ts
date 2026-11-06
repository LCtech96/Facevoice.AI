// Trova clienti (pagina Automazioni): regole usate sia dal server (lib/saas/prospects.ts)
// sia dalla pagina (app/app/automazioni). Niente database qui.

/** Stato di un'azienda trovata. "nuova" e "in_invio" sono passaggi interni (sito da leggere, invio in corso). */
export type ProspectStatus = 'nuova' | 'da_approvare' | 'approvata' | 'in_invio' | 'inviata' | 'saltata' | 'senza_email' | 'non_contattare' | 'errore'

/** approve: il cliente approva ogni email; auto: l'AI sceglie, scrive e invia da sola all'orario. */
export type ProspectMode = 'approve' | 'auto'

export const PROSPECT_STATUSES: ProspectStatus[] = ['nuova', 'da_approvare', 'approvata', 'in_invio', 'inviata', 'saltata', 'senza_email', 'non_contattare', 'errore']

/** Email al giorno di Trova clienti (scelte dal cliente), dentro il limite di 20 al giorno in tutto. */
export const PROSPECT_EMAILS_MIN = 1
export const PROSPECT_EMAILS_MAX = 20

export const PROSPECTS_LEGAL = 'Scrivi solo ad aziende, con un messaggio utile; chi risponde "no" non viene più contattato.'
export const SEARCH_UNAVAILABLE = 'Ricerca aziende non disponibile in questo momento'

/** Riga in fondo a ogni prima email, nella lingua dell'azienda (sempre presente, anche se il testo e' cambiato a mano). */
export const OPT_OUT_LINES: Record<string, string> = {
  it: 'Se non vuoi ricevere altre email, rispondi pure "no".',
  en: 'If you’d rather not get more emails, just reply "no".',
  es: 'Si no quieres recibir más correos, responde simplemente "no".',
  fr: 'Si vous ne souhaitez plus recevoir d’e-mails, répondez simplement « non ».',
  de: 'Wenn Sie keine weiteren E-Mails erhalten möchten, antworten Sie einfach mit „nein“.',
  pt: 'Se não quiser receber mais e-mails, basta responder "não".',
}

export const optOutLine = (language: string | null | undefined) => OPT_OUT_LINES[String(language || '').toLowerCase().slice(0, 2)] || OPT_OUT_LINES.it

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’‘`]/g, "'")
    .toLowerCase()

/** Il testo ha gia' la riga per non ricevere altre email (in una delle lingue)? */
export function hasOptOutLine(body: string): boolean {
  const text = fold(body).replace(/\s+/g, ' ')
  return Object.values(OPT_OUT_LINES).some((line) => text.includes(fold(line).replace(/\s+/g, ' ')))
}

/** Testo con la riga per non ricevere altre email in fondo (aggiunta solo se manca). */
export function withOptOut(body: string, language: string | null | undefined): string {
  const clean = body.replace(/\r\n/g, '\n').trim()
  return hasOptOutLine(clean) ? clean : `${clean}\n\n${optOutLine(language)}`
}

// Risposte che chiedono di non essere piu' contattati: brevi "no" (anche "No, grazie") o frasi chiare.
const EXACT_NO = new Set([
  'no', 'no grazie', 'no grazie mille', 'grazie no', 'non grazie', 'no non mi interessa', 'no non ci interessa', 'nein', 'nein danke', 'non', 'non merci',
  'nao', 'nao obrigado', 'nao obrigada', 'no thanks', 'no thank you', 'no gracias', 'stop', 'basta', 'unsubscribe', 'cancellami', 'rimuovimi', 'remove me', 'no interessa',
])
const STOP_PHRASES = [
  /non (mi|ci) interess/,
  /non (sono|siamo) interessat/,
  /non (mi|ci) (scriv|contatt|mand|invi)/,
  /non (scrivete|scrivetemi|scriveteci|scrivermi|scriverci|contattatemi|contattateci|contattarmi|contattarci|inviate|mandate)/,
  /(cancellate|cancellami|cancellatemi|cancellateci|rimuovete|rimuovimi|rimuovetemi|toglietemi|toglieteci)/,
  /\bunsubscribe\b/,
  /\bremove (me|us)\b/,
  /\bnot interested\b/,
  /\b(do not|don't|dont) (contact|email|write)\b/,
  /\bstop (emailing|writing|sending|contacting)\b/,
  /\bno me interesa\b/,
  /\bno (estoy|estamos) interesad/,
  /\bpas interesse/,
  /ne (m|nous)'interesse pas/,
  /\bkein interesse\b/,
  /\bnicht interessiert\b/,
  /\bnao (tenho|temos) interesse\b/,
]

/** La risposta di un'azienda contattata chiede di non scriverle piu' ("no", "non mi interessa", "unsubscribe"…). */
export function isOptOutReply(text: string): boolean {
  const head = fold(String(text || '')).slice(0, 600)
  const simple = (s: string) => s.replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (EXACT_NO.has(simple(head))) return true
  const firstLine = head.split('\n').map((l) => l.trim()).find(Boolean) || ''
  if (EXACT_NO.has(simple(firstLine))) return true
  return STOP_PHRASES.some((re) => re.test(head))
}

/** Voce della lista "Non contattare": un indirizzo (mario@esempio.it) o un dominio intero (@esempio.it). */
export function cleanBlockEntry(raw: unknown): string | null {
  const value = String(raw ?? '').trim().toLowerCase().replace(/^mailto:/, '')
  if (/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(value)) return value
  const domain = value.replace(/^@/, '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(domain) ? `@${domain}` : null
}
