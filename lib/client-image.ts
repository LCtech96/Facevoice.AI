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
  if (!file.type.startsWith('image/')) throw new Error('Non è un’immagine')
  const img = await loadImage(file)
  let data = draw(img, 1600, 0.85)
  // Screenshot molto lunghi o foto pesanti: si scende finche' non sta sotto ~1 MB.
  for (const [max, q] of [[1400, 0.75], [1200, 0.7], [1000, 0.65]] as const) {
    if (data.length <= 1_300_000) break
    data = draw(img, max, q)
  }
  return { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, data, thumb: draw(img, 240, 0.7) }
}

/** Foto pronta da caricare: JPEG con lato lungo max `max` px, anteprima piccola e misure. */
export type UploadPhoto = { id: string; blob: Blob; thumb: string; width: number; height: number; name: string }

const isHeic = (file: Blob & { name?: string }) => /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name || '')

function toBlob(img: HTMLImageElement, max: number, quality: number): Promise<{ blob: Blob; width: number; height: number }> {
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve({ blob, width: canvas.width, height: canvas.height }) : reject(new Error('Immagine non convertita'))), 'image/jpeg', quality)
  )
}

/**
 * Riduce e converte in JPEG una foto da caricare (anche HEIC, dove il browser la sa aprire,
 * come Safari su iPhone e Mac): lato lungo max 2048 px, sotto ~3 MB.
 */
export async function prepareUploadPhoto(file: File, max = 2048): Promise<UploadPhoto> {
  if (!file.type.startsWith('image/') && !isHeic(file)) throw new Error(`${file.name}: non è un’immagine`)
  let img: HTMLImageElement
  try {
    img = await loadImage(file)
  } catch {
    throw new Error(
      isHeic(file)
        ? `${file.name}: questo browser non apre le foto HEIC. Aprile da Safari oppure esportale in JPG (su iPhone: Impostazioni › Fotocamera › Formati › Più compatibile).`
        : `${file.name}: immagine non leggibile`
    )
  }
  let out = await toBlob(img, max, 0.86)
  for (const [m, q] of [[1800, 0.8], [1600, 0.75]] as const) {
    if (out.blob.size <= 3_000_000) break
    out = await toBlob(img, m, q)
  }
  return {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    blob: out.blob,
    thumb: draw(img, 240, 0.7),
    width: out.width,
    height: out.height,
    name: file.name.replace(/\.(heic|heif|png|webp|jpe?g)$/i, '') + '.jpg',
  }
}

/** Carica un file su un indirizzo firmato dello spazio di archiviazione (stesso formato di Supabase), con la percentuale. */
export function uploadToSignedUrl(signedUrl: string, blob: Blob, name: string, onProgress?: (percent: number) => void): Promise<void> {
  const body = new FormData()
  body.append('cacheControl', '3600')
  body.append('', new File([blob], name, { type: blob.type || 'image/jpeg' }))
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', signedUrl)
    xhr.setRequestHeader('x-upsert', 'false')
    if (onProgress) xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100))
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Caricamento non riuscito (${xhr.status})`)))
    xhr.onerror = () => reject(new Error('Caricamento interrotto: controlla la connessione'))
    xhr.send(body)
  })
}
