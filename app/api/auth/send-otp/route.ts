import { NextRequest, NextResponse } from 'next/server'

// Store temporaneo per i codici OTP (in produzione usa Redis o database)
const otpStore = new Map<string, { code: string; expiresAt: number; email: string }>()

// Genera un codice OTP di 6 cifre
function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json()

    if (!email || !email.includes('@')) {
      return NextResponse.json(
        { error: 'Indirizzo email non valido' },
        { status: 400 }
      )
    }

    // Genera codice OTP
    const code = generateOTP()
    const expiresAt = Date.now() + 10 * 60 * 1000 // 10 minuti

    // Salva il codice nello store temporaneo
    otpStore.set(email.toLowerCase(), {
      code,
      expiresAt,
      email: email.toLowerCase(),
    })

    // Invia email con codice OTP usando Resend (se configurato)
    const RESEND_API_KEY = process.env.RESEND_API_KEY
    const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL
    
    if (RESEND_API_KEY) {
      try {
        // Usa email mittente configurata (consigliato: dominio verificato su Resend)
        const fromEmail = RESEND_FROM_EMAIL || 'onboarding@resend.dev'
        
        const emailData = {
          from: `FacevoiceAI <${fromEmail}>`,
          to: email,
          subject: 'Codice di verifica - Conferma il tuo account Facevoice AI',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #333;">Conferma il tuo account</h2>
              <p>Ciao!</p>
              <p>Grazie per esserti registrato su Facevoice AI. Per completare la registrazione e verificare la tua email, inserisci questo codice di verifica:</p>
              <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0; text-align: center;">
                <h1 style="color: #007bff; font-size: 32px; letter-spacing: 5px; margin: 0;">${code}</h1>
              </div>
              <p>Inserisci questo codice nella pagina di verifica per attivare il tuo account.</p>
              <p>Questo codice scade tra <strong>10 minuti</strong>.</p>
              <p style="color: #666; font-size: 12px; margin-top: 20px;">
                Se non hai richiesto questo codice, puoi ignorare questa email.
              </p>
            </div>
          `,
          text: `Conferma il tuo account Facevoice AI\n\nIl tuo codice di verifica è: ${code}\n\nInserisci questo codice nella pagina di verifica per attivare il tuo account.\n\nQuesto codice scade tra 10 minuti.\n\nSe non hai richiesto questo codice, puoi ignorare questa email.`,
        }
        
        console.log('Sending OTP email via Resend...', { to: email, from: fromEmail })
        
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(emailData),
        })
        
        const responseData = await response.json().catch(() => ({}))
        
        if (!response.ok) {
          console.error('Resend API error response:', {
            status: response.status,
            statusText: response.statusText,
            data: responseData,
          })
          return NextResponse.json(
            { error: responseData.message || 'Errore nell\'invio dell\'email' },
            { status: response.status }
          )
        } else {
          console.log('OTP email sent successfully:', {
            to: email,
            id: responseData.id,
            code: code,
          })
        }
      } catch (emailError: any) {
        console.error('Error sending OTP email:', emailError)
        return NextResponse.json(
          { error: emailError.message || 'Errore nell\'invio dell\'email' },
          { status: 500 }
        )
      }
    } else {
      return NextResponse.json(
        { error: 'RESEND_API_KEY non configurato. Configura Resend per inviare email.' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Codice di verifica inviato. Controlla la tua email.',
      code: process.env.NODE_ENV === 'development' ? code : undefined,
    })
  } catch (error: any) {
    console.error('Error in send-otp:', error)
    return NextResponse.json(
      { error: error.message || 'Errore nell\'invio del codice' },
      { status: 500 }
    )
  }
}

// Funzione helper per verificare e ottenere il codice OTP
export function getOTP(email: string): { code: string; expiresAt: number } | null {
  const stored = otpStore.get(email.toLowerCase())
  if (!stored || Date.now() > stored.expiresAt) {
    otpStore.delete(email.toLowerCase())
    return null
  }
  return { code: stored.code, expiresAt: stored.expiresAt }
}

// Funzione helper per rimuovere il codice OTP dopo l'uso
export function deleteOTP(email: string) {
  otpStore.delete(email.toLowerCase())
}

