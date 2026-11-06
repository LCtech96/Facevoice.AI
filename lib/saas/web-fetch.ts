import http, { type IncomingMessage } from 'node:http'
import https from 'node:https'
import { lookup as dnsLookup } from 'node:dns'
import { isIP, type LookupFunction } from 'node:net'
import zlib from 'node:zlib'
import type { Readable } from 'node:stream'

// Lettura di pagine e immagini da indirizzi trovati sul web (ricerca eventi): mai verso
// la rete interna. Prima di collegarsi si controlla l'indirizzo (solo http/https, porte
// standard, niente indirizzi IP scritti a mano, niente localhost o nomi interni), si
// risolve il nome e si scartano gli indirizzi privati, di loopback, link-local e simili;
// lo stesso controllo si rifa' sull'indirizzo usato davvero per la connessione (niente
// "DNS rebinding") e a ogni rimando (al massimo 3). Tempo massimo e peso massimo per ogni
// lettura, anche dopo la decompressione.

export type RawRequest = { url: URL; method: 'GET' | 'HEAD'; headers: Record<string, string>; maxBytes: number; timeoutMs: number }
export type RawResponse = { status: number; headers: Record<string, string>; body: Buffer }
/** Come si legge davvero dalla rete: sostituibile nelle prove (niente rete vera). */
export type WebTransport = {
  request: (req: RawRequest) => Promise<RawResponse>
  /** Indirizzi IP di un nome (tutti). */
  resolve: (host: string) => Promise<string[]>
}

export type WebResponse = { url: string; status: number; contentType: string; headers: Record<string, string>; body: Buffer }

export class WebFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebFetchError'
  }
}

// --- Indirizzi vietati --------------------------------------------------------------

function ipv4Blocked(address: string): boolean {
  const p = address.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b, c] = p
  return (
    a === 0 || // "questa rete"
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local (metadati del cloud)
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224 // multicast, riservati, broadcast
  )
}

/** Gli 8 gruppi di un indirizzo IPv6 (anche con "::" e con l'IPv4 in fondo), o null. */
function ipv6Groups(address: string): number[] | null {
  let a = address.toLowerCase().split('%')[0]
  const v4 = a.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (v4) {
    const p = v4[1].split('.').map(Number)
    if (p.some((n) => n > 255)) return null
    a = `${a.slice(0, -v4[1].length)}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`
  }
  const halves = a.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0
  const all = [...head, ...new Array(Math.max(0, fill)).fill('0'), ...tail]
  if (all.length !== 8 || all.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null
  return all.map((g) => parseInt(g, 16))
}

function ipv6Blocked(address: string): boolean {
  const g = ipv6Groups(address)
  if (!g) return true
  const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
  if (g.every((x) => x === 0)) return true // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true // ::1
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return ipv4Blocked(v4(g[6], g[7])) // ::ffff:a.b.c.d e ::a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b) return ipv4Blocked(v4(g[6], g[7])) // NAT64
  if (g[0] === 0x2002) return ipv4Blocked(v4(g[1], g[2])) // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true // fc00::/7 rete privata
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true // link-local, site-local
  if ((g[0] & 0xff00) === 0xff00) return true // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true // documentazione
  if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true // scarto
  return false
}

/** Indirizzo IP a cui non ci si collega mai (rete privata, loopback, link-local, riservati). */
export function isBlockedAddress(address: string): boolean {
  const kind = isIP(address)
  if (kind === 4) return ipv4Blocked(address)
  if (kind === 6) return ipv6Blocked(address)
  return true
}

const INTERNAL_NAME = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|home\.arpa|in-addr\.arpa|ip6\.arpa)$/i

/**
 * Indirizzo accettabile per una lettura dal web: http o https, porta standard, nome
 * pubblico (non un IP scritto a mano, non localhost o nomi interni), niente utente e
 * password. Restituisce l'URL normalizzato o lancia WebFetchError.
 */
export function checkWebUrl(raw: string | URL): URL {
  let url: URL
  try {
    url = raw instanceof URL ? new URL(raw.href) : new URL(String(raw).trim())
  } catch {
    throw new WebFetchError('indirizzo non valido')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new WebFetchError('solo indirizzi http o https')
  if (url.username || url.password) throw new WebFetchError('indirizzo con credenziali non ammesso')
  // L'URL toglie da solo le porte standard (80 per http, 443 per https): qualsiasi porta rimasta non lo e'.
  if (url.port) throw new WebFetchError('porta non standard')
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!host || isIP(host)) throw new WebFetchError('indirizzo IP non ammesso')
  if (!host.includes('.') || INTERNAL_NAME.test(host)) throw new WebFetchError('nome interno non ammesso')
  if (!/^[a-z0-9.-]+$/.test(host)) throw new WebFetchError('nome non valido')
  url.hash = ''
  return url
}

/** Nome senza "www." (per crediti e fonti). */
export const domainOf = (url: string | URL) => {
  try {
    return new URL(String(url)).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

// --- Rete vera (Node) -------------------------------------------------------------------

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | { address: string; family: number }[], family?: number) => void

/**
 * Risoluzione usata al momento della connessione (al posto di quella normale): se uno degli
 * indirizzi del nome e' vietato la connessione non parte. Cosi' il controllo vale per
 * l'indirizzo usato davvero, anche se il nome cambia indirizzo tra il controllo e la connessione.
 */
export function checkedLookup(hostname: string, options: { all?: boolean } | number | undefined, callback: LookupCallback) {
  const all = typeof options === 'object' && options !== null && Boolean(options.all)
  const fail = (message: string, code: string) => {
    const error = new Error(message) as NodeJS.ErrnoException
    error.code = code
    callback(error, all ? [] : '', undefined)
  }
  transport.resolve(hostname).then(
    (addresses) => {
      if (!addresses.length) return fail(`nome non trovato: ${hostname}`, 'ENOTFOUND')
      if (addresses.some(isBlockedAddress)) return fail(`indirizzo non raggiungibile: ${hostname}`, 'EBLOCKED')
      const list = addresses.map((address) => ({ address, family: isIP(address) }))
      if (all) return callback(null, list)
      callback(null, list[0].address, list[0].family)
    },
    (error) => fail(error instanceof Error ? error.message : String(error), 'ENOTFOUND')
  )
}

/**
 * Corpo della risposta, decompresso (gzip, deflate, br) e con il peso massimo contato DOPO
 * la decompressione (niente "bombe" compresse): oltre il limite la lettura si interrompe.
 */
export function readLimitedBody(res: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(res.headers['content-length'])
    if (Number.isFinite(declared) && declared > maxBytes) {
      res.destroy()
      return reject(new WebFetchError('file troppo grande'))
    }
    const encoding = String(res.headers['content-encoding'] || '').toLowerCase()
    let stream: Readable = res
    if (encoding === 'gzip' || encoding === 'x-gzip') stream = res.pipe(zlib.createGunzip())
    else if (encoding === 'deflate') stream = res.pipe(zlib.createInflate())
    else if (encoding === 'br') stream = res.pipe(zlib.createBrotliDecompress())
    const parts: Buffer[] = []
    let size = 0
    let done = false
    const finish = (error: Error | null) => {
      if (done) return
      done = true
      if (error) reject(error)
      else resolve(Buffer.concat(parts))
    }
    stream.on('data', (chunk: Buffer) => {
      if (done) return
      size += chunk.length
      if (size > maxBytes) {
        res.destroy()
        if (stream !== res) stream.destroy()
        return finish(new WebFetchError('file troppo grande'))
      }
      parts.push(chunk)
    })
    stream.on('end', () => finish(null))
    stream.on('error', (e) => finish(e instanceof Error ? e : new Error(String(e))))
    res.on('error', (e) => finish(e))
    res.on('aborted', () => finish(new WebFetchError('lettura interrotta')))
  })
}

function nodeRequest(req: RawRequest): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const lib = req.url.protocol === 'https:' ? https : http
    let settled = false
    const finish = (error: Error | null, value?: RawResponse) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(value!)
    }
    const request = lib.request(req.url, { method: req.method, headers: req.headers, lookup: checkedLookup as unknown as LookupFunction, agent: false }, (res) => {
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v)
      const status = res.statusCode || 0
      if (req.method === 'HEAD' || (status >= 300 && status < 400)) {
        // Del rimando servono solo le intestazioni: si chiude subito la connessione (un corpo
        // che non finisce mai non resta a scaricare senza limiti di tempo o di peso).
        finish(null, { status, headers, body: Buffer.alloc(0) })
        res.on('error', () => {})
        res.destroy()
        request.destroy()
        return
      }
      readLimitedBody(res, req.maxBytes).then(
        (body) => finish(null, { status, headers, body }),
        (error) => {
          request.destroy()
          finish(error)
        }
      )
    })
    const timer = setTimeout(() => {
      request.destroy()
      finish(new WebFetchError('tempo scaduto'))
    }, req.timeoutMs)
    request.on('error', (e) => finish(e))
    request.end()
  })
}

const nodeTransport: WebTransport = {
  request: nodeRequest,
  resolve: (host) =>
    new Promise((resolve) => dnsLookup(host, { all: true }, (err, list) => resolve(err ? [] : (list as { address: string }[]).map((a) => a.address)))),
}

let transport: WebTransport = nodeTransport

/**
 * Solo per le prove: sostituisce la lettura e/o la risoluzione dei nomi con quelle finte
 * (niente rete vera); senza argomenti tornano quelle vere.
 */
export function setWebTransport(fake?: Partial<WebTransport>) {
  transport = { ...nodeTransport, ...(fake || {}) }
}

export const WEB_USER_AGENT = 'Mozilla/5.0 (compatible; FacevoiceAI/1.0; +https://www.facevoice.ai)'

/**
 * Lettura sicura di un indirizzo del web (GET o HEAD). Rimandi seguiti a mano, ognuno
 * ricontrollato (al massimo maxRedirects); tempo massimo per tutta la lettura; peso massimo.
 */
export async function safeWebGet(
  raw: string,
  options: { maxBytes: number; timeoutMs: number; accept?: string; method?: 'GET' | 'HEAD'; maxRedirects?: number; headers?: Record<string, string> }
): Promise<WebResponse> {
  const deadline = Date.now() + options.timeoutMs
  const maxRedirects = options.maxRedirects ?? 3
  let url = checkWebUrl(raw)
  for (let hop = 0; ; hop++) {
    const addresses = await transport.resolve(url.hostname)
    if (!addresses.length) throw new WebFetchError(`nome non trovato: ${url.hostname}`)
    if (addresses.some(isBlockedAddress)) throw new WebFetchError(`indirizzo non raggiungibile: ${url.hostname}`)
    const left = deadline - Date.now()
    if (left <= 0) throw new WebFetchError('tempo scaduto')
    const res = await transport.request({
      url,
      method: options.method || 'GET',
      headers: {
        'User-Agent': WEB_USER_AGENT,
        Accept: options.accept || '*/*',
        'Accept-Language': 'it-IT,it;q=0.9,en;q=0.6',
        'Accept-Encoding': 'gzip, deflate, br',
        ...(options.headers || {}),
      },
      maxBytes: options.maxBytes,
      timeoutMs: left,
    })
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.location
      if (!location) throw new WebFetchError('rimando senza indirizzo')
      if (hop >= maxRedirects) throw new WebFetchError('troppi rimandi')
      url = checkWebUrl(new URL(location, url))
      continue
    }
    return { url: url.href, status: res.status, contentType: (res.headers['content-type'] || '').split(';')[0].trim().toLowerCase(), headers: res.headers, body: res.body }
  }
}
