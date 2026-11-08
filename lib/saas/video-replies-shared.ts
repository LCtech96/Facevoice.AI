// Video risposte: costanti e tipi usati anche nelle pagine (niente codice del server qui).

export type VideoReplyChannel = 'instagram' | 'facebook'
export const VIDEO_REPLY_CHANNELS: VideoReplyChannel[] = ['instagram', 'facebook']
export const VIDEO_REPLY_CHANNEL_LABELS: Record<VideoReplyChannel, string> = { instagram: 'Instagram', facebook: 'Messenger' }

/**
 * Peso massimo di un video allegato a un messaggio diretto, per canale (byte). Meta dice 25 MB
 * per Messenger e per i Direct di Instagram: si tiene 25 milioni di byte (un po' sotto i 25 MiB).
 * Oltre, il video parte come link alla pagina del video (sempre funziona).
 * WhatsApp (16 MB) qui non c'e': nel beta i messaggi WhatsApp non partono ancora.
 */
export const DM_VIDEO_LIMIT_BYTES: Record<VideoReplyChannel, number> = { instagram: 25_000_000, facebook: 25_000_000 }

export const MAX_VIDEO_REPLIES = 30
export const MAX_VIDEO_TITLE = 80
export const MAX_VIDEO_TRIGGER = 400
export const MAX_VIDEO_MESSAGE = 600

/** Video risposta come la vede la pagina (senza il codice segreto del link, solo l'indirizzo pronto). */
export type VideoReplyView = {
  id: string
  title: string
  trigger: string
  message: string
  url: string
  size: number
  channels: VideoReplyChannel[]
  active: boolean
  oncePerPerson: boolean
  createdAt: string
  updatedAt: string
  /** Pagina pubblica del video (per i file troppo pesanti per l'allegato). */
  watchUrl: string
}

const mb = (bytes: number) => `${Math.round((bytes / 1_000_000) * 10) / 10} MB`

/** Canali in cui il video e' troppo pesante per partire come allegato. */
export const oversizeChannels = (size: number, channels: VideoReplyChannel[]): VideoReplyChannel[] =>
  size > 0 ? channels.filter((c) => size > DM_VIDEO_LIMIT_BYTES[c]) : []

/** Avviso per chi carica: il video parte come link invece che come allegato (null se va bene). */
export function sizeWarning(size: number, channels: VideoReplyChannel[]): string | null {
  const over = oversizeChannels(size, channels)
  if (!over.length) return null
  const limit = Math.min(...over.map((c) => DM_VIDEO_LIMIT_BYTES[c]))
  return `Il video pesa ${mb(size)}: su ${over.map((c) => VIDEO_REPLY_CHANNEL_LABELS[c]).join(' e ')} gli allegati arrivano al massimo a ${mb(limit)}, quindi partirà come link alla pagina del video. Per mandarlo come video, caricane uno più leggero.`
}

export const formatSize = mb
