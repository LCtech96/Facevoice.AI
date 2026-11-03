import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'
import { loginUrl, metaConfig, signState } from '@/lib/saas/meta'

export const dynamic = 'force-dynamic'

// Inizio del collegamento di Facebook e Instagram: indirizzo del login di Meta.

export async function POST(req: NextRequest) {
  const access = await requireWorkspace(req, 'admin')
  if (access instanceof NextResponse) return access
  if (!metaConfig().ready) return NextResponse.json({ error: 'Il collegamento con Meta non è ancora configurato.' }, { status: 503 })
  return NextResponse.json({ url: loginUrl(req.nextUrl.origin, signState(access.workspace.id, access.userId)) })
}
