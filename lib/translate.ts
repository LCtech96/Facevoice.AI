import { createHash } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { callAI } from '@/lib/ai'
import { LANGUAGE_NAMES, type SiteLanguage } from '@/lib/site-languages'

// Traduzione automatica dei testi del sito. Ogni frase si traduce una volta sola
// per lingua e finisce nella tabella site_translations: dalle visite successive
// arriva dal database, senza costi AI.

const TABLE = 'site_translations'
const CHUNK = 40

const hashOf = (lang: string, text: string) => createHash('sha256').update(`${lang}\n${text}`).digest('hex')

// Se la tabella non c'e' ancora si traduce lo stesso, con una cache in memoria.
const memory = new Map<string, string>()

const PROMPT = (language: string) => `You translate the user interface and content of the website of Facevoice AI (a Sicilian software house) into ${language}.
You receive a JSON array of strings, mostly Italian (some may already be in another language).
Rules:
- Return ONLY a JSON array of the same length and order, each item the translation of the matching string.
- Natural, friendly, professional tone, as a native speaker would write a website.
- Keep unchanged: brand and business names (Facevoice AI, Facevoice.ai, names of clients and people), URLs, emails, phone numbers, prices, numbers, emoji, code.
- Keep the original punctuation, leading/trailing spaces and capitalization style (an ALL CAPS label stays ALL CAPS).
- If a string is already in ${language} or has nothing to translate, return it unchanged.`

async function translateChunk(lang: SiteLanguage, texts: string[]): Promise<string[]> {
  const result = await callAI([{ role: 'user', content: JSON.stringify(texts) }], PROMPT(LANGUAGE_NAMES[lang]), {
    temperature: 0.2,
    maxOutputTokens: 8192,
    feature: 'traduzioni_sito',
  })
  const json = (result.message || '').match(/\[[\s\S]*\]/)?.[0]
  const parsed = json ? (JSON.parse(json) as unknown[]) : []
  // Se l'AI sbaglia il numero di elementi si tiene il testo originale per quelli mancanti.
  return texts.map((text, i) => (typeof parsed[i] === 'string' && parsed[i] ? (parsed[i] as string) : text))
}

/** Traduce i testi nella lingua indicata, usando la cache dove possibile. */
export async function translateTexts(lang: SiteLanguage, texts: string[]): Promise<string[]> {
  if (lang === 'it' || !texts.length) return texts
  const hashes = texts.map((t) => hashOf(lang, t))
  const found = new Map<string, string>()

  for (const h of hashes) {
    const cached = memory.get(h)
    if (cached !== undefined) found.set(h, cached)
  }
  const unknown = [...new Set(hashes.filter((h) => !found.has(h)))]
  let tableOk = true
  if (unknown.length) {
    const { data, error } = await supabaseAdmin.from(TABLE).select('source_hash, translated').eq('lang', lang).in('source_hash', unknown)
    if (error) tableOk = false
    for (const row of data || []) {
      found.set(row.source_hash, row.translated)
      memory.set(row.source_hash, row.translated)
    }
  }

  const missing: { hash: string; text: string }[] = []
  const seen = new Set<string>()
  texts.forEach((text, i) => {
    const h = hashes[i]
    if (!found.has(h) && !seen.has(h)) {
      seen.add(h)
      missing.push({ hash: h, text })
    }
  })

  for (let i = 0; i < missing.length; i += CHUNK) {
    const part = missing.slice(i, i + CHUNK)
    try {
      const translated = await translateChunk(lang, part.map((m) => m.text))
      const rows = part.map((m, j) => ({ lang, source_hash: m.hash, source: m.text, translated: translated[j] }))
      for (const row of rows) {
        found.set(row.source_hash, row.translated)
        memory.set(row.source_hash, row.translated)
      }
      if (tableOk) {
        const { error } = await supabaseAdmin.from(TABLE).upsert(rows, { onConflict: 'lang,source_hash' })
        if (error) console.warn('site_translations:', error.message)
      }
    } catch (error) {
      console.warn('translate:', error instanceof Error ? error.message : error)
    }
  }

  return texts.map((text, i) => found.get(hashes[i]) ?? text)
}
