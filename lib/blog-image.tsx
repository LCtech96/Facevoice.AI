import { readFile } from 'fs/promises'
import { join } from 'path'
import { ImageResponse } from 'next/og'
import sharp from 'sharp'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { generateGeminiImage, getGeminiApiKey } from '@/lib/gemini'

// Immagini degli articoli del blog per i social: un CAROSELLO (da 3 a 6 slide,
// formato 4:5 come i caroselli Facevoice su Canva) con i soli colori del marchio,
// in combinazioni che cambiano da un post all'altro. La prima slide ha un gancio
// in caratteri grandi e una foto generata dall'AI; anche le slide di contenuto
// hanno la loro immagine (se la generazione riesce, altrimenti solo grafica).
// Tutto in JPEG (l'unico formato accettato da Instagram).

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

// Temi delle slide, tutti con i soli colori della palette. Ogni carosello alterna
// temi diversi (vedi MIXES), cosi' la predominanza di colore cambia da una slide
// all'altra e da un post all'altro, restando sempre nel marchio.
type Theme = {
  /** Sfondo (anche gradiente) e tinta piena per le sfumature sopra le foto. */
  bg: string
  solid: string
  ink: string
  soft: string
  /** Colore di pulsanti, barre e dettagli, e del testo sopra. */
  accent: string
  onAccent: string
  label: string
  /** Atmosfera delle foto AI generate per questa slide. */
  mood: string
}

const glowBg = (base: string, end: string, at = '85% 0%', strength = 0.35) =>
  `radial-gradient(circle at ${at}, rgba(42, 101, 254, ${strength}) 0%, rgba(42, 101, 254, 0) 55%), linear-gradient(180deg, ${base} 0%, ${end} 100%)`

const DARK_MOOD = 'dark and moody, deep navy blue tones with electric blue (#2A65FE) light accents'
const LIGHT_MOOD = 'bright and airy, warm off-white (#F8F8F0) and soft periwinkle blue (#A9C1FF) tones with electric blue (#2A65FE) accents'

const THEMES = {
  notte: { bg: glowBg(BRAND.navy, BRAND.night), solid: BRAND.night, ink: BRAND.ink, soft: BRAND.inkSoft, accent: BRAND.blue, onAccent: BRAND.ink, label: BRAND.blueLight, mood: DARK_MOOD },
  profondo: {
    bg: glowBg(BRAND.deep, BRAND.night, '10% 100%', 0.5),
    solid: BRAND.night,
    ink: BRAND.ink,
    soft: BRAND.inkSoft,
    accent: BRAND.blueLight,
    onAccent: BRAND.night,
    label: BRAND.blueLight,
    mood: DARK_MOOD,
  },
  blu: {
    bg: `linear-gradient(165deg, ${BRAND.blue} 0%, ${BRAND.blue} 55%, ${BRAND.deep} 140%)`,
    solid: BRAND.blue,
    ink: BRAND.ink,
    soft: 'rgba(248, 248, 240, 0.88)',
    accent: BRAND.night,
    onAccent: BRAND.ink,
    label: BRAND.ink,
    mood: 'vivid electric blue (#2A65FE) dominant tones with deep navy shadows',
  },
  chiaro: { bg: BRAND.ink, solid: BRAND.ink, ink: BRAND.night, soft: 'rgba(5, 10, 22, 0.72)', accent: BRAND.blue, onAccent: BRAND.ink, label: BRAND.blue, mood: LIGHT_MOOD },
  azzurro: {
    bg: `linear-gradient(180deg, ${BRAND.blueLight} 0%, ${BRAND.ink} 160%)`,
    solid: BRAND.blueLight,
    ink: BRAND.night,
    soft: 'rgba(5, 10, 22, 0.76)',
    accent: BRAND.night,
    onAccent: BRAND.ink,
    label: BRAND.deep,
    mood: LIGHT_MOOD,
  },
} satisfies Record<string, Theme>

type ThemeName = keyof typeof THEMES
/** Combinazioni: [copertina, slide di contenuto (si ripetono), chiusura]. */
const MIXES: { cover: ThemeName; content: ThemeName[]; cta: ThemeName }[] = [
  { cover: 'notte', content: ['chiaro', 'blu'], cta: 'notte' },
  { cover: 'blu', content: ['notte', 'azzurro'], cta: 'blu' },
  { cover: 'chiaro', content: ['profondo', 'chiaro', 'blu'], cta: 'profondo' },
  { cover: 'profondo', content: ['azzurro', 'notte'], cta: 'blu' },
]
export const PALETTE_MIXES = MIXES.length

const IMAGE_PROMPT = (title: string, summary: string, mood: string) =>
  `Editorial photo-style image for a business blog article about artificial intelligence news.
Article title (Italian): "${title}"
Topic summary: ${summary.slice(0, 600)}
Style: cinematic, ${mood}, premium tech-magazine look, shallow depth of field. Portrait 4:5.
Absolutely no text, no letters, no words, no logos, no watermarks, no real people's faces, no brand logos.`

const SLIDE_IMAGE_PROMPT = (slide: Slide, mood: string) =>
  `Editorial photo-style illustration for one slide of an Instagram carousel about this topic.
Slide title (Italian): "${slide.title}"
Slide text: ${slide.text}
Show a concrete, recognizable scene or object that represents the topic (no abstract blobs). Style: cinematic, ${mood}, premium tech-magazine look. Landscape 16:9.
Absolutely no text, no letters, no words, no numbers, no logos, no watermarks, no real people's faces, no brand logos.`

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

const footer = (t: Theme) => (
  <div style={{ display: 'flex', justifyContent: 'center', fontSize: 30, color: t.soft, letterSpacing: 0.5 }}>@facevoice.ai</div>
)

/** Gancio grande: piu' corto e', piu' grande si scrive. */
const hookSize = (text: string) => (text.length <= 24 ? 132 : text.length <= 36 ? 118 : text.length <= 50 ? 102 : text.length <= 70 ? 88 : 74)

/**
 * Prima slide: foto (se c'e') in alto, GANCIO in caratteri grandi e, sotto, il
 * titolo dell'articolo in piccolo (se diverso dal gancio), poi "SCORRI".
 */
function coverSlide(t: Theme, hook: string, title: string, n: number, photo: string | null) {
  const subtitle = title.trim() !== hook.trim() ? title : null
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: photo ? t.solid : t.bg, color: t.ink, fontFamily: 'Inter Tight', position: 'relative' }}>
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} width={W} height={720} style={{ position: 'absolute', top: 0, left: 0, width: W, height: 720, objectFit: 'cover' }} />
      ) : null}
      {photo ? (
        <div style={{ position: 'absolute', top: 0, left: 0, width: W, height: 722, display: 'flex', background: `linear-gradient(180deg, rgba(0,0,0,0) 40%, ${t.solid} 99%)` }} />
      ) : null}
      <div style={{ position: 'absolute', top: 56, right: 64, fontSize: 28, color: photo ? BRAND.ink : t.soft, display: 'flex' }}>{counter(1, n)}</div>
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto', padding: '0 72px 64px' }}>
        <div style={{ display: 'flex', fontSize: 26, color: t.label, letterSpacing: 3, marginBottom: 22 }}>NOVITÀ SULL’INTELLIGENZA ARTIFICIALE</div>
        <div style={{ display: 'flex', fontSize: hookSize(hook), fontWeight: 800, lineHeight: 0.98, letterSpacing: -2.5 }}>{hook}</div>
        {subtitle ? <div style={{ display: 'flex', fontSize: 32, lineHeight: 1.3, color: t.soft, marginTop: 26 }}>{subtitle}</div> : null}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 44 }}>
          <div style={{ display: 'flex', background: t.accent, color: t.onAccent, fontSize: 34, fontWeight: 800, padding: '22px 110px', borderRadius: 999, letterSpacing: 1 }}>SCORRI</div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 36 }}>{footer(t)}</div>
      </div>
    </div>
  )
}

/**
 * Slide di contenuto: titolo forte e testo breve. Con l'immagine si alternano
 * due impaginazioni (foto in alto a tutta larghezza, oppure riquadro in basso).
 */
function contentSlide(t: Theme, slide: Slide, i: number, n: number, image: string | null) {
  const size = slide.title.length > 60 ? (image ? 60 : 70) : image ? 70 : 82
  const textSize = image ? 34 : 38
  if (image && i % 2 === 0) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: t.solid, color: t.ink, fontFamily: 'Inter Tight', position: 'relative' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} width={W} height={560} style={{ position: 'absolute', top: 0, left: 0, width: W, height: 560, objectFit: 'cover' }} />
        <div style={{ position: 'absolute', top: 0, left: 0, width: W, height: 562, display: 'flex', background: `linear-gradient(180deg, rgba(0,0,0,0) 55%, ${t.solid} 99%)` }} />
        <div style={{ position: 'absolute', top: 56, right: 64, fontSize: 28, color: BRAND.ink, display: 'flex' }}>{counter(i, n)}</div>
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 560, padding: '30px 80px 64px', flexGrow: 1 }}>
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto', marginBottom: 'auto' }}>
            <div style={{ display: 'flex', width: 120, height: 10, borderRadius: 5, background: t.accent, marginBottom: 34 }} />
            <div style={{ display: 'flex', fontSize: size, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1.5 }}>{slide.title}</div>
            <div style={{ display: 'flex', fontSize: textSize, lineHeight: 1.4, color: t.soft, marginTop: 28 }}>{slide.text}</div>
          </div>
          {footer(t)}
        </div>
      </div>
    )
  }
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: t.bg, color: t.ink, fontFamily: 'Inter Tight', padding: '56px 80px 64px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 28, color: t.soft }}>{counter(i, n)}</div>
      <div style={{ display: 'flex', width: 120, height: 10, borderRadius: 5, background: t.accent, marginTop: image ? 30 : 'auto', marginBottom: 40 }} />
      <div style={{ display: 'flex', fontSize: size, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1.5 }}>{slide.title}</div>
      <div style={{ display: 'flex', fontSize: textSize, lineHeight: 1.4, color: t.soft, marginTop: 32, marginBottom: image ? 40 : 'auto' }}>{slide.text}</div>
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} width={920} height={500} style={{ width: 920, height: 500, objectFit: 'cover', borderRadius: 36, marginTop: 'auto', marginBottom: 36 }} />
      ) : null}
      {footer(t)}
    </div>
  )
}

/** Ultima slide: invito a leggere l'articolo e a contattarci. */
function ctaSlide(t: Theme, i: number, n: number) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: t.bg, color: t.ink, fontFamily: 'Inter Tight', padding: '56px 80px 70px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 28, color: t.soft }}>{counter(i, n)}</div>
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto', marginBottom: 'auto' }}>
        <div style={{ display: 'flex', fontSize: 88, fontWeight: 800, lineHeight: 1.04, letterSpacing: -1.5 }}>Vuoi portare l’AI nella tua azienda?</div>
        <div style={{ display: 'flex', fontSize: 40, lineHeight: 1.4, color: t.soft, marginTop: 40 }}>
          Leggi l’articolo completo sul nostro blog e scrivici: ti mostriamo cosa si può fare, in concreto.
        </div>
        <div style={{ display: 'flex', marginTop: 60 }}>
          <div style={{ display: 'flex', background: t.accent, color: t.onAccent, fontSize: 36, fontWeight: 800, padding: '24px 60px', borderRadius: 999 }}>facevoice.ai/blog</div>
        </div>
      </div>
      {footer(t)}
    </div>
  )
}

const withTimeout = <T,>(promise: Promise<T>, ms: number) =>
  Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`tempo scaduto (${ms / 1000}s)`)), ms))])

/** Immagine generata dall'AI, ridotta e in JPEG (data URL), o null se non riesce. */
async function aiImage(prompt: string, width: number, height: number, label: string): Promise<string | null> {
  if (!getGeminiApiKey()) return null
  try {
    const { imageUrl } = await withTimeout(generateGeminiImage(prompt), 90_000)
    const base64 = imageUrl.replace(/^data:[^;]+;base64,/, '')
    if (!base64) return null
    const jpeg = await sharp(Buffer.from(base64, 'base64')).resize(width, height, { fit: 'cover', position: 'attention' }).jpeg({ quality: 84 }).toBuffer()
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`
  } catch (error) {
    console.warn(`blog image: ${label} non riuscita:`, error instanceof Error ? error.message : error)
    return null
  }
}

async function photoFromUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return null
    const jpeg = await sharp(Buffer.from(await res.arrayBuffer())).rotate().resize(W, 720, { fit: 'cover', position: 'attention' }).jpeg({ quality: 85 }).toBuffer()
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

export type CarouselOptions = {
  /** Frase d'aggancio della prima slide (se manca si usa il titolo). */
  hook?: string | null
  /** Combinazione di colori (0..PALETTE_MIXES-1); cambia a ogni post. */
  mix?: number
  /** Foto generate dall'AI anche nelle slide di contenuto. */
  slideImages?: boolean
  /** Indicazioni di Luca sullo stile delle immagini (dalla super chat). */
  imageNotes?: string | null
}

/** Crea e carica il carosello; restituisce gli indirizzi pubblici delle slide (la prima e' la copertina). */
export async function createCarousel(
  title: string,
  slides: Slide[],
  summary: string,
  ownPhotoUrl?: string | null,
  options: CarouselOptions = {}
): Promise<{ urls: string[]; photo: 'ai' | 'grafica' | 'esistente'; slideImages: number; mix: number }> {
  const content = slides.slice(0, 4)
  const n = content.length + 2
  const mixIndex = (((options.mix ?? 0) % MIXES.length) + MIXES.length) % MIXES.length
  const mix = MIXES[mixIndex]
  const coverTheme = THEMES[mix.cover]
  const themes = content.map((_, k) => THEMES[mix.content[k % mix.content.length]])
  const notes = options.imageNotes?.trim() ? `\nExtra art direction from the brand owner: ${options.imageNotes.trim().slice(0, 400)}` : ''

  // Foto della copertina e delle slide, tutte insieme (in parallelo).
  const own = ownPhotoUrl ? await photoFromUrl(ownPhotoUrl) : null
  const [cover, ...images] = await Promise.all([
    own ? Promise.resolve(own) : aiImage(IMAGE_PROMPT(title, summary, coverTheme.mood) + notes, W, 720, 'foto della copertina'),
    ...content.map((slide, k) =>
      options.slideImages === false
        ? Promise.resolve(null)
        : aiImage(SLIDE_IMAGE_PROMPT(slide, themes[k].mood) + notes, (k + 2) % 2 === 0 ? W : 920, (k + 2) % 2 === 0 ? 560 : 500, `immagine della slide ${k + 2}`)
    ),
  ])
  const hook = options.hook?.trim() || title
  const nodes = [
    coverSlide(coverTheme, hook, title, n, cover),
    ...content.map((s, k) => contentSlide(themes[k], s, k + 2, n, images[k])),
    ctaSlide(THEMES[mix.cta], n, n),
  ]
  const jpegs = await Promise.all(nodes.map(async (node) => toJpeg(await render(node))))
  const urls = await Promise.all(jpegs.map(upload))
  return { urls, photo: own ? 'esistente' : cover ? 'ai' : 'grafica', slideImages: images.filter(Boolean).length, mix: mixIndex }
}

/** Solo per le prove: le slide in JPEG senza caricarle (immagini passate gia' pronte, come data URL). */
export async function renderCarouselForTest(
  title: string,
  slides: Slide[],
  options: { hook?: string; mix?: number; cover?: string | null; images?: (string | null)[] } = {}
): Promise<Buffer[]> {
  const n = slides.length + 2
  const mix = MIXES[(options.mix ?? 0) % MIXES.length]
  const nodes = [
    coverSlide(THEMES[mix.cover], options.hook || title, title, n, options.cover ?? null),
    ...slides.map((s, k) => contentSlide(THEMES[mix.content[k % mix.content.length]], s, k + 2, n, options.images?.[k] ?? null)),
    ctaSlide(THEMES[mix.cta], n, n),
  ]
  return Promise.all(nodes.map(async (node) => toJpeg(await render(node))))
}
