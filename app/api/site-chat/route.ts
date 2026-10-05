import { NextRequest, NextResponse } from 'next/server'
import { handleSiteMessage, isHandedOff, isValidSession, loadSession } from '@/lib/site-chat'
import { asSiteLanguage } from '@/lib/site-languages'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const WINDOW_MS = 10 * 60_000
const MAX_MESSAGES = 30
const hits = new Map<string, number[]>()

function limited(key: string) {
  const now = Date.now()
  const list = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS)
  list.push(now)
  hits.set(key, list)
  return list.length > MAX_MESSAGES
}

/** Messaggi della sessione (anche le risposte dell'operatore). ?session=...&after=ISO */
export async function GET(req: NextRequest) {
  const session = req.nextUrl.searchParams.get('session')
  if (!isValidSession(session)) return NextResponse.json({ error: 'Sessione non valida' }, { status: 400 })
  const after = req.nextUrl.searchParams.get('after') || undefined
  const [messages, handoff] = await Promise.all([loadSession(session, after), isHandedOff(session)])
  return NextResponse.json({ messages, handoff })
}

/** Nuovo messaggio del visitatore. body: { session, text, history? } */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const session = body?.session
  const text = String(body?.text || '').trim().slice(0, 1000)
  if (!isValidSession(session)) return NextResponse.json({ error: 'Sessione non valida' }, { status: 400 })
  if (!text) return NextResponse.json({ error: 'Messaggio vuoto' }, { status: 400 })

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (limited(ip) || limited(session)) {
    return NextResponse.json({ error: 'Stai scrivendo troppo velocemente, riprova tra poco.' }, { status: 429 })
  }

  const history = Array.isArray(body?.history)
    ? body.history
        .filter((m: unknown): m is { role: string; content: string } => {
          const x = m as { role?: unknown; content?: unknown }
          return (x?.role === 'user' || x?.role === 'assistant') && typeof x?.content === 'string'
        })
        .map((m: { role: string; content: string }) => ({ role: m.role, content: m.content.slice(0, 1000) }))
    : []

  const result = await handleSiteMessage(session, text, history, asSiteLanguage(body?.language))
  return NextResponse.json(result)
}
