import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { completeOAuth, verifyOAuthState } from '@/lib/gmail'
import { SITE_URL } from '@/lib/seo/site'

export const dynamic = 'force-dynamic'

/** Ritorno da Google dopo il consenso: salva la casella e attiva il canale email. */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams
  const back = (result: string) => NextResponse.redirect(`${SITE_URL}/admin/control?tab=channels&email=${result}`)

  if (!verifyOAuthState(params.get('state'))) return back('invalid')
  const code = params.get('code')
  if (!code) return back('denied')

  try {
    const settings = await completeOAuth(code)
    // Canale email: parte con le risposte da approvare, come gli altri.
    const { data: existing } = await supabaseAdmin
      .from('social_channels')
      .select('id')
      .eq('platform', 'email')
      .maybeSingle()
    if (existing) {
      await supabaseAdmin
        .from('social_channels')
        .update({ status: 'connected', handle: settings.email })
        .eq('id', existing.id)
    } else {
      await supabaseAdmin.from('social_channels').insert({
        platform: 'email',
        display_name: 'Email',
        handle: settings.email,
        status: 'connected',
        reply_mode: 'approval',
      })
    }
    return back('connected')
  } catch (error) {
    console.error('gmail oauth:', error)
    return back('error')
  }
}
