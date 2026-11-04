import { callAI, hasAIProvider } from '@/lib/ai'
import type { Slide } from '@/lib/blog-image'

// Testo delle slide del carosello, preso dall'articolo. Gli articoli automatici
// hanno gia' un sottotitolo per notizia: si usano quelli (nessuna chiamata AI).
// Per gli articoli scritti a mano si chiede all'AI un riassunto in 3-4 slide,
// solo con i contenuti dell'articolo.

const MAX_TEXT = 210

/** Taglia a fine frase entro `max` caratteri. */
function clip(text: string, max = MAX_TEXT) {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  return end > 80 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`
}

/** Sottotitolo + paragrafo, come li scrive il blog automatico. */
export function slidesFromHeadings(content: string): Slide[] {
  const blocks = content
    .split(/\n\s*Fonti:/i)[0]
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
  const isHeading = (line: string) => line.length >= 4 && line.length <= 90 && !/[.!?:;,]$/.test(line)
  const slides: Slide[] = []
  for (let i = 0; i < blocks.length; i++) {
    const [first, ...rest] = blocks[i].split('\n')
    const body = rest.join(' ').trim()
    // Sottotitolo e testo nello stesso blocco ("Titolo\nTesto…")…
    if (isHeading(first.trim()) && body.length > 60) {
      slides.push({ title: first.trim(), text: clip(body) })
      continue
    }
    // …oppure sottotitolo da solo e testo nel blocco dopo.
    if (!rest.length && isHeading(first.trim()) && i + 1 < blocks.length && blocks[i + 1].length > 60) {
      slides.push({ title: first.trim(), text: clip(blocks[i + 1]) })
      i++
    }
  }
  return slides.slice(0, 4)
}

async function slidesFromAI(title: string, content: string, directions?: string | null): Promise<Slide[]> {
  if (!hasAIProvider()) return []
  try {
    const result = await callAI(
      [{ role: 'user', content: `Titolo: ${title}\n\nArticolo:\n${content.slice(0, 6000)}` }],
      `Riassumi l'articolo in 3 o 4 slide per un carosello Instagram, in italiano.
Ogni slide: un titolo forte (massimo 55 caratteri) e un testo chiaro (massimo 200 caratteri).
Usa solo informazioni presenti nell'articolo: niente dati, nomi o numeri inventati. Niente emoji, niente hashtag, niente markdown.
Rispondi SOLO con JSON: {"slides": [{"title": "...", "text": "..."}]}${directions ? `\n\nIndicazioni di Luca per i contenuti (seguile se riguardano le slide): ${directions}` : ''}`,
      { feature: 'blog_carosello', temperature: 0.4, maxOutputTokens: 1200 }
    )
    const json = (result.message || '').match(/\{[\s\S]*\}/)?.[0]
    const slides = json ? (JSON.parse(json).slides as Slide[]) : []
    return (Array.isArray(slides) ? slides : [])
      .map((s) => ({ title: clip(String(s.title || ''), 70), text: clip(String(s.text || '')) }))
      .filter((s) => s.title && s.text)
      .slice(0, 4)
  } catch {
    return []
  }
}

/** Ultima risorsa: un paragrafo per slide, con la prima frase come titolo. */
function slidesFromParagraphs(content: string): Slide[] {
  return content
    .split(/\n\s*Fonti:/i)[0]
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 60)
    .slice(0, 3)
    .map((p) => {
      const first = p.match(/^.{20,70}?[.!?](\s|$)/)?.[0]?.trim()
      return first ? { title: first.replace(/[.!?]$/, ''), text: clip(p.slice(first.length)) || clip(p) } : { title: clip(p, 60), text: clip(p) }
    })
}

/** Da 1 a 4 slide di contenuto (con copertina e chiusura il carosello ha sempre almeno 3 immagini). */
export async function slidesFor(title: string, content: string, directions?: string | null): Promise<Slide[]> {
  const fromHeadings = slidesFromHeadings(content)
  if (fromHeadings.length >= 2) return fromHeadings
  const fromAI = await slidesFromAI(title, content, directions)
  if (fromAI.length) return fromAI
  const fallback = slidesFromParagraphs(content)
  return fallback.length ? fallback : [{ title, text: clip(content) || 'Leggi l’articolo completo sul nostro blog.' }]
}

/**
 * Gancio della prima slide: una frase breve e fortissima che fa fermare chi
 * scorre, presa SOLO dai fatti dell'articolo (niente promesse false). Scritta in
 * grande sulla copertina; se l'AI non risponde si usa il titolo.
 */
export async function coverHook(title: string, content: string, directions?: string | null): Promise<string | null> {
  if (!hasAIProvider()) return null
  try {
    const result = await callAI(
      [{ role: 'user', content: `Titolo: ${title}\n\nArticolo:\n${content.split(/\n\s*Fonti:/i)[0].slice(0, 5000)}` }],
      `Scrivi il GANCIO della prima slide di un carosello Instagram, in italiano: una frase brevissima che fa fermare chi scorre e lo spinge a sfogliare.
Regole:
- Massimo 42 caratteri (spazi compresi). Meglio ancora 20-35.
- Concreta e d'impatto: un numero, un contrasto, una domanda diretta o una conseguenza per le aziende. Niente frasi generiche come "Novità sull'AI".
- Solo fatti presenti nell'articolo: niente dati, nomi o promesse inventati, niente clickbait falso.
- Niente emoji, niente hashtag, niente virgolette, niente punto finale (punto di domanda o esclamativo ammessi).
Rispondi SOLO con JSON: {"hook": "..."}${directions ? `\n\nIndicazioni di Luca per i contenuti (seguile se riguardano il gancio o il tono): ${directions}` : ''}`,
      { feature: 'blog_carosello', temperature: 0.7, maxOutputTokens: 200 }
    )
    const json = (result.message || '').match(/\{[\s\S]*\}/)?.[0]
    const hook = json ? String(JSON.parse(json).hook || '') : ''
    const clean = hook.replace(/^["«“]|["»”]$/g, '').replace(/\.$/, '').replace(/\s+/g, ' ').trim()
    return clean && clean.length <= 60 ? clean : null
  } catch {
    return null
  }
}
