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

/** Nome visibile del contatto Messenger/Instagram, se Meta lo concede. */
export async function fetchContactName(
  platform: 'facebook' | 'instagram',
  contactId: string
): Promise<string | null> {
  const page = await getPageToken()
  if (!page) return null
  const fields = platform === 'instagram' ? 'name,username' : 'name'
  try {
    const response = await fetch(
      `${GRAPH}/${contactId}?fields=${fields}&access_token=${encodeURIComponent(page.token)}`
    )
    if (!response.ok) return null
    const data = await response.json()
    return data?.name || (data?.username ? `@${data.username}` : null)
  } catch {
    return null
  }
}
