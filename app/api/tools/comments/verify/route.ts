import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')

    if (!token) {
      return NextResponse.redirect(new URL('/home?error=token-missing', request.url))
    }

    // Trova il commento con questo token
    const { data: comment, error: findError } = await supabase
      .from('tool_comments')
      .select('*')
      .eq('verification_token', token)
      .single()

    if (findError || !comment) {
      return NextResponse.redirect(new URL('/home?error=invalid-token', request.url))
    }

    // Verifica se il token è scaduto
    const now = new Date()
    const expiresAt = new Date(comment.verification_expires_at)
    if (now > expiresAt) {
      return NextResponse.redirect(new URL('/home?error=token-expired', request.url))
    }

    // Verifica se è già stato verificato
    if (comment.is_verified) {
      return NextResponse.redirect(new URL(`/home?tool=${comment.tool_id}&verified=already`, request.url))
    }

    // Verifica il commento
    const { error: updateError } = await supabase
      .from('tool_comments')
      .update({
        is_verified: true,
        verified_at: new Date().toISOString(),
      })
      .eq('id', comment.id)

    if (updateError) {
      console.error('Error verifying comment:', updateError)
      return NextResponse.redirect(new URL('/home?error=verification-failed', request.url))
    }

    // Aggiorna contatore commenti verificati
    const { count } = await supabase
      .from('tool_comments')
      .select('*', { count: 'exact', head: true })
      .eq('tool_id', comment.tool_id)
      .eq('is_verified', true)

    try {
      await supabase
        .from('ai_tools')
        .update({ comments: count || 0 })
        .eq('id', comment.tool_id)
    } catch (updateError) {
      console.warn('Could not update comment count:', updateError)
    }

    // Determina l'URL base per il redirect
    const getBaseUrl = () => {
      if (process.env.NEXT_PUBLIC_BASE_URL) {
        return process.env.NEXT_PUBLIC_BASE_URL
      }
      const host = request.headers.get('host') || ''
      if (host.includes('facevoice.ai')) {
        const protocol = request.headers.get('x-forwarded-proto') || 'https'
        return `${protocol}://${host.includes('www.') ? host : 'www.' + host.replace('www.', '')}`
      }
      const origin = request.headers.get('origin')
      if (origin && !origin.includes('vercel.app')) {
        return origin
      }
      if (process.env.NODE_ENV === 'production') {
        return 'https://www.facevoice.ai'
      }
      return 'http://localhost:3000'
    }
    
    const baseUrl = getBaseUrl()
    // Reindirizza alla pagina home con il tool evidenziato
    return NextResponse.redirect(new URL(`/home?tool=${comment.tool_id}&verified=success`, baseUrl))
  } catch (error) {
    console.error('Error in GET /api/tools/comments/verify:', error)
    return NextResponse.redirect(new URL('/home?error=internal-error', request.url))
  }
}

