import { readSetting, updateSetting } from '@/lib/settings-store'

// Indicazioni di Luca per i contenuti di Facevoice (articoli del blog, caroselli,
// immagini), date a voce o per iscritto alla super chat. Restano valide finche'
// non vengono cambiate o cancellate, e le seguono tutti i passaggi: scrittura
// dell'articolo, slide, gancio della copertina e immagini.

const KEY = 'blog_auto:directions'
const PALETTE_KEY = 'blog_auto:palette'
const MAX = 3000

export type ContentDirections = { text: string; updatedAt: string | null }

const parse = (raw: string | null): ContentDirections => {
  try {
    const data = raw ? JSON.parse(raw) : {}
    return { text: typeof data.text === 'string' ? data.text : '', updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null }
  } catch {
    return { text: '', updatedAt: null }
  }
}

export async function loadContentDirections(): Promise<ContentDirections> {
  try {
    return parse((await readSetting(KEY)).value)
  } catch {
    return { text: '', updatedAt: null }
  }
}

/** replace: sostituisce tutto; append: aggiunge in fondo; clear: cancella. */
export async function saveContentDirections(text: string, mode: 'replace' | 'append' | 'clear'): Promise<ContentDirections> {
  const clean = text.replace(/\r/g, '').trim()
  return updateSetting(KEY, parse, (current) => {
    const next = mode === 'clear' ? '' : mode === 'append' && current.text ? `${current.text}\n${clean}` : clean
    return { text: next.slice(-MAX), updatedAt: new Date().toISOString() }
  })
}

/** Combinazione di colori del prossimo carosello: cambia a ogni post. */
export async function nextPaletteMix(): Promise<number> {
  let index = 0
  try {
    await updateSetting(
      PALETTE_KEY,
      (raw) => (raw ? Number(JSON.parse(raw)) || 0 : 0),
      (current) => {
        index = current
        return current + 1
      }
    )
  } catch {
    index = Math.floor(Math.random() * 100)
  }
  return index
}
