import { supabaseAdmin } from '@/lib/supabase-admin'
import { FACEVOICE_WORKSPACE_ID, workspaceDb } from '@/lib/workspace-db'
import { facevoiceAccountIds } from '@/lib/meta/graph'
import {
  readConnectionSecret,
  saveConnection,
  setChannelState,
  takeOverConnection,
  updateConnection,
  updateConnectionSecret,
  type Connection,
} from './connections'

// Instagram dei clienti collegato con l'accesso di Instagram ("Instagram API
// with Instagram Login"): non passa dal login di Facebook e non serve una
// Pagina. Il token dura 60 giorni e si rinnova dal cron prima che scada.

export const IG_GRAPH = 'https://graph.instagram.com/v25.0'
const SCOPES = ['instagram_business_basic', 'instagram_business_manage_messages']
const DAY = 24 * 60 * 60_000
/** Si rinnova il token quando mancano meno di 15 giorni alla scadenza. */
const RENEW_BEFORE_MS = 15 * DAY

export type InstagramSecret = { kind: 'instagram_login'; token: string; igUserId: string; expiresAt: string; refreshedAt: string }

export function instagramConfig() {
  const appId = process.env.INSTAGRAM_APP_ID?.trim() || ''
  const appSecret = process.env.INSTAGRAM_APP_SECRET?.trim() || ''
  return { appId, appSecret, ready: Boolean(appId && appSecret) }
}

export const instagramCallbackUrl = (origin: string) => `${origin}/api/app/instagram/callback`

export function instagramLoginUrl(origin: string, state: string): string {
  const params = new URLSearchParams({
    client_id: instagramConfig().appId,
    redirect_uri: instagramCallbackUrl(origin),
    response_type: 'code',
    scope: SCOPES.join(','),
    state,
    enable_fb_login: '0',
    force_reauth: 'true',
  })
  return `https://www.instagram.com/oauth/authorize?${params}`
}

async function igFetch<T>(url: string, init?: RequestInit, step = ''): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.error) {
    const message = data?.error?.message || data?.error_message || `Instagram HTTP ${res.status}`
    // Nei log: quale passaggio, codice e tipo dell'errore (mai token o chiavi).
    const detail = [data?.error?.type || data?.error_type, data?.error?.code ?? data?.code, data?.error?.error_subcode].filter((v) => v != null).join('/')
    throw new Error(`${step ? `[${step}] ` : ''}${message}${detail ? ` (${detail})` : ''} HTTP ${res.status}`)
  }
  return data as T
}

const isInstagramSecret = (secret: unknown): secret is InstagramSecret =>
  Boolean(secret && typeof secret === 'object' && (secret as InstagramSecret).kind === 'instagram_login')

/** Dal codice del login: token di 60 giorni, profilo, iscrizione ai messaggi. Salva il collegamento. */
export async function connectInstagramFromCode(
  origin: string,
  rawCode: string,
  workspaceId: string,
  userId: string
): Promise<{ username: string | null; skipped: string | null; temporary?: boolean }> {
  const { appId, appSecret } = instagramConfig()
  // Instagram aggiunge "#_" in fondo al codice nel redirect.
  const code = rawCode.replace(/#_$/, '')
  const short = await igFetch<{ access_token?: string; data?: Array<{ access_token: string }> }>('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: appId, client_secret: appSecret, grant_type: 'authorization_code', redirect_uri: instagramCallbackUrl(origin), code }),
  }, 'codice')
  const shortToken = short.access_token || short.data?.[0]?.access_token
  if (!shortToken) throw new Error('Instagram non ha restituito il token')

  // Token di 60 giorni. Meta ha rifiutato sia GET sia POST sull'indirizzo della
  // guida ("Unsupported request"): si provano anche gli indirizzi con versione.
  // Se nessuno funziona si salva il token di 1 ora, cosi' il collegamento si puo'
  // comunque provare, e nei log resta quale tentativo ha risposto cosa.
  const exchange = new URLSearchParams({ grant_type: 'ig_exchange_token', client_secret: appSecret, access_token: shortToken })
  const attempts: Array<[string, string, RequestInit | undefined]> = [
    ['GET', `https://graph.instagram.com/access_token?${exchange}`, undefined],
    ['GET v25', `${IG_GRAPH}/access_token?${exchange}`, undefined],
    ['POST', 'https://graph.instagram.com/access_token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: exchange }],
    ['POST v25', `${IG_GRAPH}/access_token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: exchange }],
  ]
  let long: { access_token: string; expires_in?: number } | null = null
  let temporary = false
  for (const [label, url, init] of attempts) {
    try {
      long = await igFetch<{ access_token: string; expires_in?: number }>(url, init, `token 60 giorni ${label}`)
      console.log(`instagram exchange: riuscito con ${label}`)
      break
    } catch (error) {
      console.warn('instagram exchange:', error instanceof Error ? error.message : error)
    }
  }
  if (!long) {
    console.warn('instagram exchange: nessun tentativo riuscito, uso il token di 1 ora')
    long = { access_token: shortToken, expires_in: 3600 }
    temporary = true
  }
  type Profile = { user_id?: string | number; id?: string; username?: string; name?: string; profile_picture_url?: string; account_type?: string }
  const auth = encodeURIComponent(long.access_token)
  const profile = await igFetch<Profile>(`${IG_GRAPH}/me?fields=user_id,username,name,profile_picture_url,account_type&access_token=${auth}`, undefined, 'profilo').catch(
    (error) => {
      console.warn('instagram profile:', error instanceof Error ? error.message : error)
      return igFetch<Profile>(`https://graph.instagram.com/me?fields=user_id,username&access_token=${auth}`, undefined, 'profilo base')
    }
  )
  // user_id e' l'id dell'account professionale, lo stesso che arriva nei webhook.
  const igUserId = String(profile.user_id || profile.id || '')
  if (!igUserId) throw new Error('profilo Instagram non letto')
  const username = profile.username ? `@${profile.username}` : null

  if (workspaceId !== FACEVOICE_WORKSPACE_ID) {
    const own = await facevoiceAccountIds().catch(() => null)
    if (own?.has(igUserId)) return { username, skipped: `${username || igUserId} (è l’Instagram di Facevoice)` }
  }
  const takeOver = await takeOverConnection('instagram', igUserId, workspaceId, userId, { proven: true })
  if (!takeOver.ok) {
    const where = takeOver.ownerName ? `allo spazio «${takeOver.ownerName}»` : 'a uno spazio di un’altra persona'
    return { username, skipped: `${username || igUserId} (già collegato ${where})` }
  }

  // L'account manda a Facevoice i messaggi Direct che riceve.
  await igFetch(`${IG_GRAPH}/me/subscribed_apps?${new URLSearchParams({ subscribed_fields: 'messages', access_token: long.access_token })}`, { method: 'POST' }).catch(
    (error) => console.warn('instagram subscribe:', igUserId, error instanceof Error ? error.message : error)
  )

  const now = Date.now()
  const expiresAt = new Date(now + (long.expires_in || 60 * 24 * 60 * 60) * 1000).toISOString()
  const secret: InstagramSecret = { kind: 'instagram_login', token: long.access_token, igUserId, expiresAt, refreshedAt: new Date(now).toISOString() }
  const db = workspaceDb(workspaceId)
  await saveConnection(db, {
    platform: 'instagram',
    externalId: igUserId,
    displayName: username || profile.name || igUserId,
    meta: { via: 'instagram_login', username: profile.username || null, picture: profile.profile_picture_url || null, token_expires_at: expiresAt },
    secret,
    userId,
  })
  await setChannelState(db, 'instagram', { status: 'connected', handle: username || profile.name || igUserId })
  return { username, skipped: null, temporary }
}

/** Rinnova il token (valido almeno 24 ore e non ancora scaduto) e salva quello nuovo. */
async function renew(connection: Connection, secret: InstagramSecret): Promise<InstagramSecret> {
  const params = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: secret.token })
  const data = await igFetch<{ access_token: string; expires_in?: number }>(`https://graph.instagram.com/refresh_access_token?${params}`, undefined, 'rinnovo').catch(() =>
    igFetch<{ access_token: string; expires_in?: number }>(
      'https://graph.instagram.com/refresh_access_token',
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params },
      'rinnovo POST'
    )
  )
  const now = Date.now()
  const next: InstagramSecret = {
    ...secret,
    token: data.access_token,
    expiresAt: new Date(now + (data.expires_in || 60 * 24 * 60 * 60) * 1000).toISOString(),
    refreshedAt: new Date(now).toISOString(),
  }
  await updateConnectionSecret(connection.id, next)
  await updateConnection(workspaceDb(connection.workspace_id), connection.id, {
    status: 'connected',
    last_error: null,
    meta: { ...connection.meta, token_expires_at: next.expiresAt },
  })
  return next
}

const shouldRenew = (secret: InstagramSecret) =>
  new Date(secret.expiresAt).getTime() - Date.now() < RENEW_BEFORE_MS && Date.now() - new Date(secret.refreshedAt).getTime() > DAY

/** Token valido del collegamento: lo rinnova se sta per scadere. */
async function tokenFor(connection: Connection, secret: InstagramSecret): Promise<string> {
  if (new Date(secret.expiresAt).getTime() <= Date.now()) {
    await updateConnection(workspaceDb(connection.workspace_id), connection.id, { status: 'expired', last_error: 'Accesso a Instagram scaduto: ricollega l’account.' })
    throw new Error('accesso a Instagram scaduto: ricollega l’account')
  }
  if (shouldRenew(secret)) return (await renew(connection, secret).catch(() => secret)).token
  return secret.token
}

/** Se il collegamento usa l'accesso di Instagram restituisce le sue credenziali. */
export async function instagramLoginSecret(connection: Connection): Promise<InstagramSecret | null> {
  if ((connection.meta as { via?: string })?.via !== 'instagram_login') return null
  const secret = await readConnectionSecret<unknown>(connection.id)
  return isInstagramSecret(secret) ? secret : null
}

export async function sendInstagramLoginText(connection: Connection, secret: InstagramSecret, recipientId: string, text: string): Promise<{ id: string }> {
  const token = await tokenFor(connection, secret)
  const data = await igFetch<{ message_id?: string }>(`${IG_GRAPH}/me/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
  })
  return { id: data.message_id || `ig:${Date.now()}` }
}

export async function instagramLoginContactName(connection: Connection, secret: InstagramSecret, contactId: string): Promise<string | null> {
  const token = await tokenFor(connection, secret)
  const data = await igFetch<{ name?: string; username?: string }>(`${IG_GRAPH}/${contactId}?fields=name,username&access_token=${encodeURIComponent(token)}`)
  return data.name || (data.username ? `@${data.username}` : null)
}

/** Smette di ricevere i messaggi dell'account (chiamato quando il cliente lo scollega). */
export async function unsubscribeInstagramLogin(connection: Connection): Promise<void> {
  const secret = await instagramLoginSecret(connection).catch(() => null)
  if (!secret) return
  await igFetch(`${IG_GRAPH}/me/subscribed_apps?access_token=${encodeURIComponent(secret.token)}`, { method: 'DELETE' }).catch(() => {})
}

/** Dal cron: rinnova i token che scadono entro 15 giorni (pochi per volta). */
export async function renewInstagramTokens(max = 10): Promise<number> {
  if (!instagramConfig().ready) return 0
  const limit = new Date(Date.now() + RENEW_BEFORE_MS).toISOString()
  // Lettura fra tutti gli spazi (come il sync delle email): solo id e date, nessun dato dei messaggi.
  const { data, error } = await supabaseAdmin
    .from('channel_connections')
    .select('id, workspace_id, platform, external_id, display_name, status, last_error, meta, created_at, updated_at')
    .eq('platform', 'instagram')
    .eq('meta->>via', 'instagram_login')
    .neq('status', 'disconnected')
    .lt('meta->>token_expires_at', limit)
    .limit(max)
  if (error) return 0
  let renewed = 0
  for (const connection of (data || []) as Connection[]) {
    const secret = await instagramLoginSecret(connection).catch(() => null)
    if (!secret || !shouldRenew(secret) || new Date(secret.expiresAt).getTime() <= Date.now()) continue
    try {
      await renew(connection, secret)
      renewed++
    } catch (error) {
      console.warn('instagram renew:', connection.external_id, error instanceof Error ? error.message : error)
    }
  }
  return renewed
}
