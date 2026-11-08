import { createHash, randomUUID } from 'crypto'
import { readSetting, updateSetting } from '@/lib/settings-store'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { deliver, setOrigin } from '@/lib/meta/agent'
import { sendFirstEmail, sendFollowupEmail } from '@/lib/lead-send'
import { sendNewEmail, sendThreadReply } from '@/lib/gmail'
import { DraftConflictError, DraftError, loadPostDraft, publishPostDraft, schedulePostDraft } from '@/lib/social-posts'
import { PhotoError, describeAutopilot, saveAutopilotSettings } from '@/lib/photo-library'
import { VideoError, updateVideoPost } from '@/lib/video-posts'
import { BlogBusyError, BlogScheduleError, describeSlots, saveBlogAutoSettings, startBlogNow, type BlogSchedulePatch } from '@/lib/blog-auto'
import { listPushDevices, removePushDevice } from '@/lib/push'
import { loadContentDirections, saveContentDirections } from '@/lib/content-directions'
import { findVersion, loadDocument, renderDocumentPdf } from '@/lib/assistant-documents'
import { CHANNEL_LABEL, PIN_RE, linkOrigin, type ShareChannel } from '@/lib/contracts'
import { MAX_SHARE_TEXT, shareContractNow, textHasPin } from '@/lib/contract-share'

// Doppia conferma della super chat. Gli strumenti dell'assistente che agiscono
// fuori dalla chat o non si possono annullare (messaggi, email, pubblicazioni,
// blog automatico, cancellazioni, invio di documenti) non eseguono niente: creano
// un'azione "in attesa di conferma" con il contenuto esatto, salvata sul server.
// Parte solo quando Luca preme "Accetta e invia" (o "Conferma") sulla scheda: la
// route controlla di nuovo permessi e condizioni in quel momento ed esegue una
// volta sola esattamente quello che e' salvato (due clic o due schede aperte non
// mandano due volte). "Scarta" la chiude e l'assistente chiede cosa serve davvero.
//
// app_settings:
//   assistant_action:<id> -> azione con contenuto, stato ed esito (scade dopo 24 ore)
//   assistant_actions     -> elenco delle ultime 100 azioni (le piu' vecchie si cancellano)

export const CONFIRM_TTL_MS = 24 * 3600_000
const KEY_PREFIX = 'assistant_action:'
const INDEX_KEY = 'assistant_actions'
const MAX_ACTIONS = 100
/** "In corso" da piu' di cosi': il server si e' fermato a meta', l'esito non si sa (non si riprova da solo). */
const RUNNING_STALE_MS = 5 * 60_000
const META_WINDOW_MS = 24 * 3600_000
export const ACTION_ID_RE = /^a[a-z0-9]{8,40}$/

export type ConfirmScope = 'leads' | 'super'
export type DraftSnapshot = { leadId: string; name: string; email: string; kind: 'first' | 'followup'; subject: string; body: string; threadId?: string | null }

export type ConfirmPayload =
  | { kind: 'social_message'; platform: 'instagram' | 'facebook'; contactId: string; name: string; text: string; lastIncomingAt: string | null }
  | { kind: 'send_emails'; drafts: DraftSnapshot[]; done?: Record<string, string> }
  | { kind: 'publish_carousel'; draftId: string; title: string; platforms: ('instagram' | 'facebook')[]; base: string[]; caption: string; facebook?: string }
  /** Video gia' caricato nella Overview: programmato all'ora scelta (scheduledAt ISO) con questa didascalia. */
  | { kind: 'schedule_video'; videoId: string; title: string; scheduledAt: string; caption: string; platforms: ('instagram' | 'facebook')[]; videoUrl: string }
  /** Carosello gia' creato: esce da solo all'ora scelta (scheduledAt ISO), con le slide della scheda (base). */
  | { kind: 'schedule_carousel'; draftId: string; title: string; scheduledAt: string; platforms: ('instagram' | 'facebook')[]; base: string[]; caption: string; facebook?: string }
  /** Modifica dell'autopilota foto (solo i campi da cambiare); lines: come sara' dopo (per la scheda). */
  | { kind: 'photo_autopilot'; patch: Record<string, unknown>; lines: string[] }
  /** topic: argomento scelto (senza = quello della prima uscita). */
  | { kind: 'publish_blog_now'; origin: string; topic?: string }
  /** slots: le uscite come saranno dopo la modifica (per la scheda). */
  | { kind: 'blog_schedule'; patch: BlogSchedulePatch; slots?: string }
  | { kind: 'remove_push_devices'; devices: { id: string; name: string }[] }
  | { kind: 'clear_content_directions' }
  /** Indicazioni nuove al posto di quelle salvate (previous: com'erano quando e' nata la scheda). */
  | { kind: 'replace_content_directions'; text: string; previous: string }
  | {
      kind: 'send_document'
      docId: string
      version: number
      title: string
      filename: string
      pages: number
      to: string
      name: string
      threadId: string | null
      subject: string
      /** Risposta nel thread: indirizzo a cui va davvero (Reply-To/From letto da Gmail quando e' nata la scheda). */
      recipient?: string
      text: string
    }
  /**
   * Link unico del contratto con il PIN scelto da Luca sulla scheda. Il PIN NON sta qui
   * (ne' nella chat): arriva solo con il clic su "Accetta e invia" e si salva come hash.
   * to: email (canale email) o contactId (Instagram, Facebook, WhatsApp); vuoto per "solo link".
   */
  | { kind: 'share_contract'; contractId: string; title: string; name: string; channel: ShareChannel; to: string; lastIncomingAt: string | null; text: string }

export type ConfirmKind = ConfirmPayload['kind']
export type ActionStatus = 'pending' | 'running' | 'done' | 'failed' | 'discarded'
/** Stato mostrato: in piu' "expired" (24 ore senza conferma) e "unknown" (interrotto a meta'). */
export type CardState = ActionStatus | 'expired' | 'unknown'

export type PendingAction = {
  id: string
  scope: ConfirmScope
  title: string
  payload: ConfirmPayload
  createdAt: string
  expiresAt: string
  createdBy: string | null
  status: ActionStatus
  attempts: number
  claim?: string
  claimedAt?: string
  decidedAt?: string
  decidedBy?: string
  outcome?: string
  error?: string
  /** Non e' partito niente: si puo' riprovare con lo stesso pulsante. */
  retryable?: boolean
  edited?: boolean
}

/** Scheda di conferma nella chat: contenuto esatto e pulsanti "Accetta e invia" / "Scarta". */
export type ConfirmCard = {
  kind: 'confirm'
  id: string
  action: ConfirmKind
  title: string
  /** Testo esatto che parte (messaggio, testo dell'email). */
  text?: string
  /** Il testo si puo' correggere prima di inviare. */
  editable?: boolean
  maxLength?: number
  lines?: string[]
  /** Elenco espandibile (es. le email da inviare con il loro testo). */
  items?: { label: string; text: string }[]
  images?: string[]
  warning?: string
  confirmLabel: string
  expiresAt: string
  state: CardState
  outcome?: string
  error?: string
  retryable?: boolean
  /** La scheda chiede il PIN (contratti): resta nel browser fino al clic, mai nella chat. */
  pin?: boolean
  /** Contratto della scheda: "Apri contratto" e "Copia link" dopo l'invio. */
  contractId?: string
}

const EDITABLE_MAX: Partial<Record<ConfirmKind, number>> = { social_message: 1900, send_document: 6000, replace_content_directions: 3000, share_contract: MAX_SHARE_TEXT }

export const newActionId = () => `a${Date.now().toString(36)}${randomUUID().replace(/-/g, '').slice(0, 10)}`

function parseAction(raw: string | null): PendingAction | null {
  try {
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed.id === 'string' && parsed.payload ? (parsed as PendingAction) : null
  } catch {
    return null
  }
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
const FP_RE = /^[0-9a-f]{64}$/

/** fp: impronta corta (sha256) del contenuto; le voci vecchie con il JSON intero si convertono. */
type IndexItem = { id: string; scope: ConfirmScope; at: string; fp: string }
function parseIndex(raw: string | null): { items: IndexItem[] } {
  try {
    const parsed = raw ? JSON.parse(raw) : null
    const items: IndexItem[] = Array.isArray(parsed?.items) ? parsed.items.filter((i: Partial<IndexItem>) => typeof i?.id === 'string') : []
    return { items: items.map((i) => (typeof i.fp === 'string' && !FP_RE.test(i.fp) ? { ...i, fp: sha256(i.fp) } : i)) }
  } catch {
    return { items: [] }
  }
}

/** Stato da mostrare adesso (scadenza e lavori interrotti compresi). */
export function stateOf(action: PendingAction, now = Date.now()): CardState {
  if (action.status === 'pending' && now >= Date.parse(action.expiresAt)) return 'expired'
  if (action.status === 'running' && action.claimedAt && now - Date.parse(action.claimedAt) > RUNNING_STALE_MS) return 'unknown'
  return action.status
}

/**
 * Impronta del contenuto: la stessa azione chiesta due volte non crea due schede. Solo
 * l'hash nell'elenco (il contenuto intero sta nell'azione), cosi' l'elenco resta piccolo.
 */
function fingerprint(payload: ConfirmPayload) {
  const { done: _done, ...rest } = payload as ConfirmPayload & { done?: unknown }
  return sha256(JSON.stringify(rest))
}

export async function loadAction(id: string): Promise<PendingAction | null> {
  if (!ACTION_ID_RE.test(id)) return null
  return parseAction((await readSetting(`${KEY_PREFIX}${id}`)).value)
}

/** Ultime azioni di una chat (dalla piu' recente). */
export async function recentActions(scope: ConfirmScope, limit = 10, withinMs = 48 * 3600_000): Promise<PendingAction[]> {
  const index = parseIndex((await readSetting(INDEX_KEY)).value)
  const since = Date.now() - withinMs
  const ids = index.items.filter((i) => i.scope === scope && Date.parse(i.at) >= since).slice(-limit).map((i) => `${KEY_PREFIX}${i.id}`)
  if (!ids.length) return []
  const { data } = await supabaseAdmin.from('app_settings').select('key, value').in('key', ids)
  return (data || [])
    .map((row: { value: string }) => parseAction(row.value))
    .filter((a): a is PendingAction => Boolean(a))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Scheda da mostrare per un'azione (contenuto esatto, pulsanti e stato). */
export function cardFor(action: PendingAction, extra: Partial<ConfirmCard> = {}): ConfirmCard {
  const p = action.payload
  const base = {
    kind: 'confirm' as const,
    id: action.id,
    action: p.kind,
    title: action.title,
    expiresAt: action.expiresAt,
    state: stateOf(action),
    ...(action.outcome ? { outcome: action.outcome } : {}),
    ...(action.error ? { error: action.error } : {}),
    ...(action.retryable ? { retryable: true } : {}),
  }
  const dateTime = (iso: string) => new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  switch (p.kind) {
    case 'social_message': {
      const old = !p.lastIncomingAt || Date.now() - Date.parse(p.lastIncomingAt) > META_WINDOW_MS
      return {
        ...base,
        text: p.text,
        editable: true,
        maxLength: EDITABLE_MAX.social_message,
        lines: p.lastIncomingAt ? [`Ultimo suo messaggio: ${dateTime(p.lastIncomingAt)}`] : [],
        ...(old ? { warning: 'Ti ha scritto più di 24 ore fa: Meta non permette di scriverle da qui. Scrivile dall’app.' } : {}),
        confirmLabel: 'Accetta e invia',
        ...extra,
      }
    }
    case 'send_emails':
      return {
        ...base,
        lines: [`Partono da luca@facevoice.ai, una alla volta.`],
        items: p.drafts.map((d) => ({
          label: `${d.name} · ${d.email} · ${d.kind === 'first' ? 'primo contatto' : 'follow-up'}`,
          text: `Oggetto: ${d.subject}\n\n${d.body}`,
        })),
        confirmLabel: 'Accetta e invia',
        ...extra,
      }
    case 'publish_carousel':
      return {
        ...base,
        text: p.caption,
        lines: [`Su ${p.platforms.map((x) => (x === 'instagram' ? 'Instagram' : 'Facebook')).join(' e ')}`, `${p.base.length} slide, così come le vedi qui`],
        ...(p.facebook && p.platforms.includes('facebook') && p.facebook !== p.caption ? { items: [{ label: 'Testo per Facebook', text: p.facebook }] } : {}),
        images: p.base.slice(0, 4),
        confirmLabel: 'Pubblica',
        ...extra,
      }
    case 'schedule_video':
      return {
        ...base,
        text: p.caption,
        lines: [
          `Esce il ${new Date(p.scheduledAt).toLocaleString('it-IT', { timeZone: 'Europe/Rome', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`,
          `Su ${p.platforms.map((x) => (x === 'instagram' ? 'Instagram (Reel)' : 'Facebook')).join(' e ')}, con la didascalia qui sopra`,
          `Video: ${p.videoUrl}`,
        ],
        confirmLabel: 'Programma',
        ...extra,
      }
    case 'schedule_carousel':
      return {
        ...base,
        text: p.caption,
        lines: [
          `Esce il ${new Date(p.scheduledAt).toLocaleString('it-IT', { timeZone: 'Europe/Rome', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`,
          `Su ${p.platforms.map((x) => (x === 'instagram' ? 'Instagram' : 'Facebook')).join(' e ')}, ${p.base.length} slide, con la didascalia qui sopra`,
          'Esce da solo a quell’ora: arriva una notifica con l’esito.',
        ],
        ...(p.facebook && p.platforms.includes('facebook') && p.facebook !== p.caption ? { items: [{ label: 'Testo per Facebook', text: p.facebook }] } : {}),
        images: p.base.slice(0, 4),
        confirmLabel: 'Programma',
        ...extra,
      }
    case 'photo_autopilot':
      return { ...base, lines: p.lines, confirmLabel: 'Conferma', ...extra }
    case 'publish_blog_now':
      return {
        ...base,
        lines: [
          `Scrivo e pubblico subito un articolo con le notizie più recenti${p.topic ? ` su «${p.topic}»` : ''}, poi il carosello su Facebook e Instagram (come il blog automatico).`,
          'Ci vogliono alcuni minuti: arriva una notifica con l’esito.',
        ],
        confirmLabel: 'Conferma',
        ...extra,
      }
    case 'blog_schedule':
      return { ...base, lines: describeSchedule(p.patch, p.slots), confirmLabel: 'Conferma', ...extra }
    case 'remove_push_devices':
      return { ...base, lines: p.devices.map((d) => `Non riceverà più le notifiche: ${d.name}`), confirmLabel: 'Conferma', ...extra }
    case 'clear_content_directions':
      return { ...base, lines: ['Le indicazioni salvate per blog, caroselli e immagini vengono cancellate.'], confirmLabel: 'Conferma', ...extra }
    case 'replace_content_directions':
      return {
        ...base,
        text: p.text,
        editable: true,
        maxLength: EDITABLE_MAX.replace_content_directions,
        lines: ['Le indicazioni nuove (qui sopra) prendono il posto di quelle di adesso, per blog, caroselli e immagini.'],
        items: [{ label: 'Indicazioni di adesso (vengono tolte)', text: p.previous || '(nessuna)' }],
        confirmLabel: 'Conferma',
        ...extra,
      }
    case 'send_document':
      return {
        ...base,
        text: p.text,
        editable: true,
        maxLength: EDITABLE_MAX.send_document,
        lines: [
          `A: ${p.recipient || p.to}`,
          // Nel thread l'oggetto e' quello della conversazione ("Re: …"), letto da Gmail.
          p.threadId && !p.recipient ? 'Risposta nella conversazione email già aperta, con lo stesso oggetto' : `Oggetto: ${p.subject}`,
          `Allegato: ${p.filename} (versione ${p.version}, ${p.pages} ${p.pages === 1 ? 'pagina' : 'pagine'})`,
        ],
        confirmLabel: 'Accetta e invia',
        ...extra,
      }
    case 'share_contract': {
      const dm = p.channel === 'instagram' || p.channel === 'facebook' || p.channel === 'whatsapp'
      const old = dm && (!p.lastIncomingAt || Date.now() - Date.parse(p.lastIncomingAt) > META_WINDOW_MS)
      const where =
        p.channel === 'link' ? 'Solo il link: lo copi e lo mandi tu' : p.channel === 'email' ? `Per email a ${p.to}` : `In privato su ${CHANNEL_LABEL[p.channel]} a ${p.name}`
      return {
        ...base,
        text: p.text,
        editable: p.channel !== 'link',
        maxLength: EDITABLE_MAX.share_contract,
        pin: true,
        contractId: p.contractId,
        lines: [
          `Contratto: ${p.title}`,
          where,
          ...(p.channel === 'link' ? [] : ['In fondo al messaggio aggiungo il link al contratto e la frase «il PIN te lo mando a parte».']),
          'Scegli qui sotto il PIN per aprire il link (da 4 a 12 lettere o numeri). Non è nel messaggio: mandalo in un altro modo (a voce, SMS o telefonata).',
        ],
        ...(old ? { warning: 'Ti ha scritto più di 24 ore fa: da qui non si può scriverle. Crea solo il link e mandalo dall’app.' } : {}),
        confirmLabel: p.channel === 'link' ? 'Crea il link' : 'Accetta e invia',
        ...extra,
      }
    }
  }
}

const DAY_NAMES = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato']
function describeSchedule(patch: BlogSchedulePatch, after?: string): string[] {
  const lines: string[] = []
  const slotText = (list: { time?: string; topic?: string }[] | undefined) => (list || []).map((s) => `${s.time || '?'}${s.topic ? ` ${s.topic}` : ''}`).join(' · ')
  if (typeof patch.enabled === 'boolean') lines.push(`Blog automatico: ${patch.enabled ? 'acceso (pubblica da solo)' : 'spento'}`)
  if (patch.days) lines.push(`Giorni: ${patch.days.map((d) => DAY_NAMES[d] ?? d).join(', ') || 'nessuno'}`)
  if (patch.time) lines.push(`Ora: ${patch.time} (ora italiana)`)
  if (patch.add?.length) lines.push(`Uscite da aggiungere: ${slotText(patch.add)}`)
  if (patch.remove?.length) lines.push(`Uscite da togliere: ${patch.remove.join(', ')}`)
  if (patch.slots?.length) lines.push(`Uscite nuove: ${slotText(patch.slots)}`)
  if (after && (patch.add || patch.remove || patch.slots || patch.time)) lines.push(`Uscite dopo la modifica (ora italiana): ${after}`)
  if (typeof patch.shareFacebook === 'boolean') lines.push(`Condivisione su Facebook: ${patch.shareFacebook ? 'sì' : 'no'}`)
  if (typeof patch.shareInstagram === 'boolean') lines.push(`Condivisione su Instagram: ${patch.shareInstagram ? 'sì' : 'no'}`)
  return lines
}

/**
 * Crea l'azione in attesa di conferma (o restituisce quella uguale gia' in attesa:
 * duplicate = true, nessuna scheda nuova).
 */
export async function createPendingAction(input: {
  scope: ConfirmScope
  title: string
  payload: ConfirmPayload
  createdBy: string | null
}): Promise<{ action: PendingAction; duplicate: boolean }> {
  const fp = fingerprint(input.payload)
  const index = parseIndex((await readSetting(INDEX_KEY)).value)
  const twins = index.items.filter((i) => i.scope === input.scope && i.fp === fp).slice(-3)
  for (const twin of twins.reverse()) {
    const existing = await loadAction(twin.id)
    if (existing && stateOf(existing) === 'pending') return { action: existing, duplicate: true }
  }
  const now = new Date()
  const action: PendingAction = {
    id: newActionId(),
    scope: input.scope,
    title: input.title.slice(0, 160),
    payload: input.payload,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CONFIRM_TTL_MS).toISOString(),
    createdBy: input.createdBy,
    status: 'pending',
    attempts: 0,
  }
  await updateSetting<PendingAction | null>(`${KEY_PREFIX}${action.id}`, parseAction, () => action)
  let dropped: string[] = []
  await updateSetting(INDEX_KEY, parseIndex, (idx) => {
    const items = [...idx.items, { id: action.id, scope: action.scope, at: action.createdAt, fp }]
    dropped = items.slice(0, Math.max(0, items.length - MAX_ACTIONS)).map((i) => i.id)
    return { items: items.slice(-MAX_ACTIONS) }
  })
  if (dropped.length) {
    const { error } = await supabaseAdmin.from('app_settings').delete().in('key', dropped.map((id) => `${KEY_PREFIX}${id}`))
    if (error) console.warn('azioni da confermare: pulizia non riuscita:', error.message)
  }
  return { action, duplicate: false }
}

/** Riga per l'assistente: com'e' andata ogni scheda (cosi' non dice mai "inviato" prima del clic). */
export function describeForModel(action: PendingAction): string {
  const state = stateOf(action)
  const until = new Date(action.expiresAt).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  const text: Record<CardState, string> = {
    pending: `IN ATTESA del clic di Luca sul pulsante della scheda (scade il ${until}): NON è ancora partito niente`,
    running: 'in esecuzione proprio ora',
    done: `FATTO dopo la conferma di Luca${action.outcome ? `: ${action.outcome}` : ''}${action.edited ? ' (testo corretto da Luca prima dell’invio)' : ''}`,
    failed: `NON riuscito: ${action.error || 'errore'}${action.retryable ? ' (Luca può riprovare dalla scheda)' : ''}`,
    discarded: 'SCARTATO da Luca: non riproporlo uguale, chiedigli in breve cosa gli serve davvero',
    expired: 'SCADUTO senza conferma: non è partito niente',
    unknown: 'interrotto a metà: esito non sicuro, dì a Luca di controllare prima di rifarlo',
  }
  return `- ${action.title} [${action.id}]: ${text[state]}`
}

// ---------------------------------------------------------------------
// Decisione (dalla route, dopo il clic di Luca)
// ---------------------------------------------------------------------

type Outcome = { ok: true; outcome: string; sentLeadIds?: string[]; payload?: ConfirmPayload } | { ok: false; error: string; retryable: boolean; payload?: ConfirmPayload }

const fail = (error: string, retryable: boolean, payload?: ConfirmPayload): Outcome => ({ ok: false, error, retryable, ...(payload ? { payload } : {}) })

export type DecisionResult = {
  /** true: questa richiesta ha eseguito o scartato l'azione. */
  ok: boolean
  action: PendingAction | null
  card: ConfirmCard | null
  /** Messaggio per Luca quando non si fa niente (gia' inviata, scaduta, in corso…). */
  message?: string
  sentLeadIds?: string[]
}

const NOT_FOUND: DecisionResult = { ok: false, action: null, card: null, message: 'Azione non trovata: chiedi di nuovo all’assistente.' }

function refusal(action: PendingAction): DecisionResult {
  const state = stateOf(action)
  const messages: Record<CardState, string> = {
    pending: 'Azione ancora in attesa: riprova.',
    running: 'Sto già eseguendo questa azione: aspetta qualche secondo.',
    done: 'Già fatto: non la rifaccio una seconda volta.',
    failed: action.error ? `Non riuscita: ${action.error}` : 'Non riuscita.',
    discarded: 'Questa azione è stata scartata: se ti serve, chiedila di nuovo all’assistente.',
    expired: 'Sono passate più di 24 ore: la conferma è scaduta. Chiedila di nuovo all’assistente, così controlli il testo aggiornato.',
    unknown: 'L’invio si è interrotto a metà e non so se è partito: controlla prima di rifarlo.',
  }
  return { ok: false, action, card: cardFor(action), message: messages[state] }
}

/** "Scarta": l'azione si chiude senza fare niente. */
export async function discardAction(id: string, by: string): Promise<DecisionResult> {
  if (!ACTION_ID_RE.test(id)) return NOT_FOUND
  let changed = false
  const after = await updateSetting<PendingAction | null>(`${KEY_PREFIX}${id}`, parseAction, (a) => {
    changed = false
    if (!a || !(a.status === 'pending' || a.status === 'failed')) return false
    changed = true
    return { ...a, status: 'discarded', decidedAt: new Date().toISOString(), decidedBy: by, retryable: false }
  })
  if (!after) return NOT_FOUND
  return changed ? { ok: true, action: after, card: cardFor(after) } : refusal(after)
}

/**
 * "Accetta e invia": prende l'azione (una richiesta sola ci riesce), ricontrolla le
 * condizioni adesso ed esegue esattamente il contenuto salvato (con il testo corretto
 * da Luca, se la scheda lo permette).
 */
export async function acceptAction(id: string, by: string, options: { text?: string; pin?: string; origin?: string } = {}): Promise<DecisionResult> {
  if (!ACTION_ID_RE.test(id)) return NOT_FOUND
  const current = await loadAction(id)
  if (!current) return NOT_FOUND
  // Contratti: il PIN arriva solo qui, si controlla prima di prendere l'azione e non si salva mai.
  if (current.payload.kind === 'share_contract') {
    const pin = typeof options.pin === 'string' ? options.pin.trim() : ''
    if (!PIN_RE.test(pin)) return { ok: false, action: current, card: cardFor(current), message: 'Scegli un PIN da 4 a 12 caratteri (lettere o numeri).' }
    const text = typeof options.text === 'string' ? options.text : current.payload.text
    if (textHasPin(text, pin)) return { ok: false, action: current, card: cardFor(current), message: 'Il messaggio contiene il PIN: toglilo, il PIN va mandato a parte.' }
  }
  const max = EDITABLE_MAX[current.payload.kind]
  const edited = typeof options.text === 'string' && max ? options.text.trim() : undefined
  if (edited !== undefined && !edited) return { ok: false, action: current, card: cardFor(current), message: 'Il testo è vuoto: scrivi qualcosa o scarta.' }
  if (edited !== undefined && max && edited.length > max) return { ok: false, action: current, card: cardFor(current), message: `Testo troppo lungo (massimo ${max} caratteri).` }

  const token = randomUUID()
  const claimed = await updateSetting<PendingAction | null>(`${KEY_PREFIX}${id}`, parseAction, (a) => {
    if (!a) return false
    const now = Date.now()
    const open = now < Date.parse(a.expiresAt) && (a.status === 'pending' || (a.status === 'failed' && a.retryable))
    if (!open) return false
    const payload = edited !== undefined && 'text' in a.payload && edited !== a.payload.text ? { ...a.payload, text: edited } : a.payload
    return {
      ...a,
      payload: payload as ConfirmPayload,
      edited: a.edited || payload !== a.payload,
      status: 'running',
      claim: token,
      claimedAt: new Date(now).toISOString(),
      decidedBy: by,
      attempts: a.attempts + 1,
      error: undefined,
    }
  })
  if (!claimed) return NOT_FOUND
  if (claimed.claim !== token || claimed.status !== 'running') return refusal(claimed)

  let result: Outcome
  try {
    result = await execute(claimed, { pin: options.pin, origin: options.origin })
  } catch (error) {
    // Errore imprevisto prima di sapere se e' partito: per prudenza non si riprova da soli.
    console.error('azione confermata: errore', claimed.payload.kind, error instanceof Error ? error.message : error)
    result = fail(error instanceof Error ? error.message : 'errore imprevisto', false)
  }
  const done = await updateSetting<PendingAction | null>(`${KEY_PREFIX}${id}`, parseAction, (a) => {
    if (!a || a.claim !== token) return false
    const decidedAt = new Date().toISOString()
    return result.ok
      ? { ...a, status: 'done', outcome: result.outcome, error: undefined, retryable: false, decidedAt, payload: result.payload ?? a.payload }
      : { ...a, status: 'failed', error: result.error, retryable: result.retryable, decidedAt, payload: result.payload ?? a.payload }
  })
  const final = done || claimed
  return { ok: result.ok, action: final, card: cardFor(final), sentLeadIds: result.ok ? result.sentLeadIds : undefined, ...(result.ok ? {} : { message: result.error }) }
}

// ---------------------------------------------------------------------
// Esecuzione di ogni tipo di azione (condizioni ricontrollate adesso)
// ---------------------------------------------------------------------

async function execute(action: PendingAction, secret: { pin?: string; origin?: string } = {}): Promise<Outcome> {
  const p = action.payload
  switch (p.kind) {
    case 'share_contract': {
      // Il PIN passa solo di qui (mai salvato nell'azione, nell'esito o nella chat).
      const shared = await shareContractNow(
        p.contractId,
        { channel: p.channel, to: p.to, name: p.name, text: p.text, pin: secret.pin || '', origin: linkOrigin(secret.origin) },
        action.decidedBy || null
      )
      return shared.ok ? { ok: true, outcome: shared.outcome } : fail(shared.error, shared.retryable)
    }
    case 'social_message':
      return sendSocialMessage(p)
    case 'send_emails':
      return sendEmails(action, p)
    case 'publish_carousel':
      return publishCarousel(p)
    case 'schedule_video': {
      try {
        const video = await updateVideoPost(p.videoId, { scheduledAt: p.scheduledAt, caption: p.caption })
        return { ok: true, outcome: `programmato per il ${new Date(video.scheduledAt!).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}` }
      } catch (error) {
        if (error instanceof VideoError) return fail(error.message, false)
        throw error
      }
    }
    case 'schedule_carousel': {
      if (!(await loadPostDraft(p.draftId))) return fail('carosello non trovato', false)
      try {
        const draft = await schedulePostDraft(p.draftId, { scheduledAt: p.scheduledAt, platforms: p.platforms, base: p.base, caption: p.caption, facebook: p.facebook })
        return { ok: true, outcome: `programmato per il ${new Date(draft.scheduledAt!).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}` }
      } catch (error) {
        if (error instanceof DraftConflictError) return fail('il carosello è cambiato dopo la richiesta: chiedimi di nuovo di programmarlo, così vedi la versione giusta', false)
        if (error instanceof DraftError) return fail(error.message, false)
        throw error
      }
    }
    case 'photo_autopilot': {
      try {
        const saved = await saveAutopilotSettings(p.patch)
        return { ok: true, outcome: describeAutopilot(saved).join(' · ') }
      } catch (error) {
        if (error instanceof PhotoError) return fail(`${error.message} Chiedimi di nuovo la modifica.`, false)
        throw error
      }
    }
    case 'publish_blog_now': {
      try {
        const { topic } = await startBlogNow(p.origin, p.topic)
        return { ok: true, outcome: `articolo su «${topic}» avviato: tra qualche minuto arriva la notifica con l’esito` }
      } catch (error) {
        if (error instanceof BlogBusyError) return fail(error.message, true)
        if (error instanceof BlogScheduleError) return fail(error.message, false)
        throw error
      }
    }
    case 'blog_schedule': {
      try {
        const saved = await saveBlogAutoSettings(p.patch)
        return { ok: true, outcome: `blog automatico ${saved.enabled ? 'acceso' : 'spento'}, ${saved.days.map((d) => DAY_NAMES[d]).join(', ')}: ${describeSlots(saved.slots)}` }
      } catch (error) {
        // Le uscite sono cambiate dopo la scheda (es. dal pannello): la modifica non va piu' bene.
        if (error instanceof BlogScheduleError) return fail(`${error.message} Chiedimi di nuovo la modifica.`, false)
        throw error
      }
    }
    case 'remove_push_devices': {
      const known = new Set((await listPushDevices()).map((d) => d.id))
      const present = p.devices.filter((d) => known.has(d.id))
      for (const d of present) await removePushDevice(d.id)
      return { ok: true, outcome: present.length ? `tolti: ${present.map((d) => d.name).join(', ')}` : 'erano già stati tolti' }
    }
    case 'clear_content_directions':
      await saveContentDirections('', 'clear')
      return { ok: true, outcome: 'indicazioni cancellate' }
    case 'replace_content_directions': {
      const text = p.text.trim()
      if (!text) return fail('le indicazioni nuove sono vuote', false)
      // Cambiate dopo la richiesta: si toglierebbe qualcosa che la scheda non mostrava.
      if ((await loadContentDirections()).text.trim() !== p.previous.trim()) {
        return fail('le indicazioni sono cambiate dopo la richiesta: chiedimi di nuovo di sostituirle, così vedi quelle giuste', false)
      }
      const saved = await saveContentDirections(text, 'replace')
      return { ok: true, outcome: `indicazioni sostituite: ${saved.text.slice(0, 200)}` }
    }
    case 'send_document':
      return sendDocument(p)
  }
}

async function sendSocialMessage(p: Extract<ConfirmPayload, { kind: 'social_message' }>): Promise<Outcome> {
  const text = p.text.trim()
  if (!text) return fail('il messaggio è vuoto', false)
  if (text.length > 1900) return fail('messaggio troppo lungo (massimo 1900 caratteri)', false)
  const { data: last } = await supabaseAdmin
    .from('social_messages')
    .select('channel_account_id, contact_name, created_at')
    .eq('platform', p.platform)
    .eq('contact_id', p.contactId)
    .eq('direction', 'in')
    .eq('kind', 'message')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!last) return fail('questa persona non ci ha mai scritto in privato su questo canale: non si può scriverle da qui', false)
  // Regola di Meta: risposte libere solo entro 24 ore dal suo ultimo messaggio.
  if (Date.now() - Date.parse(last.created_at) > META_WINDOW_MS) {
    return fail(`sono passate più di 24 ore dal suo ultimo messaggio: Meta non permette di scriverle da qui. Scrivile dall’app di ${p.platform === 'instagram' ? 'Instagram' : 'Facebook'}`, false)
  }
  const target = { platform: p.platform, kind: 'message' as const, contact_id: p.contactId, channel_account_id: last.channel_account_id, reply_to: null }
  const sent = await deliver(target, text)
  const { data: row } = await supabaseAdmin
    .from('social_messages')
    .insert({
      ...target,
      contact_name: last.contact_name || p.name,
      direction: 'out',
      external_id: sent.id ?? null,
      body: text,
      status: sent.error ? 'failed' : 'sent',
      error_message: sent.error ?? null,
    })
    .select('id')
    .single()
  if (sent.error) return fail(`invio non riuscito: ${sent.error}`, true)
  if (row?.id) await setOrigin(row.id, 'manual').catch(() => undefined)
  return { ok: true, outcome: 'inviato' }
}

async function sendEmails(action: PendingAction, p: Extract<ConfirmPayload, { kind: 'send_emails' }>): Promise<Outcome> {
  const done: Record<string, string> = { ...(p.done || {}) }
  const sentIds: string[] = []
  const failures: string[] = []
  let transient = false
  for (const d of p.drafts) {
    if (done[d.leadId] === 'sent') continue
    if (d.kind === 'followup') {
      // Follow-up gia' partito da un'altra parte (pulsante Invia) dopo la richiesta: non si manda di nuovo.
      const { data: already } = await supabaseAdmin
        .from('social_messages')
        .select('id')
        .eq('platform', 'email')
        .eq('contact_id', d.email.toLowerCase())
        .eq('direction', 'out')
        .eq('status', 'sent')
        .gte('created_at', action.createdAt)
        .limit(1)
      if (already?.length) {
        done[d.leadId] = 'sent'
        continue
      }
    }
    const res =
      d.kind === 'first'
        ? await sendFirstEmail(d.leadId, { subject: d.subject, body: d.body })
        : await sendFollowupEmail(d.leadId, { subject: d.subject, body: d.body, threadId: d.threadId })
    if ('error' in res) {
      done[d.leadId] = res.error
      failures.push(`${d.name}: ${res.error}`)
      if (res.status >= 429) transient = true
      // Limite giornaliero raggiunto: inutile continuare.
      if (res.status === 429) break
    } else {
      done[d.leadId] = 'sent'
      sentIds.push(d.leadId)
    }
  }
  const payload: ConfirmPayload = { ...p, done }
  const total = p.drafts.filter((d) => done[d.leadId] === 'sent').length
  const left = p.drafts.length - total
  if (!total) return fail(failures.slice(0, 3).join('; ') || 'nessuna email inviata', transient, payload)
  const outcome = `inviate ${total} email su ${p.drafts.length}${left ? `; non inviate: ${failures.slice(0, 3).join('; ') || left}` : ''}`
  return { ok: true, outcome, sentLeadIds: sentIds, payload }
}

async function publishCarousel(p: Extract<ConfirmPayload, { kind: 'publish_carousel' }>): Promise<Outcome> {
  if (!(await loadPostDraft(p.draftId))) return fail('carosello non trovato', false)
  try {
    const draft = await publishPostDraft(p.draftId, { platforms: p.platforms, base: p.base, caption: p.caption, facebook: p.facebook })
    const where = [draft.results?.instagram && 'Instagram', draft.results?.facebook && 'Facebook'].filter(Boolean).join(' e ')
    const errors = draft.results?.errors?.length ? draft.results.errors.join(' · ') : ''
    if (draft.status !== 'published') return fail(errors || 'pubblicazione non riuscita', true)
    return { ok: true, outcome: `pubblicato su ${where}${errors ? ` (${errors})` : ''}` }
  } catch (error) {
    if (error instanceof DraftConflictError) return fail('il carosello è cambiato dopo la richiesta: chiedimi di nuovo di pubblicarlo, così vedi la versione giusta', false)
    return fail(error instanceof Error ? error.message : 'pubblicazione non riuscita', true)
  }
}

async function sendDocument(p: Extract<ConfirmPayload, { kind: 'send_document' }>): Promise<Outcome> {
  const record = await loadDocument(p.docId)
  const version = record ? findVersion(record, p.version) : null
  if (!record || !version) return fail('documento o versione non trovati', false)
  const text = p.text.trim()
  if (!text) return fail('il testo dell’email è vuoto', false)
  const pdf = renderDocumentPdf(version)
  const attachment = { filename: p.filename, contentType: 'application/pdf', data: pdf.bytes }
  // Nel thread si usano oggetto e destinatario mostrati sulla scheda.
  const fixed = p.threadId && p.recipient ? { subject: p.subject, recipient: p.recipient } : undefined
  const sent = p.threadId ? { ...(await sendThreadReply(p.threadId, p.to, text, attachment, fixed)), threadId: p.threadId } : await sendNewEmail(p.to, p.subject, text, attachment)
  if (sent.error) return fail(`invio non riuscito: ${sent.error}`, true)
  const { data: row } = await supabaseAdmin
    .from('social_messages')
    .insert({
      platform: 'email',
      kind: 'message',
      contact_id: p.to,
      contact_name: p.name,
      direction: 'out',
      external_id: sent.id ?? null,
      channel_account_id: sent.threadId ?? p.threadId,
      body: `${text}\n\n[Allegato: ${p.filename}]`,
      status: 'sent',
    })
    .select('id')
    .single()
  if (row?.id) await setOrigin(row.id, 'manual').catch(() => undefined)
  return { ok: true, outcome: `inviato a ${p.recipient || p.to} con l’allegato ${p.filename}` }
}
