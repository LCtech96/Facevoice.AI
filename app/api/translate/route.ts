import { NextRequest, NextResponse } from 'next/server'
import { translateTexts } from '@/lib/translate'
import { SITE_LANGUAGES, type SiteLanguage } from '@/lib/site-languages'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MAX_TEXTS = 120
const MAX_TEXT_CHARS = 3000
const MAX_TOTAL_CHARS = 30_000
const WINDOW_MS = 10 * 60_000
const MAX_REQUESTS = 120
const hits = new Map<string, number[]>()

function limited(ip: string) {
  const now = Date.now()
  const list = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS)
  list.push(now)
  hits.set(ip, list)
  return list.length > MAX_REQUESTS
}

/** Traduzione dei testi del sito pubblico. body: { lang, texts: string[] } → { translations } */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const lang = String(body?.lang || '')
  if (!(SITE_LANGUAGES as readonly string[]).includes(lang) || lang === 'it') {
    return NextResponse.json({ error: 'Lingua non valida' }, { status: 400 })
  }
  const texts: string[] = (Array.isArray(body?.texts) ? body.texts : [])
    .filter((t: unknown): t is string => typeof t === 'string' && t.trim().length > 0)
    .slice(0, MAX_TEXTS)
    .map((t: string) => t.slice(0, MAX_TEXT_CHARS))
  if (!texts.length) return NextResponse.json({ translations: [] })
  if (texts.reduce((n, t) => n + t.length, 0) > MAX_TOTAL_CHARS) {
    return NextResponse.json({ error: 'Troppo testo' }, { status: 413 })
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (limited(ip)) return NextResponse.json({ error: 'Troppe richieste' }, { status: 429 })

  const translations = await translateTexts(lang as SiteLanguage, texts)
  return NextResponse.json({ translations })
}
