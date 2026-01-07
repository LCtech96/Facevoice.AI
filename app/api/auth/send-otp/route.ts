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
    
    if (RESEND_API_KEY) {
      try {
        const emailData = {
          from: 'FacevoiceAI <noreply@facevoice.ai>',
          to: email,
          subject: 'Codice di verifica Facevoice AI',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #333;">Il tuo codice di verifica</h2>
              <p>Ciao!</p>
              <p>Il tuo codice di verifica per accedere a Facevoice AI è:</p>
              <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0; text-align: center;">
                <h1 style="color: #007bff; font-size: 32px; letter-spacing: 5px; margin: 0;">${code}</h1>
              </div>
              <p>Questo codice scade tra <strong>10 minuti</strong>.</p>
              <p style="color: #666; font-size: 12px; margin-top: 20px;">
                Se non hai richiesto questo codice, puoi ignorare questa email.
              </p>
            </div>
          `,
          text: `Il tuo codice di verifica Facevoice AI è: ${code}\n\nQuesto codice scade tra 10 minuti.\n\nSe non hai richiesto questo codice, puoi ignorare questa email.`,
        }
        
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(emailData),
        })
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          console.error('Resend API error:', errorData)
          // Logga il codice anche in caso di errore per debug
          console.log(`OTP per ${email}: ${code} (email non inviata a causa di errore Resend)`)
          // Non bloccare la risposta, ma avvisa che l'email potrebbe non essere arrivata
        } else {
          console.log('OTP email sent successfully to', email)
        }
      } catch (emailError: any) {
        console.error('Error sending OTP email:', emailError)
        // Logga il codice anche in caso di errore per debug
        console.log(`OTP per ${email}: ${code} (email non inviata a causa di errore)`)
        // Non bloccare la risposta
      }
    } else {
      // Resend non configurato - logga il codice per debug
      console.log(`OTP per ${email}: ${code}`)
      console.warn('RESEND_API_KEY non configurato. Configura Resend per inviare email.')
    }

    return NextResponse.json({
      success: true,
      message: RESEND_API_KEY 
        ? 'Codice di verifica inviato. Controlla la tua email.' 
        : 'Codice di verifica generato. Controlla i log del server per il codice.',
      // Restituiamo sempre il codice per ora (da rimuovere in produzione quando l'email funziona)
      code,
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

