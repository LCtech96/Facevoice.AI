import { NextRequest, NextResponse, after } from 'next/server'
import { handleWhatsAppWebhook, verifyMetaSignature } from '@/lib/meta/whatsapp'

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

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new NextResponse('Bad request', { status: 400 })
  }

  // Meta vuole un 200 rapido; la risposta AI parte dopo, senza farlo aspettare.
  after(() => handleWhatsAppWebhook(payload as Parameters<typeof handleWhatsAppWebhook>[0]))

  return NextResponse.json({ received: true })
}
