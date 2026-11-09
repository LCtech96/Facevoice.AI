// Immagini, video e PDF su WhatsApp: limiti di Meta, controlli e formato del messaggio
// salvato in casella. Funzioni pure, usate dal server e dalle pagine (niente database).

export const WA_MEDIA_BUCKET = 'wa-media'

export type WaMediaKind = 'image' | 'video' | 'document'

const MB = 1024 * 1024

/** Limiti di WhatsApp Cloud API per i file inviati con un link. */
export const WA_MEDIA_LIMITS: Record<WaMediaKind, { label: string; types: Record<string, string>; maxBytes: number; hint: string }> = {
  image: { label: 'immagine', types: { 'image/jpeg': 'jpg', 'image/png': 'png' }, maxBytes: 5 * MB, hint: 'JPG o PNG, massimo 5 MB' },
  video: { label: 'video', types: { 'video/mp4': 'mp4' }, maxBytes: 16 * MB, hint: 'MP4 (H.264 e audio AAC), massimo 16 MB' },
  document: { label: 'documento', types: { 'application/pdf': 'pdf' }, maxBytes: 100 * MB, hint: 'PDF, massimo 100 MB' },
}

export const WA_MEDIA_MIME_TYPES = Object.values(WA_MEDIA_LIMITS).flatMap((l) => Object.keys(l.types))

const EXT_TYPE: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', mp4: 'video/mp4', pdf: 'application/pdf' }

/** Tipo del file dal nome (per i browser che non lo danno). */
export function mimeFromName(name: string): string {
  const ext = name.toLowerCase().split('?')[0].split('.').pop() || ''
  return EXT_TYPE[ext] || ''
}

export function kindOfMime(type: string): WaMediaKind | null {
  for (const [kind, l] of Object.entries(WA_MEDIA_LIMITS)) if (l.types[type]) return kind as WaMediaKind
  return null
}

/** Intestazione del modello (IMAGE, VIDEO, DOCUMENT) -> tipo di file, o null se non e' un file. */
export function mediaKindOfHeader(headerFormat: string | null | undefined): WaMediaKind | null {
  const f = String(headerFormat || '').toUpperCase()
  return f === 'IMAGE' ? 'image' : f === 'VIDEO' ? 'video' : f === 'DOCUMENT' ? 'document' : null
}

const mb = (n: number) => `${Math.round((n / MB) * 10) / 10} MB`

export type MediaCheck = { ok: true; kind: WaMediaKind; contentType: string; ext: string } | { ok: false; error: string }

/**
 * Tipo e peso del file (dal browser, prima del caricamento, e di nuovo sul server).
 * allowed: i tipi accettati in quel punto (es. solo video per un modello con video).
 */
export function validateWaMedia(input: { fileName?: unknown; type?: unknown; size?: unknown }, allowed: WaMediaKind[]): MediaCheck {
  const name = String(input.fileName || '')
  const rawType = String(input.type || '').toLowerCase()
  const size = Number(input.size)
  const contentType = kindOfMime(rawType) ? rawType : !rawType || rawType === 'application/octet-stream' ? mimeFromName(name) : ''
  const kind = contentType ? kindOfMime(contentType) : null
  const accepted = allowed.map((k) => WA_MEDIA_LIMITS[k].hint).join('; ')
  if (!kind || !allowed.includes(kind)) return { ok: false, error: `Formato non supportato: ${accepted}.` }
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: 'Il file è vuoto.' }
  const max = WA_MEDIA_LIMITS[kind].maxBytes
  if (size > max) return { ok: false, error: `Il file pesa ${mb(size)}: per un${kind === 'image' ? "'" : ' '}${WA_MEDIA_LIMITS[kind].label} WhatsApp accetta al massimo ${mb(max)}.` }
  return { ok: true, kind, contentType, ext: WA_MEDIA_LIMITS[kind].types[contentType] }
}

/**
 * Link del file di intestazione di una campagna: https e, se dal nome si capisce
 * il tipo, dello stesso tipo dell'intestazione. Motivo se non va, null se va bene.
 */
export function mediaLinkProblem(headerFormat: string | null | undefined, link: string | null | undefined): string | null {
  const kind = mediaKindOfHeader(headerFormat)
  if (!kind) return null
  const url = String(link || '').trim()
  if (!/^https:\/\/\S+$/.test(url)) return `scegli il file dell'intestazione (${WA_MEDIA_LIMITS[kind].label})`
  const byName = kindOfMime(mimeFromName(url))
  if (byName && byName !== kind) return `il file scelto è un${byName === 'image' ? "'" : ' '}${WA_MEDIA_LIMITS[byName].label}, ma il modello vuole un${kind === 'image' ? "'" : ' '}${WA_MEDIA_LIMITS[kind].label}`
  return null
}

/** Parametro dell'intestazione per POST /messages (type template). */
export function mediaHeaderParameter(kind: WaMediaKind, link: string): Record<string, unknown> {
  const media: Record<string, string> = { link }
  if (kind === 'document') {
    const file = decodeURIComponent(link.split('?')[0].split('/').pop() || '') || 'documento.pdf'
    media.filename = file.replace(/^\d{8,}-[a-z0-9]+-/i, '')
  }
  return { type: kind, [kind]: media }
}

// ---------------------------------------------------------------------
// Messaggio con file salvato in casella (social_messages.body)
// ---------------------------------------------------------------------

const TAG: Record<WaMediaKind, string> = { image: 'immagine', video: 'video', document: 'documento' }
const TAG_KIND: Record<string, WaMediaKind> = { immagine: 'image', video: 'video', documento: 'document' }

/** "[immagine](https://...)" + didascalia sotto: leggibile anche dall'AI e nelle anteprime. */
export function mediaBody(kind: WaMediaKind, url: string | null, caption?: string | null): string {
  const head = url ? `[${TAG[kind]}](${url})` : `[${TAG[kind]}]`
  const text = (caption || '').trim()
  return text ? `${head}\n${text}` : head
}

export function parseMediaBody(body: string | null | undefined): { kind: WaMediaKind; url: string | null; caption: string } | null {
  const m = /^\[(immagine|video|documento)\](?:\((https:\/\/[^\s)]+)\))?(?:\n([\s\S]*))?$/.exec(String(body || ''))
  if (!m) return null
  return { kind: TAG_KIND[m[1]], url: m[2] || null, caption: (m[3] || '').trim() }
}

/** Anteprima nell'elenco delle conversazioni: senza il link. */
export function mediaPreviewText(body: string): string {
  const p = parseMediaBody(body)
  if (!p) return body
  return p.caption ? `[${TAG[p.kind]}] ${p.caption}` : `[${TAG[p.kind]}]`
}

// ---------------------------------------------------------------------
// Finestra di 24 ore (messaggi liberi, non modelli)
// ---------------------------------------------------------------------

export const SERVICE_WINDOW_MS = 24 * 3600_000

/** Si puo' mandare un messaggio libero (testo, foto, video)? Solo entro 24 ore dall'ultimo messaggio della persona. */
export function serviceWindow(lastInboundAt: string | null | undefined, now = Date.now()): { open: true; closesAt: string } | { open: false; reason: string } {
  const at = lastInboundAt ? Date.parse(lastInboundAt) : NaN
  if (!Number.isFinite(at)) return { open: false, reason: 'Questa persona non ci ha mai scritto su WhatsApp: si può usare solo un modello approvato (Campagne WhatsApp).' }
  if (now - at > SERVICE_WINDOW_MS) {
    return { open: false, reason: 'Sono passate più di 24 ore dal suo ultimo messaggio: WhatsApp non permette di mandare foto o video liberi. Aspetta che ti riscriva o usa un modello approvato (Campagne WhatsApp).' }
  }
  return { open: true, closesAt: new Date(at + SERVICE_WINDOW_MS).toISOString() }
}
