import { randomUUID } from 'crypto'
import { readSetting, updateSetting } from '@/lib/settings-store'
import { isAIBlockedError } from '@/lib/usage-limits'
import { workspaceAutomationsAccess } from '@/lib/automations-access'
import type { WorkspaceDb } from '@/lib/workspace-db'
import type { AutomationCard, ChatAction, ChatTurn, PostView, ProspectCard } from './assistant'
import { CHANNEL_LABELS, MAX_TEXT, asSendPlatform, planAssistantMessage, sendAssistantEmailWithAttachment, sendAssistantMessage, type SendPlatform } from './assistant-send'
import {
  AutomationError,
  createAutomation,
  deleteAutomation,
  describeSchedule,
  romeLabel as romeWhen,
  updateAutomation,
  type Automation,
  type AutomationInput,
  type AutomationView,
} from './automations'
import { currentDocumentPdf, documentCard, loadDocument, type DocumentCard, type StoredDocument } from './documents'
import { getPost, publishPost, romeLabel, schedulePost, type PostPlatform, type PostRow } from './posts'
import { describeAutopilot, saveAutopilot, type AutopilotInput } from './photo-autopilot'
import {
  ProspectError,
  approveAllProspects,
  approveProspect,
  departureNote,
  discardProspect,
  prospectSettingsSummary,
  prospectsOverview,
  queuePosition,
  saveProspectSettings,
  sendProspectNow,
  type SettingsInput,
} from './prospects'

// Doppia autorizzazione dell'Assistente: ogni azione che esce dalla chat o non si puo'
// annullare (messaggi e email alle persone, documenti inviati, post pubblicati o programmati,
// email programmate create, cambiate o eliminate, prime email di Trova clienti approvate,
// inviate o scartate, "l'AI invia da sola") NON parte con lo strumento dell'AI: lo strumento
// prepara un'azione "in attesa" con il contenuto esatto (testo, destinatario, canale, orario)
// e la chat mostra una scheda con «Accetta e invia» / «Scarta». Solo il clic del titolare
// chiama la rotta app/api/app/assistant/actions, che ricontrolla tutto in quel momento
// (permessi, 24 ore di Meta, limiti, accessi) ed esegue esattamente quel contenuto UNA volta
// (doppio clic o due schede: parte una volta sola). Un "sì" scritto in chat non basta.
// La condivisione di un contratto (share_contract) ha in piu' il campo PIN nella scheda: il PIN
// arriva solo con il clic (mai nella chat, nell'azione salvata, nell'esito o nei log) e il server
// ne salva solo l'hash (lib/saas/contracts.ts, caricato solo quando serve).
//
// In app_settings: ws_pending:<spazio> = ultime 60 azioni (scadono dopo 24 ore; le chiuse restano 7 giorni).

export const PENDING_TTL_MS = 24 * 3600_000
const MAX_PENDING = 60
/** Le azioni gia' chiuse si tengono 7 giorni (per le schede nella chat). */
const KEEP_HANDLED_MS = 7 * 24 * 3600_000
/** "In corso" da oltre 10 minuti (server fermato a meta'): esito non confermato, mai rifatto da solo. */
const RUNNING_STALE_MS = 10 * 60_000

export type PendingKind =
  | 'send_message'
  | 'send_document'
  | 'publish_post'
  | 'schedule_post'
  | 'create_automation'
  | 'update_automation'
  | 'delete_automation'
  | 'approve_client_draft'
  | 'approve_all_client_drafts'
  | 'discard_client_draft'
  | 'set_find_clients'
  | 'share_contract'
  | 'set_photo_autopilot'

export type PendingStatus = 'pending' | 'running' | 'done' | 'failed' | 'discarded'

/** Cosa mostra la scheda: il contenuto esatto che partira'. */
export type PendingSummary = {
  title: string
  lines: string[]
  text?: string
  subject?: string
  /** Il testo si puo' correggere nella scheda prima di inviarlo. */
  editable?: boolean
  confirmLabel: string
  doneLabel: string
  contact?: { platform: string; contactId: string; name: string }
  document?: { id: string; version: number; title: string; pages: number }
  /** La scheda chiede un PIN (condivisione del contratto): si scrive li', non parte con la chat. */
  pin?: { min: number; max: number; for: string }
}

export type PendingAction = {
  id: string
  kind: PendingKind
  workspaceId: string
  chatId: string | null
  createdBy: string
  createdAt: string
  expiresAt: string
  status: PendingStatus
  payload: Record<string, unknown>
  view: PendingSummary
  handledAt?: string
  handledBy?: string
  /** Esito in parole semplici (dopo il clic). */
  outcome?: string
}

/** Scheda nella chat (stato aggiornato quando si apre la chat). */
export type PendingView = PendingSummary & {
  id: string
  kind: PendingKind
  status: PendingStatus | 'expired' | 'unconfirmed'
  createdAt: string
  expiresAt: string
  outcome?: string
}

/** Tipi di azione che richiedono le Automazioni attive (anche al momento del clic). */
const NEEDS_AUTOMATIONS = new Set<PendingKind>(['create_automation', 'update_automation', 'delete_automation', 'approve_client_draft', 'approve_all_client_drafts', 'discard_client_draft', 'set_find_clients', 'set_photo_autopilot'])

const storeKey = (workspaceId: string) => `ws_pending:${workspaceId}`

const parseList = (raw: string | null): PendingAction[] => {
  if (!raw) return []
  try {
    const value = JSON.parse(raw)
    return Array.isArray(value) ? (value as PendingAction[]).filter((a) => a && typeof a.id === 'string' && typeof a.kind === 'string') : []
  } catch {
    return []
  }
}

/** Le piu' recenti, senza quelle chiuse o scadute da oltre 7 giorni. */
function prune(list: PendingAction[], now: number): PendingAction[] {
  return list
    .filter((a) => {
      const age = now - Date.parse(a.handledAt || a.expiresAt)
      return a.status === 'pending' || a.status === 'running' ? now - Date.parse(a.expiresAt) < KEEP_HANDLED_MS : age < KEEP_HANDLED_MS
    })
    .slice(-MAX_PENDING)
}

export async function loadPendingActions(workspaceId: string): Promise<PendingAction[]> {
  return parseList((await readSetting(storeKey(workspaceId))).value)
}

export function pendingView(a: PendingAction, now = Date.now()): PendingView {
  const status: PendingView['status'] =
    a.status === 'pending' && Date.parse(a.expiresAt) <= now ? 'expired' : a.status === 'running' && now - Date.parse(a.handledAt || a.createdAt) > RUNNING_STALE_MS ? 'unconfirmed' : a.status
  return { ...a.view, id: a.id, kind: a.kind, status, createdAt: a.createdAt, expiresAt: a.expiresAt, ...(a.outcome ? { outcome: a.outcome } : {}) }
}

const sameContent = (a: PendingAction, kind: PendingKind, payload: Record<string, unknown>) => a.kind === kind && JSON.stringify(a.payload) === JSON.stringify(payload)

export type PrepareContext = { db: WorkspaceDb; userId: string; chatId: string | null; now?: number }

/**
 * Nuova azione in attesa di conferma. La stessa azione (stesso contenuto) ancora in attesa nella
 * stessa chat non si ripete: si restituisce quella (duplicate: true, la scheda e' gia' piu' sopra).
 * In un'altra chat se ne prepara una nuova, cosi' la scheda c'e' nella chat aperta (ogni scheda parte
 * solo con il suo clic; per i messaggi l'invio salta anche lo stesso testo mandato pochi minuti prima).
 */
export async function createPending(ctx: PrepareContext, kind: PendingKind, payload: Record<string, unknown>, view: PendingSummary): Promise<{ action: PendingAction; duplicate: boolean }> {
  const now = ctx.now ?? Date.now()
  const out: { action: PendingAction | null; duplicate: boolean } = { action: null, duplicate: false }
  await updateSetting<PendingAction[]>(storeKey(ctx.db.workspaceId), parseList, (list) => {
    out.duplicate = false
    const same = list.find((a) => a.status === 'pending' && a.createdBy === ctx.userId && a.chatId === ctx.chatId && Date.parse(a.expiresAt) > now && sameContent(a, kind, payload))
    if (same) {
      out.action = same
      out.duplicate = true
      return false
    }
    out.action = {
      id: randomUUID(),
      kind,
      workspaceId: ctx.db.workspaceId,
      chatId: ctx.chatId,
      createdBy: ctx.userId,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + PENDING_TTL_MS).toISOString(),
      status: 'pending',
      payload,
      view,
    }
    return prune([...list, out.action], now)
  })
  return { action: out.action as PendingAction, duplicate: out.duplicate }
}

/** Azione della chat per la scheda di conferma. */
export const pendingChatAction = (action: PendingAction): ChatAction => ({ kind: 'pending', at: action.createdAt, pending: pendingView(action) })

/** Nota per l'AI dopo che uno strumento ha preparato un'azione. */
export const pendingNote = (view: PendingSummary) =>
  `NON è ancora partito niente: sotto la tua risposta compare una scheda con il contenuto esatto e i pulsanti «${view.confirmLabel}» e «Scarta». Parte solo se il cliente tocca «${view.confirmLabel}». Nella risposta di' in una frase cosa hai preparato e che deve confermare con il pulsante sulla scheda. Non dire che è stato inviato, pubblicato, programmato, approvato o eliminato.`

// --- Schede: carte gia' usate nella chat (spostate qui da assistant.ts) ------------------------

export const postView = (p: PostRow): PostView => ({
  id: p.id,
  status: p.status,
  kind: p.kind,
  title: p.title,
  caption: p.caption,
  facebook_text: p.facebook_text,
  media: p.media,
  platforms: p.platforms,
  publish_at: p.publish_at,
  results: p.results,
  error_message: p.error_message,
})

export const automationCard = (a: AutomationView | Automation, from: string): AutomationCard => ({
  id: a.id,
  name: a.name,
  recipients: a.recipients,
  subject: a.subject,
  mode: a.content.mode,
  when: describeSchedule(a.schedule),
  nextRun: a.nextRun,
  active: a.active,
  from,
})

/** Riepilogo vero di cosa e' programmato (dai dati salvati), da dire al cliente. */
export function automationRecap(a: AutomationView, from: string): string {
  const n = a.recipients.length
  return `«${a.name}»: ${n === 1 ? '1 email' : `${n} email, una per destinatario,`} a ${a.recipients.join(', ')}, ${describeSchedule(a.schedule)} (ora italiana)${
    a.nextRun && a.schedule.kind === 'daily' ? `, primo invio ${romeWhen(a.nextRun)}` : ''
  }${from ? `, dalla casella ${from}` : ''}${a.content.mode === 'ai' ? ', testo scritto dall’AI a ogni invio' : ''}${a.active ? '' : ' (in pausa)'}.`
}

// --- Esecuzione dopo il clic ------------------------------------------------------------------------

export type ExecuteOutcome = {
  ok: boolean
  /** done | failed | discarded; expired, handled, not_found, forbidden: niente eseguito ora. */
  code: 'done' | 'failed' | 'discarded' | 'expired' | 'handled' | 'not_found' | 'forbidden' | 'invalid'
  message: string
  action: PendingAction | null
  /** Schede da aggiungere alla chat con l'esito (messaggio inviato, automazione, post...). */
  cards: ChatAction[]
}

const HANDLED_MESSAGE: Record<string, string> = {
  running: 'Ci sto già lavorando: aspetta l’esito qui sopra.',
  done: 'Già fatto: questa azione è stata eseguita prima.',
  failed: 'Questa azione non è riuscita prima: chiedimela di nuovo se vuoi riprovare.',
  discarded: 'L’avevi scartata: chiedimela di nuovo se ti serve.',
}

type Claim =
  | { code: 'claimed'; action: PendingAction }
  | { code: 'not_found' }
  | { code: 'forbidden' }
  | { code: 'invalid'; message?: string }
  | { code: 'handled'; action: PendingAction }
  | { code: 'expired'; action: PendingAction }

/** Prende l'azione per eseguirla (una volta sola: chi arriva dopo trova "in corso" o "fatta"). */
async function claim(workspaceId: string, id: string, userId: string, next: (a: PendingAction) => PendingAction | { invalid: true; message?: string }, now: number): Promise<Claim> {
  const out: { claim: Claim } = { claim: { code: 'not_found' } }
  await updateSetting<PendingAction[]>(storeKey(workspaceId), parseList, (list) => {
    out.claim = { code: 'not_found' }
    const index = list.findIndex((a) => a.id === id)
    if (index < 0) return false
    const a = list[index]
    if (a.createdBy !== userId || a.workspaceId !== workspaceId) {
      out.claim = { code: 'forbidden' }
      return false
    }
    if (a.status !== 'pending') {
      out.claim = { code: 'handled', action: a }
      return false
    }
    if (Date.parse(a.expiresAt) <= now) {
      out.claim = { code: 'expired', action: a }
      return false
    }
    const changed = next(a)
    if ('invalid' in changed) {
      out.claim = { code: 'invalid', ...(changed.message ? { message: changed.message } : {}) }
      return false
    }
    out.claim = { code: 'claimed', action: changed }
    const copy = [...list]
    copy[index] = changed
    return copy
  })
  return out.claim
}

async function finish(workspaceId: string, id: string, status: PendingStatus, outcome: string): Promise<PendingAction | null> {
  const out: { action: PendingAction | null } = { action: null }
  await updateSetting<PendingAction[]>(storeKey(workspaceId), parseList, (list) => {
    const index = list.findIndex((a) => a.id === id)
    if (index < 0) return false
    out.action = { ...list[index], status, outcome: outcome.slice(0, 600) }
    const copy = [...list]
    copy[index] = out.action
    return copy
  })
  return out.action
}

/** Errore scritto per l'AI -> frase per il titolare (senza "dai al cliente…" e simili). */
export function userError(error: string): string {
  let text = String(error || 'non riuscito').trim()
  const cut = text.search(/(\.|:)\s+(Non è partito niente|Non è cambiato niente|Non è stato (fatto|programmato|eliminato) niente|Chiedi al cliente|chiedi al cliente|dai al cliente|Dai al cliente|dillo al cliente|Dillo al cliente)/)
  if (cut > 0) text = text.slice(0, cut)
  text = text.replace(/\s*\(poi usa[^)]*\)/, '').trim()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const dot = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`)

/**
 * "Accetta e invia" / "Conferma": esegue l'azione (esattamente il contenuto salvato, con il
 * testo corretto nella scheda se il tipo lo permette) dopo aver ricontrollato tutto adesso.
 */
export async function executePending(
  db: WorkspaceDb,
  userId: string,
  id: string,
  /** pin: scritto nella scheda (solo share_contract), mai salvato; origin: indirizzo del sito per il link. */
  options: { text?: unknown; now?: number; pin?: unknown; origin?: string } = {}
): Promise<ExecuteOutcome> {
  const now = options.now ?? Date.now()
  const edited = typeof options.text === 'string' ? options.text.replace(/\r\n?/g, '\n').trim() : null
  const pin = typeof options.pin === 'string' ? options.pin.trim() : ''
  const claimed = await claim(
    db.workspaceId,
    id,
    userId,
    (a) => {
      // Contratto: senza un PIN valido non parte niente (la scheda resta da confermare).
      if (a.kind === 'share_contract') {
        if (!PIN_FORMAT.test(pin)) return { invalid: true, message: 'Scegli un PIN da 4 a 12 caratteri (numeri o lettere) nella scheda.' }
        if (edited && edited.toLowerCase().includes(pin.toLowerCase())) return { invalid: true, message: 'Il messaggio contiene il PIN: toglilo, il PIN va mandato a parte.' }
      }
      const handled = { ...a, status: 'running' as const, handledAt: new Date(now).toISOString(), handledBy: userId }
      if (edited === null || edited === (a.view.text || '')) return handled
      if (!a.view.editable || !edited) return { invalid: true }
      const platform = asSendPlatform(a.payload.platform) || 'email'
      if (edited.length > MAX_TEXT[platform]) return { invalid: true }
      return { ...handled, payload: { ...a.payload, text: edited }, view: { ...a.view, text: edited } }
    },
    now
  )
  if (claimed.code === 'not_found') return { ok: false, code: 'not_found', message: 'Azione non trovata.', action: null, cards: [] }
  if (claimed.code === 'forbidden') return { ok: false, code: 'forbidden', message: 'Questa azione non è tua.', action: null, cards: [] }
  if (claimed.code === 'invalid') return { ok: false, code: 'invalid', message: claimed.message || 'Testo non valido: scrivilo di nuovo (non vuoto e non troppo lungo).', action: null, cards: [] }
  if (claimed.code === 'expired') return { ok: false, code: 'expired', message: 'Questa richiesta è scaduta (più di 24 ore): chiedimela di nuovo.', action: claimed.action, cards: [] }
  if (claimed.code === 'handled') return { ok: false, code: 'handled', message: HANDLED_MESSAGE[claimed.action.status] || 'Già gestita.', action: claimed.action, cards: [] }

  const action = claimed.action
  let result: { ok: boolean; message: string; cards: ChatAction[] }
  try {
    if (NEEDS_AUTOMATIONS.has(action.kind) && !(await workspaceAutomationsAccess(userId, db.workspaceId).then((a) => a.enabled).catch(() => false))) {
      result = { ok: false, message: 'Le automazioni non sono più attive per questo account: non è stato fatto niente.', cards: [] }
    } else {
      result = await run(db, userId, action, now, { pin, origin: options.origin })
    }
  } catch (error) {
    // AI del piano finita (gli invii dell'Assistente si fermano) o errore imprevisto: niente rifatto da solo.
    const message = isAIBlockedError(error)
      ? (error as Error).message
      : error instanceof AutomationError || error instanceof ProspectError || (error instanceof Error && error.name === 'ContractError')
      ? error.message
      : `Non riuscito: ${error instanceof Error ? error.message : 'errore'}`
    result = { ok: false, message: dot(message), cards: [] }
  }
  const saved = await finish(db.workspaceId, action.id, result.ok ? 'done' : 'failed', result.message)
  return { ok: result.ok, code: result.ok ? 'done' : 'failed', message: result.message, action: saved, cards: result.cards }
}

/** "Scarta": non parte niente; l'Assistente chiede cosa serve invece. */
export async function discardPending(db: WorkspaceDb, userId: string, id: string, now = Date.now()): Promise<ExecuteOutcome> {
  const claimed = await claim(db.workspaceId, id, userId, (a) => ({ ...a, status: 'discarded', handledAt: new Date(now).toISOString(), handledBy: userId, outcome: 'Scartata dal cliente: non è partito niente.' }), now)
  if (claimed.code === 'not_found') return { ok: false, code: 'not_found', message: 'Azione non trovata.', action: null, cards: [] }
  if (claimed.code === 'forbidden') return { ok: false, code: 'forbidden', message: 'Questa azione non è tua.', action: null, cards: [] }
  if (claimed.code === 'invalid') return { ok: false, code: 'invalid', message: 'Non valido.', action: null, cards: [] }
  if (claimed.code === 'handled') return { ok: false, code: 'handled', message: HANDLED_MESSAGE[claimed.action.status] || 'Già gestita.', action: claimed.action, cards: [] }
  // Scaduta: si puo' scartare lo stesso (resta solo la scheda chiusa).
  if (claimed.code === 'expired') {
    const saved = await finish(db.workspaceId, id, 'discarded', 'Scaduta e scartata: non è partito niente.')
    return { ok: true, code: 'discarded', message: discardReply(claimed.action), action: saved, cards: [] }
  }
  return { ok: true, code: 'discarded', message: discardReply(claimed.action), action: claimed.action, cards: [] }
}

/** Risposta dell'Assistente dopo "Scarta": niente e' partito, cosa serve invece? */
export function discardReply(a: PendingAction): string {
  const name = a.view.contact?.name
  if (a.kind === 'send_message') return `Ok, ho scartato il messaggio${name ? ` per ${name}` : ''}: non è partito niente. Cosa ti serve invece? Dimmi cosa cambiare (testo, tono o destinatario) e lo preparo di nuovo.`
  if (a.kind === 'send_document') return `Ok, non invio il documento${name ? ` a ${name}` : ''}: non è partito niente. Cosa ti serve invece? Posso cambiare il documento o il messaggio di accompagnamento.`
  if (a.kind === 'share_contract') return `Ok, non condivido il contratto${name ? ` con ${name}` : ''}: non è stato creato nessun link. Cosa ti serve invece? Posso cambiare il contratto, il canale o il messaggio.`
  return `Ok, ho scartato «${a.view.title}»: non è stato fatto niente. Cosa ti serve invece? Dimmi cosa cambiare e lo preparo di nuovo.`
}

const channelName = (platform: unknown) => CHANNEL_LABELS[(asSendPlatform(platform) || 'email') as SendPlatform]
const str = (v: unknown) => (typeof v === 'string' ? v : '')
/** PIN del contratto: 4-12 numeri o lettere (stessa regola di lib/saas/contracts.ts). */
const PIN_FORMAT = /^[A-Za-z0-9]{4,12}$/

/** Esecuzione vera di ogni tipo di azione (i controlli si rifanno dentro le funzioni di sempre). */
async function run(db: WorkspaceDb, userId: string, action: PendingAction, now: number, extra: { pin?: string; origin?: string } = {}): Promise<{ ok: boolean; message: string; cards: ChatAction[] }> {
  const p = action.payload
  const at = new Date().toISOString()
  switch (action.kind) {
    case 'share_contract': {
      // Caricato solo qui (link, PIN, invio): il PIN va solo a shareContract, che salva l'hash.
      const contracts = await import('./contracts')
      const outcome = await contracts.shareContract(db, userId, str(p.contractId), {
        recipientName: p.recipientName,
        email: p.email,
        channel: p.channel,
        contactId: p.contactId,
        text: p.text,
        pin: extra.pin,
        origin: extra.origin,
      })
      const c = outcome.contract
      return {
        ok: true,
        message: contracts.shareSummary(outcome),
        cards: [{ kind: 'contract', at, contract: { id: c.id, title: c.title, recipient: c.recipient.name, status: c.status, channel: outcome.channel } }],
      }
    }
    case 'send_message': {
      const outcome = await sendAssistantMessage(db, { platform: p.platform, to: p.contactId, text: p.text, subject: p.subject, again: true })
      if (!outcome.ok) return { ok: false, message: `Non è partito niente: ${dot(userError(outcome.error))}${outcome.copyText ? ' Puoi copiare il testo e mandarlo dall’app.' : ''}`, cards: [] }
      const sent = outcome.sent
      return {
        ok: true,
        message: outcome.duplicate ? `Era già partito pochi minuti fa: a ${sent.name} su ${CHANNEL_LABELS[sent.platform]} non ho mandato un doppione.` : `Fatto: messaggio inviato a ${sent.name} su ${CHANNEL_LABELS[sent.platform]}.`,
        cards: [{ kind: 'message', at, ...sent }],
      }
    }
    case 'send_document': {
      const doc = await loadDocument(db.workspaceId, str(p.documentId))
      if (!doc) return { ok: false, message: 'Il documento non c’è più: non è partito niente.', cards: [] }
      // Termini della collaborazione come sono nel contratto (se gia' aperto): mai una data vecchia all'altra parte.
      const file = await currentDocumentPdf(db.workspaceId, doc, Number(p.version) || null)
      const outcome = await sendAssistantEmailWithAttachment(db, { to: str(p.contactId), text: str(p.text), subject: str(p.subject) || null, attachment: { filename: file.filename, content: file.pdf, contentType: 'application/pdf' } }, now)
      if (!outcome.ok) return { ok: false, message: `Non è partito niente: ${dot(userError(outcome.error))}`, cards: [] }
      return { ok: true, message: `Fatto: «${doc.title}» inviato a ${outcome.sent.name} per email, con il PDF allegato.`, cards: [{ kind: 'message', at, ...outcome.sent, text: `${outcome.sent.text}\n\n[Allegato: ${file.filename}]` }] }
    }
    case 'publish_post': {
      const current = await getPost(db, str(p.postId))
      if (!current) return { ok: false, message: 'Il post non c’è più: non è stato pubblicato niente.', cards: [] }
      if (!['draft', 'scheduled', 'failed'].includes(current.status)) return { ok: false, message: current.status === 'published' ? 'Il post è già pubblicato.' : 'Il post è già in pubblicazione o eliminato.', cards: [] }
      const post = await publishPost(db, current.id)
      const where = [post.results?.instagram && 'Instagram', post.results?.facebook && 'Facebook'].filter(Boolean).join(' e ')
      // Video: Instagram lo sta ancora elaborando, esce da solo con il prossimo giro.
      if (post.status === 'scheduled' && post.results?.video?.container) {
        return { ok: true, message: `Instagram sta ancora elaborando il video «${post.title || 'video'}»: esce da solo entro pochi minuti${where ? ` (su ${where} è già uscito)` : ''}.`, cards: [{ kind: 'post', post: postView(post) }] }
      }
      if (post.status !== 'published') return { ok: false, message: `Pubblicazione non riuscita${post.results?.errors?.length ? `: ${post.results.errors.join(' · ')}` : '.'}`, cards: [{ kind: 'post', post: postView(post) }] }
      return { ok: true, message: `Fatto: «${post.title || 'post'}» pubblicato${where ? ` su ${where}` : ''}.`, cards: [{ kind: 'post', post: postView(post) }] }
    }
    case 'schedule_post': {
      const when = new Date(str(p.when))
      if (!(when.getTime() > now)) return { ok: false, message: 'L’orario scelto è già passato: chiedimi un nuovo giorno e una nuova ora.', cards: [] }
      const platforms = Array.isArray(p.platforms) ? (p.platforms as PostPlatform[]) : undefined
      const post = await schedulePost(db, str(p.postId), when, platforms)
      return { ok: true, message: `Fatto: «${post.title || 'post'}» programmato per ${romeLabel(post.publish_at as string)}.`, cards: [{ kind: 'post', post: postView(post) }] }
    }
    case 'create_automation': {
      const saved = await createAutomation(db, userId, p.input as AutomationInput, { origin: 'assistant' })
      return {
        ok: true,
        message: `Fatto: email programmata. ${automationRecap(saved.automation, saved.mailbox)}${saved.warning ? ` ${saved.warning}` : ''}`,
        cards: [{ kind: 'automation', op: 'created', at, automation: automationCard(saved.automation, saved.mailbox) }],
      }
    }
    case 'update_automation': {
      const saved = await updateAutomation(db, str(p.id), p.input as AutomationInput)
      const input = p.input as Record<string, unknown>
      const onlyActive = typeof input.active === 'boolean' && Object.keys(input).every((k) => k === 'active' || input[k] === undefined)
      return {
        ok: true,
        message: `Fatto: automazione ${onlyActive ? (input.active ? 'ripresa' : 'messa in pausa') : 'modificata'}. ${automationRecap(saved.automation, saved.mailbox)}${saved.warning ? ` ${saved.warning}` : ''}`,
        cards: [{ kind: 'automation', op: onlyActive ? (input.active ? 'resumed' : 'paused') : 'updated', at, automation: automationCard(saved.automation, saved.mailbox) }],
      }
    }
    case 'delete_automation': {
      const removed = await deleteAutomation(db, str(p.id))
      return { ok: true, message: `Fatto: automazione «${removed.name}» eliminata.`, cards: [{ kind: 'automation', op: 'deleted', at, automation: automationCard({ ...removed, nextRun: null }, '') }] }
    }
    case 'approve_client_draft': {
      const edit = p.edit && typeof p.edit === 'object' ? (p.edit as { subject?: unknown; body?: unknown }) : {}
      // Solo la bozza mostrata nella scheda (impronta "base"): se e' stata riscritta nel frattempo non parte niente.
      const base = str(p.base)
      if (!base) return { ok: false, message: 'Questa scheda è di una versione vecchia: non è partito niente. Chiedimela di nuovo.', cards: [] }
      if (p.sendNow === true) {
        const sent = await sendProspectNow(db, str(p.id), edit, { expect: base })
        const card: ProspectCard = { id: sent.id, name: sent.name, email: sent.email, subject: sent.draft?.subject }
        return { ok: true, message: `Fatto: email inviata a ${sent.name}${sent.email ? ` (${sent.email})` : ''}.`, cards: [{ kind: 'prospect', op: 'sent', at, prospect: card }] }
      }
      const approved = await approveProspect(db, str(p.id), edit, now, base)
      const o = await prospectsOverview(db)
      const parte = departureNote(o, queuePosition(o.prospects, approved.id))
      const note = parte.charAt(0).toUpperCase() + parte.slice(1) + '.'
      return {
        ok: true,
        message: `Fatto: email per ${approved.name} approvata: ${parte}.`,
        cards: [{ kind: 'prospect', op: 'approved', at, prospect: { id: approved.id, name: approved.name, email: approved.email, subject: approved.draft?.subject, note } }],
      }
    }
    case 'approve_all_client_drafts': {
      // Solo le email mostrate nella scheda (id e impronta), tutte o nessuna: mai quelle arrivate dopo.
      const drafts = (Array.isArray(p.drafts) ? p.drafts : [])
        .filter((d): d is { id: string; fp: string } => Boolean(d) && typeof (d as { id?: unknown }).id === 'string' && typeof (d as { fp?: unknown }).fp === 'string')
      if (!drafts.length) return { ok: false, message: 'Questa scheda è di una versione vecchia: non è stato approvato niente. Chiedimela di nuovo.', cards: [] }
      const n = await approveAllProspects(db, now, drafts)
      const o = await prospectsOverview(db)
      const parte = departureNote(o, o.counts.queued, true)
      if (!n) return { ok: true, message: 'Non c’erano email da approvare.', cards: [] }
      return {
        ok: true,
        message: `Fatto: ${n} email approvate: ${parte}.`,
        cards: [{ kind: 'prospect', op: 'approved', at, prospect: { name: 'Tutte le email da approvare', count: n, note: parte.charAt(0).toUpperCase() + parte.slice(1) + '.' } }],
      }
    }
    case 'discard_client_draft': {
      const block = p.block === true
      const done = await discardProspect(db, str(p.id), { block })
      return {
        ok: true,
        message: block ? `Fatto: ${done.name} non verrà più contattata.` : `Fatto: email per ${done.name} scartata.`,
        cards: [{ kind: 'prospect', op: block ? 'blocked' : 'discarded', at, prospect: { id: done.id, name: done.name, email: done.email } }],
      }
    }
    case 'set_photo_autopilot': {
      const saved = await saveAutopilot(db, userId, p.input as AutopilotInput, now)
      const s = saved.state.settings
      return {
        ok: true,
        message: `Fatto: Autopilota foto ${s.active ? 'attivo' : 'salvato (spento)'}: ${describeAutopilot(s)}${saved.nextRun ? `, il prossimo carosello ${romeLabel(saved.nextRun)}` : ''}.`,
        cards: [],
      }
    }
    case 'set_find_clients': {
      const saved = await saveProspectSettings(db, userId, p.input as SettingsInput)
      const o = await prospectsOverview(db)
      const summary = prospectSettingsSummary(saved.settings, o.nextRun) as Record<string, string>
      const note = `${summary.quando}, ${saved.settings.emailsPerDay} email al giorno, ${summary.invio}${saved.settings.active ? '' : ' (in pausa)'}`
      return {
        ok: true,
        message: `Fatto: Trova clienti salvato (${note}).${saved.warning ? ` ${saved.warning}` : ''}`,
        cards: [{ kind: 'prospect', op: 'settings', at, prospect: { name: saved.settings.niche || 'Trova clienti', note } }],
      }
    }
  }
  return { ok: false, message: 'Azione sconosciuta: non è stato fatto niente.', cards: [] }
}

// --- Chat: schede aggiornate e note per l'AI ------------------------------------------------------

/**
 * Termini della collaborazione dei documenti gia' aperti come contratti (id -> termini; null se il
 * contratto e' chiuso). Il modulo dei contratti si carica solo qui; se non c'e', restano quelli del documento.
 */
export async function contractTermsFor(workspaceId: string, ids: string[]): Promise<Map<string, { lines: string[]; missing: string[] } | null>> {
  const out = new Map<string, { lines: string[]; missing: string[] } | null>()
  if (!ids.length) return out
  const contracts = await import('./contracts').catch(() => null)
  if (!contracts) return out
  await Promise.all(
    ids.slice(0, 30).map(async (id) => {
      const c = await contracts.loadContract(workspaceId, id).catch(() => null)
      if (c) out.set(id, contracts.termsCard(c))
    })
  )
  return out
}

/** Schede di conferma e documenti nella chat con lo stato e le versioni di adesso. */
export async function refreshAssistantCards(workspaceId: string, turns: ChatTurn[], now = Date.now()): Promise<ChatTurn[]> {
  const hasPending = turns.some((t) => t.actions?.some((a) => a.kind === 'pending'))
  const docIds = new Set<string>()
  turns.forEach((t) => t.actions?.forEach((a) => a.kind === 'document' && docIds.add(a.document.id)))
  if (!hasPending && !docIds.size) return turns
  const [pending, docs] = await Promise.all([
    hasPending ? loadPendingActions(workspaceId).catch(() => [] as PendingAction[]) : Promise.resolve([] as PendingAction[]),
    Promise.all([...docIds].slice(0, 30).map(async (id) => [id, await loadDocument(workspaceId, id).catch(() => null)] as const)),
  ])
  const byId = new Map(pending.map((a) => [a.id, a]))
  const docById = new Map<string, StoredDocument | null>(docs)
  // Documenti gia' aperti come contratti: i termini della collaborazione come sono nel contratto (scelti nella pagina).
  const contractTerms = await contractTermsFor(workspaceId, [...docById].flatMap(([id, doc]) => (doc ? [id] : [])))
  // L'ultima scheda di ogni documento mostra l'ultima versione; le altre la loro.
  const lastCard = new Map<string, number>()
  turns.forEach((t, i) => t.actions?.forEach((a) => a.kind === 'document' && lastCard.set(a.document.id, i)))
  return turns.map((t, i) => ({
    ...t,
    actions: t.actions?.map((a) => {
      if (a.kind === 'pending') {
        const fresh = byId.get(a.pending.id)
        if (fresh) return { ...a, pending: pendingView(fresh, now) }
        // Non piu' salvata (oltre 7 giorni): in attesa diventa scaduta.
        return a.pending.status === 'pending' || a.pending.status === 'running' ? { ...a, pending: { ...a.pending, status: 'expired' as const } } : a
      }
      if (a.kind === 'document') {
        const doc = docById.get(a.document.id)
        if (!doc) return docById.has(a.document.id) ? { ...a, document: { ...a.document, missing: true } } : a
        const card: DocumentCard = documentCard(doc, lastCard.get(a.document.id) === i ? null : a.document.version)
        const terms = contractTerms.get(a.document.id)
        if (terms === null) delete card.terms
        else if (terms && card.terms) card.terms = terms
        return { ...a, document: card }
      }
      return a
    }),
  }))
}

/** Azioni ancora in attesa di conferma nelle ultime battute della chat. */
export function openPending(turns: ChatTurn[], now = Date.now()): PendingView[] {
  return turns
    .slice(-12)
    .flatMap((t) => t.actions || [])
    .filter((a): a is Extract<ChatAction, { kind: 'pending' }> => a.kind === 'pending')
    .map((a) => a.pending)
    .filter((p) => p.status === 'pending' && Date.parse(p.expiresAt) > now)
}

const STATUS_NOTE: Record<PendingView['status'], string> = {
  pending: 'in attesa del clic del cliente (non è partito niente)',
  running: 'in corso',
  done: 'eseguita dopo la conferma del cliente',
  failed: 'non riuscita',
  discarded: 'scartata dal cliente: non è partito niente',
  expired: 'scaduta senza conferma: non è partito niente',
  unconfirmed: 'esito non confermato',
}

/** Riga per l'AI con l'azione preparata e il suo esito (per le richieste dopo). */
export const pendingTurnNote = (p: PendingView) =>
  ` [azione da confermare: ${p.title}${p.text ? ` «${p.text.slice(0, 200)}»` : ''} — ${STATUS_NOTE[p.status]}${p.outcome && p.status !== 'pending' ? `: ${p.outcome.slice(0, 200)}` : ''}]`

/**
 * Il cliente scrive solo una conferma ("sì", "ok invia", "confermo"): con una scheda in
 * attesa non si esegue niente, si indica il pulsante (la scheda e' l'unico modo per confermare).
 */
export function typedConfirmation(message: string): boolean {
  const text = message
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text || text.split(' ').length > 6) return false
  const word = "(si|ok|okay|va bene|certo|confermo|conferma|accetto|accetta|procedi|vai|fallo|invia|invialo|inviala|inviali|inviale|invia pure|manda|mandalo|mandala|mandali|mandale|pubblica|pubblicalo|programma|programmalo|elimina|eliminala|eliminalo|approva|approvala|approvale|yes|sure|send|send it|go|go ahead|do it|perfetto|esatto|giusto)"
  return new RegExp(`^${word}( ${word}| pure| ora| adesso| subito| grazie| dai)*$`).test(text)
}

export function confirmWithButtonReply(open: PendingView[]): string {
  const first = open[open.length - 1]
  return `Per confermare tocca «${first.confirmLabel}» sulla scheda qui sopra (${first.title}): è l’unico modo per farlo partire, scrivere «sì» non basta. Se non va bene, tocca «Scarta» e dimmi cosa cambiare.`
}
