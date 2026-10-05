import { NextRequest, NextResponse } from 'next/server'
import { getAdminEmail } from '@/lib/admin-request'
import { runAssistant } from '@/lib/lead-assistant'

export const dynamic = 'force-dynamic'
// Preparare 20 bozze (con eventuale lettura dei siti) richiede tempo.
export const maxDuration = 300

/** Richiesta in linguaggio naturale all'assistente della Ricerca clienti. body: { message } */
export async function POST(req: NextRequest) {
  if (!(await getAdminEmail(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const message = String(body?.message || '').trim().slice(0, 2000)
  if (!message) return NextResponse.json({ error: 'Scrivi cosa vuoi fare' }, { status: 400 })
  try {
    return NextResponse.json(await runAssistant(message))
  } catch (error) {
    console.error('lead assistant:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Errore dell’assistente' }, { status: 500 })
  }
}
