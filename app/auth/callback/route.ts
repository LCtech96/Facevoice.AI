import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const token = requestUrl.searchParams.get('token')
  const type = requestUrl.searchParams.get('type')

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  if (code) {
    // Exchange code for session (OAuth callback)
    await supabase.auth.exchangeCodeForSession(code)
  } else if (token && type === 'magiclink') {
    // Verify magic link token
    const { error } = await supabase.auth.verifyOtp({
      token_hash: token,
      type: 'magiclink',
    })

    if (error) {
      console.error('Magic link verification error:', error)
      // Redirect to auth page with error
      return NextResponse.redirect(new URL('/auth?error=verification_failed', request.url))
    }
  }

  // Redirect to AI Chat page
  return NextResponse.redirect(new URL('/ai-chat', request.url))
}

