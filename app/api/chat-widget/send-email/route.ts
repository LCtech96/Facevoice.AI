import { NextRequest, NextResponse } from 'next/server'

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp?: string
}

// Funzione per inviare email con riassunto conversazione
async function sendConversationEmail(summaryText: string, summaryHTML: string) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY
  const recipientEmail = 'lucacorrao1996@gmail.com'
  
  console.log('Attempting to send conversation summary email...')
  console.log('RESEND_API_KEY exists:', !!RESEND_API_KEY)
  console.log('Recipient:', recipientEmail)
  
  if (RESEND_API_KEY) {
    try {
      const emailData = {
        from: 'FacevoiceAI <noreply@facevoice.ai>',
        to: recipientEmail,
        subject: 'Riassunto Conversazione Assistente AI - Facevoice AI',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <p>Hai ricevuto un nuovo riassunto di conversazione dall'assistente AI di Facevoice AI.</p>
            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #007bff;">
              ${summaryHTML}
            </div>
            <p style="color: #666; font-size: 12px; margin-top: 20px;">
              Questa email è stata generata automaticamente quando un utente ha richiesto l'invio del riassunto della conversazione.
            </p>
          </div>
        `,
        text: summaryText,
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
      console.error('Error sending conversation email:', error)
      console.error('Error details:', error.message, error.stack)
      throw error
    }
  } else {
    // In sviluppo, logga l'email invece di inviarla
    console.log('=== EMAIL RIASSUNTO CONVERSAZIONE (SVILUPPO - RESEND_API_KEY non configurato) ===')
    console.log('To:', recipientEmail)
    console.log('Summary:', summaryText)
    console.log('=====================================')
    return true
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { messages } = body
    
    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: 'Messages array is required' },
        { status: 400 }
      )
    }
    
    // Genera il riassunto della conversazione
    const userMessages = messages.filter((m: Message) => m.role === 'user')
    const assistantMessages = messages.filter((m: Message) => m.role === 'assistant')
    
    // Genera riassunto in formato testo semplice
    let summaryText = '📋 Riassunto Conversazione Facevoice AI\n\n'
    summaryText += `Data: ${new Date().toLocaleString('it-IT')}\n\n`
    
    if (userMessages.length > 0) {
      summaryText += 'Messaggi Utente:\n'
      userMessages.forEach((msg: Message, idx: number) => {
        summaryText += `${idx + 1}. ${msg.content}\n`
      })
    }
    
    if (assistantMessages.length > 0) {
      summaryText += '\nRisposte AI:\n'
      assistantMessages.forEach((msg: Message, idx: number) => {
        summaryText += `${idx + 1}. ${msg.content.substring(0, 200)}${msg.content.length > 200 ? '...' : ''}\n`
      })
    }
    
    // Genera riassunto in formato HTML
    let summaryHTML = '<h2 style="color: #333; margin-bottom: 10px;">📋 Riassunto Conversazione Facevoice AI</h2>'
    summaryHTML += `<p style="color: #666; margin-bottom: 20px;"><strong>Data:</strong> ${new Date().toLocaleString('it-IT')}</p>`
    
    if (userMessages.length > 0) {
      summaryHTML += '<h3 style="color: #333; margin-top: 20px; margin-bottom: 10px;">Messaggi Utente:</h3>'
      summaryHTML += '<ul style="list-style-type: decimal; padding-left: 20px;">'
      userMessages.forEach((msg: Message, idx: number) => {
        summaryHTML += `<li style="margin-bottom: 10px; line-height: 1.6;">${msg.content.replace(/\n/g, '<br>')}</li>`
      })
      summaryHTML += '</ul>'
    }
    
    if (assistantMessages.length > 0) {
      summaryHTML += '<h3 style="color: #333; margin-top: 20px; margin-bottom: 10px;">Risposte AI:</h3>'
      summaryHTML += '<ul style="list-style-type: decimal; padding-left: 20px;">'
      assistantMessages.forEach((msg: Message, idx: number) => {
        const content = msg.content.length > 200 ? msg.content.substring(0, 200) + '...' : msg.content
        summaryHTML += `<li style="margin-bottom: 10px; line-height: 1.6;">${content.replace(/\n/g, '<br>')}</li>`
      })
      summaryHTML += '</ul>'
    }
    
    // Invia l'email
    await sendConversationEmail(summaryText, summaryHTML)
    
    return NextResponse.json({ success: true, message: 'Email inviata con successo' })
  } catch (error: any) {
    console.error('Error in send-email route:', error)
    return NextResponse.json(
      { error: 'Errore nell\'invio dell\'email', details: error.message },
      { status: 500 }
    )
  }
}

