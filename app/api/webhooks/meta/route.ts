import { NextRequest, NextResponse, after } from 'next/server'
import { verifyMetaSignature } from '@/lib/meta/agent'
import { handleWhatsAppWebhook, type WhatsAppPayload } from '@/lib/meta/whatsapp'
import { handleMessagingWebhook, type MessagingPayload } from '@/lib/meta/messenger'
import { routeClientEntries } from '@/lib/saas/meta-inbound'
import { processDueReplies, waitForQueuedReplies } from '@/lib/saas/reply-queue'

export const dynamic = 'force-dynamic'
// Le risposte con un ritardo breve (fino a 45 s) si aspettano qui dentro, dopo la risposta a Meta.
export const maxDuration = 180
/** Oltre questo tempo dall'arrivo del webhook l'attesa passa al cron (resta il margine per scrivere e inviare). */
const WAIT_BUDGET_MS = 120_000

/** Verifica dell'URL richiesta da Meta quando si salva il webhook in console. */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  // trim: un a capo incollato per sbaglio su Vercel faceva fallire la verifica.
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim()

  if (
    expected &&
    params.get('hub.mode') === 'subscribe' &&
    params.get('hub.verify_token')?.trim() === expected
  ) {
    return new NextResponse(params.get('hub.challenge') ?? '', { status: 200 })
  }

  return new NextResponse('Forbidden', { status: 403 })
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now()
  const rawBody = await req.text()

  if (!verifyMetaSignature(rawBody, req.headers.get('x-hub-signature-256'))) {
    return forwardUnverified(rawBody, req.headers.get('x-hub-signature-256'))
  }

  let payload: { object?: string }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new NextResponse('Bad request', { status: 400 })
  }

  // Traccia minima nei log Vercel: tipo di evento, senza contenuti personali.
  const entries = (payload as { entry?: Array<{ messaging?: unknown[]; changes?: Array<{ field?: string }> }> }).entry || []
  const kinds = entries.flatMap((e) => [...(e.messaging?.length ? ['messaging'] : []), ...(e.changes || []).map((c) => c.field)])
  console.log(`meta webhook: ${payload.object} [${kinds.join(', ')}]`)

  // Meta vuole un 200 rapido; la risposta AI parte dopo, senza farlo aspettare.
  if (payload.object === 'whatsapp_business_account') {
    after(() => handleWhatsAppWebhook(payload as WhatsAppPayload))
  } else if (payload.object === 'page' || payload.object === 'instagram') {
    after(async () => {
      // Pagine e Instagram dei clienti del SaaS: ognuno nel suo spazio di lavoro.
      const queued: string[] = []
      const rest = await routeClientEntries(payload as MessagingPayload, queued)
      await Promise.all([
        // Anteprima del SaaS: gli account di Facevoice li gestisce solo il sito vero.
        process.env.META_WEBHOOK_CLIENTS_ONLY === '1' || !rest.entry?.length ? null : handleMessagingWebhook(rest as MessagingPayload),
        // Risposte dei clienti con il ritardo: quelle brevi partono da qui all'ora prevista.
        waitForQueuedReplies(queued, startedAt + WAIT_BUDGET_MS).catch((error) => console.error('saas coda risposte (webhook):', error)),
        // Se il cron non gira: le risposte gia' scadute partono con il primo evento che arriva.
        processDueReplies({ limit: 3 }).catch(() => 0),
      ])
    })
  }

  return NextResponse.json({ received: true })
}

/**
 * Firma non riconosciuta con le chiavi del sito: puo' essere un evento degli
 * Instagram dei clienti collegati con l'accesso di Instagram, firmato con la
 * chiave dell'app Instagram. Il sito non lo elabora: lo passa cosi' com'e' alla
 * beta, che ha la chiave e fa lei il controllo (e lo rifiuta se non e' di Meta).
 */
async function forwardUnverified(rawBody: string, signature: string | null) {
  const forward = process.env.SAAS_WEBHOOK_FORWARD_URL?.trim()
  let object = '?'
  try {
    object = String(JSON.parse(rawBody)?.object || '?')
  } catch {}
  if (!forward || !signature || (object !== 'instagram' && object !== 'page')) {
    console.warn(`meta webhook: firma non valida (${object})`)
    return new NextResponse('Invalid signature', { status: 401 })
  }
  const status = await fetch(forward, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': signature },
    body: rawBody,
    signal: AbortSignal.timeout(20_000),
  })
    .then((res) => res.status)
    .catch(() => 502)
  console.log(`meta webhook: ${object} con firma non del sito, girato alla beta (${status})`)
  return status === 200 ? NextResponse.json({ received: true }) : new NextResponse('Invalid signature', { status: 401 })
}
