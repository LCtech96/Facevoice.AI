import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace'
import { customerUsageStatus } from '@/lib/usage-limits'

export const dynamic = 'force-dynamic'

// Consumo dell'AI per l'area clienti: solo il gettone acceso (verde, arancione,
// rosso), se l'AI e' ferma e perche' (limite del piano o nessun piano attivo),
// quanti giorni mancano al nuovo periodo e se i pagamenti online sono attivi.
// Niente euro e niente token: quelli li vede solo Facevoice.

export async function GET(req: NextRequest) {
  const access = await requireWorkspace(req)
  if (access instanceof NextResponse) return access
  try {
    const { shown, blocked, daysLeft, periodEnd, reason, billing, trialAvailable } = await customerUsageStatus(access.workspace.id)
    return NextResponse.json(
      { shown, blocked, daysLeft, periodEnd, billing: Boolean(billing), ...(reason ? { reason } : {}), ...(trialAvailable !== undefined ? { trialAvailable } : {}) },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('consumo AI cliente:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Consumo non disponibile' }, { status: 500 })
  }
}
