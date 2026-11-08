// Costanti dei post video usate anche nelle pagine (niente codice del server qui).

export const VIDEO_BUCKET = 'workspace-videos'
export const VIDEO_MAX_MB = 200

/** Indirizzo di un video dell'archivio (per mostrare un lettore invece di un'immagine). */
export const looksLikeVideo = (url: unknown): boolean =>
  typeof url === 'string' && url.includes(`/storage/v1/object/public/${VIDEO_BUCKET}/`) && /\.(mp4|mov)$/i.test(url)
