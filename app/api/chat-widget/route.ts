import { NextRequest, NextResponse } from 'next/server'
import Groq from 'groq-sdk'
import type { ChatCompletionMessageParam } from 'groq-sdk/resources/chat/completions'

// Usa la variabile d'ambiente GROQ_API_KEY
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || '',
})

// System prompt per l'assistente
const SYSTEM_PROMPT = `Sei un assistente AI esperto di Facevoice AI. Il tuo compito è aiutare i clienti a comprendere:

1. **Servizi AI**: Spiega i vantaggi dell'intelligenza artificiale per le aziende, come può automatizzare processi, migliorare l'efficienza e creare nuove opportunità di business.

2. **Software**: Illustra come i software personalizzati possono risolvere problemi specifici, migliorare la produttività e dare un vantaggio competitivo.

3. **Importanza di avere un sito web**: 
   - Presenza online professionale 24/7
   - Credibilità e fiducia dei clienti
   - Marketing e visibilità
   - Canale di vendita e lead generation
   - Competitività nel mercato digitale

4. **Collegare il sito web al proprio account Google**:
   - Google Analytics per monitorare il traffico
   - Google Search Console per ottimizzazione SEO
   - Google My Business per visibilità locale
   - Google Ads per pubblicità mirata
   - Integrazione con servizi Google (Gmail, Drive, Calendar)

Sii sempre professionale, chiaro e conciso. Se un cliente ha domande specifiche che non puoi risolvere, suggerisci di contattare direttamente via WhatsApp per una consulenza personalizzata.`

export async function POST(req: NextRequest) {
  try {
    const { messages, userMessage } = await req.json()

    // Validazione: almeno uno tra messages e userMessage deve essere presente
    if ((!messages || !Array.isArray(messages) || messages.length === 0) && (!userMessage || typeof userMessage !== 'string')) {
      return NextResponse.json(
        { error: 'Messaggi o messaggio utente richiesto' },
        { status: 400 }
      )
    }

    // Costruisci contesto temporale server-side per risposte impeccabili su data/ora
    const romeNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Rome' }))
    const weekdayIt = romeNow.toLocaleDateString('it-IT', { weekday: 'long' })
    const dateIt = romeNow.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })
    const timeIt = romeNow.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
    const isoNow = romeNow.toISOString()

    const TIME_GUARDRAIL: ChatCompletionMessageParam = {
      role: 'system',
      content:
        `Oggi (fuso orario Europe/Rome) è ${weekdayIt} ${dateIt} e sono le ${timeIt}. ` +
        `Timestamp ISO: ${isoNow}. ` +
        `Quando l'utente chiede data, ora o giorno della settimana, usa esclusivamente questi valori server-side. ` +
        `Non indovinare mai: se la domanda richiede un calcolo sul tempo, calcola partendo da questa data/ora.`,
    }

    // Prepara i messaggi per Groq
    const messagesForGroq: ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: SYSTEM_PROMPT,
      },
      TIME_GUARDRAIL,
      ...(messages || []).map((msg: any) => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content,
      })),
    ]

    // Aggiungi il nuovo messaggio utente se fornito separatamente e non già presente
    if (userMessage && typeof userMessage === 'string') {
      const lastMessage = messagesForGroq[messagesForGroq.length - 1]
      // Aggiungi solo se l'ultimo messaggio non è già quello dell'utente
      if (!lastMessage || lastMessage.role !== 'user' || lastMessage.content !== userMessage) {
        messagesForGroq.push({
          role: 'user',
          content: userMessage,
        })
      }
    }

    // Usa il modello Llama 3.1 8B Instant per risposte veloci
    const completion = await groq.chat.completions.create({
      messages: messagesForGroq,
      model: 'llama-3.1-8b-instant',
      // Bassa creatività per massimizzare l'accuratezza fattuale
      temperature: 0.1,
      max_tokens: 2048,
      stream: false,
    })

    const response = completion.choices[0]?.message?.content || ''

    if (!response) {
      return NextResponse.json(
        { error: 'Risposta vuota dall\'AI' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      message: response,
      model: completion.model,
      usage: completion.usage,
    })
  } catch (error: any) {
    console.error('Groq API error:', error)
    
    return NextResponse.json(
      { 
        error: 'Errore nel recupero della risposta AI',
        details: error.message || 'Errore sconosciuto'
      },
      { status: 500 }
    )
  }
}


