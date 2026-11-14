import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAdminEmail } from '@/lib/admin-request'
import { canAccess, getStaffAccess } from '@/lib/staff-access'
import {
  TIKTOK_SCOPES,
  TikTokError,
  buildTikTokAuthUrl,
  createTikTokState,
  disconnectTikTok,
  getTikTokProfile,
  isTikTokConfigured,
  listTikTokVideos,
  loadTikTokConnection,
} from '@/lib/tiktok'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

/** Stato del collegamento con TikTok: profilo, numeri e ultimi video (mai i token). */
export async function GET(req: NextRequest) {
  if (!canAccess(await getStaffAccess(req), 'control', 'view')) return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  const configured = isTikTokConfigured()
  const connection = configured ? await loadTikTokConnection().catch(() => null) : null
  if (!connection) return NextResponse.json({ configured, connected: false }, { headers: NO_STORE })
  const missingScopes = TIKTOK_SCOPES.filter((s) => !connection.scopes.includes(s))
  const [profile, videos] = await Promise.allSettled([
    getTikTokProfile(),
    connection.scopes.includes('video.list') ? listTikTokVideos(12) : Promise.resolve([]),
  ])
  const problem = [profile, videos].find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined
  return NextResponse.json(
    {
      configured,
      connected: true,
      connectedAt: connection.connectedAt,
      missingScopes,
      profile: profile.status === 'fulfilled' ? profile.value : null,
      videos: videos.status === 'fulfilled' ? videos.value : [],
      error: problem ? (problem.reason instanceof Error ? problem.reason.message : 'TikTok non risponde') : null,
      needsReconnect: problem?.reason instanceof TikTokError && problem.reason.code === 'access_token_invalid',
    },
    { headers: NO_STORE }
  )
}

/** { action: 'connect' } -> indirizzo di TikTok da aprire (solo l'admin). */
export async function POST(req: NextRequest) {
  const admin = await getAdminEmail(req)
  if (!admin) return NextResponse.json({ error: 'Solo l’amministratore può collegare TikTok.' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  if (body?.action !== 'connect') return NextResponse.json({ error: 'Azione non valida' }, { status: 400 })
  if (!isTikTokConfigured()) return NextResponse.json({ error: 'Mancano TIKTOK_CLIENT_KEY e TIKTOK_CLIENT_SECRET nelle variabili di Vercel.' }, { status: 400 })
  try {
    return NextResponse.json({ url: buildTikTokAuthUrl(createTikTokState(admin)) }, { headers: NO_STORE })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Collegamento non disponibile' }, { status: 500 })
  }
}

/** Scollega TikTok: revoca il token e segna il canale come non collegato. */
export async function DELETE(req: NextRequest) {
  if (!(await getAdminEmail(req))) return NextResponse.json({ error: 'Solo l’amministratore può scollegare TikTok.' }, { status: 401 })
  try {
    await disconnectTikTok()
    await supabaseAdmin.from('social_channels').update({ status: 'not_connected' }).eq('platform', 'tiktok')
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Non riuscito' }, { status: 500 })
  }
}
