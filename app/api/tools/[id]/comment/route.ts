import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

// Usa SERVICE_ROLE_KEY per bypassare RLS e permettere commenti pubblici
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Funzione per inviare email di verifica
async function sendVerificationEmail(email: string, verificationLink: string, userName: string) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY
  
  console.log('Attempting to send verification email...')
  console.log('RESEND_API_KEY exists:', !!RESEND_API_KEY)
  console.log('Email:', email)
  console.log('Link:', verificationLink)
  
  if (RESEND_API_KEY) {
    try {
        const emailData = {
            from: 'FacevoiceAI <noreply@facevoice.ai>', // Cambiato da onboarding@resend.dev
            to: email,
            subject: 'Verifica il tuo commento su FacevoiceAI',
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #333;">Ciao ${userName}!</h2>
                <p>Grazie per aver lasciato un commento su FacevoiceAI.</p>
                <p>Per pubblicare il tuo commento, clicca sul link qui sotto per verificare la tua email:</p>
                <p style="text-align: center; margin: 30px 0;">
                  <a href="${verificationLink}" 
                     style="background-color: #007bff; color: white; padding: 12px 24px; 
                            text-decoration: none; border-radius: 5px; display: inline-block;">
                    Verifica Email
                  </a>
                </p>
                <p style="color: #666; font-size: 12px;">
                  Oppure copia e incolla questo link nel browser:<br>
                  <span style="word-break: break-all;">${verificationLink}</span>
                </p>
                <p style="color: #666; font-size: 12px;">
                  Questo link scadrà tra 24 ore. Se non hai richiesto questo commento, puoi ignorare questa email.
                </p>
              </div>
            `,
          }
      
      console.log('Sending email via Resend API...')
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(emailData),
      })
      
      const responseData = await response.json().catch(() => ({}))
      console.log('Resend API response status:', response.status)
      console.log('Resend API response data:', JSON.stringify(responseData, null, 2))
      
      if (!response.ok) {
        console.error('Resend API error:', responseData)
        throw new Error(`Failed to send email: ${responseData.message || response.statusText}`)
      }
      
      console.log('Email sent successfully!')
      return true
    } catch (error: any) {
      console.error('Error sending verification email:', error)
      console.error('Error details:', error.message, error.stack)
      throw error
    }
  } else {
    // In sviluppo, logga l'email invece di inviarla
    console.log('=== EMAIL DI VERIFICA (SVILUPPO - RESEND_API_KEY non configurato) ===')
    console.log('To:', email)
    console.log('Link:', verificationLink)
    console.log('=====================================')
    return true
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json()
    const { userId, comment, userName, userEmail } = body

    // Validazione
    if (!comment || !comment.trim()) {
      return NextResponse.json({ error: 'Il commento è obbligatorio' }, { status: 400 })
    }

    if (!userEmail || !userEmail.trim()) {
      return NextResponse.json({ error: 'L\'email è obbligatoria per pubblicare un commento' }, { status: 400 })
    }

    // Validazione formato email base
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(userEmail.trim())) {
      return NextResponse.json({ error: 'Formato email non valido' }, { status: 400 })
    }

    // Genera token di verifica
    const verificationToken = crypto.randomBytes(32).toString('hex')
    const verificationExpiresAt = new Date()
    verificationExpiresAt.setHours(verificationExpiresAt.getHours() + 24) // Scade dopo 24 ore

    // Permetti commenti anonimi - genera un ID temporaneo se non fornito
    const finalUserId = userId || `anon_${Date.now()}_${Math.random().toString(36).substring(7)}`
    const finalUserName = userName || userEmail.split('@')[0] || 'Guest'

    // Aggiungi commento (non verificato)
    const { data, error } = await supabase
      .from('tool_comments')
      .insert({
        tool_id: params.id,
        user_id: finalUserId,
        user_name: finalUserName,
        user_email: userEmail.trim().toLowerCase(),
        comment: comment.trim(),
        is_verified: false,
        verification_token: verificationToken,
        verification_expires_at: verificationExpiresAt.toISOString(),
        created_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) {
      console.error('Error adding comment:', error)
      console.error('Error details:', JSON.stringify(error, null, 2))
      return NextResponse.json({ 
        error: 'Errore nel salvare il commento',
        details: error.message 
      }, { status: 500 })
    }

    // Genera link di verifica - usa sempre il dominio principale in produzione
    const getBaseUrl = () => {
      // Priorità 1: Variabile d'ambiente esplicita
      if (process.env.NEXT_PUBLIC_BASE_URL) {
        return process.env.NEXT_PUBLIC_BASE_URL
      }
      
      // Priorità 2: Dominio principale (facevoice.ai) in produzione
      const host = request.headers.get('host') || ''
      if (host.includes('facevoice.ai')) {
        const protocol = request.headers.get('x-forwarded-proto') || 'https'
        return `${protocol}://${host.includes('www.') ? host : 'www.' + host.replace('www.', '')}`
      }
      
      // Priorità 3: Origin dalla richiesta (ma evita domini Vercel di default)
      const origin = request.headers.get('origin')
      if (origin && !origin.includes('vercel.app') && !origin.includes('localhost')) {
        return origin
      }
      
      // Priorità 4: Costruisci da host (ma evita vercel.app)
      if (host && !host.includes('vercel.app') && !host.includes('localhost')) {
        const protocol = request.headers.get('x-forwarded-proto') || 'https'
        return `${protocol}://${host}`
      }
      
      // Fallback: usa facevoice.ai in produzione, localhost in sviluppo
      if (process.env.NODE_ENV === 'production') {
        return 'https://www.facevoice.ai'
      }
      
      return 'http://localhost:3000'
    }
    
    const baseUrl = getBaseUrl()
    const verificationLink = `${baseUrl}/api/tools/comments/verify?token=${verificationToken}`
    
    console.log('Generated verification link:', verificationLink)
    console.log('Base URL source:', {
      NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
      host: request.headers.get('host'),
      origin: request.headers.get('origin'),
      finalBaseUrl: baseUrl
    })

    // Invia email di verifica
    let emailSent = false
    let emailError: any = null
    try {
      await sendVerificationEmail(userEmail.trim(), verificationLink, finalUserName)
      emailSent = true
      console.log('✅ Verification email sent successfully to:', userEmail.trim())
    } catch (err) {
      emailError = err
      console.error('❌ Error sending verification email:', err)
      // Logga il link di verifica nella console per sviluppo
      console.log('=== LINK DI VERIFICA (fallback) ===')
      console.log('Email:', userEmail.trim())
      console.log('Link:', verificationLink)
      console.log('=====================================')
      // Non fallire se l'email non viene inviata, ma logga l'errore
    }

    // Conta solo i commenti verificati
    const { count } = await supabase
      .from('tool_comments')
      .select('*', { count: 'exact', head: true })
      .eq('tool_id', params.id)
      .eq('is_verified', true)

    // Prova ad aggiornare ai_tools, ma non fallire se la tabella non esiste
    try {
      await supabase
        .from('ai_tools')
        .update({ comments: count || 0 })
        .eq('id', params.id)
    } catch (updateError) {
      console.warn('Could not update comment count in ai_tools:', updateError)
    }

    // Determina se l'email è stata inviata o solo loggata
    const hasResendKey = !!process.env.RESEND_API_KEY
    
    return NextResponse.json({ 
      success: true, 
      comment: data,
      comments: count || 0,
      message: emailSent 
        ? 'Commento salvato! Controlla la tua email per verificarlo e pubblicarlo.'
        : hasResendKey
        ? `Commento salvato! Errore nell'invio email: ${emailError?.message || 'Sconosciuto'}. Link di verifica: ${verificationLink}`
        : 'Commento salvato! Controlla i log del server per il link di verifica.',
      requiresVerification: true,
      verificationLink: emailSent ? undefined : verificationLink, // Invia il link se email non inviata
      emailError: emailError ? emailError.message : undefined
    })
  } catch (error) {
    console.error('Error in POST /api/tools/[id]/comment:', error)
    return NextResponse.json({ error: 'Errore interno del server' }, { status: 500 })
  }
}
