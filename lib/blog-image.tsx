import { ImageResponse } from 'next/og'
import sharp from 'sharp'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { generateGeminiImage, getGeminiApiKey } from '@/lib/gemini'

// Copertina degli articoli del blog (serve anche per Instagram, che accetta solo
// post con immagine, in JPEG). Prima si prova con l'AI (Gemini); se non riesce
// (limiti del piano, errori) si crea una copertina grafica con il titolo e il
// marchio, cosi' un'immagine c'e' sempre.

const SIZE = 1080
const BUCKET = 'blog-images'

const IMAGE_PROMPT = (title: string, summary: string) =>
  `Editorial cover illustration for a business blog article about artificial intelligence news.
Article title (Italian): "${title}"
Topic summary: ${summary.slice(0, 600)}
Style: modern, clean, premium tech-magazine illustration, warm orange and deep dark tones, soft light, subtle depth. Square format.
Absolutely no text, no letters, no words, no logos, no watermarks, no real people's faces, no brand logos.`

/** Copertina grafica di riserva: titolo grande su fondo scuro con il marchio. */
export async function brandedCover(title: string): Promise<Buffer> {
  const fontSize = title.length > 70 ? 60 : title.length > 45 ? 70 : 82
  const res = new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 80,
          background: 'linear-gradient(135deg, #1a0a04 0%, #3a1406 55%, #ff6a1a 140%)',
          color: '#fff',
        }}
      >
        <div style={{ display: 'flex', fontSize: 34, color: '#ff8a3d', letterSpacing: 2 }}>NOVITÀ SULL’INTELLIGENZA ARTIFICIALE</div>
        <div style={{ display: 'flex', fontSize, lineHeight: 1.12, fontWeight: 700 }}>{title}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 34 }}>
          <span>Facevoice AI</span>
          <span style={{ color: '#ffb27a' }}>facevoice.ai/blog</span>
        </div>
      </div>
    ),
    { width: SIZE, height: SIZE }
  )
  return Buffer.from(await res.arrayBuffer())
}

/** Immagine generata dall'AI, oppure null se non riesce. */
async function aiCover(title: string, summary: string): Promise<Buffer | null> {
  if (!getGeminiApiKey()) return null
  try {
    const { imageUrl } = await generateGeminiImage(IMAGE_PROMPT(title, summary))
    const base64 = imageUrl.replace(/^data:[^;]+;base64,/, '')
    return base64 ? Buffer.from(base64, 'base64') : null
  } catch (error) {
    console.warn('blog image: AI non riuscita, uso la copertina grafica:', error instanceof Error ? error.message : error)
    return null
  }
}

/** JPEG quadrato 1080×1080 (formato accettato da Instagram) da qualsiasi immagine. */
export const toJpeg = (input: Buffer) =>
  sharp(input).rotate().resize(SIZE, SIZE, { fit: 'cover', position: 'attention' }).flatten({ background: '#1a0a04' }).jpeg({ quality: 86 }).toBuffer()

async function upload(jpeg: Buffer): Promise<string> {
  const path = `auto/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, jpeg, { contentType: 'image/jpeg', upsert: false })
  if (error) throw new Error(`caricamento immagine non riuscito: ${error.message}`)
  return supabaseAdmin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

/** Crea e carica la copertina; restituisce l'indirizzo pubblico e com'e' stata fatta. */
export async function createCover(title: string, summary: string): Promise<{ url: string; source: 'ai' | 'grafica' }> {
  const ai = await aiCover(title, summary)
  const source = ai ? 'ai' : 'grafica'
  const jpeg = await toJpeg(ai ?? (await brandedCover(title)))
  return { url: await upload(jpeg), source }
}

/** Copia JPEG di un'immagine gia' online (es. caricata a mano in PNG o WebP), per Instagram. */
export async function jpegCopyOf(imageUrl: string): Promise<string> {
  const res = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`immagine non leggibile (${res.status})`)
  return upload(await toJpeg(Buffer.from(await res.arrayBuffer())))
}
