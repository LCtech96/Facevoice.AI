import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { AI_TOOLS_DETAILED_INFO } from '@/lib/ai-tools-info'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
})

// Lista completa degli AI Tools (deve corrispondere a mockAITools in Feed.tsx)
const AI_TOOLS = [
  // Video e Generazione Stile
  {
    id: 'higgsfield',
    name: 'Higgsfield',
    description: 'Video e Generazione Stile con estensione Chrome. Crea video AI, effetti VFX, animazioni e contenuti visivi professionali.',
    category: 'Video & Stile',
  },
  {
    id: 'runway',
    name: 'Runway',
    description: 'Generazione Video (Gen-3) e VFX. Piattaforma avanzata per creare video AI professionali con effetti visivi.',
    category: 'Video & VFX',
  },
  {
    id: 'domoai',
    name: 'DomoAI',
    description: 'Generazione Video e Animazione tramite Discord. Trasforma immagini in video animati con AI.',
    category: 'Video & Animazione',
  },
  {
    id: 'synthesia',
    name: 'Synthesia',
    description: 'Avatar Parlanti e Video Aziendali. Crea video professionali con avatar AI che parlano in oltre 120 lingue.',
    category: 'Video & Avatar',
  },
  {
    id: 'pika',
    name: 'Pika Labs',
    description: 'Generazione Video da Testo/Immagine. Crea video AI di alta qualità da prompt testuali o immagini.',
    category: 'Video & Generazione',
  },
  {
    id: 'google-veo',
    name: 'Google Veo',
    description: 'Generazione Video avanzata. Modello AI di Google per creare video di alta qualità da descrizioni testuali.',
    category: 'Video & AI',
  },
  {
    id: 'kling-ai',
    name: 'Kling AI',
    description: 'Generazione Video avanzata. Piattaforma per creare video AI professionali con controlli precisi.',
    category: 'Video & AI',
  },
  {
    id: 'descript',
    name: 'Descript',
    description: 'Editor Video Basato su Testo. Modifica video come se fosse un documento di testo, con trascrizione automatica.',
    category: 'Video & Editing',
  },
  {
    id: 'opus-clip',
    name: 'OpusClip',
    description: 'Clip Brevi e Riutilizzo Contenuti. Trasforma video lunghi in clip virali ottimizzati per social media.',
    category: 'Video & Social',
  },
  {
    id: 'muapi',
    name: 'Muapi.ai',
    description: 'API per Effetti Video. Integra effetti video AI avanzati nelle tue applicazioni.',
    category: 'Video & API',
  },
  // Immagini e Grafica
  {
    id: 'midjourney',
    name: 'Midjourney',
    description: 'Generazione di Immagini tramite Discord e Sito. Crea immagini artistiche di alta qualità con AI.',
    category: 'Immagini & Arte',
  },
  {
    id: 'dalle3',
    name: 'DALL·E 3',
    description: 'Generazione Immagini e Comprensione Prompt. Modello avanzato di OpenAI per creare immagini da testo.',
    category: 'Immagini & AI',
  },
  {
    id: 'canva',
    name: 'Canva (Magic Studio)',
    description: 'Suite di Design AI e Immagini. Crea design professionali con strumenti AI integrati.',
    category: 'Design & Grafica',
  },
  {
    id: 'adobe-sensei',
    name: 'Adobe Sensei',
    description: 'AI integrata in Creative Cloud (Photoshop, Illustrator, ecc.). Automatizza e migliora il tuo workflow creativo.',
    category: 'Design & Editing',
  },
  {
    id: 'nano-banana',
    name: 'Nano Banana (Google)',
    description: 'Editing Immagini avanzato. Strumento AI di Google per modificare e migliorare immagini.',
    category: 'Immagini & Editing',
  },
  {
    id: 'openart',
    name: 'OpenArt',
    description: 'Piattaforma per Modelli AI di Immagini. Accedi a centinaia di modelli AI per generare immagini.',
    category: 'Immagini & AI',
  },
  {
    id: 'khroma',
    name: 'Khroma',
    description: 'Generatore di Palette Colori AI. Crea palette di colori perfette per i tuoi progetti design.',
    category: 'Design & Colori',
  },
  {
    id: 'deepart',
    name: 'Deep Art Effects',
    description: 'Trasformazione Immagini in Arte. Applica stili artistici AI alle tue immagini.',
    category: 'Immagini & Arte',
  },
  {
    id: 'jasper-art',
    name: 'Jasper Art',
    description: 'Generazione Immagini per Marketing. Crea immagini AI ottimizzate per campagne marketing.',
    category: 'Immagini & Marketing',
  },
  {
    id: 'vreelabs',
    name: 'VREE Labs',
    description: 'Modellazione 3D da Immagini 2D. Trasforma immagini 2D in modelli 3D con AI.',
    category: '3D & Modellazione',
  },
  // UX/UI e Prototipazione
  {
    id: 'figma-ai',
    name: 'Figma AI (Plugins)',
    description: 'Assistenti di Design e Wireframe. Migliora il tuo workflow di design con plugin AI per Figma.',
    category: 'UX/UI & Design',
  },
  {
    id: 'uizard',
    name: 'Uizard',
    description: 'Prototipazione Rapida e Autodesigner. Crea wireframe e prototipi UI con AI in pochi secondi.',
    category: 'UX/UI & Prototipazione',
  },
  {
    id: 'visily',
    name: 'Visily',
    description: 'Wireframing e Design Rapido AI. Trasforma screenshot in design completi con AI.',
    category: 'UX/UI & Design',
  },
  {
    id: 'uxpin',
    name: 'UXPin',
    description: 'Prototipazione e Test di Accessibilità. Piattaforma completa per design, prototipazione e testing.',
    category: 'UX/UI & Testing',
  },
  {
    id: 'uxpilot',
    name: 'UX Pilot',
    description: 'Flusso di Lavoro UX e Color Palette AI. Automatizza il processo di design UX con AI.',
    category: 'UX/UI & Workflow',
  },
  // Contenuti e Produttività
  {
    id: 'chatgpt',
    name: 'ChatGPT / Gemini (Flash)',
    description: 'Generazione Testo e Brainstorming. Assistente AI per scrivere, ideare e risolvere problemi.',
    category: 'Contenuti & AI',
  },
  {
    id: 'wordtune',
    name: 'Wordtune',
    description: 'Riscrittura e Miglioramento Contenuti. Migliora la qualità dei tuoi testi con AI.',
    category: 'Contenuti & Scrittura',
  },
  {
    id: 'fireflies',
    name: 'Fireflies.ai',
    description: 'Trascrizione e Sintesi Riunioni. Registra, trascrive e riassume le tue riunioni automaticamente.',
    category: 'Produttività & Meeting',
  },
  {
    id: 'otter',
    name: 'Otter AI',
    description: 'Trascrizione e Sottotitoli. Trascrivi riunioni, lezioni e conversazioni in tempo reale.',
    category: 'Produttività & Trascrizione',
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    description: 'Sintesi Vocale e Clonazione Vocale. Crea voci AI realistiche e clona voci esistenti.',
    category: 'Audio & Voce',
  },
  {
    id: 'creatio',
    name: 'Creatio',
    description: 'Piattaforma No-Code per Flussi di Lavoro. Automatizza processi aziendali senza scrivere codice.',
    category: 'Produttività & Automazione',
  },
]

export async function POST(req: NextRequest) {
  try {
    const { query } = await req.json()

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return NextResponse.json(
        { error: 'Query di ricerca richiesta' },
        { status: 400 }
      )
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      // Fallback: ricerca semplice se non c'è API key
      const queryLower = query.toLowerCase()
      const matched = AI_TOOLS.filter(tool => {
        const searchText = `${tool.name} ${tool.description} ${tool.category}`.toLowerCase()
        return searchText.includes(queryLower)
      })
      return NextResponse.json({ toolIds: matched.map(t => t.id) })
    }

    // Prepara le informazioni dettagliate per i tool disponibili
    const toolsWithDetails = AI_TOOLS.map(tool => {
      const detailedInfo = AI_TOOLS_DETAILED_INFO[tool.id]
      if (detailedInfo) {
        return {
          id: tool.id,
          name: tool.name,
          description: tool.description,
          category: tool.category,
          pricing: detailedInfo.pricing,
          bestFor: detailedInfo.bestFor,
          strengths: detailedInfo.strengths,
          limitations: detailedInfo.limitations,
          useCase: detailedInfo.useCase,
        }
      }
      return {
        id: tool.id,
        name: tool.name,
        description: tool.description,
        category: tool.category,
      }
    })

    const toolsDescription = toolsWithDetails.map(tool => {
      let desc = `- ${tool.name} (ID: ${tool.id}): ${tool.description} [Categoria: ${tool.category}]`
      if ('bestFor' in tool && tool.bestFor) {
        desc += `\n  Migliore per: ${tool.bestFor.join(', ')}`
      }
      if ('strengths' in tool && tool.strengths) {
        desc += `\n  Punti di forza: ${tool.strengths.join('; ')}`
      }
      if ('pricing' in tool && tool.pricing) {
        if (tool.pricing.free) {
          desc += `\n  Pricing: Gratuito disponibile`
        }
        if (tool.pricing.plans && tool.pricing.plans.length > 0) {
          desc += `\n  Pricing: ${tool.pricing.plans.map(p => `${p.name} ${p.price}`).join(', ')}`
        }
      }
      if ('useCase' in tool && tool.useCase) {
        desc += `\n  Quando usarlo: ${tool.useCase}`
      }
      return desc
    }).join('\n\n')

    const systemPrompt = `Sei un assistente esperto che aiuta gli utenti a trovare gli AI Tools più rilevanti per le loro esigenze.

Analizza la richiesta dell'utente e gli AI Tools disponibili (con informazioni su pricing, punti di forza, limitazioni e casi d'uso).

IMPORTANTE: Quando la richiesta chiede consigli su quale tool usare (es. "quale tool per generare video?", "quale AI potrei usare per..."), devi:
1. Identificare i tool più rilevanti
2. Ordinarli per rilevanza considerando pricing, qualità, e adattamento all'uso specifico
3. Fornire spiegazioni concise sul PERCHÉ ogni tool è consigliato, basandoti su documentazione, pricing e caratteristiche reali (NON su marketing del sito)

Criteri di rilevanza e ranking:
1. Corrispondenza diretta con la richiesta
2. Pricing accessibile (preferire free/low-cost se appropriato)
3. Qualità e punti di forza reali del tool
4. Adattamento all'uso specifico menzionato
5. Limiti e quando NON è adatto

Restituisci un JSON con:
- toolIds: array di ID ordinati per rilevanza (max 5-8 tool, solo quelli davvero rilevanti)
- explanations: oggetto con chiave=ID del tool e valore=spiegazione breve (2-3 frasi) sul perché è consigliato

Formato risposta: {"toolIds": ["id1", "id2"], "explanations": {"id1": "spiegazione perché id1 è consigliato", "id2": "spiegazione perché id2 è consigliato"}}`

    const userPrompt = `Richiesta utente: "${query}"

AI Tools disponibili con informazioni dettagliate:
${toolsDescription}

Quali AI Tools sono più rilevanti per questa richiesta? 
Restituisci il JSON con toolIds ordinati per rilevanza e explanations per ciascuno.`

    // Chiama Claude
    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022', // Usa Haiku per velocità e costo
      max_tokens: 2000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    })

    // Estrai il testo dalla risposta
    const textBlock = response.content.find(
      (block: any): block is { type: 'text'; text: string } => block.type === 'text'
    )
    const responseText = textBlock?.text || ''

    // Prova a parsare la risposta JSON
    let toolIds: string[] = []
    let explanations: Record<string, string> = {}
    
    try {
      // Cerca JSON nella risposta (potrebbe avere testo prima/dopo)
      const jsonMatch = responseText.match(/\{[\s\S]*"toolIds"[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        toolIds = Array.isArray(parsed.toolIds) ? parsed.toolIds : []
        explanations = parsed.explanations && typeof parsed.explanations === 'object' 
          ? parsed.explanations 
          : {}
      } else {
        // Fallback: cerca array diretto
        const arrayMatch = responseText.match(/\[[\s\S]*\]/)
        if (arrayMatch) {
          toolIds = JSON.parse(arrayMatch[0])
        }
      }
    } catch (parseError) {
      console.error('Errore nel parsing della risposta di Claude:', parseError)
      console.error('Risposta ricevuta:', responseText)
      
      // Fallback: ricerca semplice
      const queryLower = query.toLowerCase()
      const matched = AI_TOOLS.filter(tool => {
        const searchText = `${tool.name} ${tool.description} ${tool.category}`.toLowerCase()
        return searchText.includes(queryLower)
      })
      toolIds = matched.map(t => t.id)
    }

    // Valida che gli ID esistano
    const validToolIds = toolIds.filter(id => 
      AI_TOOLS.some(tool => tool.id === id)
    )
    
    // Aggiungi spiegazioni dai dati dettagliati se mancanti
    const finalExplanations: Record<string, string> = {}
    validToolIds.forEach(id => {
      if (explanations[id]) {
        finalExplanations[id] = explanations[id]
      } else {
        // Genera spiegazione dai dati dettagliati
        const detailedInfo = AI_TOOLS_DETAILED_INFO[id]
        if (detailedInfo) {
          const tool = AI_TOOLS.find(t => t.id === id)
          finalExplanations[id] = `${detailedInfo.useCase || tool?.description}${detailedInfo.pricing?.free ? ' Piano gratuito disponibile.' : ''}`
        }
      }
    })

    return NextResponse.json({ 
      toolIds: validToolIds,
      explanations: finalExplanations 
    })
  } catch (error) {
    console.error('Errore nella ricerca AI Tools:', error)
    
    // Fallback: ricerca semplice
    try {
      const { query } = await req.json()
      const queryLower = query.toLowerCase()
      const matched = AI_TOOLS.filter(tool => {
        const searchText = `${tool.name} ${tool.description} ${tool.category}`.toLowerCase()
        return searchText.includes(queryLower)
      })
      return NextResponse.json({ toolIds: matched.map(t => t.id) })
    } catch (fallbackError) {
      return NextResponse.json(
        { error: 'Errore nella ricerca' },
        { status: 500 }
      )
    }
  }
}










