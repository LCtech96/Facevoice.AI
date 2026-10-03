import { createHmac, timingSafeEqual } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { SITE_URL } from '@/lib/seo/site'
import type { SendResult } from '@/lib/meta/graph'

// Casella Google Workspace collegata via OAuth (scope gmail.modify: leggere,
// inviare, segnare come letto). Il refresh token sta in app_settings, che
// solo il server puo' leggere; client ID e secret nelle variabili Vercel.

const SETTINGS_KEY = 'gmail_oauth'
const SCOPES = ['https://www.googleapis.com/auth/gmail.modify', 'openid', 'email']
const API = 'https://gmail.googleapis.com/gmail/v1/users/me'
export const GMAIL_REDIRECT_URI = `${SITE_URL}/api/admin/email/callback`

export type GmailSettings = {
  email: string
  refreshToken: string
  // Solo le email arrivate dopo il collegamento: niente risposte all'arretrato.
  connectedAt: number
}

function clientCredentials() {
  const id = process.env.GOOGLE_CLIENT_ID?.trim()
  const secret = process.env.GOOGLE_CLIENT_SECRET?.trim()
  return id && secret ? { id, secret } : null
}

export function isGmailConfigured() {
  return clientCredentials() !== null
}

// ---------------------------------------------------------------------
// Stato OAuth firmato: lega il ritorno da Google all'admin che l'ha avviato.
// ---------------------------------------------------------------------

function stateSecret() {
  return clientCredentials()?.secret || ''
}

export function createOAuthState(adminEmail: string) {
  const payload = Buffer.from(JSON.stringify({ e: adminEmail, x: Date.now() + 10 * 60_000 })).toString('base64url')
  const sig = createHmac('sha256', stateSecret()).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifyOAuthState(state: string | null): string | null {
  if (!state || !stateSecret()) return null
  const [payload, sig] = state.split('.')
  if (!payload || !sig) return null
  const expected = createHmac('sha256', stateSecret()).update(payload).digest()
  const received = Buffer.from(sig, 'base64url')
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
    return typeof data.e === 'string' && data.x > Date.now() ? data.e : null
  } catch {
    return null
  }
}

export function buildAuthUrl(state: string, loginHint?: string) {
  const creds = clientCredentials()
  if (!creds) throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET mancanti')
  const params = new URLSearchParams({
    client_id: creds.id,
    redirect_uri: GMAIL_REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    // consent: Google restituisce sempre un refresh token, anche ai ricollegamenti.
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  if (loginHint) params.set('login_hint', loginHint)
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

/** Scambia il codice di Google e salva la casella collegata. */
export async function completeOAuth(code: string): Promise<GmailSettings> {
  const creds = clientCredentials()
  if (!creds) throw new Error('Credenziali Google mancanti')

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: creds.id,
      client_secret: creds.secret,
      redirect_uri: GMAIL_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  })
  const tokens = await response.json()
  if (!response.ok || !tokens.refresh_token) {
    throw new Error(tokens.error_description || tokens.error || 'Google non ha restituito un refresh token')
  }

  const profile = await fetch(`${API}/profile`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  }).then((r) => r.json())
  if (!profile?.emailAddress) throw new Error('Impossibile leggere l\'indirizzo della casella')

  const settings: GmailSettings = {
    email: String(profile.emailAddress).toLowerCase(),
    refreshToken: tokens.refresh_token,
    connectedAt: Date.now(),
  }
  await supabaseAdmin
    .from('app_settings')
    .upsert({ key: SETTINGS_KEY, value: JSON.stringify(settings), updated_at: new Date().toISOString() })
  cachedToken = { value: tokens.access_token, expiresAt: Date.now() + (tokens.expires_in - 60) * 1000 }
  return settings
}

export async function loadGmailSettings(): Promise<GmailSettings | null> {
  const { data } = await supabaseAdmin.from('app_settings').select('value').eq('key', SETTINGS_KEY).maybeSingle()
  if (!data?.value) return null
  try {
    return JSON.parse(data.value) as GmailSettings
  } catch {
    return null
  }
}

export async function disconnectGmail() {
  const settings = await loadGmailSettings()
  if (settings) {
    // Revoca lato Google; se fallisce, il token resta comunque cancellato da noi.
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(settings.refreshToken)}`, {
      method: 'POST',
    }).catch(() => undefined)
  }
  cachedToken = null
  await supabaseAdmin.from('app_settings').delete().eq('key', SETTINGS_KEY)
}

// ---------------------------------------------------------------------
// Chiamate API
// ---------------------------------------------------------------------

let cachedToken: { value: string; expiresAt: number } | null = null

async function accessToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value
  const creds = clientCredentials()
  const settings = await loadGmailSettings()
  if (!creds || !settings) return null

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: creds.id,
      client_secret: creds.secret,
      refresh_token: settings.refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const data = await response.json()
  if (!response.ok || !data.access_token) {
    console.error('gmail: rinnovo token fallito', data.error, data.error_description)
    return null
  }
  cachedToken = { value: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 }
  return cachedToken.value
}

async function gmail<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken()
  if (!token) throw new Error('Casella Gmail non collegata')
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data?.error?.message || `Gmail API ${response.status}`)
  return data as T
}

type GmailPart = {
  mimeType?: string
  filename?: string
  headers?: { name: string; value: string }[]
  body?: { data?: string; size?: number }
  parts?: GmailPart[]
}

export type GmailMessage = {
  id: string
  threadId: string
  internalDate: string
  labelIds?: string[]
  payload?: GmailPart
}

export async function listInboxIds(query: string, max = 20): Promise<{ id: string; threadId: string }[]> {
  const data = await gmail<{ messages?: { id: string; threadId: string }[] }>(
    `/messages?maxResults=${max}&q=${encodeURIComponent(query)}`
  )
  return data.messages || []
}

export async function getMessage(id: string): Promise<GmailMessage> {
  return gmail<GmailMessage>(`/messages/${id}?format=full`)
}

export async function markRead(id: string) {
  await gmail(`/messages/${id}/modify`, {
    method: 'POST',
    body: JSON.stringify({ removeLabelIds: ['UNREAD'] }),
  }).catch(() => undefined)
}

export function header(message: GmailMessage, name: string): string {
  const found = message.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())
  return found?.value || ''
}

function decode(data?: string) {
  return data ? Buffer.from(data, 'base64url').toString('utf8') : ''
}

function findPart(part: GmailPart | undefined, mime: string): GmailPart | undefined {
  if (!part) return undefined
  if (part.mimeType === mime && part.body?.data && !part.filename) return part
  for (const child of part.parts || []) {
    const found = findPart(child, mime)
    if (found) return found
  }
  return undefined
}

function htmlToText(html: string) {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

/** Testo del messaggio senza la parte citata delle email precedenti. */
export function messageText(message: GmailMessage): string {
  const plain = findPart(message.payload, 'text/plain')
  const html = plain ? undefined : findPart(message.payload, 'text/html')
  const raw = plain ? decode(plain.body?.data) : htmlToText(decode(html?.body?.data))

  const lines: string[] = []
  for (const line of raw.replace(/\r\n/g, '\n').split('\n')) {
    // Inizio della citazione: "Il giorno ... ha scritto:", "On ... wrote:", "-----Original Message-----"
    if (/^\s*(Il giorno .+ ha scritto:|On .+ wrote:|-{2,}\s*(Original Message|Messaggio originale)\s*-{2,})\s*$/i.test(line)) break
    if (/^\s*>/.test(line)) continue
    lines.push(line)
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** "Mario Rossi <mario@x.it>" -> { name, email } */
export function parseAddress(value: string): { name: string | null; email: string } {
  const match = value.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (match) return { name: match[1].trim() || null, email: match[2].trim().toLowerCase() }
  return { name: null, email: value.trim().toLowerCase() }
}

function encodeHeader(value: string) {
  // RFC 2047 solo se servono caratteri non ASCII (accenti nell'oggetto).
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

/**
 * Risponde nello stesso thread Gmail. Oggetto, Message-ID e destinatario
 * si leggono dall'ultima email ricevuta nel thread, cosi' il database non
 * deve conservarli.
 */
export async function sendThreadReply(threadId: string, to: string, text: string): Promise<SendResult> {
  try {
    const settings = await loadGmailSettings()
    if (!settings) return { error: 'Casella Gmail non collegata' }

    const thread = await gmail<{ messages?: GmailMessage[] }>(
      `/threads/${threadId}?format=metadata&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=From&metadataHeaders=Reply-To`
    )
    const incoming = (thread.messages || [])
      .filter((m) => !parseAddress(header(m, 'From')).email.includes(settings.email))
      .pop()
    const subjectRaw = incoming ? header(incoming, 'Subject') : ''
    const subject = /^re:/i.test(subjectRaw) ? subjectRaw : `Re: ${subjectRaw || 'Facevoice AI'}`
    const messageId = incoming ? header(incoming, 'Message-ID') : ''
    const references = [incoming ? header(incoming, 'References') : '', messageId].filter(Boolean).join(' ')
    const recipient = incoming ? parseAddress(header(incoming, 'Reply-To') || header(incoming, 'From')).email : to

    const mime = [
      `From: ${settings.email}`,
      `To: ${recipient || to}`,
      `Subject: ${encodeHeader(subject)}`,
      ...(messageId ? [`In-Reply-To: ${messageId}`, `References: ${references}`] : []),
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(text, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n'),
    ].join('\r\n')

    const sent = await gmail<{ id: string }>('/messages/send', {
      method: 'POST',
      body: JSON.stringify({ raw: Buffer.from(mime).toString('base64url'), threadId }),
    })
    return { id: `gmail:${sent.id}` }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Invio email non riuscito' }
  }
}

/** Nuova email (non una risposta): usata per il primo contatto della Ricerca clienti. */
export async function sendNewEmail(to: string, subject: string, text: string): Promise<SendResult & { threadId?: string }> {
  try {
    const settings = await loadGmailSettings()
    if (!settings) return { error: 'Casella Gmail non collegata' }
    const mime = [
      `From: Luca Corrao <${settings.email}>`,
      `To: ${to}`,
      `Subject: ${encodeHeader(subject)}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(text, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n'),
    ].join('\r\n')
    const sent = await gmail<{ id: string; threadId: string }>('/messages/send', {
      method: 'POST',
      body: JSON.stringify({ raw: Buffer.from(mime).toString('base64url') }),
    })
    return { id: `gmail:${sent.id}`, threadId: sent.threadId }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Invio email non riuscito' }
  }
}
