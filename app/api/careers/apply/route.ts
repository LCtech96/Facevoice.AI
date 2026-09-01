import { NextRequest, NextResponse } from 'next/server'

const RESEND_API_KEY = process.env.RESEND_API_KEY

export async function POST(req: NextRequest) {
  try {
    const { name, email, phone, message } = await req.json()

    if (!name || !email || !phone) {
      return NextResponse.json(
        { error: 'Nome, email e telefono sono obbligatori' },
        { status: 400 }
      )
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Email non valida' },
        { status: 400 }
      )
    }

    if (!RESEND_API_KEY) {
      console.warn('RESEND_API_KEY non configurato. Candidatura non inviata via email.')
      return NextResponse.json({
        success: true,
        emailSent: false,
        message: 'Richiesta ricevuta (email non inviata - configurazione mancante)',
      })
    }

    const fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev'
    const toEmail = process.env.RESEND_TO_EMAIL || 'luca@facevoice.ai'

    const emailData = {
      from: `FacevoiceAI <${fromEmail}>`,
      to: toEmail,
      subject: `FACEVOICEAI — Nuova candidatura "Lavora con noi" da ${name.trim()}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
          <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
            <div style="background: linear-gradient(135deg, #007AFF, #5856D6); color: white; padding: 20px; border-radius: 8px; margin-bottom: 24px;">
              <h1 style="margin: 0; font-size: 22px;">FACEVOICEAI</h1>
              <p style="margin: 8px 0 0; opacity: 0.9; font-size: 14px;">
                Nuova richiesta dal sito web — Sezione "Lavora con noi"
              </p>
            </div>

            <h2 style="color: #333; border-bottom: 2px solid #007bff; padding-bottom: 10px;">
              Dati del candidato
            </h2>

            <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #666; width: 140px;">Nome:</td>
                <td style="padding: 8px 0; color: #333;">${name.trim()}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #666;">Email:</td>
                <td style="padding: 8px 0; color: #333;">${email.trim()}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold; color: #666;">Telefono:</td>
                <td style="padding: 8px 0; color: #333;">${phone.trim()}</td>
              </tr>
            </table>

            ${message ? `
            <div style="margin-top: 20px; padding: 15px; background-color: #f8f9fa; border-left: 4px solid #007bff; border-radius: 5px;">
              <h4 style="color: #007bff; margin-top: 0; margin-bottom: 10px;">Messaggio:</h4>
              <p style="color: #333; margin: 0; white-space: pre-wrap;">${message.trim()}</p>
            </div>
            ` : ''}

            <div style="margin-top: 24px; padding: 12px; background-color: #e7f3ff; border-radius: 5px;">
              <p style="color: #666; margin: 0; font-size: 12px;">
                Ricevuta il ${new Date().toLocaleString('it-IT')} da www.facevoice.ai
              </p>
            </div>
          </div>
        </div>
      `,
      text: `
FACEVOICEAI — Nuova richiesta dal sito web
Sezione: Lavora con noi

Dati del candidato:
- Nome: ${name.trim()}
- Email: ${email.trim()}
- Telefono: ${phone.trim()}
${message ? `\nMessaggio:\n${message.trim()}` : ''}

Ricevuta il ${new Date().toLocaleString('it-IT')} da www.facevoice.ai
      `.trim(),
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(emailData),
    })

    const responseData = await response.json().catch(() => ({}))

    if (!response.ok) {
      console.error('Resend API error:', responseData)
      return NextResponse.json(
        { error: 'Errore nell\'invio dell\'email' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      emailSent: true,
      message: 'Candidatura inviata con successo',
    })
  } catch (error) {
    console.error('Error in POST /api/careers/apply:', error)
    return NextResponse.json(
      { error: 'Errore interno del server' },
      { status: 500 }
    )
  }
}
