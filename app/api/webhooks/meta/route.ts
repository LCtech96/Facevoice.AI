import { NextRequest, NextResponse, after } from 'next/server'
import { verifyMetaSignature } from '@/lib/meta/agent'
import { handleWhatsAppWebhook, type WhatsAppPayload } from '@/lib/meta/whatsapp'
import { handleMessagingWebhook, type MessagingPayload } from '@/lib/meta/messenger'
import { facevoiceAccountIds } from '@/lib/meta/graph'
import { waitForDmReplies } from '@/lib/meta/reply-queue'

export const dynamic = 'force-dynamic'
// Dopo il 200 a Meta (after) si aspettano anche le risposte ai messaggi privati in coda
// (almeno 30 secondi dopo l'ultimo messaggio, fino a 45 secondi di attesa) e si scrivono.
export const maxDuration = 120

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
    after(async () => waitForDmReplies(await handleWhatsAppWebhook(payload as WhatsAppPayload)))
  } else if (payload.object === 'page' || payload.object === 'instagram') {
    const signature = req.headers.get('x-hub-signature-256')
    const handleOwn = async (): Promise<string[]> => {
      const messaging = payload as MessagingPayload
      const own = await facevoiceAccountIds().catch(() => null)
      // Senza gli id di Facevoice (token non disponibile) si lavora come sempre.
      if (!own) return handleMessagingWebhook(messaging)
      // Instagram di Facevoice non riconosciuto: meglio gestire tutto come sempre che perdere messaggi.
      if (payload.object === 'instagram' && own.size < 2) return handleMessagingWebhook(messaging)
      const entries = messaging.entry || []
      const ours = entries.filter((e) => !e.id || own.has(e.id))
      const clients = entries.length - ours.length
      // Pagine e Instagram dei clienti del SaaS: l'evento (firmato da Meta) passa alla beta.
      const forward = process.env.SAAS_WEBHOOK_FORWARD_URL?.trim()
      if (clients && forward) {
        await fetch(forward, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(signature ? { 'x-hub-signature-256': signature } : {}) },
          body: rawBody,
          signal: AbortSignal.timeout(20_000),
        })
          .then((res) => console.log(`meta webhook: ${clients} eventi di clienti girati alla beta (${res.status})`))
          .catch((error) => console.error('meta webhook: inoltro alla beta non riuscito', error instanceof Error ? error.message : error))
      }
      if (ours.length) return handleMessagingWebhook({ ...messaging, entry: ours })
      return []
    }
    // Risposte messe in coda dai nostri messaggi privati: si aspettano qui, il resto lo manda il cron.
    after(async () => waitForDmReplies(await handleOwn()))
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
