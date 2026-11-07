import { supabaseAdmin } from '@/lib/supabase-admin'
import { deliver, setOrigin } from '@/lib/meta/agent'
import { sendNewEmail } from '@/lib/gmail'
import { sendPushToAdmins } from '@/lib/push'
import { deleteDocument } from '@/lib/assistant-documents'
import {
  CHANNEL_LABEL,
  ContractError,
  PIN_RE,
  SHARE_CHANNELS,
  addNote,
  contractLink,
  createShareLink,
  currentLink,
  loadContract,
  setRecipient,
  undoShareLink,
  type Contract,
  type NoteKind,
  type ShareChannel,
} from '@/lib/contracts'

// Invio del link del contratto (dalla scheda di conferma della super chat o dalla
// pagina Contratti) e avvisi a Luca (campanella, notifica push, email a fine firma).
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

const NOTE_TITLE: Record<NoteKind, (c: Contract) => string> = {
  modifica: (c) => `${c.recipient.name} ha chiesto una modifica`,
  firma_destinatario: (c) => `${c.recipient.name} ha firmato`,
  completato: () => 'Contratto firmato da entrambi',
}

/** Campanella + notifica push all'amministratore (l'esito della push non blocca niente). */
export async function notifyCreator(c: Contract, kind: NoteKind, requestId?: string): Promise<void> {
  const title = NOTE_TITLE[kind](c)
  const docTitle = c.version.doc.title.slice(0, 80)
  await addNote({ kind, contractId: c.id, ...(requestId ? { requestId } : {}), title: `${title} · ${docTitle}` }).catch((error) =>
    console.error('contratti: notifica non salvata', error instanceof Error ? error.message : 'errore')
  )
  await sendPushToAdmins({
    title: 'Contratti',
    body: `${title}: «${docTitle}»`,
    url: `/admin/contratti/${c.id}${requestId ? `?req=${encodeURIComponent(requestId)}` : ''}`,
    tag: `contratto-${c.id}`,
  }).catch(() => undefined)
}

/**
 * Firmato da tutti: il documento di partenza (con le sue bozze) si cancella, avviso a
 * Luca, e una email breve "Contratto firmato" con il link (mai il PDF, mai il PIN).
 */
export async function afterCompleted(c: Contract, origin: string): Promise<void> {
  if (c.docId) await deleteDocument(c.docId).catch((error) => console.error('contratti: documento di partenza non cancellato', error instanceof Error ? error.message : 'errore'))
  await notifyCreator(c, 'completato')
  const title = c.version.doc.title
  const publicLink = currentLink(c, origin)
  const mails: { to: string; text: string }[] = []
  if (c.recipient.email && publicLink) {
    mails.push({
      to: c.recipient.email,
      text: `Ciao ${firstName(c.recipient.name)},\n\nil contratto «${title}» tra ${c.creator.name} e ${c.recipient.name} è firmato da tutti e due.\nPuoi scaricare il PDF firmato da qui (serve lo stesso PIN di prima):\n${publicLink}\n\n${c.creator.name}`,
    })
  }
  if (c.creator.email) {
    mails.push({ to: c.creator.email, text: `Il contratto «${title}» con ${c.recipient.name} è firmato da tutti e due.\nLo trovi qui, con il PDF firmato:\n${origin}/admin/contratti/${c.id}` })
  }
  for (const mail of mails) {
    const sent = await sendNewEmail(mail.to, 'Contratto firmato', mail.text).catch((e) => ({ error: e instanceof Error ? e.message : 'errore' }))
    if (sent.error) console.warn('contratti: email "Contratto firmato" non inviata')
  }
}
