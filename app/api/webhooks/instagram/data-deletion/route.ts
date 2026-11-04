import { NextRequest, NextResponse } from 'next/server'
import { deleteInstagramData, parseSignedRequest } from '@/lib/saas/instagram-callbacks'

export const dynamic = 'force-dynamic'

// Meta: una persona chiede di cancellare i dati ricevuti dal suo Instagram.
// Risposta richiesta da Meta: indirizzo dove seguire la richiesta e codice.

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null)
  const payload = parseSignedRequest(form ? String(form.get('signed_request') || '') : null)
  if (!payload?.user_id) return NextResponse.json({ error: 'richiesta non valida' }, { status: 400 })
  const code = await deleteInstagramData(String(payload.user_id))
  return NextResponse.json({ url: `https://www.facevoice.ai/privacy/cancellazione-dati?codice=${code}`, confirmation_code: code })
}
