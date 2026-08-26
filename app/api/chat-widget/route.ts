import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { DEFAULT_CHAT_MODEL } from '@/lib/chat-models'
import { callGeminiWithFallback, getGeminiApiKey } from '@/lib/gemini'
import { buildRealtimeDateTimeInstructionsItalian } from '@/lib/current-datetime'

const getSupabaseAdmin = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    return null
  }

  return createClient(supabaseUrl, serviceRoleKey)
}

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

Sii sempre professionale, chiaro e conciso. Le risposte devono essere BREVI e PRECISE (massimo 2-3 frasi). Rispondi direttamente alla domanda senza giri di parole. Se un cliente ha domande specifiche che non puoi risolvere, suggerisci di contattare direttamente via WhatsApp per una consulenza personalizzata.`

export async function POST(req: NextRequest) {
  try {
    const { messages, userMessage } = await req.json()

    if (
      (!messages || !Array.isArray(messages) || messages.length === 0) &&
      (!userMessage || typeof userMessage !== 'string')
    ) {
      return NextResponse.json(
        { error: 'Messaggi o messaggio utente richiesto' },
        { status: 400 }
      )
    }

    if (!getGeminiApiKey()) {
      return NextResponse.json(
        {
          error:
            'Gemini API key not configured. Please set GEMINI_API_KEY or GOOGLE_API_KEY environment variable.',
        },
        { status: 500 }
      )
    }

    const timeGuardrail = buildRealtimeDateTimeInstructionsItalian()

    let knowledgeText = ''
    try {
      const supabaseAdmin = getSupabaseAdmin()
      if (supabaseAdmin) {
        const { data: knowledgeData } = await supabaseAdmin
          .from('ai_knowledge')
          .select('title, content')
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(50)

        if (knowledgeData && knowledgeData.length > 0) {
          knowledgeText = knowledgeData
            .map((item: { title: string; content: string }) => `- ${item.title}: ${item.content}`)
            .join('\n')
        }
      }
    } catch (error) {
      console.warn('AI knowledge load failed:', error)
    }

    const knowledgeGuardrail = knowledgeText
      ? `\n\nINFORMAZIONI UFFICIALI DEL SITO:\n${knowledgeText}\n\nRispondi SOLO con informazioni presenti qui sopra o già note nel prompt. Se l'informazione non è presente, di' chiaramente che non è disponibile sul sito e invita a contattarci su WhatsApp.`
      : `\n\nNon inventare dettagli. Se l'informazione non è presente nel sito, dì che non è disponibile e invita a contattarci su WhatsApp.`

    const systemPrompt =
      SYSTEM_PROMPT +
      knowledgeGuardrail +
      '\n\nIMPORTANTE: Sii sempre BREVE e PRECISO nelle risposte. Massimo 2-3 frasi. Rispondi direttamente senza giri di parole.\n\n' +
      timeGuardrail

    const chatMessages: Array<{ role: string; content: string }> = [
      ...(messages || []).map((msg: { role: string; content: string }) => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content,
      })),
    ]

    if (userMessage && typeof userMessage === 'string') {
      const lastMessage = chatMessages[chatMessages.length - 1]
      if (!lastMessage || lastMessage.role !== 'user' || lastMessage.content !== userMessage) {
        chatMessages.push({
          role: 'user',
          content: userMessage,
        })
      }
    }

    const result = await callGeminiWithFallback(chatMessages, DEFAULT_CHAT_MODEL, systemPrompt, {
      temperature: 0.1,
      maxOutputTokens: 150,
    })

    if (!result.message) {
      return NextResponse.json({ error: 'Risposta vuota dall\'AI' }, { status: 500 })
    }

    return NextResponse.json({
      message: result.message,
      model: result.model,
      usage: result.usage,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Errore sconosciuto'
    console.error('Gemini API error:', error)

    return NextResponse.json(
      {
        error: 'Errore nel recupero della risposta AI',
        details: message,
      },
      { status: 500 }
    )
  }
}
