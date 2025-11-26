import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

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
  {
    id: 'aitryon',
    name: 'AITryOn',
    description: 'Video di Prodotto per E-commerce. Genera video di prodotti per il tuo negozio online con AI.',
    category: 'Video & E-commerce',
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

    // Prepara il prompt per Claude
    const toolsDescription = AI_TOOLS.map(tool => 
      `- ${tool.name} (ID: ${tool.id}): ${tool.description} [Categoria: ${tool.category}]`
    ).join('\n')

    const systemPrompt = `Sei un assistente esperto che aiuta gli utenti a trovare gli AI Tools più rilevanti per le loro esigenze.

Analizza la richiesta dell'utente e gli AI Tools disponibili. Restituisci SOLO un array JSON di ID dei tool più rilevanti, ordinati per rilevanza (dal più rilevante al meno rilevante).

Criteri di rilevanza:
1. Corrispondenza diretta con la richiesta (es. "modificare voce" → ElevenLabs)
2. Corrispondenza semantica (es. "generare video" → Runway, Higgsfield, Pika Labs)
3. Corrispondenza per categoria
4. Corrispondenza parziale per funzionalità

Restituisci massimo 10 tool, ma solo quelli realmente rilevanti. Se nessun tool è rilevante, restituisci un array vuoto.

Formato risposta: {"toolIds": ["id1", "id2", "id3"]}`

    const userPrompt = `Richiesta utente: "${query}"

AI Tools disponibili:
${toolsDescription}

Quali AI Tools sono più rilevanti per questa richiesta? Restituisci solo l'array JSON con gli ID ordinati per rilevanza.`

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
    try {
      // Cerca JSON nella risposta (potrebbe avere testo prima/dopo)
      const jsonMatch = responseText.match(/\{[\s\S]*"toolIds"[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        toolIds = Array.isArray(parsed.toolIds) ? parsed.toolIds : []
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

    return NextResponse.json({ toolIds: validToolIds })
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

