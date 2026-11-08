// Chiamate in uscita verso la Graph API di Meta.

export const GRAPH_VERSION = 'v25.0'
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`

// recipientId: per le risposte private ai commenti, l'id Messenger/Direct del destinatario.
export type SendResult = { id?: string; error?: string; recipientId?: string }

/** Un solo token di sistema per tutti i canali Meta (nome storico: WHATSAPP_ACCESS_TOKEN). */
export function getSystemToken(): string | undefined {
  return (process.env.META_ACCESS_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN)?.trim() || undefined
}

let cachedPageToken: { pageId: string; token: string } | null = null

/** Messenger e Instagram si usano con il token della Pagina, ricavato da quello di sistema. */
export async function getPageToken(): Promise<{ pageId: string; token: string } | null> {
  if (cachedPageToken) return cachedPageToken

  const systemToken = getSystemToken()
  if (!systemToken) return null

  const response = await fetch(
    `${GRAPH}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(systemToken)}`
  )
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    console.error('Meta page token error:', data?.error?.message || response.status)
    return null
  }

  const wanted = process.env.META_PAGE_ID?.trim()
  const pages: Array<{ id: string; access_token?: string }> = data?.data || []
  const page = wanted ? pages.find((p) => p.id === wanted) : pages[0]
  if (!page?.access_token) {
    console.error('Meta: nessuna Pagina accessibile con il token di sistema')
    return null
  }

  cachedPageToken = { pageId: page.id, token: page.access_token }
  return cachedPageToken
}

async function post(url: string, token: string, body: unknown): Promise<SendResult & { raw?: any }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (data?.error?.code === 190) cachedPageToken = null
    return { error: data?.error?.message || `HTTP ${response.status}` }
  }
  return { raw: data }
}

export async function sendWhatsAppText(phoneNumberId: string, to: string, text: string): Promise<SendResult> {
  const token = getSystemToken()
  if (!token) return { error: 'Token Meta non configurato' }
  const res = await post(`${GRAPH}/${phoneNumberId}/messages`, token, {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text },
  })
  return res.error ? res : { id: res.raw?.messages?.[0]?.id }
}

/** Vale sia per Messenger sia per i Direct di Instagram. */
export async function sendMessengerText(recipientId: string, text: string): Promise<SendResult> {
  const page = await getPageToken()
  if (!page) return { error: 'Token della Pagina non disponibile' }
  const res = await post(`${GRAPH}/me/messages`, page.token, {
    recipient: { id: recipientId },
    messaging_type: 'RESPONSE',
    message: { text },
  })
  return res.error ? res : { id: res.raw?.message_id }
}

export async function replyToComment(
  platform: 'facebook' | 'instagram',
  commentId: string,
  text: string
): Promise<SendResult> {
  const page = await getPageToken()
  if (!page) return { error: 'Token della Pagina non disponibile' }
  const edge = platform === 'instagram' ? 'replies' : 'comments'
  const res = await post(`${GRAPH}/${commentId}/${edge}`, page.token, { message: text })
  return res.error ? res : { id: res.raw?.id }
}

/**
 * Risposta privata a un commento (Private Replies): un solo messaggio per
 * commento, entro 7 giorni. Vale per Pagina Facebook e Instagram.
 */
export async function sendPrivateReply(commentId: string, text: string): Promise<SendResult> {
  const page = await getPageToken()
  if (!page) return { error: 'Token della Pagina non disponibile' }
  const res = await post(`${GRAPH}/me/messages`, page.token, {
    recipient: { comment_id: commentId },
    message: { text },
  })
  return res.error ? res : { id: res.raw?.message_id, recipientId: res.raw?.recipient_id }
}

/** Didascalia del post o reel commentato, per dare contesto alla risposta. */
export async function fetchPostCaption(
  platform: 'facebook' | 'instagram',
  postId: string
): Promise<string | null> {
  const page = await getPageToken()
  if (!page) return null
  const fields = platform === 'instagram' ? 'caption,media_product_type' : 'message'
  try {
    const response = await fetch(`${GRAPH}/${postId}?fields=${fields}&access_token=${encodeURIComponent(page.token)}`)
    if (!response.ok) return null
    const data = await response.json()
    const text = (platform === 'instagram' ? data?.caption : data?.message) as string | undefined
    if (!text) return null
    const kind = data?.media_product_type === 'REELS' ? 'Reel' : 'Post'
    return `${kind}: ${text.slice(0, 1500)}`
  } catch {
    return null
  }
}

/**
 * Nome visibile e, su Instagram, username del contatto, se Meta li concede. Lo username viene
 * da Meta (non lo sceglie chi scrive nel messaggio): serve al collegamento automatico.
 */
export async function fetchContactProfile(
  platform: 'facebook' | 'instagram',
  contactId: string
): Promise<{ name: string | null; username: string | null }> {
  const empty = { name: null, username: null }
  const page = await getPageToken()
  if (!page) return empty
  const fields = platform === 'instagram' ? 'name,username' : 'name'
  try {
    const response = await fetch(
      `${GRAPH}/${contactId}?fields=${fields}&access_token=${encodeURIComponent(page.token)}`
    )
    if (!response.ok) return empty
    const data = await response.json()
    const username = typeof data?.username === 'string' && data.username.trim() ? data.username.trim() : null
    return { name: typeof data?.name === 'string' && data.name.trim() ? data.name : null, username }
  } catch {
    return empty
  }
}

/** Nome visibile del contatto Messenger/Instagram, se Meta lo concede. */
export async function fetchContactName(
  platform: 'facebook' | 'instagram',
  contactId: string
): Promise<string | null> {
  const profile = await fetchContactProfile(platform, contactId)
  return profile.name || (profile.username ? `@${profile.username}` : null)
}

let cachedIgUserId: string | null = null

/** Account Instagram aziendale collegato alla Pagina (serve per leggere profili altrui). */
export async function getInstagramUserId(page: { pageId: string; token: string }): Promise<string | null> {
  if (cachedIgUserId) return cachedIgUserId
  const response = await fetch(`${GRAPH}/${page.pageId}?fields=instagram_business_account&access_token=${encodeURIComponent(page.token)}`)
  const data = await response.json().catch(() => ({}))
  cachedIgUserId = data?.instagram_business_account?.id || null
  return cachedIgUserId
}

export type InstagramProfile = {
  username: string
  name?: string
  followers?: number
  following?: number
  posts?: number
  biography?: string
  website?: string
  recentPosts?: { date: string; caption: string; likes?: number; comments?: number; url?: string }[]
  error?: string
}

/**
 * Profilo pubblico di un account Instagram business o creator (Business Discovery):
 * follower, numero di post, bio, sito e ultimi post. Gli account personali non sono leggibili.
 */
export async function fetchInstagramProfile(username: string): Promise<InstagramProfile> {
  const clean = username.replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').split(/[/?#]/)[0].trim()
  if (!clean) return { username, error: 'username mancante' }
  const page = await getPageToken()
  if (!page) return { username: clean, error: 'collegamento Meta non configurato' }
  const igId = await getInstagramUserId(page)
  if (!igId) return { username: clean, error: 'nessun account Instagram aziendale collegato alla Pagina' }

  const fields = `business_discovery.username(${clean}){username,name,followers_count,follows_count,media_count,biography,website,media.limit(6){caption,timestamp,like_count,comments_count,permalink}}`
  const response = await fetch(`${GRAPH}/${igId}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(page.token)}`)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    return { username: clean, error: data?.error?.error_user_msg || data?.error?.message || `HTTP ${response.status}` }
  }
  const bd = data?.business_discovery || {}
  return {
    username: bd.username || clean,
    name: bd.name,
    followers: bd.followers_count,
    following: bd.follows_count,
    posts: bd.media_count,
    biography: bd.biography,
    website: bd.website,
    recentPosts: (bd.media?.data || []).map((m: any) => ({
      date: m.timestamp,
      caption: String(m.caption || '').slice(0, 200),
      likes: m.like_count,
      comments: m.comments_count,
      url: m.permalink,
    })),
  }
}

/**
 * Post sulla Pagina Facebook (testo + link con anteprima). Serve il permesso
 * pages_manage_posts sul token: senza, Meta risponde con un errore di permessi.
 */
export async function publishPagePost(message: string, link?: string): Promise<SendResult> {
  const page = await getPageToken()
  if (!page) return { error: 'collegamento Meta non configurato' }
  const result = await post(`${GRAPH}/${page.pageId}/feed`, page.token, { message, ...(link ? { link } : {}) })
  if (result.error) return { error: result.error }
  return { id: result.raw?.id }
}

/** Attende che Meta abbia elaborato un contenuto Instagram (FINISHED). */
/**
 * Aspetta che Instagram abbia finito di elaborare un contenuto. Prima, dopo 30
 * secondi si pubblicava comunque: con immagini piu' pesanti Instagram non era
 * pronto e rispondeva "Media ID is not available". Ora si aspetta fino a
 * `seconds` e, se non e' pronto, lo si dice.
 */
async function waitForInstagram(id: string, token: string, seconds = 90): Promise<string | null> {
  const until = Date.now() + seconds * 1000
  let last = ''
  while (Date.now() < until) {
    const res = await fetch(`${GRAPH}/${id}?fields=status_code,status&access_token=${encodeURIComponent(token)}`).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    last = data?.status_code || ''
    if (last === 'FINISHED') return null
    if (last === 'ERROR' || last === 'EXPIRED') return `Instagram non ha accettato le immagini (${last}${data?.status ? `: ${data.status}` : ''})`
    await new Promise((r) => setTimeout(r, 3000))
  }
  return `Instagram non ha finito di elaborare le immagini in ${seconds} secondi (stato ${last || 'sconosciuto'})`
}

/**
 * Carosello nel feed Instagram (da 2 a 10 immagini JPEG pubbliche + didascalia):
 * un contenuto per immagine, poi il carosello, poi la pubblicazione. Serve il
 * permesso instagram_content_publish.
 */
export async function publishInstagramCarousel(imageUrls: string[], caption: string): Promise<SendResult> {
  const page = await getPageToken()
  if (!page) return { error: 'collegamento Meta non configurato' }
  const igId = await getInstagramUserId(page)
  if (!igId) return { error: 'nessun account Instagram aziendale collegato alla Pagina' }
  const children: string[] = []
  for (const url of imageUrls.slice(0, 10)) {
    const item = await post(`${GRAPH}/${igId}/media`, page.token, { image_url: url, is_carousel_item: true })
    if (item.error || !item.raw?.id) return { error: item.error || 'immagine del carosello non accettata' }
    children.push(item.raw.id)
  }
  // Ogni immagine deve essere pronta prima di creare il carosello.
  for (const child of children) {
    const childNotReady = await waitForInstagram(child, page.token, 60)
    if (childNotReady) return { error: childNotReady }
  }
  const carousel = await post(`${GRAPH}/${igId}/media`, page.token, { media_type: 'CAROUSEL', children: children.join(','), caption: caption.slice(0, 2200) })
  if (carousel.error || !carousel.raw?.id) return { error: carousel.error || 'carosello non creato' }
  const notReady = await waitForInstagram(carousel.raw.id, page.token)
  if (notReady) return { error: notReady }
  // "Media ID is not available": a volte Instagram ha bisogno di qualche secondo in piu'.
  let published = await post(`${GRAPH}/${igId}/media_publish`, page.token, { creation_id: carousel.raw.id })
  for (let attempt = 0; attempt < 4 && published.error && /not available|not ready|try again/i.test(published.error); attempt++) {
    await new Promise((r) => setTimeout(r, 6000))
    published = await post(`${GRAPH}/${igId}/media_publish`, page.token, { creation_id: carousel.raw.id })
  }
  if (published.error) return { error: published.error }
  return { id: published.raw?.id }
}

/**
 * Post con piu' foto sulla Pagina Facebook: le foto si caricano senza pubblicarle,
 * poi un unico post le raccoglie. Serve il permesso pages_manage_posts.
 */
export async function publishPagePhotos(imageUrls: string[], message: string): Promise<SendResult> {
  const page = await getPageToken()
  if (!page) return { error: 'collegamento Meta non configurato' }
  const ids: string[] = []
  for (const url of imageUrls.slice(0, 10)) {
    const photo = await post(`${GRAPH}/${page.pageId}/photos`, page.token, { url, published: false })
    if (photo.error || !photo.raw?.id) return { error: photo.error || 'foto non caricata su Facebook' }
    ids.push(photo.raw.id)
  }
  const result = await post(`${GRAPH}/${page.pageId}/feed`, page.token, { message, attached_media: ids.map((id) => ({ media_fbid: id })) })
  if (result.error) return { error: result.error }
  return { id: result.raw?.id }
}

/** Stato di un contenuto Instagram in elaborazione (Reel): FINISHED, IN_PROGRESS, ERROR, EXPIRED, PUBLISHED. */
export type ContainerStatus = { status: string; detail?: string; error?: string }

/**
 * Crea il contenuto di un Reel (video pubblico mp4/mov + didascalia) e restituisce subito il suo id:
 * Instagram lo elabora per qualche minuto, poi si pubblica con publishInstagramContainer.
 * Serve il permesso instagram_content_publish.
 */
export async function createInstagramReel(videoUrl: string, caption: string): Promise<SendResult> {
  const page = await getPageToken()
  if (!page) return { error: 'collegamento Meta non configurato' }
  const igId = await getInstagramUserId(page)
  if (!igId) return { error: 'nessun account Instagram aziendale collegato alla Pagina' }
  const res = await post(`${GRAPH}/${igId}/media`, page.token, { media_type: 'REELS', video_url: videoUrl, caption: caption.slice(0, 2200), share_to_feed: true })
  if (res.error || !res.raw?.id) return { error: res.error || 'Reel non accettato da Instagram' }
  return { id: res.raw.id }
}

/** Un solo controllo (nessuna attesa): a che punto e' l'elaborazione del Reel. */
export async function instagramContainerStatus(containerId: string): Promise<ContainerStatus> {
  const page = await getPageToken()
  if (!page) return { status: '', error: 'collegamento Meta non configurato' }
  try {
    const res = await fetch(`${GRAPH}/${containerId}?fields=status_code,status&access_token=${encodeURIComponent(page.token)}`, { signal: AbortSignal.timeout(10_000) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { status: '', error: data?.error?.message || `HTTP ${res.status}` }
    return { status: String(data?.status_code || ''), ...(data?.status ? { detail: String(data.status) } : {}) }
  } catch (error) {
    return { status: '', error: error instanceof Error ? error.message : String(error) }
  }
}

/** Pubblica un contenuto Instagram gia' elaborato (FINISHED). */
export async function publishInstagramContainer(containerId: string): Promise<SendResult> {
  const page = await getPageToken()
  if (!page) return { error: 'collegamento Meta non configurato' }
  const igId = await getInstagramUserId(page)
  if (!igId) return { error: 'nessun account Instagram aziendale collegato alla Pagina' }
  const res = await post(`${GRAPH}/${igId}/media_publish`, page.token, { creation_id: containerId })
  if (res.error) return { error: res.error }
  return { id: res.raw?.id }
}

/**
 * Video sulla Pagina Facebook da un indirizzo pubblico (Facebook lo scarica e lo elabora da solo).
 * Serve il permesso pages_manage_posts.
 */
export async function publishPageVideo(videoUrl: string, description: string): Promise<SendResult> {
  const page = await getPageToken()
  if (!page) return { error: 'collegamento Meta non configurato' }
  const res = await post(`https://graph-video.facebook.com/${GRAPH_VERSION}/${page.pageId}/videos`, page.token, { file_url: videoUrl, description: description.slice(0, 5000) })
  if (res.error || !res.raw?.id) return { error: res.error || 'video non accettato da Facebook' }
  return { id: res.raw.id }
}

/** Rifiuta dopo ms millisecondi (le chiamate a Meta non devono mai fermare una risposta). */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout dopo ${ms} ms`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

/** Messaggio letto dallo storico di una conversazione Messenger o Instagram. */
export type GraphConversationMessage = { id: string; text: string; fromId: string | null; createdAt: string | null }

/** created_time di Meta ("2026-11-05T10:00:00+0000") in ISO; null se non si legge. */
function graphTime(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const ms = Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

const CONVERSATION_FIELDS = 'messages.limit(20){id,message,from,to,created_time}'

/**
 * Ultimi 20 messaggi della conversazione con questa persona (Messenger o Direct di
 * Instagram collegato alla Pagina), compresi quelli scritti a mano dall'app.
 * ownIds: i nostri id (Pagina e Instagram) per capire chi ha scritto cosa.
 * Tutto entro timeoutMs: oltre, errore (chi chiama prosegue senza storico).
 */
export async function fetchConversationHistory(
  platform: 'facebook' | 'instagram',
  contactId: string,
  timeoutMs = 5000
): Promise<{ messages: GraphConversationMessage[]; ownIds: string[] } | { error: string }> {
  const started = Date.now()
  const left = () => Math.max(1, timeoutMs - (Date.now() - started))
  // Limite rigido anche se una chiamata ignorasse il segnale di interruzione.
  return withTimeout(readConversation(platform, contactId, left), timeoutMs + 200).catch((error) => ({
    error: error instanceof Error ? error.message : String(error),
  }))
}

async function readConversation(
  platform: 'facebook' | 'instagram',
  contactId: string,
  left: () => number
): Promise<{ messages: GraphConversationMessage[]; ownIds: string[] } | { error: string }> {
  try {
    const page = await withTimeout(getPageToken(), left())
    if (!page) return { error: 'token della Pagina non disponibile' }
    const igId = platform === 'instagram' ? await withTimeout(getInstagramUserId(page), left()).catch(() => null) : null
    const ownIds = [page.pageId, ...(igId ? [igId] : [])]
    const token = encodeURIComponent(page.token)

    const read = async (url: string) => {
      const response = await fetch(url, { signal: AbortSignal.timeout(left()) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data?.error?.message || `HTTP ${response.status}`)
      return data
    }
    const list = async (ownerId: string) =>
      read(
        `${GRAPH}/${ownerId}/conversations?platform=${platform === 'instagram' ? 'instagram' : 'messenger'}&user_id=${encodeURIComponent(contactId)}&fields=${encodeURIComponent(CONVERSATION_FIELDS)}&access_token=${token}`
      )

    let data: any
    try {
      data = await list(page.pageId)
    } catch (error) {
      // Instagram: alcune configurazioni rispondono solo sull'id dell'account Instagram.
      if (!igId) throw error
      data = await list(igId)
    }
    const conversation = (data?.data || [])[0]
    if (!conversation) return { messages: [], ownIds }
    let messages = conversation.messages?.data
    if (!Array.isArray(messages) && conversation.id) {
      const detail = await read(`${GRAPH}/${conversation.id}?fields=${encodeURIComponent(CONVERSATION_FIELDS)}&access_token=${token}`)
      messages = detail?.messages?.data
    }
    const parsed: GraphConversationMessage[] = (Array.isArray(messages) ? messages : [])
      .filter((m: any) => typeof m?.id === 'string' && m.id)
      .map((m: any) => ({
        id: m.id as string,
        text: typeof m.message === 'string' ? m.message : '',
        fromId: m.from?.id ? String(m.from.id) : null,
        createdAt: graphTime(m.created_time),
      }))
      // Meta li da' dal piu' recente: si salvano in ordine.
      .sort((a, b) => Date.parse(a.createdAt || '') - Date.parse(b.createdAt || ''))
    return { messages: parsed, ownIds }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Pagina Facebook: le eco dei messaggi scritti a mano (app Messenger, Meta Business Suite)
 * arrivano solo con il campo "message_echoes". Lo aggiunge ai campi gia' attivi della
 * nostra app sulla Pagina, senza toglierne nessuno. Serve il permesso pages_manage_metadata.
 * Instagram manda le eco dentro "messages": li' non serve niente.
 */
export async function ensureMessageEchoes(): Promise<'ok' | 'added' | 'skipped' | { error: string }> {
  try {
    const page = await withTimeout(getPageToken(), 5000)
    if (!page) return 'skipped'
    const token = encodeURIComponent(page.token)
    const [appRes, subsRes] = await Promise.all([
      fetch(`${GRAPH}/app?fields=id&access_token=${token}`, { signal: AbortSignal.timeout(5000) }),
      fetch(`${GRAPH}/${page.pageId}/subscribed_apps?access_token=${token}`, { signal: AbortSignal.timeout(5000) }),
    ])
    const app = await appRes.json().catch(() => ({}))
    const subs = await subsRes.json().catch(() => ({}))
    if (!appRes.ok || !subsRes.ok) return { error: subs?.error?.message || app?.error?.message || `HTTP ${appRes.ok ? subsRes.status : appRes.status}` }
    const ours = (subs?.data || []).find((a: any) => String(a?.id) === String(app?.id))
    // La nostra app non e' iscritta alla Pagina: si configura dalla dashboard Meta, non qui.
    if (!ours) return 'skipped'
    const fields: string[] = Array.isArray(ours.subscribed_fields) ? ours.subscribed_fields.map(String) : []
    if (fields.includes('message_echoes')) return 'ok'
    const res = await post(`${GRAPH}/${page.pageId}/subscribed_apps`, page.token, {
      subscribed_fields: [...fields, 'message_echoes'].join(','),
    })
    return res.error ? { error: res.error } : 'added'
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/** Id della Pagina e dell'Instagram di Facevoice: gli altri account nei webhook sono dei clienti del SaaS. */
export async function facevoiceAccountIds(): Promise<Set<string> | null> {
  const page = await getPageToken()
  if (!page) return null
  const ids = new Set([page.pageId])
  const ig = await getInstagramUserId(page).catch(() => null)
  if (ig) ids.add(ig)
  return ids
}
