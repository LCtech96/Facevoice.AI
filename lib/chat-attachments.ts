export type ChatAttachment = {
  mimeType: string
  data: string
}

/**
 * Lato più lungo a cui ridurre le immagini.
 *
 * Oltre questa misura il modello ridimensiona comunque l'immagine prima
 * di analizzarla: mandare più pixel non aggiunge dettaglio, costa solo
 * banda e token.
 */
const MAX_EDGE = 1568

/**
 * Tetto per singolo allegato, sui byte codificati.
 *
 * La richiesta viaggia come JSON con le immagini in base64, che gonfia
 * i dati di circa un terzo. Il limite di dimensione della richiesta su
 * Vercel è 4,5 MB: superarlo produce un 413 prima che la route venga
 * eseguita, quindi non è un errore che si possa gestire lato server.
 */
const MAX_ATTACHMENT_BYTES = 900 * 1024

/** Tetto complessivo, per lasciare spazio a testo e storico. */
export const MAX_TOTAL_ATTACHMENT_BYTES = 3 * 1024 * 1024

/** Tipi che l'API accetta: gli altri vengono convertiti in JPEG. */
const PASSTHROUGH_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      const base64 = result.includes(',') ? result.split(',')[1] : result
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Immagine non leggibile'))
    }
    image.src = url
  })
}

/**
 * Riduce e ricomprime l'immagine finché non rientra nel tetto.
 *
 * La qualità scende a gradini invece che con un valore fisso: una foto
 * e uno screenshot si comprimono in modo molto diverso, e un valore
 * unico o rovina la prima o non basta al secondo.
 */
async function compressImage(file: File): Promise<ChatAttachment> {
  const image = await loadImage(file)

  const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height))
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Impossibile elaborare l’immagine in questo browser')
  }

  // Sfondo bianco: il JPEG non ha trasparenza, e senza questo le aree
  // trasparenti di un PNG diventerebbero nere.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(image, 0, 0, width, height)

  for (const quality of [0.85, 0.7, 0.55, 0.4]) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    const data = dataUrl.split(',')[1] ?? ''
    if (data.length <= MAX_ATTACHMENT_BYTES) {
      return { mimeType: 'image/jpeg', data }
    }
  }

  // Ultima spiaggia: dimezza il lato e riprova una volta sola.
  const smaller = document.createElement('canvas')
  smaller.width = Math.max(1, Math.round(width / 2))
  smaller.height = Math.max(1, Math.round(height / 2))
  const smallerContext = smaller.getContext('2d')
  if (smallerContext) {
    smallerContext.fillStyle = '#ffffff'
    smallerContext.fillRect(0, 0, smaller.width, smaller.height)
    smallerContext.drawImage(image, 0, 0, smaller.width, smaller.height)
    const dataUrl = smaller.toDataURL('image/jpeg', 0.6)
    return { mimeType: 'image/jpeg', data: dataUrl.split(',')[1] ?? '' }
  }

  throw new Error('Immagine troppo grande da elaborare')
}

export async function fileToAttachment(file: File): Promise<ChatAttachment> {
  const isSupported = PASSTHROUGH_TYPES.includes(file.type)

  // Le immagini già piccole e di tipo supportato passano intatte: non
  // ha senso ricomprimere (e degradare) uno screenshot da 200 KB.
  if (isSupported && file.size <= MAX_ATTACHMENT_BYTES * 0.75) {
    return {
      mimeType: file.type,
      data: await fileToBase64(file),
    }
  }

  return compressImage(file)
}

export async function filesToAttachments(
  files: Array<{ file: File; type: string }>
): Promise<ChatAttachment[]> {
  const attachments: ChatAttachment[] = []

  for (const item of files) {
    if (!item.file.type.startsWith('image/')) continue
    attachments.push(await fileToAttachment(item.file))
  }

  return attachments
}

export function attachmentsSize(attachments: ChatAttachment[]): number {
  return attachments.reduce((total, item) => total + item.data.length, 0)
}

export function dataUrlToAttachment(dataUrl: string, mimeType = 'image/png'): ChatAttachment {
  return {
    mimeType,
    data: dataUrl.replace(/^data:[^;]+;base64,/, ''),
  }
}
