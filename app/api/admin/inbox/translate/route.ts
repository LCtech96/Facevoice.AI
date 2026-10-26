import { NextRequest, NextResponse } from 'next/server'
import { guard } from '@/lib/staff-access'
import { callAI, hasAIProvider } from '@/lib/ai'

export const dynamic = 'force-dynamic'

// Traduzione al volo di un messaggio in Messaggi (es. un commento in russo),
// solo per leggerlo: il messaggio salvato e inviato non cambia.

const TARGETS = { it: 'italiano', en: 'inglese' } as const
const memory = new Map<string, string>()

export async function POST(req: NextRequest) {
  const access = await guard(req, 'inbox', 'view')
  if (access instanceof NextResponse) return access
  const body = await req.json().catch(() => ({}))
  const lang = body?.lang === 'en' ? 'en' : 'it'
  const text = String(body?.text || '').trim().slice(0, 8000)
  if (!text) return NextResponse.json({ error: 'Testo mancante' }, { status: 400 })
  if (!hasAIProvider()) return NextResponse.json({ error: 'Nessuna chiave AI configurata' }, { status: 503 })

  const key = `${lang}\n${text}`
  const cached = memory.get(key)
  if (cached) return NextResponse.json({ translation: cached })

  try {
    const result = await callAI(
      [{ role: 'user', content: text }],
      `Traduci in ${TARGETS[lang]} il messaggio che ricevi. Rispondi SOLO con la traduzione, senza commenti né virgolette. Mantieni a capo, emoji, nomi, link e numeri. Se è già in ${TARGETS[lang]}, restituiscilo uguale.`,
      { temperature: 0.1, maxOutputTokens: 4096, feature: 'traduzioni_messaggi' }
    )
    const translation = (result.message || '').trim()
    if (!translation) throw new Error('vuota')
    if (memory.size > 500) memory.clear()
    memory.set(key, translation)
    return NextResponse.json({ translation })
  } catch {
    return NextResponse.json({ error: 'Traduzione non riuscita, riprova' }, { status: 502 })
  }
}
