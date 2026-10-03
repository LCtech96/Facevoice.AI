import { NextRequest, NextResponse, after } from 'next/server'
import { verifyMetaSignature } from '@/lib/meta/agent'
import { handleWhatsAppWebhook, type WhatsAppPayload } from '@/lib/meta/whatsapp'
import { handleMessagingWebhook, type MessagingPayload } from '@/lib/meta/messenger'

export const dynamic = 'force-dynamic'

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
    return new NextResponse('Invalid signature', { status: 401 })
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
    after(() => handleMessagingWebhook(payload as MessagingPayload))
  }

  return NextResponse.json({ received: true })
}
