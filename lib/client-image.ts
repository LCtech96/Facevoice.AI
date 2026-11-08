// Riduzione delle immagini nel browser prima dell'invio (Super chat): foto del
// telefono da 4-8 MB diventano poche centinaia di KB, piu' un'anteprima piccola.

export type PreparedImage = { id: string; data: string; thumb: string }

async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    return img
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

function draw(img: HTMLImageElement, max: number, quality: number): string {
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
  const ctx = canvas.getContext('2d')!
  // Sfondo bianco: le PNG trasparenti in JPEG non diventano nere.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', quality)
}

/** Immagine pronta da inviare: lato lungo max 1600 px (testo degli screenshot ancora leggibile). */
export async function prepareImage(file: Blob): Promise<PreparedImage> {
  if (!looksLikeImage(file)) throw new Error('Non è un’immagine')
  const img = await loadImage(file).catch(() => {
    throw new Error(isHeic(file) ? HEIC_MESSAGE : 'Immagine non leggibile')
  })
  let data = draw(img, 1600, 0.85)
  // Screenshot molto lunghi o foto pesanti: si scende finche' non sta sotto ~1 MB.
  for (const [max, q] of [[1400, 0.75], [1200, 0.7], [1000, 0.65]] as const) {
    if (data.length <= 1_300_000) break
    data = draw(img, max, q)
  }
  return { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, data, thumb: draw(img, 240, 0.7) }
}

/** Foto HEIC/HEIF (iPhone): molti browser non le aprono. */
export const isHeic = (file: File | Blob) => /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test((file as File).name || '')

/** Il file scelto e' un'immagine (anche HEIC senza tipo, come capita su Windows). */
export const looksLikeImage = (file: File | Blob) => file.type.startsWith('image/') || isHeic(file) || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test((file as File).name || '')

export const HEIC_MESSAGE = 'Foto HEIC: questo browser non la apre. Caricala da Safari (iPhone o Mac) oppure salvala in JPG.'

/**
 * Foto pronta da caricare nell'archivio: JPEG, lato lungo max `max` px (sfondo bianco per le
 * trasparenze), piu' un'anteprima piccola. Le HEIC si convertono dove il browser le sa aprire
 * (Safari); altrove errore chiaro.
 */
export async function prepareJpeg(file: File | Blob, max = 2048, quality = 0.86): Promise<{ blob: Blob; thumb: string }> {
  if (!looksLikeImage(file)) throw new Error('Non è un’immagine')
  let img: HTMLImageElement
  try {
    img = await loadImage(file)
  } catch {
    throw new Error(isHeic(file) ? HEIC_MESSAGE : 'Immagine non leggibile')
  }
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) throw new Error('Immagine non convertita')
  return { blob, thumb: draw(img, 240, 0.7) }
}
