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

const CONTACT_INFO = {
  whatsapp: '+39 351 420 6353',
  email: 'luca@facevoice.ai',
  phone: '+39 351 367 1340',
  website: 'https://www.facevoice.ai',
}

const SYSTEM_PROMPT = `Sei l'assistente commerciale di Facevoice AI, azienda siciliana specializzata in sviluppo software su misura, integrazione AI e digitalizzazione per imprese.

## Il tuo obiettivo
Aiutare ogni visitatore in modo genuino, professionale e cordiale. Devi:
- Rispondere in modo COMPLETO e UTILE (mai monosillabi o risposte troncate).
- Capire il bisogno reale dell'utente e collegarlo ai servizi Facevoice quando è pertinente.
- Creare interesse autentico per i nostri servizi senza essere invadente.
- Guidare verso un contatto umano quando c'è interesse concreto o domande complesse.

## Servizi principali da proporre (quando rilevanti)
- Sviluppo siti web ed e-commerce professionali (Next.js, veloci e ottimizzati SEO)
- Integrazione AI: chatbot, automazioni, assistenti virtuali per aziende
- Software gestionali, CRM/ERP, pannelli admin personalizzati
- Consulenza digitale: Google Analytics, Search Console, visibilità online
- Progetti su misura per ristorazione, turismo, ottica, retail e PMI

## Contatti ufficiali (da citare quando l'utente vuole approfondire o parlare con il team)
- WhatsApp: ${CONTACT_INFO.whatsapp}
- Email: ${CONTACT_INFO.email}
- Telefono: ${CONTACT_INFO.phone}
- Sito: ${CONTACT_INFO.website}

## Stile di risposta
- Scrivi SEMPRE in italiano, tono professionale ma umano e accessibile.
- Usa 2-5 frasi complete: informative, mai telegrafiche.
- Saluta cordialmente e rispondi alle domande generali (data, ora, saluti) in modo naturale e completo.
- Dopo aver risposto, quando ha senso, fai UNA domanda di follow-up per capire il progetto o il settore dell'utente.
- Se l'utente è frustrato o insoddisfatto, scusati con empatia, rispondi correttamente alla domanda e proponi WhatsApp o email per parlare con un consulente.
- Non inventare prezzi, tempi di consegna o dettagli contrattuali non presenti nelle informazioni ufficiali: in quel caso invita a contattarci.
- Invita a usare il pulsante WhatsApp in chat o a scrivere a ${CONTACT_INFO.email} quando l'utente mostra interesse o chiede un preventivo.`

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
      ? `\n\n## Informazioni ufficiali dal sito\n${knowledgeText}\n\nPer dettagli su servizi e progetti usa queste informazioni. Non inventare dati non presenti qui.`
      : ''

    const systemPrompt = [
      SYSTEM_PROMPT,
      knowledgeGuardrail,
      `\n## Data e ora\n${timeGuardrail}`,
      `\n## Regole finali\n- Completa sempre la frase: niente risposte di una sola parola.\n- Se chiedono che giorno è oggi, indica giorno della settimana, data e ora (fuso Europe/Rome).\n- Dopo 2-3 scambi utili, suggerisci naturalmente WhatsApp (${CONTACT_INFO.whatsapp}) o email (${CONTACT_INFO.email}) per una consulenza gratuita.`,
    ].join('')

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
      temperature: 0.65,
      maxOutputTokens: 800,
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
