import { createHmac, timingSafeEqual } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { FACEVOICE_WORKSPACE_ID, workspaceDb, type WorkspaceDb } from '@/lib/workspace-db'
import { readConnectionSecret, saveConnection, setChannelState, takeOverConnection, updateConnection, type Connection } from './connections'
import { instagramLoginContactName, instagramLoginSecret, sendInstagramLoginAction, sendInstagramLoginText } from './instagram'

// Facebook e Instagram dei clienti: collegamento con "Facebook Login for
// Business" (configurazione con token di sistema che non scade), Pagine e
// account Instagram scelti dal cliente, iscrizione della Pagina ai webhook e
// invio dei messaggi con il token della sua Pagina.

export const GRAPH = 'https://graph.facebook.com/v25.0'

export type MetaSecret = { pageToken: string; pageId: string; userToken?: string }

export function metaConfig() {
  const appId = process.env.META_APP_ID?.trim() || ''
  const configId = process.env.META_LOGIN_CONFIG_ID?.trim() || ''
  const appSecret = process.env.META_APP_SECRET?.trim() || ''
  return { appId, configId, appSecret, ready: Boolean(appId && configId && appSecret) }
}

const stateKey = () => process.env.CHANNEL_SECRETS_KEY?.trim() || process.env.META_APP_SECRET?.trim() || ''

/** Stato firmato del collegamento: chi lo ha chiesto e per quale spazio (valido 15 minuti). */
export function signState(workspaceId: string, userId: string): string {
  const body = Buffer.from(JSON.stringify({ w: workspaceId, u: userId, e: Date.now() + 15 * 60_000 })).toString('base64url')
  const mac = createHmac('sha256', stateKey()).update(body).digest('base64url')
  return `${body}.${mac}`
}

export function verifyState(state: string | null): { workspaceId: string; userId: string } | null {
  if (!state || !stateKey()) return null
  const [body, mac] = state.split('.')
  if (!body || !mac) return null
  const expected = createHmac('sha256', stateKey()).update(body).digest('base64url')
  if (expected.length !== mac.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(mac))) return null
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (typeof data.e !== 'number' || data.e < Date.now()) return null
    return { workspaceId: String(data.w), userId: String(data.u) }
  } catch {
    return null
  }
}

export const callbackUrl = (origin: string) => `${origin}/api/app/meta/callback`

export function loginUrl(origin: string, state: string): string {
  const { appId, configId } = metaConfig()
  const params = new URLSearchParams({
    client_id: appId,
    config_id: configId,
    redirect_uri: callbackUrl(origin),
    response_type: 'code',
    override_default_response_type: 'true',
    state,
  })
  return `https://www.facebook.com/v25.0/dialog/oauth?${params}`
}

async function graph<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GRAPH}${path}`, { ...init, signal: AbortSignal.timeout(20_000) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.error) throw new Error(data?.error?.message || `Meta HTTP ${res.status}`)
  return data as T
}

/**
 * Eventi che la Pagina manda a Facevoice. message_echoes: i messaggi che il
 * cliente scrive a mano dall'app (Messenger, Business Suite), cosi' l'AI vede
 * anche il primo messaggio della conversazione. Per Instagram gli "echo"
 * arrivano gia' dentro "messages".
 */
export const PAGE_SUBSCRIBED_FIELDS = 'messages,message_echoes,messaging_postbacks,feed'

/** Iscrive la Pagina ai webhook (true se Meta ha accettato). */
export async function subscribePage(pageId: string, pageToken: string): Promise<boolean> {
  return graph(`/${pageId}/subscribed_apps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ subscribed_fields: PAGE_SUBSCRIBED_FIELDS, access_token: pageToken }),
  })
    .then(() => true)
    .catch((error) => {
      console.warn('meta subscribe:', pageId, error instanceof Error ? error.message : error)
      return false
    })
}

/**
 * Pagine collegate prima degli "echo": la prima volta che arriva un loro evento
 * si rinnova l'iscrizione con i campi nuovi (un tentativo al giorno se Meta rifiuta).
 */
export async function ensurePageSubscription(connection: Connection): Promise<void> {
  if (connection.platform !== 'facebook') return
  const meta = (connection.meta || {}) as { subscribed_fields?: string | null; subscribe_tried_at?: string }
  if (meta.subscribed_fields === PAGE_SUBSCRIBED_FIELDS) return
  if (meta.subscribe_tried_at && Date.now() - new Date(meta.subscribe_tried_at).getTime() < 24 * 3600_000) return
  const secret = await readConnectionSecret<MetaSecret>(connection.id).catch(() => null)
  if (!secret?.pageToken) return
  const ok = await subscribePage(secret.pageId || connection.external_id, secret.pageToken)
  await updateConnection(workspaceDb(connection.workspace_id), connection.id, {
    meta: { ...connection.meta, ...(ok ? { subscribed_fields: PAGE_SUBSCRIBED_FIELDS } : {}), subscribe_tried_at: new Date().toISOString() },
  })
  console.log(`meta subscribe: Pagina ${connection.external_id} ${ok ? 'iscritta anche agli echo' : 'non aggiornata'}`)
}

type Page = { id: string; name: string; access_token?: string; instagram_business_account?: { id: string; username?: string; profile_picture_url?: string } }

/** Dal codice del login: token, Pagine scelte dal cliente e Instagram collegati. Salva tutto. */
export async function connectFromCode(
  origin: string,
  code: string,
  workspaceId: string,
  userId: string
): Promise<{ pages: string[]; instagram: string[]; skipped: string[] }> {
  const { appId, appSecret } = metaConfig()
  const token = await graph<{ access_token: string }>(
    `/oauth/access_token?${new URLSearchParams({ client_id: appId, client_secret: appSecret, redirect_uri: callbackUrl(origin), code })}`
  )
  // Token dell'utente: si scambia con quello di lunga durata, cosi' i token delle
  // Pagine ricavati da lui non scadono. (Con il token di sistema lo scambio non
  // serve e, se Meta lo rifiuta, si usa quello ricevuto.)
  const longLived = await graph<{ access_token: string }>(
    `/oauth/access_token?${new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: token.access_token })}`
  ).catch(() => token)
  const { data: pages } = await graph<{ data: Page[] }>(
    `/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,profile_picture_url}&limit=50&access_token=${encodeURIComponent(longLived.access_token)}`
  )
  const db = workspaceDb(workspaceId)
  const facevoicePage = process.env.META_PAGE_ID?.trim()
  const result = { pages: [] as string[], instagram: [] as string[], skipped: [] as string[] }

  for (const page of pages || []) {
    if (!page.access_token) continue
    if (page.id === facevoicePage && workspaceId !== FACEVOICE_WORKSPACE_ID) {
      result.skipped.push(`${page.name} (è la Pagina di Facevoice)`)
      continue
    }
    const pageTakeOver = await takeOverConnection('facebook', page.id, workspaceId, userId, { proven: true })
    if (!pageTakeOver.ok) {
      result.skipped.push(`${page.name} (già collegata ${pageTakeOver.ownerName ? `allo spazio «${pageTakeOver.ownerName}»` : 'a uno spazio di un’altra persona'})`)
      continue
    }
    // La Pagina manda a Facevoice messaggi e commenti (anche quelli del suo Instagram).
    const subscribed = await subscribePage(page.id, page.access_token)

    const secret: MetaSecret = { pageToken: page.access_token, pageId: page.id, userToken: longLived.access_token }
    await saveConnection(db, {
      platform: 'facebook',
      externalId: page.id,
      displayName: page.name,
      meta: { pageName: page.name, subscribed_fields: subscribed ? PAGE_SUBSCRIBED_FIELDS : null },
      secret,
      userId,
    })
    result.pages.push(page.name)

    const ig = page.instagram_business_account
    if (ig?.id) {
      const igTakeOver = await takeOverConnection('instagram', ig.id, workspaceId, userId, { proven: true })
      if (!igTakeOver.ok) {
        result.skipped.push(`@${ig.username || ig.id} (già collegato ${igTakeOver.ownerName ? `allo spazio «${igTakeOver.ownerName}»` : 'a uno spazio di un’altra persona'})`)
      } else {
        await saveConnection(db, {
          platform: 'instagram',
          externalId: ig.id,
          displayName: ig.username ? `@${ig.username}` : page.name,
          meta: { pageId: page.id, username: ig.username || null, picture: ig.profile_picture_url || null },
          secret,
          userId,
        })
        result.instagram.push(ig.username ? `@${ig.username}` : ig.id)
      }
    }
  }

  if (result.pages.length) await setChannelState(db, 'facebook', { status: 'connected', handle: result.pages.join(', ') })
  if (result.instagram.length) await setChannelState(db, 'instagram', { status: 'connected', handle: result.instagram.join(', ') })
  return result
}

/** Account collegato (Pagina o Instagram) a cui arriva un webhook: a quale cliente appartiene. */
export async function connectionForAccount(platform: 'facebook' | 'instagram', accountId: string): Promise<Connection | null> {
  const { data } = await supabaseAdmin
    .from('channel_connections')
    .select('id, workspace_id, platform, external_id, display_name, status, last_error, meta, created_at, updated_at')
    .eq('platform', platform)
    .eq('external_id', accountId)
    .neq('status', 'disconnected')
    .maybeSingle()
  return (data as Connection | null) ?? null
}

/** Messaggio di risposta (Messenger o Direct) con il token della Pagina del cliente. */
export async function sendMetaText(connection: Connection, recipientId: string, text: string): Promise<{ id: string }> {
  // Instagram collegato con l'accesso di Instagram: altra API, altro token.
  const igSecret = await instagramLoginSecret(connection)
  if (igSecret) return sendInstagramLoginText(connection, igSecret, recipientId, text)
  const secret = await readConnectionSecret<MetaSecret>(connection.id)
  const data = await graph<{ message_id?: string }>(`/me/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secret.pageToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: recipientId }, messaging_type: 'RESPONSE', message: { text } }),
  })
  return { id: data.message_id || `meta:${Date.now()}` }
}

export type SenderAction = 'mark_seen' | 'typing_on'

/** "Visto" o "sta scrivendo..." nella chat (Messenger o Direct). Mai bloccante: gli errori si ignorano. */
export async function sendMetaSenderAction(connection: Connection, recipientId: string, action: SenderAction): Promise<void> {
  try {
    const igSecret = await instagramLoginSecret(connection)
    if (igSecret) return await sendInstagramLoginAction(connection, igSecret, recipientId, action)
    const secret = await readConnectionSecret<MetaSecret>(connection.id)
    await fetch(`${GRAPH}/me/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret.pageToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: recipientId }, sender_action: action }),
      signal: AbortSignal.timeout(5_000),
    })
  } catch {}
}

/** Nome visibile di chi scrive, con il token della Pagina del cliente. */
export async function contactName(connection: Connection, contactId: string): Promise<string | null> {
  try {
    const igSecret = await instagramLoginSecret(connection)
    if (igSecret) return await instagramLoginContactName(connection, igSecret, contactId)
    const secret = await readConnectionSecret<MetaSecret>(connection.id)
    const fields = connection.platform === 'instagram' ? 'name,username' : 'name'
    const data = await graph<{ name?: string; username?: string }>(`/${contactId}?fields=${fields}&access_token=${encodeURIComponent(secret.pageToken)}`)
    return data.name || (data.username ? `@${data.username}` : null)
  } catch {
    return null
  }
}

export type { WorkspaceDb }
