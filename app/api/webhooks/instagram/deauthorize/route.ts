import { NextRequest, NextResponse } from 'next/server'
import { deauthorizeInstagram, parseSignedRequest } from '@/lib/saas/instagram-callbacks'

export const dynamic = 'force-dynamic'

// Meta: una persona ha tolto a Facevoice l'accesso al suo Instagram.

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null)
  const payload = parseSignedRequest(form ? String(form.get('signed_request') || '') : null)
  if (!payload?.user_id) return NextResponse.json({ error: 'richiesta non valida' }, { status: 400 })
  await deauthorizeInstagram(String(payload.user_id)).catch((error) => console.error('instagram deauthorize:', error))
  return NextResponse.json({ ok: true })
}
