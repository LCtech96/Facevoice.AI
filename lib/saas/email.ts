import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'
import MailComposer from 'nodemailer/lib/mail-composer'
import { simpleParser, type ParsedMail } from 'mailparser'
import { isAutomaticEmail } from '@/lib/email-address'
import type { WorkspaceDb } from '@/lib/workspace-db'
import { assertPublicHost } from './safe-host'
import { IMAP_PORTS, SMTP_PORTS, type MailServer } from './email-presets'
import { readConnectionSecret, updateConnection, type Connection } from './connections'

// Casella email di un cliente, collegata con IMAP (lettura) e SMTP (invio).
// La lettura prende solo i messaggi scritti da persone: newsletter, notifiche
// automatiche e mittenti no-reply restano fuori dall'omnichat.

export type EmailSecret = { user: string; password: string; imap: MailServer; smtp: MailServer }
export type EmailMeta = {
  savesSent?: boolean
  last_uid?: number
  uid_validity?: string
  last_sync_at?: string
  sent_mailbox?: string | null
}

const FIRST_SYNC_DAYS = 3
const MAX_PER_SYNC = 25
const MAX_BODY = 6000
const TIMEOUT_MS = 20_000

function imapClient(secret: EmailSecret) {
  return new ImapFlow({
    host: secret.imap.host,
    port: secret.imap.port,
    secure: secret.imap.port === 993,
    auth: { user: secret.user, pass: secret.password },
    logger: false,
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: 60_000,
  })
}

function smtpTransport(secret: EmailSecret) {
  return nodemailer.createTransport({
    host: secret.smtp.host,
    port: secret.smtp.port,
    secure: secret.smtp.port === 465,
    requireTLS: secret.smtp.port !== 465,
    auth: { user: secret.user, pass: secret.password },
    connectionTimeout: TIMEOUT_MS,
    greetingTimeout: TIMEOUT_MS,
    socketTimeout: 30_000,
  })
}

/** Messaggio d'errore comprensibile per il cliente. */
export function explainMailError(error: unknown): string {
  const raw = error instanceof Error ? `${error.message} ${(error as { responseText?: string }).responseText || ''}` : String(error)
  if (/AUTHENTICATIONFAILED|Invalid credentials|authentication failed|535|534|Username and Password not accepted|LOGIN failed|auth/i.test(raw)) {
    return 'Email o password non accettate dal server. Controlla di aver usato la password per le app, se il tuo fornitore la richiede.'
  }
  if (/ENOTFOUND|EAI_AGAIN|non esiste/i.test(raw)) return 'Il server di posta non esiste: controlla l’indirizzo del server.'
  if (/ETIMEDOUT|timeout|ECONNREFUSED|ECONNRESET/i.test(raw)) return 'Il server di posta non risponde: controlla server e porta, poi riprova.'
  if (/IMAP.*disabled|IMAP access/i.test(raw)) return 'Sulla casella non è attivo l’accesso IMAP: attivalo nelle impostazioni della posta.'
  return 'Collegamento non riuscito: controlla i dati e riprova.'
}

/** Prova lettura e invio con i dati inseriti dal cliente (prima di salvarli). */
export async function testMailbox(secret: EmailSecret): Promise<void> {
  if (!IMAP_PORTS.includes(secret.imap.port) || !SMTP_PORTS.includes(secret.smtp.port)) throw new Error('Porta del server non ammessa.')
  await Promise.all([assertPublicHost(secret.imap.host), assertPublicHost(secret.smtp.host)])
  const client = imapClient(secret)
  try {
    await client.connect()
    await client.mailboxOpen('INBOX', { readOnly: true })
  } finally {
    await client.logout().catch(() => undefined)
  }
  await smtpTransport(secret).verify()
}

/** Toglie dalla risposta la parte citata del messaggio precedente. */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  for (const line of lines) {
    if (/^\s*>/.test(line)) break
    if (/^\s*(Il giorno .+ ha scritto:|On .+ wrote:|-----\s*Original Message\s*-----|-----\s*Messaggio originale\s*-----|(?:Da|From): .*@.*)\s*$/i.test(line)) break
    out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function isBulk(mail: ParsedMail): boolean {
  const header = (name: string) => String(mail.headers.get(name) ?? '').toLowerCase()
  // mailparser raccoglie List-Unsubscribe, List-Id... sotto la chiave 'list'.
  if (mail.headers.has('list') || mail.headers.has('list-unsubscribe') || mail.headers.has('list-id')) return true
  if (/bulk|list|junk/.test(header('precedence'))) return true
  const auto = header('auto-submitted')
  return Boolean(auto && auto !== 'no')
}

type InboundEmail = { externalId: string; from: string; name: string | null; subject: string; body: string; at: string }

function toInbound(mail: ParsedMail, own: string, uidKey: string): InboundEmail | null {
  const sender = mail.from?.value?.[0]
  const from = sender?.address?.toLowerCase().trim()
  if (!from || from === own || isAutomaticEmail(from) || isBulk(mail)) return null
  const text = mail.text || (typeof mail.html === 'string' ? mail.html.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ') : '')
  const body = stripQuoted(text).slice(0, MAX_BODY)
  if (!body) return null
  return {
    externalId: mail.messageId?.trim() || uidKey,
    from,
    name: sender?.name?.trim() || null,
    subject: (mail.subject || '').trim().slice(0, 300),
    body,
    at: (mail.date || new Date()).toISOString(),
  }
}

/** Legge le email nuove e le salva in social_messages. Restituisce gli id dei messaggi nuovi. */
export async function syncMailbox(db: WorkspaceDb, connection: Connection): Promise<{ inserted: string[]; error?: string }> {
  const meta = (connection.meta || {}) as EmailMeta
  let secret: EmailSecret
  try {
    secret = await readConnectionSecret<EmailSecret>(connection.id)
  } catch (error) {
    return { inserted: [], error: error instanceof Error ? error.message : 'credenziali non leggibili' }
  }
  const own = connection.external_id.toLowerCase()
  const client = imapClient(secret)
  const found: InboundEmail[] = []
  let lastUid = meta.last_uid || 0
  let uidValidity = meta.uid_validity
  try {
    await client.connect()
    const lock = await client.getMailboxLock('INBOX', { readOnly: true })
    try {
      const box = client.mailbox
      const validity = box ? String(box.uidValidity) : undefined
      if (validity && validity !== uidValidity) {
        lastUid = 0
        uidValidity = validity
      }
      let uids: number[]
      if (lastUid) {
        const result = await client.search({ uid: `${lastUid + 1}:*` }, { uid: true })
        uids = (result || []).filter((uid) => uid > lastUid)
      } else {
        const since = new Date(Date.now() - FIRST_SYNC_DAYS * 86_400_000)
        uids = (await client.search({ since }, { uid: true })) || []
      }
      uids.sort((a, b) => a - b)
      const batch = uids.slice(-MAX_PER_SYNC)
      if (batch.length) {
        for await (const message of client.fetch(batch.join(','), { uid: true, source: true }, { uid: true })) {
          if (!message.source) continue
          const mail = await simpleParser(message.source)
          const inbound = toInbound(mail, own, `uid:${uidValidity}:${message.uid}`)
          if (inbound) found.push(inbound)
        }
      }
      if (uids.length) lastUid = Math.max(lastUid, uids[uids.length - 1])
    } finally {
      lock.release()
    }
  } catch (error) {
    const message = explainMailError(error)
    console.error('email sync:', connection.external_id, error instanceof Error ? error.message : error)
    await updateConnection(db, connection.id, {
      status: /password/i.test(message) ? 'expired' : connection.status,
      last_error: message,
      meta: { ...meta, last_sync_at: new Date().toISOString() },
    })
    return { inserted: [], error: message }
  } finally {
    await client.logout().catch(() => undefined)
  }

  const inserted: string[] = []
  if (found.length) {
    const { data, error } = await db
      .from('social_messages')
      .upsert(
        found.map((m) => ({
          platform: 'email',
          kind: 'message',
          direction: 'in',
          contact_id: m.from,
          contact_name: m.name,
          external_id: m.externalId,
          subject: m.subject,
          body: m.body,
          channel_account_id: own,
          created_at: m.at,
        })),
        { onConflict: 'workspace_id,external_id', ignoreDuplicates: true }
      )
      .select('id')
    if (error) {
      console.error('email sync insert:', error.message)
      return { inserted: [], error: 'Messaggi non salvati, riprovo tra poco.' }
    }
    inserted.push(...(data || []).map((row) => row.id as string))
  }
  await updateConnection(db, connection.id, {
    status: 'connected',
    last_error: null,
    meta: { ...meta, last_uid: lastUid, uid_validity: uidValidity, last_sync_at: new Date().toISOString() },
  })
  return { inserted }
}

/** Invia una risposta nello stesso filo della conversazione. */
export async function sendEmailReply(
  connection: Connection,
  input: { to: string; subject: string | null; inReplyTo: string | null; text: string; fromName: string | null }
): Promise<{ messageId: string }> {
  const secret = await readConnectionSecret<EmailSecret>(connection.id)
  const meta = (connection.meta || {}) as EmailMeta
  const base = (input.subject || '').trim()
  const subject = !base ? 'La nostra risposta' : /^re:/i.test(base) ? base : `Re: ${base}`
  const reference = input.inReplyTo && !input.inReplyTo.startsWith('uid:') ? input.inReplyTo : undefined
  const mail = {
    from: input.fromName ? { name: input.fromName, address: connection.external_id } : connection.external_id,
    to: input.to,
    subject,
    text: input.text,
    inReplyTo: reference,
    references: reference ? [reference] : undefined,
  }
  const raw = await new MailComposer(mail).compile().build()
  const info = await smtpTransport(secret).sendMail({ envelope: { from: connection.external_id, to: [input.to] }, raw })
  const messageId = (info.messageId as string | undefined) || `sent:${Date.now()}`

  // Copia nella cartella "Inviata", per chi la usa anche dal suo programma di posta.
  if (!meta.savesSent) {
    const client = imapClient(secret)
    try {
      await client.connect()
      const boxes = await client.list()
      const sent = boxes.find((b) => b.specialUse === '\\Sent')?.path || boxes.find((b) => /^(sent|inviat|posta inviata)/i.test(b.name))?.path
      if (sent) await client.append(sent, raw, ['\\Seen'])
    } catch (error) {
      console.warn('email sent copy:', error instanceof Error ? error.message : error)
    } finally {
      await client.logout().catch(() => undefined)
    }
  }
  return { messageId }
}
