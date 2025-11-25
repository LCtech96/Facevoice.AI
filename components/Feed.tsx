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
  likes: number
  comments: number
  shares: number
  isLiked?: boolean
}

interface FeedProps {
  user: User | null
  highlightedToolId?: string | null
}

// Mock data per gli AI tools
const mockAITools: AITool[] = [
  {
    id: '1',
    name: 'AI Chat Assistant',
    description: 'Chat intelligente con modelli LLM avanzati. Supporta multiple conversazioni, progetti organizzati e integrazione con vari modelli AI.',
    coverImage: '/team/Trinacria.png',
    category: 'Chat & Conversazione',
    likes: 124,
    comments: 23,
    shares: 45,
  },
  {
    id: '2',
    name: 'Voice Recognition AI',
    description: 'Sistema avanzato di riconoscimento vocale con supporto multilingua e trascrizione in tempo reale.',
    coverImage: '/team/Trinacria.png',
    category: 'Audio & Voice',
    likes: 89,
    comments: 15,
    shares: 32,
  },
  {
    id: '3',
    name: 'Image Generator AI',
    description: 'Genera immagini AI di alta qualità da descrizioni testuali. Supporta vari stili artistici e personalizzazioni.',
    coverImage: '/team/Trinacria.png',
    category: 'Immagini & Design',
    likes: 256,
    comments: 42,
    shares: 78,
  },
  {
    id: '4',
    name: 'Code Assistant AI',
    description: 'Assistente per sviluppatori che aiuta a scrivere, debuggare e ottimizzare codice in vari linguaggi di programmazione.',
    coverImage: '/team/Trinacria.png',
    category: 'Sviluppo',
    likes: 312,
    comments: 67,
    shares: 91,
  },
  {
    id: '5',
    name: 'Document Analyzer AI',
    description: 'Analizza e estrae informazioni da documenti PDF, Word e altri formati. Supporta OCR e analisi semantica.',
    coverImage: '/team/Trinacria.png',
    category: 'Produttività',
    likes: 178,
    comments: 28,
    shares: 56,
  },
  {
    id: '6',
    name: 'Translation AI',
    description: 'Traduzione istantanea in oltre 100 lingue con supporto per contesto e tono conversazionale.',
    coverImage: '/team/Trinacria.png',
    category: 'Linguistica',
    likes: 203,
    comments: 35,
    shares: 64,
  },
]

export default function Feed({ user, highlightedToolId }: FeedProps) {
  const [tools, setTools] = useState<AITool[]>([])
  const [loading, setLoading] = useState(true)

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

      {tools.map((tool, index) => (
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

