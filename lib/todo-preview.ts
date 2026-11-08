import { lookup as dnsLookup } from 'dns/promises'
import http from 'http'
import https from 'https'
import { BlockList, isIP } from 'net'
import type { TodoLinkPreview } from '@/lib/todo-shared'

// Anteprima dei link della todo list (titolo, descrizione, immagine dai tag
// OpenGraph). La pagina la scarica il server, quindi con tutte le difese contro
// l'uso del server per raggiungere indirizzi interni: solo http/https sulle porte
// standard, niente credenziali nell'indirizzo, ogni nome risolto e controllato
// (nessun IP privato, locale o riservato), connessione fatta proprio all'IP
// controllato, redirect seguiti a mano e ricontrollati, tempo e dimensione limitati.

// Due elenchi separati: in uno solo, gli intervalli IPv6 come ::ffff:0:0/96 coprirebbero anche tutti gli IPv4.
const BLOCKED_V4 = new BlockList()
const BLOCKED_V6 = new BlockList()
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) BLOCKED_V4.addSubnet(net, prefix, 'ipv4')
for (const [net, prefix] of [
  ['::', 96], // non specificato, loopback, IPv4 "compatibili"
  ['::ffff:0:0', 96], // IPv4 dentro IPv6
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) BLOCKED_V6.addSubnet(net, prefix, 'ipv6')

/** IP privato, locale, riservato o non valido: non si contatta. */
export function isBlockedIp(ip: string): boolean {
  const clean = ip.replace(/^\[|\]$/g, '').split('%')[0]
  const v = isIP(clean)
  if (!v) return true
  return v === 4 ? BLOCKED_V4.check(clean, 'ipv4') : BLOCKED_V6.check(clean, 'ipv6')
}

/** Indirizzo accettabile in partenza (prima della risoluzione del nome). */
export function checkUrl(raw: string): URL | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null
  if (u.port && !['80', '443'].includes(u.port)) return null
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '')
  if (!host) return null
  if (isIP(host)) return isBlockedIp(host) ? null : u
  if (!host.includes('.') || /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain|home\.arpa)$/.test(host)) return null
  return u
}

export type Resolved = { address: string; family: 4 | 6 }
export type Resolver = (hostname: string) => Promise<Resolved>

/** Risolve il nome e accetta solo se TUTTI gli indirizzi sono pubblici. */
export const resolvePublic: Resolver = async (hostname) => {
  const host = hostname.replace(/^\[|\]$/g, '')
  const v = isIP(host)
  if (v) {
    if (isBlockedIp(host)) throw new Error('indirizzo non pubblico')
    return { address: host, family: v as 4 | 6 }
  }
  const addrs = await Promise.race([
    dnsLookup(host, { all: true, verbatim: true }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('dns lento')), 3000)),
  ])
  if (!addrs.length || addrs.some((a) => isBlockedIp(a.address))) throw new Error('indirizzo non pubblico')
  return { address: addrs[0].address, family: addrs[0].family === 6 ? 6 : 4 }
}

export type RawResponse = { status: number; location?: string; contentType?: string; body?: string }
export type Requester = (url: URL, pinned: Resolved, opts: { timeoutMs: number; maxBytes: number }) => Promise<RawResponse>

const USER_AGENT = 'Mozilla/5.0 (compatible; FacevoiceAI-Anteprima/1.0; +https://www.facevoice.ai)'

/** Una richiesta GET collegata proprio all'IP gia' controllato (niente seconda risoluzione del nome). */
export const requestPinned: Requester = (url, pinned, { timeoutMs, maxBytes }) =>
  new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http
    let settled = false
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    const req = mod.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1', 'Accept-Language': 'it,en;q=0.8' },
        // Sempre e solo l'IP controllato.
        lookup: ((_host: string, options: { all?: boolean } | number | undefined, cb: (...args: unknown[]) => void) => {
          if (typeof options === 'object' && options?.all) cb(null, [{ address: pinned.address, family: pinned.family }])
          else cb(null, pinned.address, pinned.family)
        }) as never,
      },
      (res) => {
        const status = res.statusCode || 0
        const contentType = String(res.headers['content-type'] || '')
        if (status >= 300 && status < 400) {
          res.resume()
          done(() => resolve({ status, location: typeof res.headers.location === 'string' ? res.headers.location : undefined }))
          return
        }
        if (status !== 200 || !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
          res.destroy()
          done(() => resolve({ status, contentType }))
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        const finish = () => {
          const buf = Buffer.concat(chunks).subarray(0, maxBytes)
          const charset = /charset=["']?([\w-]+)/i.exec(contentType)?.[1]
          let body: string
          try {
            body = new TextDecoder(charset || 'utf-8').decode(buf)
          } catch {
            body = new TextDecoder('utf-8').decode(buf)
          }
          done(() => resolve({ status, contentType, body }))
        }
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
          size += chunk.length
          // L'intestazione della pagina sta all'inizio: oltre il limite si smette di leggere.
          if (size >= maxBytes) {
            finish()
            res.destroy()
          }
        })
        res.on('end', finish)
        res.on('error', (e) => done(() => reject(e)))
      }
    )
    const timer = setTimeout(() => {
      req.destroy(new Error('tempo scaduto'))
    }, timeoutMs)
    req.on('error', (e) => done(() => reject(e)))
    req.end()
  })

export type SafeFetchOptions = { maxRedirects?: number; timeoutMs?: number; maxBytes?: number; resolver?: Resolver; requester?: Requester }

/** Scarica l'HTML di una pagina pubblica con tutte le difese; null se non si puo'. */
export async function safeFetchHtml(raw: string, options: SafeFetchOptions = {}): Promise<{ url: string; html: string } | null> {
  const { maxRedirects = 3, timeoutMs = 6000, maxBytes = 512_000, resolver = resolvePublic, requester = requestPinned } = options
  const deadline = Date.now() + timeoutMs
  let current = checkUrl(raw)
  for (let hop = 0; current && hop <= maxRedirects; hop++) {
    const left = deadline - Date.now()
    if (left <= 0) return null
    let pinned: Resolved
    try {
      pinned = await resolver(current.hostname)
    } catch {
      return null
    }
    if (isBlockedIp(pinned.address)) return null
    let res: RawResponse
    try {
      res = await requester(current, pinned, { timeoutMs: left, maxBytes })
    } catch {
      return null
    }
    if (res.status >= 300 && res.status < 400) {
      if (!res.location) return null
      let next: string
      try {
        next = new URL(res.location, current).href
      } catch {
        return null
      }
      current = checkUrl(next)
      continue
    }
    if (res.status !== 200 || typeof res.body !== 'string') return null
    return { url: current.href, html: res.body.slice(0, maxBytes) }
  }
  return null
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

const clean = (s: string | undefined, max: number) => (s ? decodeEntities(s).replace(/\s+/g, ' ').trim().slice(0, max) : undefined) || undefined

/** Titolo, descrizione, immagine e sito dai tag della pagina. */
export function parsePreview(html: string, pageUrl: string): Omit<TodoLinkPreview, 'url'> {
  const head = html.slice(0, 300_000)
  const metas = new Map<string, string>()
  for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
    const key = /\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase()
    const content = /\bcontent\s*=\s*"([^"]*)"/i.exec(tag)?.[1] ?? /\bcontent\s*=\s*'([^']*)'/i.exec(tag)?.[1]
    if (key && content !== undefined && !metas.has(key)) metas.set(key, content)
  }
  const pick = (...keys: string[]) => keys.map((k) => metas.get(k)).find((v) => v && v.trim())
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1]
  let image = pick('og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src')
  if (image) {
    try {
      const u = new URL(decodeEntities(image.trim()), pageUrl)
      // Solo immagini https: su una pagina https quelle http non si vedrebbero.
      image = u.protocol === 'https:' && u.href.length <= 1000 ? u.href : undefined
    } catch {
      image = undefined
    }
  }
  let site = pick('og:site_name', 'application-name')
  if (!site) {
    try {
      site = new URL(pageUrl).hostname.replace(/^www\./, '')
    } catch {}
  }
  return {
    title: clean(pick('og:title', 'twitter:title') || titleTag, 200),
    description: clean(pick('og:description', 'twitter:description', 'description'), 300),
    image,
    site: clean(site, 80),
  }
}

/** Anteprima di un link; se la pagina non si legge resta solo il link. */
export async function fetchLinkPreview(url: string, options: SafeFetchOptions = {}): Promise<TodoLinkPreview> {
  const page = await safeFetchHtml(url, options).catch(() => null)
  if (!page) return { url }
  const info = parsePreview(page.html, page.url)
  const out: TodoLinkPreview = { url }
  if (info.title) out.title = info.title
  if (info.description) out.description = info.description
  if (info.image) out.image = info.image
  if (info.site) out.site = info.site
  return out
}
