import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'
import { signState } from '@/lib/saas/meta'
import { instagramConfig, instagramLoginUrl } from '@/lib/saas/instagram'

export const dynamic = 'force-dynamic'

// Inizio del collegamento con l'accesso di Instagram: indirizzo del login di Instagram.

export async function POST(req: NextRequest) {
  const access = await requireWorkspace(req, 'admin')
  if (access instanceof NextResponse) return access
  if (!instagramConfig().ready) return NextResponse.json({ error: 'Il collegamento con Instagram non è ancora configurato.' }, { status: 503 })
  // publish=1: si chiede anche il permesso di pubblicare i post (Assistente AI).
  const publish = req.nextUrl.searchParams.get('publish') === '1'
  return NextResponse.json({ url: instagramLoginUrl(req.nextUrl.origin, signState(access.workspace.id, access.userId), { publish }) })
}
