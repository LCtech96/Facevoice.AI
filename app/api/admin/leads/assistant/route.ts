import { NextRequest, NextResponse } from 'next/server'
import { getAdminEmail } from '@/lib/admin-request'
import { runWithStatus } from '@/lib/ai'
import { runAssistant } from '@/lib/lead-assistant'

export const dynamic = 'force-dynamic'
// Preparare 20 bozze (con eventuale lettura dei siti) richiede tempo.
export const maxDuration = 300
// Oltre questo tempo non si inizia altro lavoro: si consegna e il browser rilancia per continuare.
const WORK_BUDGET_MS = 210_000

/** Richiesta in linguaggio naturale all'assistente della Ricerca clienti. body: { message } */
export async function POST(req: NextRequest) {
  if (!(await getAdminEmail(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const message = String(body?.message || '').trim().slice(0, 2000)
  if (!message) return NextResponse.json({ error: 'Scrivi cosa vuoi fare' }, { status: 400 })
  const history = (Array.isArray(body?.history) ? body.history : [])
    .filter((t: { role?: unknown; text?: unknown }) => (t?.role === 'user' || t?.role === 'assistant') && typeof t?.text === 'string')
    .slice(-8)
    .map((t: { role: 'user' | 'assistant'; text: string }) => ({ role: t.role, text: t.text.slice(0, 1500) }))
  const drafts = (Array.isArray(body?.drafts) ? body.drafts : [])
    .filter((d: Record<string, unknown>) => typeof d?.leadId === 'string' && typeof d?.body === 'string')
    .slice(0, 60)
  // Risposta in streaming, una riga JSON per evento: {"type":"status"} mentre lavora,
  // poi {"type":"result"} o {"type":"error"}. Cosi' Luca vede a che punto e'.
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      let open = true
      const send = (event: Record<string, unknown>) => {
        if (!open) return
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        } catch {
          open = false // browser chiuso: il lavoro (gia' salvato sulle schede) continua
        }
      }
      try {
        const result = await runWithStatus(
          { status: (text) => send({ type: 'status', text }), deadline: Date.now() + WORK_BUDGET_MS },
          () => runAssistant(message, history, drafts)
        )
        send({ type: 'result', ...result })
      } catch (error) {
        console.error('lead assistant:', error)
        send({ type: 'error', error: error instanceof Error ? error.message : 'Errore dell’assistente' })
      } finally {
        if (open) controller.close()
        open = false
      }
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
  })
}
