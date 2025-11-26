'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import AIToolCard from './AIToolCard'
import type { User } from '@supabase/supabase-js'

export interface AITool {
  id: string
  name: string
  description: string
  coverImage: string
  category: string
  link: string
  videoUrl?: string
  likes: number
  comments: number
  shares: number
  isLiked?: boolean
}

interface FeedProps {
  user: User | null
  highlightedToolId?: string | null
  searchQuery?: string
  categoryFilter?: string
}

// Mock data per gli AI tools
const mockAITools: AITool[] = [
  // Video e Generazione Stile
  {
    id: 'higgsfield',
    name: 'Higgsfield',
    description: 'Video e Generazione Stile con estensione Chrome. Crea video AI, effetti VFX, animazioni e contenuti visivi professionali.',
    coverImage: '/team/Higgsfield.png',
    category: 'Video & Stile',
    link: 'https://chromewebstore.google.com/detail/higgsfield-instant/oohmjaflbknghbidmaoonmchcodhmkgj',
    likes: 342,
    comments: 56,
    shares: 89,
  },
  {
    id: 'runway',
    name: 'Runway',
    description: 'Generazione Video (Gen-3) e VFX. Piattaforma avanzata per creare video AI professionali con effetti visivi.',
    coverImage: '/team/Runway.png',
    category: 'Video & VFX',
    link: 'https://runwayml.com/',
    likes: 456,
    comments: 78,
    shares: 123,
  },
  {
    id: 'domoai',
    name: 'DomoAI',
    description: 'Generazione Video e Animazione tramite Discord. Trasforma immagini in video animati con AI.',
    coverImage: '/team/Domoai.png',
    category: 'Video & Animazione',
    link: 'https://domoai.app/',
    likes: 289,
    comments: 45,
    shares: 67,
  },
  {
    id: 'synthesia',
    name: 'Synthesia',
    description: 'Avatar Parlanti e Video Aziendali. Crea video professionali con avatar AI che parlano in oltre 120 lingue.',
    coverImage: '/team/Synthesia.png',
    category: 'Video & Avatar',
    link: 'https://www.synthesia.io/',
    likes: 512,
    comments: 92,
    shares: 145,
  },
  {
    id: 'pika',
    name: 'Pika Labs',
    description: 'Generazione Video da Testo/Immagine. Crea video AI di alta qualità da prompt testuali o immagini.',
    coverImage: '/team/Pika Labs.png',
    category: 'Video & Generazione',
    link: 'https://www.pika.art/',
    likes: 378,
    comments: 64,
    shares: 98,
  },
  {
    id: 'google-veo',
    name: 'Google Veo',
    description: 'Generazione Video avanzata. Modello AI di Google per creare video di alta qualità da descrizioni testuali.',
    coverImage: 'https://ai.google.dev/static/site-assets/images/share.png',
    category: 'Video & AI',
    link: 'https://ai.google.dev/',
    likes: 234,
    comments: 38,
    shares: 56,
  },
  {
    id: 'kling-ai',
    name: 'Kling AI',
    description: 'Generazione Video avanzata. Piattaforma per creare video AI professionali con controlli precisi.',
    coverImage: '/team/Klingai.png',
    category: 'Video & AI',
    link: 'https://klingai.com/',
    likes: 267,
    comments: 42,
    shares: 73,
  },
  {
    id: 'descript',
    name: 'Descript',
    description: 'Editor Video Basato su Testo. Modifica video come se fosse un documento di testo, con trascrizione automatica.',
    coverImage: '/team/Descript.png',
    category: 'Video & Editing',
    link: 'https://www.descript.com/',
    likes: 389,
    comments: 71,
    shares: 112,
  },
  {
    id: 'opus-clip',
    name: 'OpusClip',
    description: 'Clip Brevi e Riutilizzo Contenuti. Trasforma video lunghi in clip virali ottimizzati per social media.',
    coverImage: 'https://www.opus.pro/og-image.png',
    category: 'Video & Social',
    link: 'https://www.opus.pro/',
    likes: 298,
    comments: 53,
    shares: 87,
  },
  {
    id: 'muapi',
    name: 'Muapi.ai',
    description: 'API per Effetti Video. Integra effetti video AI avanzati nelle tue applicazioni.',
    coverImage: 'https://muapi.ai/og-image.png',
    category: 'Video & API',
    link: 'https://muapi.ai/',
    likes: 156,
    comments: 28,
    shares: 41,
  },
  {
    id: 'aitryon',
    name: 'AITryOn',
    description: 'Video di Prodotto per E-commerce. Genera video di prodotti per il tuo negozio online con AI.',
    coverImage: '/team/placeholder.svg',
    category: 'Video & E-commerce',
    link: 'https://aitryon.ai/',
    likes: 201,
    comments: 35,
    shares: 59,
  },
  // Immagini e Grafica
  {
    id: 'midjourney',
    name: 'Midjourney',
    description: 'Generazione di Immagini tramite Discord e Sito. Crea immagini artistiche di alta qualità con AI.',
    coverImage: 'https://www.midjourney.com/og-image.jpg',
    category: 'Immagini & Arte',
    link: 'https://www.midjourney.com/',
    likes: 892,
    comments: 156,
    shares: 234,
  },
  {
    id: 'dalle3',
    name: 'DALL·E 3',
    description: 'Generazione Immagini e Comprensione Prompt. Modello avanzato di OpenAI per creare immagini da testo.',
    coverImage: 'https://openai.com/images/dalle-3-og.png',
    category: 'Immagini & AI',
    link: 'https://openai.com/dall-e-3/',
    likes: 756,
    comments: 134,
    shares: 198,
  },
  {
    id: 'canva',
    name: 'Canva (Magic Studio)',
    description: 'Suite di Design AI e Immagini. Crea design professionali con strumenti AI integrati.',
    coverImage: 'https://www.canva.com/og-image.jpg',
    category: 'Design & Grafica',
    link: 'https://www.canva.com/',
    likes: 623,
    comments: 98,
    shares: 167,
  },
  {
    id: 'adobe-sensei',
    name: 'Adobe Sensei',
    description: 'AI integrata in Creative Cloud (Photoshop, Illustrator, ecc.). Automatizza e migliora il tuo workflow creativo.',
    coverImage: 'https://www.adobe.com/sensei/og-image.jpg',
    category: 'Design & Editing',
    link: 'https://www.adobe.com/sensei.html',
    likes: 567,
    comments: 89,
    shares: 145,
  },
  {
    id: 'nano-banana',
    name: 'Nano Banana (Google)',
    description: 'Editing Immagini avanzato. Strumento AI di Google per modificare e migliorare immagini.',
    coverImage: 'https://ai.google.dev/static/site-assets/images/share.png',
    category: 'Immagini & Editing',
    link: 'https://ai.google.dev/',
    likes: 234,
    comments: 41,
    shares: 68,
  },
  {
    id: 'openart',
    name: 'OpenArt',
    description: 'Piattaforma per Modelli AI di Immagini. Accedi a centinaia di modelli AI per generare immagini.',
    coverImage: 'https://openart.ai/og-image.png',
    category: 'Immagini & AI',
    link: 'https://openart.ai/',
    likes: 345,
    comments: 62,
    shares: 94,
  },
  {
    id: 'khroma',
    name: 'Khroma',
    description: 'Generatore di Palette Colori AI. Crea palette di colori perfette per i tuoi progetti design.',
    coverImage: '/team/placeholder.svg',
    category: 'Design & Colori',
    link: 'https://www.khroma.co/',
    likes: 178,
    comments: 29,
    shares: 47,
  },
  {
    id: 'deepart',
    name: 'Deep Art Effects',
    description: 'Trasformazione Immagini in Arte. Applica stili artistici AI alle tue immagini.',
    coverImage: 'https://www.deeparteffects.com/og-image.jpg',
    category: 'Immagini & Arte',
    link: 'https://www.deeparteffects.com/',
    likes: 267,
    comments: 48,
    shares: 76,
  },
  {
    id: 'jasper-art',
    name: 'Jasper Art',
    description: 'Generazione Immagini per Marketing. Crea immagini AI ottimizzate per campagne marketing.',
    coverImage: 'https://www.jasper.ai/art/og-image.png',
    category: 'Immagini & Marketing',
    link: 'https://www.jasper.ai/art',
    likes: 312,
    comments: 55,
    shares: 89,
  },
  {
    id: 'vreelabs',
    name: 'VREE Labs',
    description: 'Modellazione 3D da Immagini 2D. Trasforma immagini 2D in modelli 3D con AI.',
    coverImage: '/team/placeholder.svg',
    category: '3D & Modellazione',
    link: 'https://www.vreelabs.ai/',
    likes: 189,
    comments: 33,
    shares: 52,
  },
  // UX/UI e Prototipazione
  {
    id: 'figma-ai',
    name: 'Figma AI (Plugins)',
    description: 'Assistenti di Design e Wireframe. Migliora il tuo workflow di design con plugin AI per Figma.',
    coverImage: 'https://www.figma.com/og-image.jpg',
    category: 'UX/UI & Design',
    link: 'https://www.figma.com/community',
    likes: 445,
    comments: 78,
    shares: 123,
  },
  {
    id: 'uizard',
    name: 'Uizard',
    description: 'Prototipazione Rapida e Autodesigner. Crea wireframe e prototipi UI con AI in pochi secondi.',
    coverImage: 'https://uizard.io/og-image.png',
    category: 'UX/UI & Prototipazione',
    link: 'https://uizard.io/',
    likes: 334,
    comments: 61,
    shares: 98,
  },
  {
    id: 'visily',
    name: 'Visily',
    description: 'Wireframing e Design Rapido AI. Trasforma screenshot in design completi con AI.',
    coverImage: 'https://www.visily.ai/og-image.png',
    category: 'UX/UI & Design',
    link: 'https://www.visily.ai/',
    likes: 278,
    comments: 49,
    shares: 76,
  },
  {
    id: 'uxpin',
    name: 'UXPin',
    description: 'Prototipazione e Test di Accessibilità. Piattaforma completa per design, prototipazione e testing.',
    coverImage: 'https://www.uxpin.com/og-image.jpg',
    category: 'UX/UI & Testing',
    link: 'https://www.uxpin.com/',
    likes: 356,
    comments: 67,
    shares: 104,
  },
  {
    id: 'uxpilot',
    name: 'UX Pilot',
    description: 'Flusso di Lavoro UX e Color Palette AI. Automatizza il processo di design UX con AI.',
    coverImage: 'https://uxpilot.ai/og-image.png',
    category: 'UX/UI & Workflow',
    link: 'https://uxpilot.ai/',
    likes: 201,
    comments: 38,
    shares: 59,
  },
  // Contenuti e Produttività
  {
    id: 'chatgpt',
    name: 'ChatGPT / Gemini (Flash)',
    description: 'Generazione Testo e Brainstorming. Assistente AI per scrivere, ideare e risolvere problemi.',
    coverImage: 'https://openai.com/images/chatgpt-og.png',
    category: 'Contenuti & AI',
    link: 'https://chatgpt.com/',
    likes: 1234,
    comments: 234,
    shares: 456,
  },
  {
    id: 'wordtune',
    name: 'Wordtune',
    description: 'Riscrittura e Miglioramento Contenuti. Migliora la qualità dei tuoi testi con AI.',
    coverImage: 'https://www.wordtune.com/og-image.png',
    category: 'Contenuti & Scrittura',
    link: 'https://www.wordtune.com/',
    likes: 423,
    comments: 76,
    shares: 134,
  },
  {
    id: 'fireflies',
    name: 'Fireflies.ai',
    description: 'Trascrizione e Sintesi Riunioni. Registra, trascrive e riassume le tue riunioni automaticamente.',
    coverImage: 'https://fireflies.ai/og-image.png',
    category: 'Produttività & Meeting',
    link: 'https://fireflies.ai/',
    likes: 389,
    comments: 68,
    shares: 112,
  },
  {
    id: 'otter',
    name: 'Otter AI',
    description: 'Trascrizione e Sottotitoli. Trascrivi riunioni, lezioni e conversazioni in tempo reale.',
    coverImage: 'https://otter.ai/og-image.png',
    category: 'Produttività & Trascrizione',
    link: 'https://otter.ai/',
    likes: 456,
    comments: 82,
    shares: 145,
  },
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    description: 'Sintesi Vocale e Clonazione Vocale. Crea voci AI realistiche e clona voci esistenti.',
    coverImage: 'https://elevenlabs.io/og-image.png',
    category: 'Audio & Voce',
    link: 'https://elevenlabs.io/',
    likes: 512,
    comments: 94,
    shares: 167,
  },
  {
    id: 'creatio',
    name: 'Creatio',
    description: 'Piattaforma No-Code per Flussi di Lavoro. Automatizza processi aziendali senza scrivere codice.',
    coverImage: 'https://www.creatio.com/og-image.jpg',
    category: 'Produttività & Automazione',
    link: 'https://www.creatio.com/',
    likes: 267,
    comments: 45,
    shares: 73,
  },
]

export default function Feed({ user, highlightedToolId, searchQuery = '', categoryFilter }: FeedProps) {
  const [tools, setTools] = useState<AITool[]>([])
  const [loading, setLoading] = useState(true)
  const [filteredTools, setFilteredTools] = useState<AITool[]>([])

  useEffect(() => {
    // Simula caricamento dati
    const loadTools = async () => {
      // In futuro, caricherà da API/Supabase
      // Per ora usa mock data
      const toolsWithLikes = await Promise.all(
        mockAITools.map(async (tool) => {
          // Verifica se l'utente ha già messo like
          const isLiked = user ? await checkUserLike(tool.id, user.id) : false
          return { ...tool, isLiked }
        })
      )
      setTools(toolsWithLikes)
      setLoading(false)

      // Scroll al tool evidenziato dopo il caricamento
      if (highlightedToolId) {
        setTimeout(() => {
          const element = document.getElementById(`tool-${highlightedToolId}`)
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' })
            // Evidenzia il tool
            element.classList.add('ring-4', 'ring-coral-red', 'ring-opacity-50')
            setTimeout(() => {
              element.classList.remove('ring-4', 'ring-coral-red', 'ring-opacity-50')
            }, 3000)
          }
        }, 500)
      }
    }

    loadTools()
  }, [user, highlightedToolId])

  const checkUserLike = async (toolId: string, userId: string): Promise<boolean> => {
    try {
      const response = await fetch(`/api/tools/${toolId}/like?userId=${userId}`)
      if (response.ok) {
        const data = await response.json()
        return data.isLiked || false
      }
    } catch (error) {
      console.error('Error checking like:', error)
    }
    return false
  }

  const handleLike = async (toolId: string) => {
    if (!user) return

    setTools((prev) =>
      prev.map((tool) => {
        if (tool.id === toolId) {
          const newIsLiked = !tool.isLiked
          return {
            ...tool,
            isLiked: newIsLiked,
            likes: newIsLiked ? tool.likes + 1 : tool.likes - 1,
          }
        }
        return tool
      })
    )

    // Salva like su server
    try {
      await fetch(`/api/tools/${toolId}/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, isLiked: !tools.find((t) => t.id === toolId)?.isLiked }),
      })
    } catch (error) {
      console.error('Error saving like:', error)
    }
  }

  const handleComment = async (toolId: string, comment: string) => {
    if (!user || !comment.trim()) return

    const userName = user.email?.split('@')[0] || user.user_metadata?.full_name || user.id.substring(0, 8)

    try {
      const response = await fetch(`/api/tools/${toolId}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          userId: user.id, 
          comment: comment.trim(),
          userName: userName
        }),
      })

      if (response.ok) {
        setTools((prev) =>
          prev.map((tool) => {
            if (tool.id === toolId) {
              return { ...tool, comments: tool.comments + 1 }
            }
            return tool
          })
        )
      }
    } catch (error) {
      console.error('Error saving comment:', error)
    }
  }

  const handleShare = async (toolId: string) => {
    const tool = tools.find((t) => t.id === toolId)
    if (!tool) return

    const shareUrl = `${window.location.origin}/home?tool=${toolId}`
    
    try {
      if (navigator.share) {
        await navigator.share({
          title: tool.name,
          text: tool.description,
          url: shareUrl,
        })
      } else {
        // Fallback: copia negli appunti
        await navigator.clipboard.writeText(shareUrl)
        alert('Link copiato negli appunti!')
      }

      // Incrementa contatore condivisioni
      setTools((prev) =>
        prev.map((t) => {
          if (t.id === toolId) {
            return { ...t, shares: t.shares + 1 }
          }
          return t
        })
      )

      // Salva condivisione su server
      await fetch(`/api/tools/${toolId}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error('Error sharing:', error)
      }
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-coral-red">Caricamento feed...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="text-4xl font-bold gradient-text mb-2">AI Tools Feed</h1>
        <p className="text-coral-red/70">Scopri e interagisci con i migliori strumenti AI</p>
      </motion.div>

      {(filteredTools.length > 0 || searchQuery || categoryFilter ? filteredTools : tools).map((tool, index) => (
        <motion.div
          key={tool.id}
          id={`tool-${tool.id}`}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.1 }}
        >
          <AIToolCard
            tool={tool}
            user={user}
            onLike={() => handleLike(tool.id)}
            onComment={(comment) => handleComment(tool.id, comment)}
            onShare={() => handleShare(tool.id)}
            isHighlighted={highlightedToolId === tool.id}
          />
        </motion.div>
      ))}
    </div>
  )
}

