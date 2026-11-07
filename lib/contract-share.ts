import { after } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { deliver, setOrigin } from '@/lib/meta/agent'
import { sendNewEmail } from '@/lib/gmail'
import { sendPushToAdmins } from '@/lib/push'
import { emailLayout, escapeHtml, sendEmail } from '@/lib/email'
import { BUSINESS, deleteDocument } from '@/lib/assistant-documents'
import { romeLong } from '@/lib/contract-terms'
import {
  CHANNEL_LABEL,
  ContractError,
  PIN_RE,
  SHARE_CHANNELS,
  addNote,
  claimOpenNotice,
  contractLink,
  createShareLink,
  currentLink,
  loadContract,
  setRecipient,
  termsProblem,
  undoShareLink,
  type Contract,
  type NoteKind,
  type ShareChannel,
} from '@/lib/contracts'

// Invio del link del contratto (dalla scheda di conferma della super chat o dalla
// pagina Contratti) e avvisi a Luca: campanella, notifica push ed email al suo indirizzo
// quando chi riceve apre il link, quando firma e quando il contratto e' firmato da tutti.
// Il PIN arriva qui solo per farne l'hash: non entra nel messaggio, nella chat, nel
// database dei messaggi o nei log. Nel registro dei messaggi il link e' nascosto.

const META_WINDOW_MS = 24 * 3600_000
export const MAX_SHARE_TEXT = 1500
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const firstName = (name: string) => name.split(/\s+/)[0] || name

export { defaultShareText } from '@/lib/contract-text'

/** Messaggio che parte davvero: testo, link e la frase sul PIN (mai il PIN). */
export function composeShareMessage(text: string, link: string) {
  return `${text.trim()}\n\nApri il contratto: ${link}\nPer aprirlo serve un PIN: te lo mando a parte.`
}

/** Il testo contiene il PIN? (si confronta senza maiuscole e spazi). */
export function textHasPin(text: string, pin: string) {
  const p = pin.trim().toLowerCase()
  return p.length >= 4 && text.toLowerCase().replace(/\s+/g, '').includes(p)
}

export type ShareInput = { channel: ShareChannel; to?: string; name?: string; text: string; pin: string; origin: string }
export type ShareResult = { ok: true; outcome: string; contract: Contract } | { ok: false; error: string; retryable: boolean }

/** Ultimo messaggio privato ricevuto da quella persona su quel canale (per la regola delle 24 ore). */
async function lastIncoming(platform: string, contactId: string) {
  const { data } = await supabaseAdmin
    .from('social_messages')
    .select('channel_account_id, contact_name, created_at')
    .eq('platform', platform)
    .eq('contact_id', contactId)
    .eq('direction', 'in')
    .eq('kind', 'message')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data as { channel_account_id: string | null; contact_name: string | null; created_at: string } | null
}

/**
 * Crea il link (con il PIN scelto) e lo manda sul canale scelto. Se l'invio non riesce
 * il link nuovo si toglie e resta quello di prima. Mai il PIN nel messaggio.
 */
export async function shareContractNow(id: string, input: ShareInput, by: string | null): Promise<ShareResult> {
  const fail = (error: string, retryable = false): ShareResult => ({ ok: false, error, retryable })
  const c = await loadContract(id)
  if (!c) return fail('contratto non trovato')
  if (c.status === 'annullato') return fail('il contratto è stato annullato')
  // Senza data e ora della collaborazione e termine di consegna non si condivide.
  const terms = termsProblem(c, 'condividere')
  if (terms) return fail(terms.replace(/\.$/, '').replace(/^./, (x) => x.toLowerCase()))
  if (!SHARE_CHANNELS.includes(input.channel)) return fail('canale non valido')
  if (typeof input.pin !== 'string' || !PIN_RE.test(input.pin.trim())) return fail('il PIN deve avere da 4 a 12 caratteri, solo lettere e numeri')
  const text = String(input.text || '').trim()
  if (!text && input.channel !== 'link') return fail('il messaggio è vuoto')
  if (text.length > MAX_SHARE_TEXT) return fail(`messaggio troppo lungo (massimo ${MAX_SHARE_TEXT} caratteri)`)
  if (textHasPin(text, input.pin)) return fail('il messaggio contiene il PIN: toglilo, il PIN va mandato a parte')
  const name = (input.name || c.recipient.name).replace(/\s+/g, ' ').trim().slice(0, 120) || c.recipient.name
  const to = input.channel === 'email' ? (input.to || '').trim().toLowerCase() : (input.to || '').trim()

  // Condizioni controllate PRIMA di creare il link.
  let social: { channel_account_id: string | null; contact_name: string | null } | null = null
  if (input.channel === 'email' && !EMAIL_RE.test(to)) return fail('serve un indirizzo email valido')
  if (input.channel === 'instagram' || input.channel === 'facebook' || input.channel === 'whatsapp') {
    if (!to) return fail('manca la persona a cui scrivere')
    const last = await lastIncoming(input.channel, to)
    if (!last) return fail(`questa persona non ci ha mai scritto in privato su ${CHANNEL_LABEL[input.channel]}: non si può scriverle da qui`)
    if (Date.now() - Date.parse(last.created_at) > META_WINDOW_MS) {
      return fail(`sono passate più di 24 ore dal suo ultimo messaggio: ${CHANNEL_LABEL[input.channel]} non permette di scriverle da qui. Crea solo il link e mandalo dall’app`)
    }
    social = last
  }

  let created: Awaited<ReturnType<typeof createShareLink>>
  try {
    created = await createShareLink(id, { pin: input.pin, channel: input.channel, to: input.channel === 'link' ? '' : to })
  } catch (error) {
    return fail(error instanceof ContractError ? error.message.replace(/\.$/, '') : 'link non creato', !(error instanceof ContractError))
  }
  const link = contractLink(input.origin, created.token)
  const message = composeShareMessage(text || `Ecco il contratto «${c.version.doc.title}».`, link)
  // Nel registro dei messaggi il link non si salva in chiaro.
  const logged = message.replace(link, `${input.origin}/c/[link del contratto]`)

  if (input.channel !== 'link') {
    const sent =
      input.channel === 'email'
        ? await sendNewEmail(to, `Contratto tra ${c.creator.name} e ${name}`, message).catch((e) => ({ error: e instanceof Error ? e.message : 'errore', id: undefined, threadId: undefined }))
        : await deliver({ platform: input.channel, kind: 'message', contact_id: to, channel_account_id: social?.channel_account_id ?? null, reply_to: null }, message).catch((e) => ({
            error: e instanceof Error ? e.message : 'errore',
            id: undefined,
          }))
    if (sent.error) {
      await undoShareLink(id, created.token, created.previous)
      return fail(`invio non riuscito: ${sent.error}`, true)
    }
    const { data: row } = await supabaseAdmin
      .from('social_messages')
      .insert({
        platform: input.channel,
        kind: 'message',
        contact_id: to,
        contact_name: social?.contact_name || name,
        direction: 'out',
        external_id: sent.id ?? null,
        channel_account_id: input.channel === 'email' ? ('threadId' in sent ? sent.threadId ?? null : null) : social?.channel_account_id ?? null,
        body: logged,
        status: 'sent',
      })
      .select('id')
      .single()
    if (row?.id) await setOrigin(row.id, 'manual').catch(() => undefined)
  }

  const contract = await setRecipient(id, {
    name,
    ...(input.channel === 'email' ? { email: to } : {}),
    ...(input.channel !== 'email' && input.channel !== 'link' ? { platform: input.channel, contactId: to } : {}),
  }).catch(() => created.contract)
  const where = input.channel === 'link' ? 'link creato: copialo dalla scheda o dalla pagina Contratti' : `link inviato a ${name} (${input.channel === 'email' ? to : CHANNEL_LABEL[input.channel]})`
  return { ok: true, outcome: `${where}. Il PIN non è nel messaggio: mandalo in un altro modo`, contract }
}

// ---------------------------------------------------------------------
// Avvisi a Luca
// ---------------------------------------------------------------------

const pending = new Set<Promise<void>>()

/**
 * Lavoro da fare dopo la risposta (avvisi, email): con Next parte dopo aver risposto e non
 * rallenta ne' blocca l'apertura o la firma; fuori da una richiesta (prove) si aspetta qui.
 * Un errore si scrive nei log senza dati personali e non arriva mai a chi apre o firma.
 */
export async function runLater(task: () => Promise<unknown>): Promise<void> {
  const safe = async () => {
    try {
      await task()
    } catch (error) {
      console.error('contratti: avviso non riuscito', error instanceof Error ? error.message.slice(0, 160) : 'errore')
    }
  }
  try {
    after(safe)
    return
  } catch {
    // Fuori da una richiesta di Next.
  }
  const p = safe()
  pending.add(p)
  try {
    await p
  } finally {
    pending.delete(p)
  }
}

/** Avvisi ancora in corso (per le prove). */
export async function settleLater(): Promise<void> {
  await Promise.all([...pending])
}

type NoteOpts = { requestId?: string; origin?: string; at?: string; by?: 'creatore' | 'destinatario' }

/** Titolo del contratto senza spazi da compilare (mai un dato scritto dalla controparte). */
const plainTitle = (c: Contract) => c.version.doc.title.replace(/\{\{[^}]*\}\}/g, '…').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Contratto'

const NOTE_TITLE: Record<NoteKind, (c: Contract, o: NoteOpts) => string> = {
  aperto: (c) => `Link aperto da ${c.recipient.name}`,
  modifica: (c) => `${c.recipient.name} ha chiesto una modifica`,
  firma_destinatario: (c) => `Contratto firmato da ${c.recipient.name}`,
  // Firmato da tutti: con la firma di chi riceve un solo avviso ("firmato da …, completato").
  completato: (c, o) => (o.by === 'destinatario' ? `Contratto firmato da ${c.recipient.name}: completato` : 'Contratto completato: firmato da tutti e due'),
}

/**
 * Email all'indirizzo di chi crea (luca@facevoice.ai) per "aperto", "firmato" e
 * "completato": titolo, nome di chi riceve, ora italiana e il link alla pagina interna del
 * contratto. Mai il PIN, il link pubblico, i dati personali della controparte o il testo.
 */
export function creatorEmail(c: Contract, kind: 'aperto' | 'firma_destinatario' | 'completato', origin: string, at: string, by?: 'creatore' | 'destinatario') {
  const title = plainTitle(c)
  const name = c.recipient.name
  const when = romeLong(at)
  const link = `${origin}/admin/contratti/${encodeURIComponent(c.id)}`
  const subject = kind === 'aperto' ? `Contratto aperto: ${title}` : kind === 'completato' && by !== 'destinatario' ? `Contratto completato: ${title}` : `Contratto firmato: ${title}`
  const line =
    kind === 'aperto'
      ? `${name} ha aperto il contratto «${title}» ${when}.`
      : kind === 'firma_destinatario'
        ? `${name} ha firmato il contratto «${title}» ${when}. Ora manca la tua firma.`
        : by === 'destinatario'
          ? `${name} ha firmato il contratto «${title}» ${when}. Ora è firmato da tutti e due.`
          : `Il contratto «${title}» con ${name} è firmato da tutti e due (${when}).`
  const text = `${line}\n\nApri il contratto: ${link}\n\n${BUSINESS.name}`
  const html = emailLayout(
    `<p>${escapeHtml(line)}</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#1a2a73;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:bold;">Apri il contratto</a></p>`
  )
  return { to: c.creator.email || BUSINESS.email, subject, text, html }
}

async function emailCreator(c: Contract, kind: 'aperto' | 'firma_destinatario' | 'completato', origin: string, at: string, by?: 'creatore' | 'destinatario') {
  // Senza la chiave di Resend: solo campanella e notifica push (avviso nei log, senza dati).
  if (!process.env.RESEND_API_KEY) {
    console.warn('contratti: email a chi crea non inviata (manca RESEND_API_KEY): resta l’avviso nella campanella')
    return
  }
  const ok = await sendEmail(creatorEmail(c, kind, origin, at, by))
  if (!ok) console.warn('contratti: email a chi crea non inviata')
}

/**
 * Campanella + notifica push all'amministratore, e per "aperto", "firmato" e "completato"
 * anche l'email al suo indirizzo. Ogni canale va per conto suo: un errore non ferma gli altri.
 */
export async function notifyCreator(c: Contract, kind: NoteKind, opts: NoteOpts | string = {}): Promise<void> {
  const o: NoteOpts = typeof opts === 'string' ? { requestId: opts } : opts
  const title = NOTE_TITLE[kind](c, o)
  const docTitle = plainTitle(c).slice(0, 80)
  await addNote({ kind, contractId: c.id, ...(o.requestId ? { requestId: o.requestId } : {}), title: `${title} · ${docTitle}` }).catch((error) =>
    console.error('contratti: notifica non salvata', error instanceof Error ? error.message : 'errore')
  )
  await sendPushToAdmins({
    title: 'Contratti',
    body: `${title}: «${docTitle}»`,
    url: `/admin/contratti/${c.id}${o.requestId ? `?req=${encodeURIComponent(o.requestId)}` : ''}`,
    tag: `contratto-${c.id}`,
  }).catch(() => console.warn('contratti: notifica push non inviata'))
  if (kind !== 'modifica' && o.origin) {
    await emailCreator(c, kind, o.origin, o.at || new Date().toISOString(), o.by).catch(() => console.warn('contratti: email a chi crea non inviata'))
  }
}

/**
 * Link aperto da chi lo riceve (PIN giusto o pagina riaperta): avviso a chi crea solo se
 * tocca (vedi claimOpenNotice). Non lancia mai: aprire il contratto non dipende dall'avviso.
 */
export async function noteOpened(id: string, origin: string): Promise<void> {
  try {
    const c = await claimOpenNotice(id)
    if (c) await notifyCreator(c, 'aperto', { origin, at: c.opened?.at })
  } catch (error) {
    console.error('contratti: avviso di apertura non riuscito', error instanceof Error ? error.message.slice(0, 160) : 'errore')
  }
}

/**
 * Dopo una firma: chi riceve ha firmato ("Contratto firmato da …") oppure il contratto e'
 * firmato da tutti (un solo avviso "completato"). Chi crea che firma per primo: nessun avviso.
 */
export async function afterSigned(c: Contract, party: 'creatore' | 'destinatario', completed: boolean, origin: string): Promise<void> {
  const at = c.signatures[party]?.at || new Date().toISOString()
  if (completed) return afterCompleted(c, origin, party)
  if (party === 'destinatario') await notifyCreator(c, 'firma_destinatario', { origin, at, by: party })
}

/**
 * Firmato da tutti: il documento di partenza (con le sue bozze) si cancella, avviso a
 * Luca (campanella, push, email) e a chi riceve una email breve "Contratto firmato" con il
 * link (mai il PDF, mai il PIN).
 */
export async function afterCompleted(c: Contract, origin: string, by: 'creatore' | 'destinatario' = 'creatore'): Promise<void> {
  if (c.docId) await deleteDocument(c.docId).catch((error) => console.error('contratti: documento di partenza non cancellato', error instanceof Error ? error.message : 'errore'))
  await notifyCreator(c, 'completato', { origin, at: c.final?.at || new Date().toISOString(), by })
  const title = c.version.doc.title
  const publicLink = currentLink(c, origin)
  if (c.recipient.email && publicLink) {
    const text = `Ciao ${firstName(c.recipient.name)},\n\nil contratto «${title}» tra ${c.creator.name} e ${c.recipient.name} è firmato da tutti e due.\nPuoi scaricare il PDF firmato da qui (serve lo stesso PIN di prima):\n${publicLink}\n\n${c.creator.name}`
    const sent = await sendNewEmail(c.recipient.email, 'Contratto firmato', text).catch((e) => ({ error: e instanceof Error ? e.message : 'errore' }))
    if (sent.error) console.warn('contratti: email "Contratto firmato" non inviata')
  }
}
