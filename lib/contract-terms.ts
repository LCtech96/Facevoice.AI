import type { DocField, DocSection, StructuredDoc } from '@/lib/pdf-doc'

// «Termini della collaborazione» dei contratti: subito dopo «Le parti», due dati che
// sceglie chi crea il contratto (mai l'AI da sola, mai la controparte):
//   - "Data e ora della collaborazione" (giorno e ora in cui si fa: ora italiana)
//   - "Termine di consegna dei contenuti" (7, 14 o 30 giorni dalla data della collaborazione)
// Per tutti e due si puo' scegliere apposta "nessuna data" / "nessun termine" (stampato cosi').
// Sono spazi di chi crea: entrano nell'impronta del testo che firma e si bloccano alla sua
// firma. Senza tutti e due il contratto non si condivide e non si firma.
// Niente codice del server: lo usano anche le pagine nel browser.

export const TERMS_HEADING = 'Termini della collaborazione'
export const TERMS_DATE_ID = 'termini_data'
export const TERMS_DAYS_ID = 'termini_consegna'
export const TERMS_IDS: readonly string[] = [TERMS_DATE_ID, TERMS_DAYS_ID]
export const TERMS_DATE_LABEL = 'Data e ora della collaborazione'
export const TERMS_DAYS_LABEL = 'Termine di consegna dei contenuti'
export const DELIVERY_DAYS = [7, 14, 30] as const
export type DeliveryDays = (typeof DELIVERY_DAYS)[number]
/** Scelta voluta di chi crea: stampata cosi' nel contratto. */
export const NO_DATE = 'Nessuna data stabilita'
export const NO_TERM = 'Nessun termine'

export const isTermsId = (id: string) => TERMS_IDS.includes(id)

/**
 * Elementi essenziali (art. 1325 c.c.) che l'AI non ha scritto nemmeno dopo il promemoria:
 * diventano spazi di chi crea (mai fatti inventati), obbligatori per la sua firma.
 */
export const ESSENTIAL_OBJECT = { id: 'essenziale_oggetto', label: 'Oggetto del contratto' } as const
export const ESSENTIAL_EXCHANGE = { id: 'essenziale_scambio', label: 'Cosa dà e cosa riceve ciascuna parte' } as const
export const isEssentialId = (id: string) => id === ESSENTIAL_OBJECT.id || id === ESSENTIAL_EXCHANGE.id

const WEEKDAYS = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato']
const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']
const pad = (n: number) => String(n).padStart(2, '0')

/** Data e ora "locali" come nel campo datetime-local: 2026-11-15T20:30. */
const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/
/** Lo stesso valore, anche con i secondi (2026-11-15T20:30:00 o :00.000): si tengono ore e minuti. */
const LOCAL_SECONDS_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::[0-5]\d(?:\.\d{1,3})?)?$/

function localParts(local: string): { y: number; m: number; d: number; hh: number; mm: number } | null {
  const m = LOCAL_RE.exec(String(local || '').trim())
  if (!m) return null
  const [y, mo, d, hh, mm] = m.slice(1).map(Number)
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || hh > 23 || mm > 59) return null
  // Giorno vero del calendario (niente 31 novembre).
  const check = new Date(Date.UTC(y, mo - 1, d))
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null
  return { y, m: mo, d, hh, mm }
}

export const validLocal = (local: string) => localParts(local) !== null

/** "2026-11-15T20:30" -> "sabato 15 novembre 2026, ore 20:30" (null se non valida). */
export function formatCollabDate(local: string): string | null {
  const p = localParts(local)
  if (!p) return null
  const weekday = WEEKDAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()]
  return `${weekday} ${p.d} ${MONTHS[p.m - 1]} ${p.y}, ore ${pad(p.hh)}:${pad(p.mm)}`
}

const FORMATTED_RE = new RegExp(`^(?:${WEEKDAYS.join('|')}) (\\d{1,2}) (${MONTHS.join('|')}) (\\d{4}), ore (\\d{2}):(\\d{2})$`)

/** Il testo scritto da qui torna data e ora locali (per il campo della pagina). */
export function parseCollabDate(text: string): string | null {
  const m = FORMATTED_RE.exec(String(text || '').trim())
  if (!m) return null
  const local = `${m[3]}-${pad(MONTHS.indexOf(m[2]) + 1)}-${pad(Number(m[1]))}T${m[4]}:${m[5]}`
  return formatCollabDate(local) === String(text).trim() ? local : null
}

export const deliveryText = (days: DeliveryDays) => `entro ${days} giorni dalla data della collaborazione`

export function parseDelivery(text: string): DeliveryDays | null {
  const m = /^entro (\d{1,2}) giorni dalla data della collaborazione$/.exec(String(text || '').trim())
  const n = m ? Number(m[1]) : NaN
  return (DELIVERY_DAYS as readonly number[]).includes(n) ? (n as DeliveryDays) : null
}

const NONE_WORDS = /^(none|nessun[ao]?|nessuna data(?: stabilita)?|nessun termine|no|senza(?: data| termine)?)$/i

/**
 * Valore da salvare per "Data e ora della collaborazione": accetta il valore del campo
 * datetime-local (2026-11-15T20:30), il testo gia' scritto da qui o "nessuna data".
 * '' = vuoto; null = non valido.
 */
export function normalizeDateValue(raw: string): string | null {
  const v = String(raw ?? '').trim()
  if (!v) return ''
  if (v === NO_DATE || NONE_WORDS.test(v)) return NO_DATE
  // Alcuni telefoni (o valori messi dal programma) aggiungono i secondi: 2026-11-15T20:30:00.
  const local = LOCAL_SECONDS_RE.exec(v)
  if (local) return formatCollabDate(local[1])
  return parseCollabDate(v) ? v : null
}

/** Valore da salvare per "Termine di consegna": 7, 14 o 30 (anche come testo gia' scritto) o "nessun termine". */
export function normalizeDaysValue(raw: string): string | null {
  const v = String(raw ?? '').trim()
  if (!v) return ''
  if (v === NO_TERM || NONE_WORDS.test(v)) return NO_TERM
  const n = /^\d{1,2}$/.test(v) ? Number(v) : parseDelivery(v)
  return n && (DELIVERY_DAYS as readonly number[]).includes(n) ? deliveryText(n as DeliveryDays) : null
}

export function normalizeTermValue(id: string, raw: string): string | null {
  return id === TERMS_DATE_ID ? normalizeDateValue(raw) : id === TERMS_DAYS_ID ? normalizeDaysValue(raw) : raw
}

export type TermsInfo = {
  /** Tutti e due gli spazi ci sono (contratti di prima: no). */
  present: boolean
  date: { value: string; local: string | null; none: boolean }
  days: { value: string; n: DeliveryDays | null; none: boolean }
  /** Etichette ancora da scegliere. */
  missing: string[]
}

/** Termini scritti nel documento. */
export function readTerms(doc: Pick<StructuredDoc, 'fields'>): TermsInfo {
  const fields = doc.fields || []
  const date = fields.find((f) => f.id === TERMS_DATE_ID)
  const days = fields.find((f) => f.id === TERMS_DAYS_ID)
  const dv = date?.value?.trim() || ''
  const nv = days?.value?.trim() || ''
  const missing = [...(!dv ? [TERMS_DATE_LABEL] : []), ...(!nv ? [TERMS_DAYS_LABEL] : [])]
  return {
    present: Boolean(date && days),
    date: { value: dv, local: parseCollabDate(dv), none: dv === NO_DATE },
    days: { value: nv, n: parseDelivery(nv), none: nv === NO_TERM },
    missing,
  }
}

export const hasTermsFields = (doc: Pick<StructuredDoc, 'fields'>) => readTerms(doc).present

/**
 * Valore scritto da qui per uno dei due spazi: quello normalizzato, una data detta a parole
 * ("sabato 14 novembre alle 20:30", per esempio riscritta dall'AI) messa per esteso, oppure
 * niente se non vale (lo spazio torna da scegliere: mai un valore storto nel contratto).
 */
function tidyTermValue(id: string, value: string | undefined): string | undefined {
  const v = value?.trim()
  if (!v) return undefined
  const normal = normalizeTermValue(id, v)
  if (normal) return normal
  if (id === TERMS_DATE_ID) {
    const local = parseDateTimeInput(v)
    return (local && formatCollabDate(local)) || undefined
  }
  return undefined
}

/**
 * Aggiunge (se mancano) i due spazi di chi crea, sempre con le loro etichette e di chi crea,
 * e con valori validi (vedi tidyTermValue). values: valori iniziali messi solo negli spazi
 * vuoti. Restituisce lo stesso oggetto se non cambia niente.
 */
export function ensureTerms(doc: StructuredDoc, values: { date?: string; days?: string } = {}): StructuredDoc {
  let changed = false
  const wanted: Record<string, { label: string; value?: string }> = {
    [TERMS_DATE_ID]: { label: TERMS_DATE_LABEL, value: tidyTermValue(TERMS_DATE_ID, values.date) },
    [TERMS_DAYS_ID]: { label: TERMS_DAYS_LABEL, value: tidyTermValue(TERMS_DAYS_ID, values.days) },
  }
  const fields = (doc.fields || []).map((f) => {
    const w = wanted[f.id]
    if (!w) return f
    const own = tidyTermValue(f.id, f.value)
    const value = own || w.value || undefined
    if (f.party === 'creatore' && f.label === w.label && value === f.value) return f
    changed = true
    const { value: _old, ...rest } = f
    return { ...rest, label: w.label, party: 'creatore' as const, ...(value ? { value } : {}) }
  })
  for (const id of TERMS_IDS) {
    if (fields.some((f) => f.id === id)) continue
    const w = wanted[id]
    fields.push({ id, label: w.label, party: 'creatore', ...(w.value?.trim() ? { value: w.value } : {}) })
    changed = true
  }
  return changed ? { ...doc, fields } : doc
}

/** Sezione «Termini della collaborazione» (subito dopo «Le parti»). */
export function termsSection(): DocSection {
  return { heading: TERMS_HEADING, paragraphs: [], bullets: [`${TERMS_DATE_LABEL}: {{${TERMS_DATE_ID}}}`, `${TERMS_DAYS_LABEL}: {{${TERMS_DAYS_ID}}}`] }
}

const TERMS_HEADING_RE = /^\s*(\d+\s*[.)]?\s*)?termini della collaborazione\s*$/i
/** Riga "Etichetta: valore" di uno dei due termini (come la scrive termsSection). */
const TERMS_LINE_RE = /^\s*(data e ora della collaborazione|termine di consegna dei contenuti)\s*:\s*(.*?)\s*\.?\s*$/i

/**
 * Riga dei termini che si puo' togliere senza perdere niente: "Etichetta: {{termini_…}}",
 * "Etichetta:" vuota (o con la linea ____), con uno spazio da compilare ancora vuoto, oppure
 * con lo stesso valore gia' salvato nel campo del termine.
 */
function generatedTermsLine(line: string, fields: readonly DocField[]): boolean {
  const m = TERMS_LINE_RE.exec(line)
  if (!m) return false
  const id = /^data/i.test(m[1]) ? TERMS_DATE_ID : TERMS_DAYS_ID
  const value = m[2].trim()
  if (!value || /^[_\s.\-–]+$/.test(value)) return true
  const ph = /^\{\{\s*([a-z0-9_]{1,40})\s*\}\}$/.exec(value)
  if (ph) return isTermsId(ph[1]) || !fields.find((f) => f.id === ph[1])?.value?.trim()
  const own = fields.find((f) => f.id === id)?.value?.trim()
  return Boolean(own) && own === value
}

/**
 * E' la sezione scritta da qui (stesso titolo e le due righe con gli spazi)? loose (testo da
 * preparare, mai un testo gia' firmato): anche una copia scritta dall'AI, ma solo se togliendola
 * non si perde niente (niente paragrafi, solo le righe di data e termine: vedi
 * generatedTermsLine). Una sezione con lo stesso titolo e clausole vere resta (renameTermsSection).
 */
export function isTermsSection(s: DocSection, loose = false, fields: readonly DocField[] = []): boolean {
  if (!TERMS_HEADING_RE.test(s.heading || '')) return false
  const bullets = s.bullets || []
  const paragraphs = (s.paragraphs || []).some((p) => p.trim())
  if (!loose) return !paragraphs && bullets.length === 2 && bullets[0].includes(`{{${TERMS_DATE_ID}}}`) && bullets[1].includes(`{{${TERMS_DAYS_ID}}}`)
  const lines = bullets.filter((b) => b.trim())
  return !paragraphs && lines.length <= 2 && lines.every((b) => generatedTermsLine(b, fields))
}

/** Titolo per una sezione dell'AI (o di prima) con clausole vere e lo stesso titolo della sezione di sistema. */
export const TERMS_CLAUSES_HEADING = 'Condizioni della collaborazione'

/**
 * Testo da preparare: una sezione intitolata «Termini della collaborazione» che non e' quella
 * di sistema (ha clausole vere) resta com'e', solo col titolo «Condizioni della collaborazione»
 * (stesso numero), per non confondersi con i termini scelti da chi crea. Restituisce lo stesso
 * oggetto se non cambia niente.
 */
export function renameTermsSections<T extends Pick<StructuredDoc, 'sections'>>(doc: T): T {
  if (!doc.sections.some((s) => TERMS_HEADING_RE.test(s.heading || ''))) return doc
  return {
    ...doc,
    sections: doc.sections.map((s) => {
      const m = TERMS_HEADING_RE.exec(s.heading || '')
      return m ? { ...s, heading: `${m[1] ? `${m[1].trim()} ` : ''}${TERMS_CLAUSES_HEADING}` } : s
    }),
  }
}

// ---------------------------------------------------------------------
// Date dette a parole (richiesta di Luca, chat): "sabato 15 novembre alle 20:30"
// ---------------------------------------------------------------------

/** Ora italiana di un istante, come data e ora locali (2026-11-15T20:30). */
export function romeLocal(iso: string | number | Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value])
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}`
}

/** Istante in ora italiana scritto per esteso ("sabato 7 novembre 2026, ore 15:42"). */
export const romeLong = (iso: string | number | Date) => formatCollabDate(romeLocal(iso)) || ''

const MONTH_WORDS = MONTHS.join('|')
const squashText = (s: string) => s.toLowerCase().replace(/[’`]/g, "'")

/**
 * Data e ora da un testo (ISO con o senza fuso, "15/11/2026 20:30", "sabato 15 novembre
 * alle 20:30", "15 novembre 2026 ore 20.30"). Senza anno: la prossima volta che arriva.
 * Servono giorno e ora: altrimenti null.
 */
export function parseDateTimeInput(text: string, now: Date = new Date()): string | null {
  const raw = String(text || '').trim()
  if (!raw) return null
  const iso = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(raw)
  if (iso) {
    if (iso[6]) {
      const at = Date.parse(raw.replace(' ', 'T'))
      return Number.isFinite(at) ? romeLocal(at) : null
    }
    const local = `${iso[1]}-${iso[2]}-${iso[3]}T${iso[4]}:${iso[5]}`
    return validLocal(local) ? local : null
  }
  const s = squashText(raw)
  let d = 0
  let m = 0
  let y = 0
  let rest = s
  const numeric = /\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/.exec(s)
  const named = new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_WORDS})(?:\\s+(\\d{4}))?\\b`).exec(s)
  // "20.30" e' un'ora, non una data: la data con i punti solo se ha anche l'anno.
  if (named) {
    d = Number(named[1])
    m = MONTHS.indexOf(named[2]) + 1
    y = named[3] ? Number(named[3]) : 0
    rest = s.replace(named[0], ' ')
  } else if (numeric && (numeric[0].includes('/') || numeric[0].includes('-') || numeric[3])) {
    d = Number(numeric[1])
    m = Number(numeric[2])
    y = numeric[3] ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]) : 0
    rest = s.replace(numeric[0], ' ')
  }
  if (!d || !m) return null
  const said = /\b(?:ore|alle|h)\s*(\d{1,2})(?:[:.](\d{2}))?\b/.exec(rest)
  // "alle 2" senza minuti e' ambiguo (le 2 o le 14) e spesso non e' un'ora ("3 reel alle 2 amiche"): vale dalle 7 in su.
  const time = said && (said[2] || Number(said[1]) >= 7) ? said : /\b(\d{1,2})[:.](\d{2})\b/.exec(rest)
  if (!time) return null
  const hh = Number(time[1])
  const mm = time[2] ? Number(time[2]) : 0
  if (!y) {
    const today = romeLocal(now).slice(0, 10)
    y = Number(today.slice(0, 4))
    if (`${y}-${pad(m)}-${pad(d)}` < today) y++
  }
  const local = `${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}`
  return validLocal(local) ? local : null
}

/** Righe della chat con l'ora di ogni messaggio ("[07/11/2026, 10:00] Giusy: …"): l'ora del messaggio non e' una data detta. */
const STAMP_RE = /\[\d{2}\/\d{2}\/\d{4},? \d{2}:\d{2}\]/g

/** Frasi di un testo (righe e punti a fine frase; "20.30" resta intero), senza l'ora dei messaggi. */
const sentences = (text: string) =>
  String(text || '')
    .replace(STAMP_RE, ' ')
    // "aperti 24/7", "h24/7": un modo di dire, non una data.
    .replace(/\b(aperti|aperto|aperta|attivi|attivo|attiva|disponibil[ei]|sempre|online|h)\s*24\s*\/\s*7\b/gi, '$1')
    .split(/\n+|[!?;]+|\.(?=\s|$)/)
    .map((x) => x.trim())
    .filter(Boolean)

/**
 * Data e ora della collaborazione dette davvero: giorno, mese e ora nella stessa frase
 * ("sabato 15 novembre alle 20:30", "15/11 ore 21"). Un giorno della settimana da solo ("ci
 * sentiamo lunedì"), "24/7" o "alle 2 amiche" non bastano. Restituisce l'ultima detta
 * (data e ora locali) o null.
 */
export function statedDateTime(text: string, now: Date = new Date()): string | null {
  let found: string | null = null
  for (const s of sentences(text)) found = parseDateTimeInput(s, now) || found
  return found
}

const DAY_WORDS: Record<string, DeliveryDays> = { '7': 7, sette: 7, '14': 14, quattordici: 14, '30': 30, trenta: 30 }

/**
 * Termine di consegna detto davvero (7, 14 o 30 giorni, una o due settimane, un mese), vicino
 * a "entro", "in" o "consegna": "consegna entro 7 giorni", "entro due settimane". "Aperti 7
 * giorni su 7" non conta. Restituisce l'ultimo detto o null.
 */
export function statedDeliveryDays(text: string): DeliveryDays | null {
  let found: DeliveryDays | null = null
  for (const raw of sentences(text)) {
    const s = squashText(raw)
    if (!/\b(entro|in|consegn\w*|termine)\b/.test(s)) continue
    const days = /\b(?:(?:entro|in)\s+(?:i\s+|max\s+|massimo\s+)?|(?:consegn\w*|termine)\b[^.]{0,30}?\s)(7|14|30|sette|quattordici|trenta)\s*(?:giorni|gg)\b/.exec(s)
    if (days) {
      found = DAY_WORDS[days[1]]
      continue
    }
    const weeks = /\b(?:entro|in)\s+(?:una|1)\s+settimana\b/.test(s) ? 7 : /\b(?:entro|in)\s+(?:due|2)\s+settimane\b/.test(s) ? 14 : /\b(?:entro|in)\s+(?:un|1)\s+mese\b/.test(s) ? 30 : null
    if (weeks) found = weeks
  }
  return found
}

/**
 * La data proposta dall'AI c'e' davvero nel testo (giorno e mese, e l'ora)? Per non
 * mettere mai una data inventata come valore iniziale.
 */
export function dateInSource(local: string, text: string): boolean {
  const p = localParts(local)
  if (!p) return false
  const s = squashText(String(text || '').replace(STAMP_RE, ' '))
  const day = `0?${p.d}`
  const hasDay = new RegExp(`\\b${day}\\s+${MONTHS[p.m - 1]}\\b`).test(s) || new RegExp(`\\b${day}[/.-]0?${p.m}\\b`).test(s)
  const hour = `0?${p.hh}`
  const hasTime = new RegExp(`\\b${hour}[:.]${pad(p.mm)}\\b`).test(s) || (p.mm === 0 && new RegExp(`\\b(?:ore|alle|h)\\s*${hour}\\b`).test(s))
  return hasDay && hasTime
}
