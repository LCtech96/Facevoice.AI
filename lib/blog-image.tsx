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

export type Palette = {
  night: string
  navy: string
  deep: string
  blue: string
  blueLight: string
  ink: string
}

/** Palette Facevoice. I clienti della piattaforma possono avere la loro (vedi themesFor). */
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
  /** Firma in fondo a ogni slide (es. @facevoice.ai). */
  handle: string
}

const rgb = (hex: string) => {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0').slice(0, 6)
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0).join(', ')
}
const alpha = (hex: string, a: number) => `rgba(${rgb(hex)}, ${a})`

function themesFor(p: Palette, handle = '@facevoice.ai') {
  const glowBg = (base: string, end: string, at = '85% 0%', strength = 0.35) =>
    `radial-gradient(circle at ${at}, ${alpha(p.blue, strength)} 0%, ${alpha(p.blue, 0)} 55%), linear-gradient(180deg, ${base} 0%, ${end} 100%)`
  const dark = `dark and moody, deep ${p.night} and ${p.deep} tones with ${p.blue} light accents`
  const light = `bright and airy, warm off-white (${p.ink}) and soft ${p.blueLight} tones with ${p.blue} accents`
  const inkSoft = alpha(p.ink, 0.74)
  return {
    notte: { bg: glowBg(p.navy, p.night), solid: p.night, ink: p.ink, soft: inkSoft, accent: p.blue, onAccent: p.ink, label: p.blueLight, mood: dark, handle },
    profondo: { bg: glowBg(p.deep, p.night, '10% 100%', 0.5), solid: p.night, ink: p.ink, soft: inkSoft, accent: p.blueLight, onAccent: p.night, label: p.blueLight, mood: dark, handle },
    blu: {
      bg: `linear-gradient(165deg, ${p.blue} 0%, ${p.blue} 55%, ${p.deep} 140%)`,
      solid: p.blue,
      ink: p.ink,
      soft: alpha(p.ink, 0.88),
      accent: p.night,
      onAccent: p.ink,
      label: p.ink,
      mood: `vivid ${p.blue} dominant tones with deep ${p.night} shadows`,
      handle,
    },
    chiaro: { bg: p.ink, solid: p.ink, ink: p.night, soft: alpha(p.night, 0.72), accent: p.blue, onAccent: p.ink, label: p.blue, mood: light, handle },
    azzurro: {
      bg: `linear-gradient(180deg, ${p.blueLight} 0%, ${p.ink} 160%)`,
      solid: p.blueLight,
      ink: p.night,
      soft: alpha(p.night, 0.76),
      accent: p.night,
      onAccent: p.ink,
      label: p.deep,
      mood: light,
      handle,
    },
  } satisfies Record<string, Theme>
}

const THEMES = themesFor(BRAND)
type ThemeName = keyof typeof THEMES
/** Combinazioni: [copertina, slide di contenuto (si ripetono), chiusura]. */
const MIXES: { cover: ThemeName; content: ThemeName[]; cta: ThemeName }[] = [
  { cover: 'notte', content: ['chiaro', 'blu'], cta: 'notte' },
  { cover: 'blu', content: ['notte', 'azzurro'], cta: 'blu' },
  { cover: 'chiaro', content: ['profondo', 'chiaro', 'blu'], cta: 'profondo' },
  { cover: 'profondo', content: ['azzurro', 'notte'], cta: 'blu' },
]
export const PALETTE_MIXES = MIXES.length

const IMAGE_PROMPT = (title: string, summary: string, mood: string, subject = 'a business blog article about artificial intelligence news') =>
  `Editorial photo-style image for ${subject}.
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

const footer = (t: Theme) =>
  t.handle ? <div style={{ display: 'flex', justifyContent: 'center', fontSize: 30, color: t.soft, letterSpacing: 0.5 }}>{t.handle}</div> : <div style={{ display: 'flex' }} />

/** Gancio grande: piu' corto e', piu' grande si scrive. */
const hookSize = (text: string) => (text.length <= 24 ? 132 : text.length <= 36 ? 118 : text.length <= 50 ? 102 : text.length <= 70 ? 88 : 74)

/**
 * Prima slide: foto (se c'e') in alto, GANCIO in caratteri grandi e, sotto, il
 * titolo dell'articolo in piccolo (se diverso dal gancio), poi "SCORRI".
 */
function coverSlide(t: Theme, hook: string, title: string, n: number, photo: string | null, label = 'NOVITÀ SULL’INTELLIGENZA ARTIFICIALE') {
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
        {label ? <div style={{ display: 'flex', fontSize: 26, color: t.label, letterSpacing: 3, marginBottom: 22 }}>{label.toUpperCase()}</div> : null}
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
function contentSlide(t: Theme, slide: Slide, i: number, n: number, image: string | null, mine = false) {
  const size = slide.title.length > 60 ? (image ? 60 : 70) : image ? 70 : 82
  const textSize = image ? 34 : 38
  // Foto o screenshot di Luca: grande e intera al centro, testo sopra e sotto.
  if (image && mine) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: t.bg, color: t.ink, fontFamily: 'Inter Tight', padding: '52px 72px 60px' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 28, color: t.soft }}>{counter(i, n)}</div>
        <div style={{ display: 'flex', fontSize: slide.title.length > 50 ? 54 : 64, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1.5, marginTop: 18 }}>{slide.title}</div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} width={936} height={660} style={{ width: 936, height: 660, objectFit: 'cover', borderRadius: 32, marginTop: 30 }} />
        <div style={{ display: 'flex', fontSize: 32, lineHeight: 1.38, color: t.soft, marginTop: 28, marginBottom: 'auto' }}>{slide.text}</div>
        {footer(t)}
      </div>
    )
  }
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

export type Cta = { title: string; text: string; button: string }
const BLOG_CTA: Cta = {
  title: 'Vuoi portare l’AI nella tua azienda?',
  text: 'Leggi l’articolo completo sul nostro blog e scrivici: ti mostriamo cosa si può fare, in concreto.',
  button: 'facevoice.ai/blog',
}

/** Ultima slide: invito a leggere l'articolo e a contattarci (o il testo scelto per il post). */
function ctaSlide(t: Theme, i: number, n: number, cta: Cta = BLOG_CTA) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: t.bg, color: t.ink, fontFamily: 'Inter Tight', padding: '56px 80px 70px' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 28, color: t.soft }}>{counter(i, n)}</div>
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto', marginBottom: 'auto' }}>
        <div style={{ display: 'flex', fontSize: cta.title.length > 50 ? 74 : 88, fontWeight: 800, lineHeight: 1.04, letterSpacing: -1.5 }}>{cta.title}</div>
        <div style={{ display: 'flex', fontSize: 40, lineHeight: 1.4, color: t.soft, marginTop: 40 }}>{cta.text}</div>
        <div style={{ display: 'flex', marginTop: 60 }}>
          <div style={{ display: 'flex', background: t.accent, color: t.onAccent, fontSize: 36, fontWeight: 800, padding: '24px 60px', borderRadius: 999 }}>{cta.button}</div>
        </div>
      </div>
      {footer(t)}
    </div>
  )
}

const withTimeout = <T,>(promise: Promise<T>, ms: number) =>
  Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`tempo scaduto (${ms / 1000}s)`)), ms))])

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Immagine generata dall'AI, ridotta e in JPEG (data URL), o null se non riesce.
 * Il piano gratuito di Gemini accetta poche immagini al minuto: se si supera il
 * limite si aspetta e si riprova, finche' c'e' tempo (deadline).
 */
async function aiImage(prompt: string, width: number, height: number, label: string, deadline = Date.now() + 90_000): Promise<string | null> {
  if (!getGeminiApiKey()) return null
  for (let attempt = 0; ; attempt++) {
    const left = deadline - Date.now()
    if (left < 15_000) {
      console.warn(`blog image: ${label} saltata (tempo finito)`)
      return null
    }
    try {
      const { imageUrl } = await withTimeout(generateGeminiImage(prompt), Math.min(90_000, left))
      const base64 = imageUrl.replace(/^data:[^;]+;base64,/, '')
      if (!base64) return null
      const jpeg = await sharp(Buffer.from(base64, 'base64')).resize(width, height, { fit: 'cover', position: 'attention' }).jpeg({ quality: 84 }).toBuffer()
      return `data:image/jpeg;base64,${jpeg.toString('base64')}`
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/rate limit|limite|429|quota|resource.?exhausted/i.test(message) && attempt < 4) {
        await sleep(Math.min(20_000 * (attempt + 1), Math.max(0, deadline - Date.now() - 15_000)))
        continue
      }
      console.warn(`blog image: ${label} non riuscita:`, message)
      return null
    }
  }
}

/**
 * Foto da un indirizzo, nella misura chiesta. Se la forma e' molto diversa (es. uno
 * screenshot verticale in un riquadro orizzontale) non si taglia: si mostra intera
 * su uno sfondo sfocato della stessa immagine.
 */
async function photoFromUrl(url: string, width = W, height = 720): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) return null
    const input = await sharp(Buffer.from(await res.arrayBuffer())).rotate().toBuffer()
    const meta = await sharp(input).metadata()
    const ratio = (meta.width || 1) / (meta.height || 1)
    const target = width / height
    let jpeg: Buffer
    if (ratio / target > 1.35 || target / ratio > 1.35) {
      const backdrop = await sharp(input).resize(width, height, { fit: 'cover' }).blur(40).modulate({ brightness: 0.7 }).toBuffer()
      const front = await sharp(input).resize(width - 60, height - 60, { fit: 'inside' }).toBuffer()
      jpeg = await sharp(backdrop).composite([{ input: front, gravity: 'center' }]).jpeg({ quality: 86 }).toBuffer()
    } else {
      jpeg = await sharp(input).resize(width, height, { fit: 'cover', position: 'attention' }).jpeg({ quality: 86 }).toBuffer()
    }
    return `data:image/jpeg;base64,${jpeg.toString('base64')}`
  } catch {
    return null
  }
}

/** JPEG 4:5 (formato accettato da Instagram) da qualsiasi immagine. */
export const toJpeg = (input: Buffer) =>
  sharp(input).rotate().resize(W, H, { fit: 'cover', position: 'attention' }).flatten({ background: BRAND.night }).jpeg({ quality: 88 }).toBuffer()

async function upload(jpeg: Buffer, storage?: { bucket: string; folder: string }): Promise<string> {
  const bucket = storage?.bucket || BUCKET
  const path = `${storage?.folder || 'auto'}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
  const { error } = await supabaseAdmin.storage.from(bucket).upload(path, jpeg, { contentType: 'image/jpeg', upsert: false })
  if (error) throw new Error(`caricamento immagine non riuscito: ${error.message}`)
  return supabaseAdmin.storage.from(bucket).getPublicUrl(path).data.publicUrl
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
  /** Foto di Luca per le slide di contenuto (indirizzi, nello stesso ordine delle slide). */
  photos?: (string | null)[]
  /** Solo le foto di Luca: niente immagini AI nelle slide che non ne hanno una. */
  onlyMyImages?: boolean
  /** Etichetta sopra il gancio della copertina ('' per toglierla). */
  label?: string
  /** Testo dell'ultima slide (predefinito: invito al blog). */
  cta?: Cta
  /** Slide di contenuto al massimo (Instagram: 10 immagini in tutto). */
  maxSlides?: number
  /** Secondi al massimo per generare le immagini AI (poi le slide restano solo grafica). */
  imageSeconds?: number
  /** Colori e firma di un cliente della piattaforma (predefiniti: quelli di Facevoice). */
  palette?: Palette
  handle?: string
  /** Di cosa parla il post, per le foto AI (predefinito: notizie AI del blog). */
  subject?: string
  /** Cartella di salvataggio (bucket e percorso) per i post dei clienti. */
  storage?: { bucket: string; folder: string }
}

/** Crea e carica il carosello; restituisce gli indirizzi pubblici delle slide (la prima e' la copertina). */
export async function createCarousel(
  title: string,
  slides: Slide[],
  summary: string,
  ownPhotoUrl?: string | null,
  options: CarouselOptions = {}
): Promise<{ urls: string[]; photo: 'ai' | 'grafica' | 'esistente'; slideImages: number; mix: number }> {
  const content = slides.slice(0, Math.min(8, Math.max(1, options.maxSlides ?? 4)))
  const n = content.length + 2
  const mixIndex = (((options.mix ?? 0) % MIXES.length) + MIXES.length) % MIXES.length
  const mix = MIXES[mixIndex]
  const themeSet = options.palette || options.handle !== undefined ? themesFor(options.palette || BRAND, options.handle ?? '@facevoice.ai') : THEMES
  const coverTheme = themeSet[mix.cover]
  const themes = content.map((_, k) => themeSet[mix.content[k % mix.content.length]])
  const notes = options.imageNotes?.trim() ? `\nExtra art direction from the brand owner: ${options.imageNotes.trim().slice(0, 400)}` : ''

  // Foto di Luca subito (in parallelo); le immagini AI una alla volta, prima la
  // copertina: tutte insieme superavano il limite al minuto di Gemini e non ne
  // usciva nessuna. Tempo massimo per le immagini AI: imageSeconds.
  const own = ownPhotoUrl ? await photoFromUrl(ownPhotoUrl) : null
  const mine = content.map((_, k) => options.photos?.[k] || null)
  const minePhotos = await Promise.all(mine.map((url) => (url ? photoFromUrl(url, 936, 660) : Promise.resolve(null))))
  const deadline = Date.now() + (options.imageSeconds ?? 150) * 1000
  const cover = own ?? (options.onlyMyImages ? null : await aiImage(IMAGE_PROMPT(title, summary, coverTheme.mood, options.subject) + notes, W, 720, 'foto della copertina', deadline))
  const images: (string | null)[] = []
  for (const [k, slide] of content.entries()) {
    if (minePhotos[k]) images.push(minePhotos[k])
    else if (options.slideImages === false || options.onlyMyImages) images.push(null)
    else images.push(await aiImage(SLIDE_IMAGE_PROMPT(slide, themes[k].mood) + notes, (k + 2) % 2 === 0 ? W : 920, (k + 2) % 2 === 0 ? 560 : 500, `immagine della slide ${k + 2}`, deadline))
  }
  const hook = options.hook?.trim() || title
  const nodes = [
    coverSlide(coverTheme, hook, title, n, cover, options.label),
    ...content.map((s, k) => contentSlide(themes[k], s, k + 2, n, images[k], Boolean(mine[k] && images[k]))),
    ctaSlide(themeSet[mix.cta], n, n, options.cta),
  ]
  const jpegs = await Promise.all(nodes.map(async (node) => toJpeg(await render(node))))
  const urls = await Promise.all(jpegs.map((jpeg) => upload(jpeg, options.storage)))
  return { urls, photo: own ? 'esistente' : cover ? 'ai' : 'grafica', slideImages: images.filter(Boolean).length, mix: mixIndex }
}

/** Solo per le prove: le slide in JPEG senza caricarle (immagini passate gia' pronte, come data URL). */
export async function renderCarouselForTest(
  title: string,
  slides: Slide[],
  options: { hook?: string; mix?: number; cover?: string | null; images?: (string | null)[]; mine?: boolean; label?: string; cta?: Cta } = {}
): Promise<Buffer[]> {
  const n = slides.length + 2
  const mix = MIXES[(options.mix ?? 0) % MIXES.length]
  const nodes = [
    coverSlide(THEMES[mix.cover], options.hook || title, title, n, options.cover ?? null, options.label),
    ...slides.map((s, k) => contentSlide(THEMES[mix.content[k % mix.content.length]], s, k + 2, n, options.images?.[k] ?? null, options.mine)),
    ctaSlide(THEMES[mix.cta], n, n, options.cta),
  ]
  return Promise.all(nodes.map(async (node) => toJpeg(await render(node))))
}

/**
 * Foto di un cliente pronta per un post Instagram (4:5, 1080x1350, JPEG): se la
 * forma e' simile si ritaglia, altrimenti (es. foto orizzontale o screenshot) si
 * mostra intera su uno sfondo sfocato della stessa foto, senza tagliare niente.
 */
export async function fitPostPhoto(input: Buffer): Promise<Buffer> {
  const rotated = await sharp(input).rotate().toBuffer()
  const meta = await sharp(rotated).metadata()
  const ratio = (meta.width || 1) / (meta.height || 1)
  const target = W / H
  if (ratio / target <= 1.18 && target / ratio <= 1.18) {
    return sharp(rotated).resize(W, H, { fit: 'cover', position: 'attention' }).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer()
  }
  const backdrop = await sharp(rotated).resize(W, H, { fit: 'cover' }).blur(45).modulate({ brightness: 0.75 }).toBuffer()
  const front = await sharp(rotated).resize(W - 40, H - 40, { fit: 'inside' }).toBuffer()
  return sharp(backdrop).composite([{ input: front, gravity: 'center' }]).flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer()
}
