import { NextRequest, NextResponse } from 'next/server'

const RESEND_API_KEY = process.env.RESEND_API_KEY

export async function GET(req: NextRequest) {
  try {
    // Verifica che la chiave API sia configurata
    if (!RESEND_API_KEY) {
      return NextResponse.json({
        success: false,
        error: 'RESEND_API_KEY non configurata',
        message: 'Aggiungi RESEND_API_KEY nelle variabili d\'ambiente di Vercel',
        hasApiKey: false
      }, { status: 500 })
    }

    // Prova a inviare un'email di test
    const testEmailData = {
      from: 'FacevoiceAI <onboarding@resend.dev>',
      to: 'luca@facevoice.ai',
      subject: 'Test Email da Facevoice AI',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333;">Test Email da Resend</h2>
          <p>Questa è un'email di test per verificare la configurazione di Resend.</p>
          <p>Se ricevi questa email, significa che Resend è configurato correttamente!</p>
          <p style="color: #666; font-size: 12px; margin-top: 20px;">
            Inviato il ${new Date().toLocaleString('it-IT')}
          </p>
        </div>
      `,
      text: 'Test Email da Facevoice AI\n\nQuesta è un\'email di test per verificare la configurazione di Resend.'
    }

    console.log('Sending test email via Resend...', {
      from: testEmailData.from,
      to: testEmailData.to,
      hasApiKey: !!RESEND_API_KEY,
      apiKeyPrefix: RESEND_API_KEY?.substring(0, 10) + '...'
    })

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testEmailData),
    })

    let responseData: any = {}
    try {
      responseData = await response.json()
    } catch (e) {
      responseData = { error: 'Failed to parse response', raw: await response.text() }
    }

    if (!response.ok) {
      return NextResponse.json({
        success: false,
        error: 'Errore nell\'invio email',
        status: response.status,
        statusText: response.statusText,
        details: responseData,
        message: responseData.message || responseData.error || 'Errore sconosciuto',
        hasApiKey: true
      }, { status: response.status })
    }

    return NextResponse.json({
      success: true,
      message: 'Email di test inviata con successo!',
      emailId: responseData.id,
      hasApiKey: true,
      response: responseData
    })

  } catch (error: any) {
    console.error('Error in test-resend:', error)
    return NextResponse.json({
      success: false,
      error: 'Errore interno',
      message: error.message,
      hasApiKey: !!RESEND_API_KEY
    }, { status: 500 })
  }
}

