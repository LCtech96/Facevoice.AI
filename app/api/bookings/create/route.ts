import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const RESEND_API_KEY = process.env.RESEND_API_KEY

export async function POST(req: NextRequest) {
  try {
    const { name, email, whatsapp, service, datetime } = await req.json()

    if (!name || !email || !whatsapp || !service) {
      return NextResponse.json(
        { error: 'Tutti i campi sono obbligatori' },
        { status: 400 }
      )
    }

    // Valida email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Email non valida' },
        { status: 400 }
      )
    }

    // Formatta datetime se presente
    let formattedDateTime = null
    if (datetime && typeof datetime === 'object' && datetime.date && datetime.time) {
      try {
        formattedDateTime = new Date(`${datetime.date}T${datetime.time}`).toISOString()
      } catch (error) {
        console.error('Error formatting datetime:', error)
        formattedDateTime = null
      }
    }

    // Salva la prenotazione nel database
    const { data, error } = await supabaseAdmin
      .from('bookings')
      .insert({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        whatsapp: whatsapp.trim(),
        service: service.trim(),
        datetime: formattedDateTime,
        status: 'pending',
        created_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) {
      console.error('❌ Error creating booking in database:', {
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint
      })
      return NextResponse.json(
        { 
          error: 'Errore nel salvare la prenotazione',
          details: process.env.NODE_ENV === 'development' ? error.message : undefined
        },
        { status: 500 }
      )
    }

    console.log('✅ Booking saved successfully:', {
      bookingId: data.id,
      name: data.name,
      email: data.email,
      datetime: data.datetime
    })

    // Invia email con Resend
    if (!RESEND_API_KEY) {
      console.warn('⚠️ RESEND_API_KEY non configurato. Email di prenotazione non verrà inviata.')
      console.log('Prenotazione salvata nel database ma email non inviata.')
    } else {
      try {
        const formattedDate = formattedDateTime 
          ? new Date(formattedDateTime).toLocaleString('it-IT', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })
          : 'Non specificata'

        const emailData = {
          from: 'FacevoiceAI <onboarding@resend.dev>',
          to: 'luca@facevoice.ai',
          subject: `Nuova Prenotazione da ${name.trim()}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5;">
              <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <h2 style="color: #333; border-bottom: 2px solid #007bff; padding-bottom: 10px;">
                  Nuova Prenotazione da Facevoice AI
                </h2>
                
                <div style="margin-top: 20px;">
                  <h3 style="color: #007bff; margin-bottom: 15px;">Informazioni Cliente</h3>
                  
                  <table style="width: 100%; border-collapse: collapse;">
                    <tr>
                      <td style="padding: 8px 0; font-weight: bold; color: #666; width: 150px;">Nome:</td>
                      <td style="padding: 8px 0; color: #333;">${name.trim()}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; font-weight: bold; color: #666;">Email:</td>
                      <td style="padding: 8px 0; color: #333;">${email.trim()}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; font-weight: bold; color: #666;">WhatsApp:</td>
                      <td style="padding: 8px 0; color: #333;">${whatsapp.trim()}</td>
                    </tr>
                    <tr>
                      <td style="padding: 8px 0; font-weight: bold; color: #666;">Data e Ora:</td>
                      <td style="padding: 8px 0; color: #333;">${formattedDate}</td>
                    </tr>
                  </table>
                  
                  <div style="margin-top: 20px; padding: 15px; background-color: #f8f9fa; border-left: 4px solid #007bff; border-radius: 5px;">
                    <h4 style="color: #007bff; margin-top: 0; margin-bottom: 10px;">Motivo del Booking:</h4>
                    <p style="color: #333; margin: 0; white-space: pre-wrap;">${service.trim()}</p>
                  </div>
                  
                  <div style="margin-top: 20px; padding: 15px; background-color: #e7f3ff; border-radius: 5px;">
                    <p style="color: #666; margin: 0; font-size: 12px;">
                      Prenotazione ricevuta il ${new Date().toLocaleString('it-IT')}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          `,
          text: `
Nuova Prenotazione da Facevoice AI

Informazioni Cliente:
- Nome: ${name.trim()}
- Email: ${email.trim()}
- WhatsApp: ${whatsapp.trim()}
- Data e Ora: ${formattedDate}

Motivo del Booking:
${service.trim()}

Prenotazione ricevuta il ${new Date().toLocaleString('it-IT')}
          `.trim(),
        }

        console.log('Attempting to send booking email via Resend...', {
          from: emailData.from,
          to: emailData.to,
          subject: emailData.subject,
          hasApiKey: !!RESEND_API_KEY,
          apiKeyLength: RESEND_API_KEY?.length || 0
        })

        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(emailData),
        })

        let responseData: any = {}
        try {
          responseData = await response.json()
        } catch (e) {
          responseData = { error: 'Failed to parse response', raw: await response.text() }
        }
        
        console.log('Resend API response:', {
          status: response.status,
          statusText: response.statusText,
          data: responseData
        })

        if (!response.ok) {
          const errorMessage = responseData.message || responseData.error || response.statusText
          console.error('❌ Resend API error:', {
            status: response.status,
            statusText: response.statusText,
            error: errorMessage,
            fullResponse: responseData
          })
          
          // Ritorna un warning nella risposta se in development
          if (process.env.NODE_ENV === 'development') {
            console.warn('⚠️ Email non inviata. Errore:', errorMessage)
          }
        } else {
          console.log('✅ Booking email sent successfully to luca@facevoice.ai', {
            emailId: responseData.id,
            message: 'Email inviata con successo'
          })
        }
      } catch (emailError: any) {
        console.error('❌ Error sending booking email:', {
          error: emailError.message,
          stack: emailError.stack,
          name: emailError.name
        })
        // Non fallire la richiesta se l'email non viene inviata, ma logga l'errore
      }
    }

    // Verifica se l'email è stata inviata con successo
    const emailSent = RESEND_API_KEY ? true : false
    
    return NextResponse.json({
      success: true,
      booking: data,
      emailSent: emailSent,
      message: emailSent 
        ? 'Prenotazione salvata e email inviata con successo'
        : 'Prenotazione salvata (email non inviata - RESEND_API_KEY non configurata)'
    })
  } catch (error: any) {
    console.error('Error in POST /api/bookings/create:', error)
    return NextResponse.json(
      { error: 'Errore interno del server' },
      { status: 500 }
    )
  }
}

