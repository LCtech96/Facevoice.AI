import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'
import { appUrl, billingConfigured, createPortalSession, readBillingState } from '@/lib/billing'

export const dynamic = 'force-dynamic'

// "Gestisci abbonamento e fatture": portale di Stripe (carta, fatture, disdetta),
// solo per titolare o amministratore. Si torna alla pagina Piano.

export async function POST(req: NextRequest) {
  const access = await requireWorkspace(req, 'admin')
  if (access instanceof NextResponse) return access
  if (!billingConfigured()) return NextResponse.json({ error: 'Il pagamento online arriva presto: scrivici su WhatsApp.' }, { status: 503 })
  try {
    const state = await readBillingState(access.workspace.id)
    if (!state.customerId) return NextResponse.json({ error: 'Non hai ancora un abbonamento: scegli un piano.' }, { status: 409 })
    return NextResponse.json({ url: await createPortalSession(state.customerId, appUrl(req)) })
  } catch (error) {
    console.error('portale abbonamento:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Gestione abbonamento non disponibile ora, riprova tra poco.' }, { status: 502 })
  }
}
