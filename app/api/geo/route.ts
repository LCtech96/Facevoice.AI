import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Paese di chi visita (dall'IP, lo calcola Vercel), per scegliere la lingua del sito
// alla prima visita: Italia -> italiano, altrove -> inglese. Solo il codice del paese,
// niente altro e nessun dato salvato.

export async function GET(req: NextRequest) {
  const raw = req.headers.get('x-vercel-ip-country') || ''
  const country = /^[A-Z]{2}$/.test(raw) ? raw : null
  return NextResponse.json({ country }, { headers: { 'Cache-Control': 'private, no-store' } })
}
