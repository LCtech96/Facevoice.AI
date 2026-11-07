import { stripMarkdown } from '@/lib/tool-step'
import { assertAIAllowed } from '@/lib/usage-limits'
import type { WorkspaceDb } from '@/lib/workspace-db'
import { listConnections, type ConnectionPlatform } from './connections'
import { sendPrivateReply } from './comments'
import { sendEmailReply, type MailAttachment } from './email'
import { ASSISTANT_ORIGIN, deliverDraft, workspaceName } from './responder'

// Messaggi mandati dall'Assistente AI su richiesta del titolare ("scrivi a Monia su
// Instagram…"). Solo a chi ci ha GIA' scritto su quel canale (messaggi, menzioni e
// risposte alle storie, commenti) e nei tempi di Meta: Direct, Messenger e WhatsApp
// entro 24 ore dall'ultimo messaggio della persona; a chi ha solo commentato una
// risposta privata entro 7 giorni dal commento; email nel filo della sua ultima email.
// Si invia con gli stessi strumenti delle risposte automatiche e dell'omnichat; il
// messaggio resta nella conversazione con origine 'assistant' (conta come del team:
// l'AI delle risposte non risponde di nuovo al posto della persona).

export type SendPlatform = 'instagram' | 'facebook' | 'email' | 'whatsapp'
export const SEND_PLATFORMS: SendPlatform[] = ['instagram', 'facebook', 'email', 'whatsapp']
export const CHANNEL_LABELS: Record<SendPlatform, string> = { instagram: 'Instagram', facebook: 'Facebook', email: 'email', whatsapp: 'WhatsApp' }

/** Meta: si risponde entro 24 ore dall'ultimo messaggio della persona. */
export const MESSAGING_WINDOW_MS = 24 * 3600_000
/** Meta: risposta privata a un commento entro 7 giorni (una per commento). */
export const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 3600_000
export const MAX_TEXT: Record<SendPlatform, number> = { instagram: 1000, facebook: 2000, whatsapp: 4000, email: 10000 }
/**
 * Stesso testo alla stessa persona negli ultimi minuti: non si rimanda (passo ripetuto dall'AI).
 * Un altro testo dall'Assistente alla stessa persona negli stessi minuti: prima si chiede al cliente.
 */
const DUPLICATE_MS = 10 * 60_000

export type SentMessage = {
  platform: SendPlatform
  contactId: string
  name: string
  text: string
  subject?: string
  /** dm = Direct/Messenger, comment = risposta privata a un commento, email = nel filo. */
  via: 'dm' | 'comment' | 'email'
}

export type SendResult =
  | { ok: true; sent: SentMessage; duplicate?: boolean }
  | { ok: false; error: string; candidates?: CandidateView[]; copyText?: string }

export type CandidateView = { nome: string; contact_id: string; canale: SendPlatform; ultimo: string; tipo: string }

type Row = {
  id: string
  platform: string
  kind: string
  contact_id: string
  contact_name: string | null
  external_id: string | null
  subject: string | null
  channel_account_id: string | null
  created_at: string
}

export type Candidate = {
  platform: SendPlatform
  contactId: string
  names: string[]
  /** Ultimo messaggio ricevuto (non commento): apre la finestra delle 24 ore. */
  lastMessage: Row | null
  /** Ultimo commento ricevuto: per la risposta privata. */
  lastComment: Row | null
  lastAt: string
}

export function asSendPlatform(value: unknown): SendPlatform | null {
  const v = String(value || '').trim().toLowerCase()
  if (['instagram', 'ig', 'direct', 'insta'].includes(v)) return 'instagram'
  if (['facebook', 'fb', 'messenger'].includes(v)) return 'facebook'
  if (['email', 'mail', 'e-mail', 'posta'].includes(v)) return 'email'
  if (['whatsapp', 'wa'].includes(v)) return 'whatsapp'
  return null
}

/** Minuscole, senza accenti, senza @ iniziale e spazi in piu'. */
export const normalizeContact = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/^@+/, '')
    .replace(/\s+/g, ' ')
/** "@monia_cumbo", "Monia.Cumbo" e "monia cumbo" diventano uguali. */
const loose = (value: string) => normalizeContact(value).replace(/[._\-]+/g, ' ').replace(/\s+/g, ' ').trim()
const compact = (value: string) => normalizeContact(value).replace(/[^a-z0-9]/g, '')
const tokens = (value: string) => loose(value).split(' ').filter((t) => t.length >= 2)

const stamp = (iso: string) =>
  new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Righe ricevute (dalla piu' recente) -> una persona per canale e contatto. */
export function groupCandidates(rows: Row[]): Candidate[] {
  const map = new Map<string, Candidate>()
  for (const row of rows) {
    const platform = asSendPlatform(row.platform)
    if (!platform || !row.contact_id) continue
    const key = `${platform}:${row.contact_id}`
    let c = map.get(key)
    if (!c) {
      c = { platform, contactId: row.contact_id, names: [], lastMessage: null, lastComment: null, lastAt: row.created_at }
      map.set(key, c)
    }
    if (row.contact_name && !c.names.includes(row.contact_name)) c.names.push(row.contact_name)
    if (row.kind === 'comment') c.lastComment ||= row
    else c.lastMessage ||= row
  }
  return [...map.values()]
}

export const displayName = (c: Candidate) => c.names.find((n) => !n.startsWith('@')) || c.names[0] || c.contactId

/** "@monia_cumbo" o "monia_cumbo": sembra uno username (non un nome di persona). */
const looksLikeHandle = (value: string) => value.startsWith('@') || (/^[\p{L}\p{N}._]+$/u.test(value) && /[._\d]/.test(value))

/**
 * Chi corrisponde a quello che ha scritto il cliente. Contact id, email o @username
 * esatti indicano proprio quella persona. Un nome invece raccoglie TUTTE le persone
 * che corrispondono (nome uguale, scritto in modo diverso - maiuscole, accenti, @,
 * punti e trattini bassi - o con tutte le parole): se sono piu' di una si chiede al
 * cliente quale ("Giulia" con Giulia, Giulia Rossi e @giulia.bianchi).
 */
export function matchCandidates(candidates: Candidate[], to: string): Candidate[] {
  const wanted = to.trim()
  if (!wanted) return []
  const alternatives = [wanted, ...(wanted.match(/@[\p{L}\p{N}._]+/gu) || [])]
  for (const alt of alternatives) {
    const exact = normalizeContact(alt)
    const handle = looksLikeHandle(alt)
    const byId = candidates.filter(
      (c) => normalizeContact(c.contactId) === exact || (handle && c.names.some((n) => n.startsWith('@') && normalizeContact(n) === exact))
    )
    if (byId.length) return byId
  }
  const found = new Set<Candidate>()
  for (const alt of alternatives) {
    const exact = normalizeContact(alt)
    const l = loose(alt)
    const k = compact(alt)
    const words = tokens(alt)
    for (const c of candidates) {
      const hit = c.names.some((n) => {
        if (normalizeContact(n) === exact || loose(n) === l || (k.length >= 4 && compact(n) === k)) return true
        const own = tokens(n)
        return words.length > 0 && words.every((w) => own.includes(w))
      })
      if (hit) found.add(c)
    }
  }
  return [...found]
}

/**
 * Forma "a orecchio" di un nome: minuscole, senza accenti, numeri e simboli, y/j come i, k come c,
 * lettere doppie una sola volta ("Giusyy" e "Giusi" diventano entrambi "giusi"). Le lettere
 * decorative di Instagram (𝓖𝓲𝓾𝓼𝔂) tornano normali con NFKD.
 */
export function soundKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[yj]/g, 'i')
    .replace(/k/g, 'c')
    .replace(/[^a-z\s]+/g, ' ')
    .replace(/([a-z])\1+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Quante lettere vanno cambiate per passare da a a b (si ferma oltre il massimo). */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = cur[0]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      best = Math.min(best, cur[j])
    }
    if (best > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

/** Una parola scritta dal cliente somiglia a una parola del nome? */
function wordLooksLike(q: string, t: string): boolean {
  if (q === t) return true
  if (q.length >= 3 && t.startsWith(q)) return true
  if (t.length >= 3 && q.startsWith(t)) return true
  if (q.length >= 4 && t.length >= 4) return editDistance(q, t, q.length >= 7 ? 2 : 1) <= (q.length >= 7 ? 2 : 1)
  return false
}

/**
 * Quando nessun nome corrisponde (es. "Giusi" o "Giusyy" per "Giusy B." o "@giusy.b"): le persone
 * con un nome che suona uguale o quasi. Il cliente vede sempre chi e' stato scelto (scheda di
 * conferma o nome nella risposta), quindi un nome simile basta per proporla.
 */
export function fuzzyCandidates(candidates: Candidate[], to: string): Candidate[] {
  const query = soundKey(to.replace(/@/g, ' '))
  const words = query.split(' ').filter((w) => w.length >= 3)
  if (!words.length) return []
  const scored: { c: Candidate; score: number }[] = []
  for (const c of candidates) {
    let best = 0
    for (const n of c.names) {
      const key = soundKey(n.replace(/[._\-]+/g, ' '))
      const own = key.split(' ').filter(Boolean)
      const joined = key.replace(/\s+/g, '')
      if (!own.length) continue
      if (key === query || joined === query.replace(/\s+/g, '')) best = Math.max(best, 3)
      else if (words.every((w) => own.some((t) => t === w))) best = Math.max(best, 2)
      else if (words.every((w) => own.some((t) => wordLooksLike(w, t)) || joined.includes(w))) best = Math.max(best, 1)
    }
    if (best) scored.push({ c, score: best })
  }
  if (!scored.length) return []
  const top = Math.max(...scored.map((s) => s.score))
  return scored.filter((s) => s.score === top).map((s) => s.c)
}

/** I nomi salvati anche sui nostri messaggi (risposte, conversazioni importate) aiutano a trovare la persona. */
export function addKnownNames(candidates: Candidate[], rows: { platform: string; contact_id: string | null; contact_name: string | null }[]) {
  const byKey = new Map(candidates.map((c) => [`${c.platform}:${c.contactId}`, c]))
  for (const row of rows) {
    const platform = asSendPlatform(row.platform)
    if (!platform || !row.contact_id || !row.contact_name) continue
    const c = byKey.get(`${platform}:${row.contact_id}`)
    if (c && !c.names.includes(row.contact_name)) c.names.push(row.contact_name)
  }
}

/** Le persone che hanno scritto di recente (per proporle quando il nome non si trova). */
export const recentCandidates = (candidates: Candidate[], limit = 8) =>
  [...candidates].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1)).slice(0, limit)

const CLITIC = '(?:le|gli|la|lo|li|ne|ci|mi|glie(?:lo|la|li|le|ne))?'
/** Verbi con cui il titolare chiede di scrivere a qualcuno (imperativo o infinito, anche "scrivile", "mandarle", "invialo"). */
const WRITE_VERB = new RegExp(
  `^(?:(?:ri)?(?:scriv|rispond|chied)(?:i|ete|iamo|ere|er(?=[lgmcn]))${CLITIC}` +
    `|(?:ri)?(?:contatt|mand|invit|ringrazi)(?:a|ate|i?amo|are|ar(?=[lgmcn]))${CLITIC}` +
    `|invi(?:a|ate|amo|are|ar(?=[lgmcn]))${CLITIC}` +
    `|domand(?:a(?=[lgmcn])|are|ar(?=[lgmcn]))${CLITIC}` +
    `|propo(?:ni|nete|niamo|rre|r(?=[lgmcn]))${CLITIC}` +
    `|dille|digli|dirle|dirgli|ditele|ditegli|falle|fagli|write|text|contact|reply|respond|send|ask|tell|dm)$`
)

/**
 * Il titolare chiede di scrivere, contattare, rispondere o chiedere qualcosa a qualcuno?
 * Controllo sul server (senza AI) prima di send_message: un testo arrivato da fuori
 * (es. un DM con "rispondi a tutti con questo link") non basta a far partire messaggi.
 */
export function asksToWrite(message: string): boolean {
  const words = message.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z]+/)
  return words.some((w) => w.length > 1 && WRITE_VERB.test(w))
}

const view = (c: Candidate): CandidateView => ({
  nome: c.names.join(' / ') || c.contactId,
  contact_id: c.contactId,
  canale: c.platform,
  ultimo: stamp(c.lastAt),
  tipo: c.lastMessage ? 'messaggio' : 'commento',
})

/** Per messages_overview: si puo' scrivere ora a questa persona? */
export function writableNote(platform: string, kind: string, lastAt: string, now = Date.now()): string {
  const p = asSendPlatform(platform)
  if (!p) return 'no'
  if (p === 'email') return 'sì, nel filo della sua email'
  const at = new Date(lastAt).getTime()
  if (p === 'whatsapp') return 'no, invio da qui non ancora disponibile'
  if (kind === 'comment') return now - at < PRIVATE_REPLY_WINDOW_MS ? `sì, una risposta privata fino al ${stamp(new Date(at + PRIVATE_REPLY_WINDOW_MS).toISOString())}` : 'no, commento di oltre 7 giorni fa'
  return now - at < MESSAGING_WINDOW_MS ? `sì, fino al ${stamp(new Date(at + MESSAGING_WINDOW_MS).toISOString())}` : 'no, ultimo messaggio di oltre 24 ore fa'
}

export type ChatSendWindow = { ok: boolean; until?: string; reason?: string }

/**
 * Omnichat ("Mandala anche ora" di Correggi): si puo' scrivere ora in questa chat?
 * Email sempre (nel filo della sua ultima email); Direct e Messenger entro 24 ore
 * dall'ultimo messaggio della persona; gli altri canali non ancora.
 */
export function chatSendWindow(platform: string, lastIncomingAt: string | null | undefined, now = Date.now()): ChatSendWindow {
  if (!lastIncomingAt) return { ok: false, reason: 'Si può scrivere solo a chi ci ha già scritto.' }
  if (platform === 'email') return { ok: true }
  if (platform === 'instagram' || platform === 'facebook') {
    const until = new Date(lastIncomingAt).getTime() + MESSAGING_WINDOW_MS
    if (now < until) return { ok: true, until: new Date(until).toISOString() }
    return { ok: false, reason: `${CHANNEL_LABELS[platform]} permette di scrivere solo entro 24 ore dall’ultimo messaggio della persona.` }
  }
  return { ok: false, reason: 'Da questo canale non si può ancora inviare da qui.' }
}

/** Come si inviera' il messaggio (deciso dai controlli, prima di inviare). */
type SendRoute =
  | { kind: 'deliver'; person: Candidate; last: Row; subject: string | null; via: 'dm' | 'email' }
  | { kind: 'comment'; person: Candidate; comment: Row }

type PlanResult =
  | { ok: true; sent: SentMessage; duplicate?: boolean; route?: SendRoute; until?: string }
  | { ok: false; error: string; candidates?: CandidateView[]; copyText?: string }

/**
 * Tutti i controlli prima dell'invio (persona che ci ha scritto, canale collegato, 24 ore
 * di Meta o 7 giorni per la risposta privata a un commento, testo, doppioni): a chi, come
 * e fino a quando si puo' scrivere. Non invia niente.
 */
async function planSend(
  db: WorkspaceDb,
  input: { platform?: unknown; to?: unknown; text?: unknown; subject?: unknown; again?: unknown },
  now: number
): Promise<PlanResult> {
  const to = typeof input.to === 'string' ? input.to.trim() : ''
  // Il testo arriva dal modello: niente **grassetto** o # alla persona (@nomi e link restano).
  const text = typeof input.text === 'string' ? stripMarkdown(input.text).trim() : ''
  const asked = input.platform == null || input.platform === '' || input.platform === 'all' ? null : asSendPlatform(input.platform)
  if (input.platform != null && input.platform !== '' && input.platform !== 'all' && !asked) return { ok: false, error: 'canale non valido: usa instagram, facebook, email o whatsapp' }
  if (!to) return { ok: false, error: 'manca a chi scrivere ("to")' }
  if (!text) return { ok: false, error: 'manca il testo del messaggio ("text")' }
  // AI del piano finita: niente invii dall'assistente (l'errore ferma la richiesta).
  await assertAIAllowed(db.workspaceId)

  const { data, error } = await db
    .from('social_messages')
    .select('id, platform, kind, contact_id, contact_name, external_id, subject, channel_account_id, created_at')
    .eq('direction', 'in')
    .order('created_at', { ascending: false })
    .limit(2000)
  if (error) return { ok: false, error: 'messaggi ricevuti non letti, riprova' }
  const everyone = groupCandidates((data || []) as Row[])
  const { data: ours } = await db
    .from('social_messages')
    .select('platform, contact_id, contact_name')
    .eq('direction', 'out')
    .order('created_at', { ascending: false })
    .limit(2000)
  addKnownNames(everyone, (ours || []) as { platform: string; contact_id: string | null; contact_name: string | null }[])
  const label = asked ? CHANNEL_LABELS[asked] : 'nessun canale'
  const onChannel = asked ? everyone.filter((c) => c.platform === asked) : everyone
  let matches = matchCandidates(onChannel, to)
  // Nome scritto in modo diverso ("Giusi", "Giusyy" per "Giusy"): chi ha un nome che suona uguale.
  if (!matches.length) matches = fuzzyCandidates(onChannel, to)

  if (!matches.length) {
    const elsewhere = asked ? matchCandidates(everyone.filter((c) => c.platform !== asked), to) : []
    const hint = elsewhere.length
      ? ` Ci ha scritto però su ${[...new Set(elsewhere.map((c) => CHANNEL_LABELS[c.platform]))].join(' e ')} (${elsewhere.map(displayName).join(', ')}): chiedi al cliente se scriverle lì.`
      : ''
    const recent = elsewhere.length ? [] : recentCandidates(onChannel)
    return {
      ok: false,
      error: `nessuno con il nome "${to}" ci ha scritto su ${asked ? CHANNEL_LABELS[asked] : 'nessun canale'}: si può scrivere solo a chi ci ha scritto prima.${hint}${
        recent.length ? ' Mostra al cliente, per nome, le persone che hanno scritto di recente (candidati) e chiedigli quale intende: non dire solo "non ho trovato".' : ''
      }`,
      ...(elsewhere.length ? { candidates: elsewhere.slice(0, 6).map(view) } : recent.length ? { candidates: recent.map(view) } : {}),
      copyText: text,
    }
  }
  if (matches.length > 1) {
    return {
      ok: false,
      error: `più persone corrispondono a "${to}"${asked ? ` su ${label}` : ''}: chiedi al cliente quale (poi usa il suo contact_id in "to")`,
      candidates: matches.slice(0, 8).map(view),
    }
  }

  const person = matches[0]
  const platform = person.platform
  const name = displayName(person)
  if (text.length > MAX_TEXT[platform]) return { ok: false, error: `testo troppo lungo per ${CHANNEL_LABELS[platform]} (massimo ${MAX_TEXT[platform]} caratteri): accorcialo` }

  // Stesso testo appena mandato a questa persona: non si rimanda. Un altro testo dall'Assistente
  // negli stessi minuti (es. richiesta ripetuta dopo un errore): prima si chiede al cliente.
  const { data: recent } = await db
    .from('social_messages')
    .select('id, body, status, origin, created_at')
    .eq('platform', platform)
    .eq('contact_id', person.contactId)
    .eq('direction', 'out')
    .in('status', ['sent', 'sending'])
    .gte('created_at', new Date(now - DUPLICATE_MS).toISOString())
    .limit(20)
  if ((recent || []).some((row) => String(row.body || '').trim() === text)) {
    return { ok: true, duplicate: true, sent: { platform, contactId: person.contactId, name, text, via: platform === 'email' ? 'email' : 'dm' } }
  }
  const byAssistant = (recent || [])
    .filter((row) => row.origin === ASSISTANT_ORIGIN)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]
  if (byAssistant && input.again !== true) {
    const time = new Date(byAssistant.created_at as string).toLocaleTimeString('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit' })
    return {
      ok: false,
      error: `a ${name} è già partito un messaggio dall’Assistente alle ${time} («${String(byAssistant.body || '').slice(0, 160)}»): non è partito niente di nuovo. Chiedi al cliente se vuole mandargliene un altro; solo se dice di sì, rifai send_message con "again": true.`,
    }
  }

  const connections = (await listConnections(db, platform as ConnectionPlatform).catch(() => [])).filter((c) => c.status !== 'disconnected')
  const lastMessageAge = person.lastMessage ? now - new Date(person.lastMessage.created_at).getTime() : Infinity

  if (platform === 'email') {
    const last = person.lastMessage
    if (!last) return { ok: false, error: `${name} non ci ha mai scritto per email: si può rispondere solo a chi ci ha scritto prima`, copyText: text }
    if (!connections.length) return { ok: false, error: 'la casella email non è collegata', copyText: text }
    const subject = (typeof input.subject === 'string' && input.subject.trim()) || last.subject || null
    const cut = subject ? subject.slice(0, 200) : null
    return { ok: true, sent: { platform, contactId: person.contactId, name, text, ...(cut ? { subject: cut } : {}), via: 'email' }, route: { kind: 'deliver', person, last, subject: cut, via: 'email' } }
  }

  if (platform === 'whatsapp') {
    if (lastMessageAge >= MESSAGING_WINDOW_MS) return { ok: false, error: windowError(name, platform, person.lastMessage?.created_at), copyText: text }
    return { ok: false, error: 'su WhatsApp l’invio da Facevoice non è ancora disponibile: dai al cliente il testo da copiare', copyText: text }
  }

  if (!connections.length) return { ok: false, error: `${platform === 'facebook' ? 'la Pagina Facebook' : 'Instagram'} non è collegato`, copyText: text }

  // Direct / Messenger: entro 24 ore dal suo ultimo messaggio (anche menzioni e risposte alle storie).
  if (person.lastMessage && lastMessageAge < MESSAGING_WINDOW_MS) {
    const until = new Date(new Date(person.lastMessage.created_at).getTime() + MESSAGING_WINDOW_MS).toISOString()
    return { ok: true, sent: { platform, contactId: person.contactId, name, text, via: 'dm' }, route: { kind: 'deliver', person, last: person.lastMessage, subject: null, via: 'dm' }, until }
  }

  // Ha solo commentato (o il messaggio e' vecchio): una risposta privata al commento, entro 7 giorni.
  const comment = person.lastComment
  if (comment?.external_id && now - new Date(comment.created_at).getTime() < PRIVATE_REPLY_WINDOW_MS) {
    const { count } = await db
      .from('social_messages')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'message')
      .eq('direction', 'out')
      .eq('reply_to', comment.external_id)
      .eq('status', 'sent')
    if (!count) {
      const until = new Date(new Date(comment.created_at).getTime() + PRIVATE_REPLY_WINDOW_MS).toISOString()
      return { ok: true, sent: { platform, contactId: person.contactId, name, text, via: 'comment' }, route: { kind: 'comment', person, comment }, until }
    }
  }
  return { ok: false, error: windowError(name, platform, person.lastMessage?.created_at ?? comment?.created_at), copyText: text }
}

export type PlannedMessage = SendResult & { until?: string }

/**
 * Prepara il messaggio senza inviarlo (scheda "Accetta e invia" dell'Assistente): stessi
 * controlli dell'invio vero, con a chi, come e fino a quando si puo' ancora scrivere.
 */
export async function planAssistantMessage(
  db: WorkspaceDb,
  input: { platform?: unknown; to?: unknown; text?: unknown; subject?: unknown; again?: unknown },
  now = Date.now()
): Promise<PlannedMessage> {
  const plan = await planSend(db, input, now)
  if (!plan.ok) return plan
  return { ok: true, sent: plan.sent, ...(plan.duplicate ? { duplicate: true } : {}), ...(plan.until ? { until: plan.until } : {}) }
}

/** Invia il messaggio chiesto dal titolare, se la persona ci ha scritto prima e Meta lo permette (i controlli si rifanno adesso). */
export async function sendAssistantMessage(
  db: WorkspaceDb,
  /** again: il cliente ha confermato di voler mandare un altro messaggio a chi ha appena ricevuto quello dell'Assistente. */
  input: { platform?: unknown; to?: unknown; text?: unknown; subject?: unknown; again?: unknown },
  now = Date.now()
): Promise<SendResult> {
  const plan = await planSend(db, input, now)
  if (!plan.ok) return plan
  if (plan.duplicate || !plan.route) return { ok: true, sent: plan.sent, ...(plan.duplicate ? { duplicate: true } : {}) }
  const { sent } = plan
  const route = plan.route
  if (route.kind === 'deliver') return deliver(db, route.person, route.last, sent.text, route.subject, route.via, sent.name)
  const replied = await sendPrivateReply(db, route.comment.id, sent.text, ASSISTANT_ORIGIN)
  if (!replied.ok) return { ok: false, error: `invio non riuscito: ${replied.error}`, copyText: sent.text }
  await rejectStaleDrafts(db, sent.platform, sent.contactId, new Date().toISOString())
  return { ok: true, sent }
}

/**
 * Email con un file allegato (il PDF di un documento dell'Assistente) nel filo dell'ultima
 * email della persona, dopo la conferma del titolare. Solo email: su Instagram e Facebook
 * un file si manda solo con un link pubblico, che per un contratto non si fa.
 */
export async function sendAssistantEmailWithAttachment(
  db: WorkspaceDb,
  input: { to: string; text: string; subject?: string | null; attachment: MailAttachment },
  now = Date.now()
): Promise<SendResult> {
  const plan = await planSend(db, { platform: 'email', to: input.to, text: input.text, subject: input.subject ?? undefined, again: true }, now)
  if (!plan.ok) return plan
  if (!plan.route || plan.route.kind !== 'deliver' || plan.sent.platform !== 'email') return { ok: false, error: 'i documenti si possono inviare da qui solo per email' }
  const { person, last, subject } = plan.route
  const note = `[Allegato: ${input.attachment.filename}]`
  const { data: saved, error } = await db
    .from('social_messages')
    .insert({
      platform: 'email',
      kind: 'message',
      direction: 'out',
      contact_id: person.contactId,
      contact_name: last.contact_name ?? (person.names[0] || null),
      subject,
      reply_to: last.external_id,
      channel_account_id: last.channel_account_id,
      body: `${plan.sent.text}\n\n${note}`,
      status: 'sending',
      origin: ASSISTANT_ORIGIN,
    })
    .select('id')
    .single()
  if (error || !saved) return { ok: false, error: 'messaggio non salvato, riprova' }
  try {
    const connections = (await listConnections(db, 'email')).filter((c) => c.status !== 'disconnected')
    const connection = connections.find((c) => c.external_id === last.channel_account_id) || connections[0]
    if (!connection) throw new Error('casella email non collegata')
    const { messageId } = await sendEmailReply(connection, {
      to: person.contactId,
      subject,
      inReplyTo: last.external_id,
      text: plan.sent.text,
      fromName: await workspaceName(db.workspaceId),
      attachments: [input.attachment],
    })
    await db.from('social_messages').update({ status: 'sent', external_id: messageId, created_at: new Date().toISOString() }).eq('id', saved.id as string)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'invio non riuscito'
    await db.from('social_messages').update({ status: 'failed', error_message: message.slice(0, 300) }).eq('id', saved.id as string)
    return { ok: false, error: `invio non riuscito: ${message}` }
  }
  await rejectStaleDrafts(db, 'email', person.contactId, new Date().toISOString())
  return { ok: true, sent: plan.sent }
}

function windowError(name: string, platform: SendPlatform, lastAt?: string): string {
  return `${CHANNEL_LABELS[platform]} permette di scrivere solo entro 24 ore dall'ultimo messaggio della persona${lastAt ? `: l'ultimo di ${name} è del ${stamp(lastAt)}` : ''}. Non è partito niente: dai al cliente il testo da copiare e mandare dall'app, oppure aspetta che ${name} scriva di nuovo.`
}

/** Salva il messaggio nella conversazione e lo invia come una risposta dell'omnichat. */
async function deliver(db: WorkspaceDb, person: Candidate, last: Row, text: string, subject: string | null, via: 'dm' | 'email', name: string): Promise<SendResult> {
  const { data: saved, error } = await db
    .from('social_messages')
    .insert({
      platform: person.platform,
      kind: 'message',
      direction: 'out',
      contact_id: person.contactId,
      contact_name: last.contact_name ?? (person.names[0] || null),
      subject: via === 'email' ? subject : last.subject,
      reply_to: last.external_id,
      channel_account_id: last.channel_account_id,
      body: text,
      status: 'pending',
      origin: ASSISTANT_ORIGIN,
    })
    .select('id')
    .single()
  if (error || !saved) return { ok: false, error: 'messaggio non salvato, riprova' }
  const sent = await deliverDraft(db, saved.id as string, text, ASSISTANT_ORIGIN)
  if (!sent.ok) return { ok: false, error: `invio non riuscito: ${sent.error}`, copyText: text }
  await rejectStaleDrafts(db, person.platform, person.contactId, new Date().toISOString())
  return { ok: true, sent: { platform: person.platform, contactId: person.contactId, name, text, ...(subject ? { subject } : {}), via } }
}

/**
 * Bozze dell'AI ancora da approvare per questa persona, preparate prima del messaggio
 * dell'Assistente: sono superate (come quando si risponde a mano dall'app, meta-inbound.ts).
 * Approvarle dopo manderebbe alla persona un secondo messaggio. Mai bloccante.
 */
async function rejectStaleDrafts(db: WorkspaceDb, platform: string, contactId: string, sentAt: string): Promise<void> {
  const { error } = await db
    .from('social_messages')
    .update({ status: 'rejected', error_message: 'Annullata: ha scritto l’Assistente' })
    .eq('platform', platform)
    .eq('contact_id', contactId)
    .eq('kind', 'message')
    .eq('direction', 'out')
    .eq('status', 'pending')
    .like('origin', 'ai%')
    .lt('created_at', sentAt)
  if (error) console.error('saas assistente: bozze non annullate:', error.message)
}
