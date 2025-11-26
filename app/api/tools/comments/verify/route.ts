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

    // Determina l'URL base per il redirect - usa sempre il dominio principale in produzione
    const getBaseUrl = () => {
      // Priorità 1: Variabile d'ambiente esplicita
      if (process.env.NEXT_PUBLIC_BASE_URL) {
        return process.env.NEXT_PUBLIC_BASE_URL
      }
      
      // Priorità 2: Dominio principale (facevoice.ai) in produzione
      const host = request.headers.get('host') || ''
      if (host.includes('facevoice.ai')) {
        const protocol = request.headers.get('x-forwarded-proto') || 'https'
        // Assicurati di usare www.facevoice.ai
        if (host.includes('www.')) {
          return `${protocol}://${host}`
        } else {
          return `${protocol}://www.facevoice.ai`
        }
      }
      
      // Priorità 3: In produzione, usa sempre facevoice.ai
      if (process.env.NODE_ENV === 'production') {
        return 'https://www.facevoice.ai'
      }
      
      // Fallback: localhost in sviluppo
      return 'http://localhost:3000'
    }
    
    const baseUrl = getBaseUrl()
    const redirectUrl = `${baseUrl}/home?tool=${comment.tool_id}&verified=success`
    
    console.log('Comment verified successfully:', {
      commentId: comment.id,
      toolId: comment.tool_id,
      redirectUrl,
      baseUrl
    })
    
    // Reindirizza alla pagina home con il tool evidenziato
    return NextResponse.redirect(redirectUrl)
  } catch (error) {
    console.error('Error in GET /api/tools/comments/verify:', error)
    return NextResponse.redirect(new URL('/home?error=internal-error', request.url))
  }
}

