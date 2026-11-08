import { NextRequest, NextResponse } from 'next/server'
import { canAccess, getStaffAccess } from '@/lib/staff-access'
import { asScope } from '@/lib/assistant-state'
import { createChatUploads } from '@/lib/chat-uploads'

export const dynamic = 'force-dynamic'

/** { scope, count } → indirizzi firmati per caricare le foto del prossimo messaggio direttamente dal browser. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const scope = asScope(body?.scope)
  const access = await getStaffAccess(req)
  const ok = scope === 'super' ? canAccess(access, 'assistant', 'use') : canAccess(access, 'leads', 'assistant')
  if (!ok) return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  try {
    return NextResponse.json({ uploads: await createChatUploads(body?.count) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Caricamento non disponibile' }, { status: 400 })
  }
}
