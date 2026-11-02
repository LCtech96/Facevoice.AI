import { readFile } from 'fs/promises'
import { join } from 'path'
import { ImageResponse } from 'next/og'
import sharp from 'sharp'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { generateGeminiImage, getGeminiApiKey } from '@/lib/gemini'

// Immagini degli articoli del blog per i social: un CAROSELLO (da 3 a 6 slide,
// formato 4:5 come i caroselli Facevoice su Canva) con i colori del marchio:
// fondo blu notte, blu elettrico, testo bianco caldo. La prima slide usa una foto
// generata dall'AI se ci riesce, altrimenti solo grafica. Tutto in JPEG (l'unico
// formato accettato da Instagram).

export const BRAND = {
  night: '#050a16',
  navy: '#060f1c',
  deep: '#0b1a35',
  blue: '#2a65fe',
  blueLight: '#a9c1ff',
  ink: '#f8f8f0',
  inkSoft: 'rgba(248, 248, 240, 0.74)',
}

const W = 1080
const H = 1350
const BUCKET = 'blog-images'

export type Slide = { title: string; text: string }

const IMAGE_PROMPT = (title: string, summary: string) =>
  `Editorial photo-style cover image for a business blog article about artificial intelligence news.
Article title (Italian): "${title}"
Topic summary: ${summary.slice(0, 600)}
Style: cinematic, dark and moody, deep navy blue background with electric blue (#2A65FE) light accents, premium tech-magazine look, shallow depth of field. Portrait 4:5.
Absolutely no text, no letters, no words, no logos, no watermarks, no real people's faces, no brand logos.`

let fonts: { name: string; data: Buffer; weight: 400 | 800; style: 'normal' }[] | null = null
async function brandFonts() {
  if (fonts) return fonts
  const dir = join(process.cwd(), 'lib', 'fonts')
  try {
    const [regular, heavy] = await Promise.all([
      readFile(join(dir, 'inter-tight-latin-400-normal.woff')),
      readFile(join(dir, 'inter-tight-latin-800-normal.woff')),
    ])
    fonts = [
      { name: 'Inter Tight', data: regular, weight: 400, style: 'normal' },
      { name: 'Inter Tight', data: heavy, weight: 800, style: 'normal' },
    ]
  } catch (error) {
    // Senza i file del font si usa quello predefinito: le immagini escono lo stesso.
    console.warn('blog image: font del marchio non trovato:', error instanceof Error ? error.message : error)
    fonts = []
  }
  return fonts
}

async function render(node: React.ReactElement): Promise<Buffer> {
  const list = await brandFonts()
  const res = new ImageResponse(node, { width: W, height: H, ...(list.length ? { fonts: list } : {}) })
  return Buffer.from(await res.arrayBuffer())
}

const counter = (i: number, n: number) => `${String(i).padStart(2, '0')} / ${String(n).padStart(2, '0')}`

const footer = (
  <div style={{ display: 'flex', justifyContent: 'center', fontSize: 30, color: BRAND.inkSoft, letterSpacing: 0.5 }}>@facevoice.ai</div>
)

const glow = `radial-gradient(circle at 85% 0%, rgba(42, 101, 254, 0.35) 0%, rgba(42, 101, 254, 0) 55%), linear-gradient(180deg, ${BRAND.navy} 0%, ${BRAND.night} 100%)`

/** Prima slide: foto (se c'e') in alto, titolo grande, "SCORRI". */
function coverSlide(title: string, n: number, photo: string | null) {
  const size = title.length > 80 ? 66 : title.length > 55 ? 76 : 88
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: glow, color: BRAND.ink, fontFamily: 'Inter Tight', position: 'relative' }}>
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} width={W} height={760} style={{ position: 'absolute', top: 0, left: 0, width: W, height: 760, objectFit: 'cover' }} />
      ) : null}
      {photo ? (
        <div style={{ position: 'absolute', top: 0, left: 0, width: W, height: 780, display: 'flex', background: `linear-gradient(180deg, rgba(5,10,22,0) 45%, ${BRAND.night} 100%)` }} />
      ) : null}
      <div style={{ position: 'absolute', top: 56, right: 64, fontSize: 28, color: BRAND.inkSoft, display: 'flex' }}>{counter(1, n)}</div>
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto', padding: '0 80px 70px' }}>
        <div style={{ display: 'flex', fontSize: 28, color: BRAND.blueLight, letterSpacing: 3, marginBottom: 26 }}>NOVITÀ SULL’INTELLIGENZA ARTIFICIALE</div>
        <div style={{ display: 'flex', fontSize: size, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1.5 }}>{title}</div>
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 56 }}>
          <div style={{ display: 'flex', background: BRAND.blue, color: '#fff', fontSize: 34, fontWeight: 800, padding: '22px 110px', borderRadius: 999, letterSpacing: 1 }}>SCORRI</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 44 }}>{footer}</div>
      </div>
    </div>
  )
}

/** Slide di contenuto: titolo forte e testo breve. */
function contentSlide(slide: Slide, i: number, n: number) {
  const size = slide.title.length > 60 ? 70 : 82
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: glow, color: BRAND.ink, fontFamily: 'Inter Tight', padding: '56px 80px 70px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 28, color: BRAND.inkSoft }}>{counter(i, n)}</div>
      <div style={{ display: 'flex', width: 120, height: 10, borderRadius: 5, background: BRAND.blue, marginTop: 'auto', marginBottom: 44 }} />
      <div style={{ display: 'flex', fontSize: size, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1.5 }}>{slide.title}</div>
      <div style={{ display: 'flex', fontSize: 38, lineHeight: 1.4, color: BRAND.inkSoft, marginTop: 40, marginBottom: 'auto' }}>{slide.text}</div>
      {footer}
    </div>
  )
}

/** Ultima slide: invito a leggere l'articolo e a contattarci. */
function ctaSlide(i: number, n: number) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: glow, color: BRAND.ink, fontFamily: 'Inter Tight', padding: '56px 80px 70px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 28, color: BRAND.inkSoft }}>{counter(i, n)}</div>
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto', marginBottom: 'auto' }}>
        <div style={{ display: 'flex', fontSize: 88, fontWeight: 800, lineHeight: 1.04, letterSpacing: -1.5 }}>Vuoi portare l’AI nella tua azienda?</div>
        <div style={{ display: 'flex', fontSize: 40, lineHeight: 1.4, color: BRAND.inkSoft, marginTop: 40 }}>
          Leggi l’articolo completo sul nostro blog e scrivici: ti mostriamo cosa si può fare, in concreto.
        </div>
        <div style={{ display: 'flex', marginTop: 60 }}>
          <div style={{ display: 'flex', background: BRAND.blue, color: '#fff', fontSize: 36, fontWeight: 800, padding: '24px 60px', borderRadius: 999 }}>facevoice.ai/blog</div>
        </div>
      </div>
      {footer}
    </div>
  )
}

/** Foto generata dall'AI per la prima slide (data URL), o null se non riesce. */
async function aiPhoto(title: string, summary: string): Promise<string | null> {
  if (!getGeminiApiKey()) return null
  try {
    const { imageUrl } = await generateGeminiImage(IMAGE_PROMPT(title, summary))
    const base64 = imageUrl.replace(/^data:[^;]+;base64,/, '')
    if (!base64) return null
    // Ridotta e in JPEG: l'immagine dentro la slide pesa meno.
    const jpeg = await sharp(Buffer.from(base64, 'base64')).resize(W, 760, { fit: 'cover', position: 'attention' }).jpeg({ quality: 85 }).toBuffer()
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`
  } catch (error) {
    console.warn('blog image: foto AI non riuscita, prima slide solo grafica:', error instanceof Error ? error.message : error)
    return null
  }
}

async function photoFromUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return null
    const jpeg = await sharp(Buffer.from(await res.arrayBuffer())).rotate().resize(W, 760, { fit: 'cover', position: 'attention' }).jpeg({ quality: 85 }).toBuffer()
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`
  } catch {
    return null
  }
}

/** JPEG 4:5 (formato accettato da Instagram) da qualsiasi immagine. */
export const toJpeg = (input: Buffer) =>
  sharp(input).rotate().resize(W, H, { fit: 'cover', position: 'attention' }).flatten({ background: BRAND.night }).jpeg({ quality: 88 }).toBuffer()

async function upload(jpeg: Buffer): Promise<string> {
  const path = `auto/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, jpeg, { contentType: 'image/jpeg', upsert: false })
  if (error) throw new Error(`caricamento immagine non riuscito: ${error.message}`)
  return supabaseAdmin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

/** Crea e carica il carosello; restituisce gli indirizzi pubblici delle slide (la prima e' la copertina). */
export async function createCarousel(
  title: string,
  slides: Slide[],
  summary: string,
  ownPhotoUrl?: string | null
): Promise<{ urls: string[]; photo: 'ai' | 'grafica' | 'esistente' }> {
  const content = slides.slice(0, 4)
  const n = content.length + 2
  // Foto della prima slide: quella dell'articolo se c'e', altrimenti generata dall'AI.
  const own = ownPhotoUrl ? await photoFromUrl(ownPhotoUrl) : null
  const photo = own ?? (await aiPhoto(title, summary))
  const nodes = [coverSlide(title, n, photo), ...content.map((s, k) => contentSlide(s, k + 2, n)), ctaSlide(n, n)]
  const jpegs = await Promise.all(nodes.map(async (node) => toJpeg(await render(node))))
  const urls = await Promise.all(jpegs.map(upload))
  return { urls, photo: own ? 'esistente' : photo ? 'ai' : 'grafica' }
}

/** Solo per le prove: le slide in JPEG senza caricarle. */
export async function renderCarouselForTest(title: string, slides: Slide[]): Promise<Buffer[]> {
  const n = slides.length + 2
  const nodes = [coverSlide(title, n, null), ...slides.map((s, k) => contentSlide(s, k + 2, n)), ctaSlide(n, n)]
  return Promise.all(nodes.map(async (node) => toJpeg(await render(node))))
}
