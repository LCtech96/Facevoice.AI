import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAdminEmail } from '@/lib/admin-request'
import { canAccess, getStaffAccess } from '@/lib/staff-access'
import {
  buildAuthUrl,
  createOAuthState,
  disconnectGmail,
  isGmailConfigured,
  loadGmailSettings,
} from '@/lib/gmail'
import { pollGmail } from '@/lib/gmail-poll'

export const dynamic = 'force-dynamic'

/** Stato della casella email collegata (mai il token). */
export async function GET(req: NextRequest) {
  if (!canAccess(await getStaffAccess(req), 'control', 'view')) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }
  const settings = await loadGmailSettings()
  return NextResponse.json({
    configured: isGmailConfigured(),
    cron: Boolean(process.env.CRON_SECRET?.trim()),
    connected: Boolean(settings),
    email: settings?.email ?? null,
    connectedAt: settings?.connectedAt ?? null,
  })
}

/** body.action: 'connect' -> URL di Google da aprire; 'sync' -> controlla subito le nuove email. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))

  // Controllo nuove email: lo fa anche la casella Messaggi aperta da un dipendente.
  if (body?.action === 'sync') {
    if (!canAccess(await getStaffAccess(req), 'inbox', 'view')) {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
    }
    return NextResponse.json(await pollGmail())
  }

  // Collegare la casella resta solo dell'admin.
  const admin = await getAdminEmail(req)
  if (!admin) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })

  if (body?.action === 'connect') {
    if (!isGmailConfigured()) {
      return NextResponse.json(
        { error: 'Mancano GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET nelle variabili di Vercel.' },
        { status: 400 }
      )
    }
    return NextResponse.json({ url: buildAuthUrl(createOAuthState(admin), admin) })
  }

  return NextResponse.json({ error: 'Azione non valida' }, { status: 400 })
}

/** Scollega la casella: revoca il token e ferma l'agente sul canale email. */
export async function DELETE(req: NextRequest) {
  if (!(await getAdminEmail(req))) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  await disconnectGmail()
  await supabaseAdmin.from('social_channels').update({ status: 'not_connected' }).eq('platform', 'email')
  return NextResponse.json({ success: true })
}
