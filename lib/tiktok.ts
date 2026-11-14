import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { readSetting, updateSetting } from '@/lib/settings-store'
import { SITE_URL } from '@/lib/seo/site'

// Collegamento con TikTok (Login Kit, Display API, Content Posting API, webhook).
// - L'admin preme «Collega TikTok», accede a TikTok e accetta i permessi: il ritorno
//   (/api/admin/tiktok/callback) porta uno "state" firmato con la sua email.
// - I token stanno in app_settings (tiktok_oauth), cifrati (AES-256-GCM). Il token di
//   accesso dura poco: si rinnova da solo con il refresh token, che TikTok cambia a ogni
//   rinnovo (si salva sempre quello nuovo, un rinnovo alla volta).
// - Le chiavi sono su Vercel: TIKTOK_CLIENT_KEY e TIKTOK_CLIENT_SECRET.

const API = 'https://open.tiktokapis.com/v2'
export const TIKTOK_SCOPES = ['user.info.basic', 'user.info.profile', 'user.info.stats', 'video.list', 'video.upload', 'video.publish']
export const TIKTOK_REDIRECT_URI = `${SITE_URL}/api/admin/tiktok/callback`
export const TIKTOK_STORE_KEY = 'tiktok_oauth'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function credentials(): { key: string; secret: string } | null {
  const key = process.env.TIKTOK_CLIENT_KEY?.trim()
  const secret = process.env.TIKTOK_CLIENT_SECRET?.trim()
  return key && secret ? { key, secret } : null
}

export const isTikTokConfigured = () => credentials() !== null

/** Errore di TikTok con un messaggio in italiano (code: codice di TikTok, status: HTTP). */
export class TikTokError extends Error {
  constructor(message: string, public code = '', public status = 0) {
    super(message)
  }
  /** Problema passeggero (rete, limite di richieste, TikTok non disponibile): si riprova. */
  get transient() {
    return this.status === 0 || this.status === 429 || this.status >= 500 || this.code === 'rate_limit_exceeded' || this.code === 'internal_error'
  }
}

const MESSAGES: Record<string, string> = {
  access_token_invalid: 'TikTok: il collegamento non è più valido, ricollega l’account da Canali.',
  scope_not_authorized: 'TikTok: manca un permesso. Ricollega l’account da Canali e accetta tutti i permessi.',
  scope_permission_missed: 'TikTok: manca un permesso. Ricollega l’account da Canali e accetta tutti i permessi.',
  spam_risk_too_many_posts: 'TikTok: raggiunto il limite di post di oggi per questo account. Riprova più tardi.',
  spam_risk_user_banned_from_posting: 'TikTok: al momento questo account non può pubblicare nuovi video.',
  reached_active_user_cap: 'TikTok: raggiunto il limite giornaliero di account che pubblicano con l’app (l’app non è ancora approvata da TikTok). Riprova domani.',
  unaudited_client_can_only_post_to_private_accounts:
    'TikTok: finché TikTok non approva l’app si può pubblicare solo con un account privato e con visibilità «Solo io».',
  privacy_level_option_mismatch: 'TikTok: la visibilità scelta non è disponibile per questo account. Scegline un’altra.',
  rate_limit_exceeded: 'TikTok: troppe richieste, riprova tra un minuto.',
  url_ownership_unverified: 'TikTok: dominio del video non verificato.',
  invalid_publish_id: 'TikTok: pubblicazione non trovata.',
}

export const tiktokMessage = (code: string, fallback?: string) => MESSAGES[code] || `TikTok: ${fallback || code || 'errore sconosciuto'}`

// ---------------------------------------------------------------------
// Cifratura dei token e firma dello state
// ---------------------------------------------------------------------

function serverKey(purpose: string): Buffer {
  const base = (process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  if (!base) throw new TikTokError('Manca il segreto del server (CRON_SECRET) per proteggere i token di TikTok.', 'no_server_key', 500)
  return createHmac('sha256', base).update(purpose).digest()
}

function seal(text: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', serverKey('tiktok-token-seal'), iv)
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${data.toString('base64url')}`
}

function unseal(sealed: string | undefined): string | null {
  try {
    const [v, iv, tag, data] = String(sealed || '').split('.')
    if (v !== 'v1') return null
    const decipher = createDecipheriv('aes-256-gcm', serverKey('tiktok-token-seal'), Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

/** State firmato (10 minuti): lega il ritorno da TikTok a chi ha avviato il collegamento. */
export function createTikTokState(owner: string): string {
  const payload = Buffer.from(JSON.stringify({ o: owner, x: Date.now() + 10 * 60_000, n: randomBytes(8).toString('hex') })).toString('base64url')
  const sig = createHmac('sha256', serverKey('tiktok-oauth-state')).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function verifyTikTokState(state: string | null): string | null {
  try {
    const [payload, sig] = String(state || '').split('.')
    if (!payload || !sig) return null
    const expected = createHmac('sha256', serverKey('tiktok-oauth-state')).update(payload).digest()
    const received = Buffer.from(sig, 'base64url')
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
    return typeof data.o === 'string' && Number(data.x) > Date.now() ? data.o : null
  } catch {
    return null
  }
}

export function buildTikTokAuthUrl(state: string, redirectUri = TIKTOK_REDIRECT_URI): string {
  const creds = credentials()
  if (!creds) throw new TikTokError('Mancano TIKTOK_CLIENT_KEY e TIKTOK_CLIENT_SECRET nelle variabili di Vercel.', 'not_configured', 400)
  const params = new URLSearchParams({
    client_key: creds.key,
    scope: TIKTOK_SCOPES.join(','),
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
    // Mostra sempre la pagina di TikTok: si vede con quale account si sta collegando.
    disable_auto_auth: '1',
  })
  return `https://www.tiktok.com/v2/auth/authorize/?${params}`
}

// ---------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------

type Stored = {
  openId: string
  scope: string
  access: string
  refresh: string
  expiresAt: number
  refreshExpiresAt: number
  connectedAt: string
  connectedBy: string
  lock?: { id: string; until: number }
}

type TokenResponse = { access_token: string; refresh_token: string; expires_in: number; refresh_expires_in: number; open_id: string; scope: string }

const parseStored = (raw: string | null): Stored | null => {
  try {
    const v = raw ? JSON.parse(raw) : null
    return v && typeof v.openId === 'string' && typeof v.access === 'string' ? (v as Stored) : null
  } catch {
    return null
  }
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const creds = credentials()
  if (!creds) throw new TikTokError('Mancano TIKTOK_CLIENT_KEY e TIKTOK_CLIENT_SECRET nelle variabili di Vercel.', 'not_configured', 400)
  const res = await fetch(`${API}/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
    body: new URLSearchParams({ client_key: creds.key, client_secret: creds.secret, ...params }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null)
  if (!res) throw new TikTokError('TikTok non risponde, riprova tra poco.', 'network', 0)
  const json = await res.json().catch(() => null)
  if (!res.ok || typeof json?.error === 'string' || !json?.access_token) {
    const code = typeof json?.error === 'string' ? json.error : `http_${res.status}`
    throw new TikTokError(`TikTok: ${json?.error_description || code}`, code, res.ok ? 400 : res.status)
  }
  return json as TokenResponse
}

const toStored = (t: TokenResponse, base: { connectedAt: string; connectedBy: string }): Stored => ({
  openId: t.open_id,
  scope: t.scope || '',
  access: seal(t.access_token),
  refresh: seal(t.refresh_token),
  expiresAt: Date.now() + Number(t.expires_in || 0) * 1000,
  refreshExpiresAt: Date.now() + Number(t.refresh_expires_in || 0) * 1000,
  connectedAt: base.connectedAt,
  connectedBy: base.connectedBy,
})

/** Scambia il codice del ritorno da TikTok e salva il collegamento (sostituisce quello di prima). */
export async function completeTikTokOAuth(code: string, owner: string, options: { key?: string; redirectUri?: string } = {}) {
  const key = options.key || TIKTOK_STORE_KEY
  const token = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: options.redirectUri || TIKTOK_REDIRECT_URI })
  const previous = parseStored((await readSetting(key)).value)
  const stored = toStored(token, { connectedAt: new Date().toISOString(), connectedBy: owner })
  await updateSetting(key, parseStored, () => stored)
  // Collegato un altro account: il token del vecchio si revoca (non serve piu').
  if (previous && previous.openId !== stored.openId) await revoke(unseal(previous.access))
  const profile = await getTikTokProfile(key).catch(() => null)
  return { openId: stored.openId, scope: stored.scope, profile }
}

export async function loadTikTokConnection(key = TIKTOK_STORE_KEY) {
  const stored = parseStored((await readSetting(key)).value)
  return stored ? { openId: stored.openId, scopes: stored.scope.split(',').filter(Boolean), connectedAt: stored.connectedAt, connectedBy: stored.connectedBy } : null
}

/** Token di accesso valido (rinnovato se sta per scadere: uno alla volta, gli altri aspettano). */
export async function tiktokAccessToken(key = TIKTOK_STORE_KEY): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const stored = parseStored((await readSetting(key)).value)
    if (!stored) throw new TikTokError('TikTok non è collegato: collegalo da Canali.', 'not_connected', 401)
    const access = unseal(stored.access)
    const now = Date.now()
    if (access && stored.expiresAt - now > 10 * 60_000) return access
    const stillValid = access && stored.expiresAt - now > 30_000 ? access : null
    if (stored.refreshExpiresAt && stored.refreshExpiresAt < now) {
      if (stillValid) return stillValid
      throw new TikTokError('Il collegamento con TikTok è scaduto: ricollegalo da Canali.', 'access_token_invalid', 401)
    }
    const lockId = randomBytes(8).toString('hex')
    const claimed = await updateSetting(key, parseStored, (current) => {
      if (!current || current.refresh !== stored.refresh || (current.lock && current.lock.until > Date.now())) return false
      return { ...current, lock: { id: lockId, until: Date.now() + 30_000 } }
    })
    if (claimed?.lock?.id !== lockId) {
      // Sta rinnovando qualcun altro (o e' appena cambiato): si usa il token attuale o si riprova.
      if (stillValid) return stillValid
      await sleep(1500)
      continue
    }
    try {
      const fresh = await tokenRequest({ grant_type: 'refresh_token', refresh_token: unseal(claimed.refresh) || '' })
      const next = toStored(fresh, claimed)
      // Il refresh token nuovo si salva sempre (quello vecchio non vale piu'), se l'account e' lo stesso.
      await updateSetting(key, parseStored, (current) => (current && current.connectedAt === claimed.connectedAt ? next : false))
      return fresh.access_token
    } catch (error) {
      await updateSetting(key, parseStored, (current) => {
        if (current?.lock?.id !== lockId) return false
        const { lock: _lock, ...rest } = current
        return rest
      }).catch(() => undefined)
      if (stillValid) return stillValid
      if (error instanceof TikTokError && error.code === 'invalid_grant') {
        throw new TikTokError('TikTok ha chiuso il collegamento: ricollega l’account da Canali.', 'access_token_invalid', 401)
      }
      throw error
    }
  }
  throw new TikTokError('TikTok non risponde, riprova tra poco.', 'busy', 503)
}

async function revoke(accessToken: string | null) {
  const creds = credentials()
  if (!creds || !accessToken) return
  await fetch(`${API}/oauth/revoke/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_key: creds.key, client_secret: creds.secret, token: accessToken }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined)
}

/** Scollega: revoca il token su TikTok (se si puo') e cancella il collegamento. */
export async function disconnectTikTok(key = TIKTOK_STORE_KEY) {
  const stored = parseStored((await readSetting(key)).value)
  if (stored) await revoke(unseal(stored.access))
  const { error } = await supabaseAdmin.from('app_settings').delete().eq('key', key)
  if (error) throw new Error(error.message)
}

/** TikTok ha tolto l'autorizzazione (webhook): si cancella il collegamento di quell'account. */
export async function forgetTikTokAccount(openId: string, key = TIKTOK_STORE_KEY): Promise<boolean> {
  const { value, stamp } = await readSetting(key)
  const stored = parseStored(value)
  if (!stored || !stamp || stored.openId !== openId) return false
  const { error } = await supabaseAdmin.from('app_settings').delete().eq('key', key).eq('updated_at', stamp)
  if (error) throw new Error(error.message)
  return true
}

// ---------------------------------------------------------------------
// Chiamate alle API
// ---------------------------------------------------------------------

async function api<T>(path: string, token: string, body?: unknown, timeoutMs = 20_000): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => null)
  if (!res) throw new TikTokError('TikTok non risponde, riprova tra poco.', 'network', 0)
  const json = await res.json().catch(() => null)
  const code = typeof json?.error?.code === 'string' ? json.error.code : ''
  if (!res.ok || (code && code !== 'ok')) {
    const finalCode = code || `http_${res.status}`
    throw new TikTokError(tiktokMessage(finalCode, json?.error?.message), finalCode, res.ok ? 400 : res.status)
  }
  return (json?.data ?? {}) as T
}

async function apiGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) }).catch(() => null)
  if (!res) throw new TikTokError('TikTok non risponde, riprova tra poco.', 'network', 0)
  const json = await res.json().catch(() => null)
  const code = typeof json?.error?.code === 'string' ? json.error.code : ''
  if (!res.ok || (code && code !== 'ok')) {
    const finalCode = code || `http_${res.status}`
    throw new TikTokError(tiktokMessage(finalCode, json?.error?.message), finalCode, res.ok ? 400 : res.status)
  }
  return (json?.data ?? {}) as T
}

export type TikTokProfile = {
  openId: string
  displayName: string
  username: string | null
  avatarUrl: string | null
  bio: string | null
  profileUrl: string | null
  verified: boolean
  followers: number | null
  following: number | null
  likes: number | null
  videos: number | null
}

/** Profilo dell'account collegato (i campi dipendono dai permessi accettati). */
export async function getTikTokProfile(key = TIKTOK_STORE_KEY): Promise<TikTokProfile> {
  const token = await tiktokAccessToken(key)
  const scopes = (await loadTikTokConnection(key))?.scopes || []
  const fields = ['open_id', 'avatar_url', 'display_name']
  if (scopes.includes('user.info.profile')) fields.push('username', 'bio_description', 'profile_deep_link', 'is_verified')
  if (scopes.includes('user.info.stats')) fields.push('follower_count', 'following_count', 'likes_count', 'video_count')
  const data = await apiGet<{ user?: Record<string, unknown> }>(`/user/info/?fields=${fields.join(',')}`, token)
  const u = data.user || {}
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return {
    openId: String(u.open_id || ''),
    displayName: String(u.display_name || ''),
    username: typeof u.username === 'string' && u.username ? u.username : null,
    avatarUrl: typeof u.avatar_url === 'string' ? u.avatar_url : null,
    bio: typeof u.bio_description === 'string' ? u.bio_description : null,
    profileUrl: typeof u.profile_deep_link === 'string' ? u.profile_deep_link : null,
    verified: u.is_verified === true,
    followers: num(u.follower_count),
    following: num(u.following_count),
    likes: num(u.likes_count),
    videos: num(u.video_count),
  }
}

export type TikTokVideo = {
  id: string
  title: string
  cover: string | null
  url: string | null
  createdAt: string | null
  duration: number | null
  views: number | null
  likes: number | null
  comments: number | null
  shares: number | null
}

/** Ultimi video pubblici dell'account (al massimo 20). */
export async function listTikTokVideos(max = 12, key = TIKTOK_STORE_KEY): Promise<TikTokVideo[]> {
  const token = await tiktokAccessToken(key)
  const fields = 'id,create_time,cover_image_url,share_url,video_description,title,duration,view_count,like_count,comment_count,share_count'
  const data = await api<{ videos?: Record<string, unknown>[] }>(`/video/list/?fields=${fields}`, token, { max_count: Math.min(Math.max(max, 1), 20) })
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return (data.videos || []).map((v) => ({
    id: String(v.id || ''),
    title: String(v.title || v.video_description || ''),
    cover: typeof v.cover_image_url === 'string' ? v.cover_image_url : null,
    url: typeof v.share_url === 'string' ? v.share_url : null,
    createdAt: typeof v.create_time === 'number' ? new Date(v.create_time * 1000).toISOString() : null,
    duration: num(v.duration),
    views: num(v.view_count),
    likes: num(v.like_count),
    comments: num(v.comment_count),
    shares: num(v.share_count),
  }))
}

export type TikTokCreator = {
  nickname: string
  username: string
  avatarUrl: string | null
  privacyOptions: string[]
  commentDisabled: boolean
  duetDisabled: boolean
  stitchDisabled: boolean
  maxDurationSec: number | null
}

/** Chi pubblica e cosa puo' fare adesso (da chiedere ogni volta che si prepara un post). */
export async function getTikTokCreator(key = TIKTOK_STORE_KEY): Promise<TikTokCreator> {
  const token = await tiktokAccessToken(key)
  const d = await api<Record<string, unknown>>('/post/publish/creator_info/query/', token)
  return {
    nickname: String(d.creator_nickname || ''),
    username: String(d.creator_username || ''),
    avatarUrl: typeof d.creator_avatar_url === 'string' ? d.creator_avatar_url : null,
    privacyOptions: Array.isArray(d.privacy_level_options) ? d.privacy_level_options.filter((p): p is string => typeof p === 'string') : [],
    commentDisabled: d.comment_disabled === true,
    duetDisabled: d.duet_disabled === true,
    stitchDisabled: d.stitch_disabled === true,
    maxDurationSec: typeof d.max_video_post_duration_sec === 'number' ? d.max_video_post_duration_sec : null,
  }
}

export type TikTokPostInfo = {
  title: string
  privacy_level: string
  disable_comment: boolean
  disable_duet: boolean
  disable_stitch: boolean
  brand_content_toggle: boolean
  brand_organic_toggle: boolean
  is_aigc?: boolean
}

/** Pezzi del caricamento: fino a 20 MB in un pezzo solo, poi pezzi da 10 MB (l'ultimo prende il resto). */
export function tiktokChunkPlan(size: number): { chunkSize: number; total: number } {
  const CHUNK = 10_000_000
  if (size <= 2 * CHUNK) return { chunkSize: size, total: 1 }
  return { chunkSize: CHUNK, total: Math.floor(size / CHUNK) }
}

/** Avvia la pubblicazione: diretta (con post_info) oppure nelle bozze dell'app (inbox). */
export async function initTikTokUpload(mode: 'direct' | 'inbox', size: number, postInfo: TikTokPostInfo | null, key = TIKTOK_STORE_KEY) {
  const token = await tiktokAccessToken(key)
  const { chunkSize, total } = tiktokChunkPlan(size)
  const source_info = { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunkSize, total_chunk_count: total }
  const data =
    mode === 'direct'
      ? await api<{ publish_id?: string; upload_url?: string }>('/post/publish/video/init/', token, { post_info: postInfo, source_info })
      : await api<{ publish_id?: string; upload_url?: string }>('/post/publish/inbox/video/init/', token, { source_info })
  if (!data.publish_id || !data.upload_url) throw new TikTokError('TikTok non ha avviato il caricamento: riprova.', 'no_upload_url', 502)
  return { publishId: data.publish_id, uploadUrl: data.upload_url, chunkSize, total }
}

/** Manda un pezzo del video. 'done' = era l'ultimo; 'more' = ne servono altri; 'range' = TikTok si aspettava un altro pezzo. */
export async function putTikTokChunk(uploadUrl: string, bytes: Uint8Array<ArrayBuffer>, start: number, size: number, contentType: string): Promise<'done' | 'more' | 'range'> {
  const end = start + bytes.byteLength - 1
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType, 'Content-Range': `bytes ${start}-${end}/${size}` },
    body: bytes,
    signal: AbortSignal.timeout(45_000),
  }).catch(() => null)
  if (!res) throw new TikTokError('Caricamento su TikTok interrotto, riprovo al prossimo giro.', 'network', 0)
  if (res.status === 201) return 'done'
  if (res.status === 206 || res.status === 200) return end + 1 >= size ? 'done' : 'more'
  if (res.status === 416) return 'range'
  if (res.status === 403 || res.status === 404) throw new TikTokError('TikTok: il tempo per caricare il video è scaduto. Premi «Riprova ora».', 'upload_expired', 400)
  throw new TikTokError(`TikTok: caricamento non riuscito (${res.status}).`, `http_${res.status}`, res.status)
}

export type TikTokPublishStatus = { status: string; failReason: string; postIds: string[]; uploadedBytes: number | null }

export async function getTikTokPublishStatus(publishId: string, key = TIKTOK_STORE_KEY): Promise<TikTokPublishStatus> {
  const token = await tiktokAccessToken(key)
  const d = await api<Record<string, unknown>>('/post/publish/status/fetch/', token, { publish_id: publishId })
  const ids = Array.isArray(d.publicaly_available_post_id) ? d.publicaly_available_post_id : Array.isArray(d.publicly_available_post_id) ? d.publicly_available_post_id : []
  return {
    status: String(d.status || ''),
    failReason: String(d.fail_reason || ''),
    postIds: ids.map((x) => String(x)),
    uploadedBytes: typeof d.uploaded_bytes === 'number' ? d.uploaded_bytes : null,
  }
}

const FAIL_REASONS: Record<string, string> = {
  file_format_check_failed: 'formato non accettato (usa MP4 o MOV con codifica H.264)',
  duration_check_failed: 'durata non accettata per questo account',
  frame_rate_check_failed: 'frequenza dei fotogrammi non accettata (serve tra 23 e 60 fps)',
  picture_size_check_failed: 'dimensioni non accettate (lati tra 360 e 4096 pixel)',
  internal: 'errore interno di TikTok, riprova',
  video_pull_failed: 'TikTok non è riuscito a scaricare il video, riprova',
  publish_cancelled: 'pubblicazione annullata',
  auth_removed: 'l’autorizzazione è stata tolta: ricollega l’account',
  spam_risk_too_many_posts: 'raggiunto il limite di post di oggi',
  spam_risk_user_banned_from_posting: 'l’account al momento non può pubblicare',
  spam_risk_text: 'TikTok ha rifiutato il testo della didascalia',
  spam_risk: 'TikTok ha rifiutato il post',
}

export const tiktokFailReason = (reason: string) => `TikTok non ha pubblicato il video: ${FAIL_REASONS[reason] || reason || 'motivo sconosciuto'}.`

// ---------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------

/** Firma del webhook: TikTok-Signature "t=<secondi>,s=<hex>" = HMAC-SHA256(client secret, "<t>.<corpo>"). */
export function verifyTikTokSignature(header: string | null, rawBody: string, toleranceSec = 300): boolean {
  const creds = credentials()
  if (!creds || !header) return false
  const parts = Object.fromEntries(
    header.split(',').map((piece) => {
      const at = piece.indexOf('=')
      return [piece.slice(0, at).trim(), piece.slice(at + 1).trim()]
    })
  )
  const t = Number(parts.t)
  if (!Number.isFinite(t) || !/^[0-9a-f]+$/i.test(parts.s || '')) return false
  if (Math.abs(Date.now() / 1000 - t) > toleranceSec) return false
  const expected = createHmac('sha256', creds.secret).update(`${parts.t}.${rawBody}`, 'utf8').digest()
  const received = Buffer.from(parts.s, 'hex')
  return expected.length === received.length && timingSafeEqual(expected, received)
}

export const tiktokClientKey = () => credentials()?.key || ''
