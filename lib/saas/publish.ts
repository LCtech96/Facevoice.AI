import type { Connection } from './connections'
import { readConnectionSecret } from './connections'
import { GRAPH, type MetaSecret } from './meta'
import { IG_GRAPH, igFetch, instagramLoginToken } from './instagram'

// Pubblicazione dei post dei clienti sui loro account: Instagram (collegato con
// l'accesso di Instagram o tramite la Pagina Facebook) e Pagine Facebook.
// Le immagini sono indirizzi pubblici JPEG 4:5 (bucket workspace-media).

export const PUBLISH_PERMISSION = 'instagram_business_content_publish'

type Access = { base: string; token: string }

async function accessFor(connection: Connection): Promise<Access> {
  const igToken = await instagramLoginToken(connection)
  if (igToken) return { base: IG_GRAPH, token: igToken }
  const secret = await readConnectionSecret<MetaSecret>(connection.id)
  return { base: GRAPH, token: secret.pageToken }
}

/** Puo' pubblicare? Per l'accesso di Instagram serve il permesso di pubblicazione. */
export function canPublish(connection: Connection): boolean {
  const meta = connection.meta as { via?: string; permissions?: string[] }
  if (meta.via === 'instagram_login') return (meta.permissions || []).includes(PUBLISH_PERMISSION)
  return true
}

const post = <T,>(access: Access, path: string, body: Record<string, unknown>, step: string) =>
  igFetch<T>(
    `${access.base}${path}`,
    { method: 'POST', headers: { Authorization: `Bearer ${access.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    step
  )

/** Aspetta che Instagram abbia elaborato un contenuto (immagine o carosello). */
async function waitReady(access: Access, id: string, seconds = 90): Promise<void> {
  const until = Date.now() + seconds * 1000
  let last = ''
  while (Date.now() < until) {
    const data = await igFetch<{ status_code?: string; status?: string }>(
      `${access.base}/${id}?fields=status_code,status&access_token=${encodeURIComponent(access.token)}`,
      undefined,
      'stato del contenuto'
    ).catch(() => ({}) as { status_code?: string; status?: string })
    last = data.status_code || ''
    if (last === 'FINISHED') return
    if (last === 'ERROR' || last === 'EXPIRED') throw new Error(`Instagram non ha accettato le immagini (${last}${data.status ? `: ${data.status}` : ''})`)
    await new Promise((r) => setTimeout(r, 3000))
  }
  throw new Error(`Instagram non ha finito di elaborare le immagini in ${seconds} secondi`)
}

/** Post nel feed Instagram: una foto o un carosello (2-10 immagini). Restituisce l'id del post. */
export async function publishInstagram(connection: Connection, urls: string[], caption: string): Promise<string> {
  if (!urls.length) throw new Error('nessuna immagine da pubblicare')
  if (!canPublish(connection)) throw new Error('manca il permesso di pubblicazione: ricollega Instagram e consenti la pubblicazione dei contenuti')
  const access = await accessFor(connection)
  const igId = connection.external_id
  const images = urls.slice(0, 10)
  let creation: string
  if (images.length === 1) {
    const item = await post<{ id: string }>(access, `/${igId}/media`, { image_url: images[0], caption: caption.slice(0, 2200) }, 'immagine')
    await waitReady(access, item.id)
    creation = item.id
  } else {
    const children: string[] = []
    for (const url of images) {
      const item = await post<{ id: string }>(access, `/${igId}/media`, { image_url: url, is_carousel_item: true }, 'immagine del carosello')
      children.push(item.id)
    }
    for (const child of children) await waitReady(access, child, 60)
    const carousel = await post<{ id: string }>(access, `/${igId}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption: caption.slice(0, 2200) }, 'carosello')
    await waitReady(access, carousel.id)
    creation = carousel.id
  }
  for (let attempt = 0; ; attempt++) {
    try {
      const done = await post<{ id: string }>(access, `/${igId}/media_publish`, { creation_id: creation }, 'pubblicazione')
      return done.id
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (attempt >= 4 || !/not available|not ready|try again/i.test(message)) throw error
      await new Promise((r) => setTimeout(r, 6000))
    }
  }
}

/** Post sulla Pagina Facebook: una o piu' foto con il testo. Serve pages_manage_posts. */
export async function publishFacebook(connection: Connection, urls: string[], text: string): Promise<string> {
  if (!urls.length) throw new Error('nessuna immagine da pubblicare')
  const secret = await readConnectionSecret<MetaSecret>(connection.id)
  const access: Access = { base: GRAPH, token: secret.pageToken }
  const pageId = connection.external_id
  if (urls.length === 1) {
    const photo = await post<{ id?: string; post_id?: string }>(access, `/${pageId}/photos`, { url: urls[0], message: text.slice(0, 5000), published: true }, 'foto su Facebook')
    return photo.post_id || photo.id || 'ok'
  }
  const ids: string[] = []
  for (const url of urls.slice(0, 10)) {
    const photo = await post<{ id: string }>(access, `/${pageId}/photos`, { url, published: false }, 'foto su Facebook')
    ids.push(photo.id)
  }
  const done = await post<{ id: string }>(access, `/${pageId}/feed`, { message: text.slice(0, 5000), attached_media: ids.map((id) => ({ media_fbid: id })) }, 'post su Facebook')
  return done.id
}

// --- Video: Reel su Instagram e video sulla Pagina Facebook ---------------------
// Il video e' un indirizzo pubblico (bucket workspace-videos) che Instagram e
// Facebook scaricano da soli. Instagram lo elabora per qualche minuto: si crea il
// contenuto, si controlla lo stato (anche ai giri successivi del cron) e solo
// quando e' pronto si pubblica.

/** Crea il Reel su Instagram (da pubblicare quando e' pronto). Restituisce l'id del contenuto. */
export async function startInstagramReel(connection: Connection, videoUrl: string, caption: string): Promise<string> {
  if (!canPublish(connection)) throw new Error('manca il permesso di pubblicazione: ricollega Instagram e consenti la pubblicazione dei contenuti')
  const access = await accessFor(connection)
  const item = await post<{ id: string }>(
    access,
    `/${connection.external_id}/media`,
    { media_type: 'REELS', video_url: videoUrl, caption: caption.slice(0, 2200), share_to_feed: true },
    'reel'
  )
  if (!item?.id) throw new Error('Instagram non ha accettato il video')
  return item.id
}

/** Stato del Reel su Instagram: IN_PROGRESS, FINISHED, ERROR, EXPIRED o PUBLISHED. */
export async function instagramReelStatus(connection: Connection, id: string): Promise<{ code: string; detail: string }> {
  const access = await accessFor(connection)
  const data = await igFetch<{ status_code?: string; status?: string }>(
    `${access.base}/${id}?fields=status_code,status&access_token=${encodeURIComponent(access.token)}`,
    undefined,
    'stato del video'
  )
  return { code: data.status_code || '', detail: data.status || '' }
}

/** Pubblica il Reel gia' elaborato. Restituisce l'id del post. */
export async function finishInstagramReel(connection: Connection, id: string): Promise<string> {
  const access = await accessFor(connection)
  const done = await post<{ id: string }>(access, `/${connection.external_id}/media_publish`, { creation_id: id }, 'pubblicazione del reel')
  return done.id
}

/** Video sulla Pagina Facebook con il testo: Facebook lo scarica dall'indirizzo. Serve pages_manage_posts. */
export async function publishFacebookVideo(connection: Connection, videoUrl: string, text: string): Promise<string> {
  const secret = await readConnectionSecret<MetaSecret>(connection.id)
  const access: Access = { base: GRAPH, token: secret.pageToken }
  const video = await post<{ id?: string; post_id?: string }>(access, `/${connection.external_id}/videos`, { file_url: videoUrl, description: text.slice(0, 5000), published: true }, 'video su Facebook')
  return video.post_id || video.id || 'ok'
}
