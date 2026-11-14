import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isAdminEmail } from '@/lib/admin-auth'
import { completeTikTokOAuth, verifyTikTokState } from '@/lib/tiktok'
import { SITE_URL } from '@/lib/seo/site'

export const dynamic = 'force-dynamic'

/** Ritorno da TikTok dopo il consenso: salva il collegamento e segna il canale TikTok come collegato. */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const back = (result: string) => NextResponse.redirect(`${SITE_URL}/admin/overview?tiktok=${result}`)

  const admin = verifyTikTokState(params.get('state'))
  if (!admin || !isAdminEmail(admin)) return back('invalid')
  const code = params.get('code')
  if (params.get('error') || !code) return back('denied')

  try {
    const { profile } = await completeTikTokOAuth(code, admin)
    const handle = profile?.username ? `@${profile.username}` : profile?.displayName || null
    const { data: existing } = await supabaseAdmin.from('social_channels').select('id').eq('platform', 'tiktok').maybeSingle()
    if (existing) {
      await supabaseAdmin.from('social_channels').update({ status: 'connected', ...(handle ? { handle } : {}) }).eq('id', existing.id)
    } else {
      await supabaseAdmin.from('social_channels').insert({ platform: 'tiktok', display_name: 'TikTok', handle, status: 'connected', reply_mode: 'approval' })
    }
    return back('connected')
  } catch (error) {
    console.error('tiktok oauth:', error instanceof Error ? error.message : error)
    return back('error')
  }
}
