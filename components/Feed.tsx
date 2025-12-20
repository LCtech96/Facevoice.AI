'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import AIToolCard from './AIToolCard'
import type { User } from '@supabase/supabase-js'
import { allAITools } from '@/lib/ai-tools-data'

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

// Mock data per gli AI tools - usa gli stessi dati della CircularGallery
const mockAITools: AITool[] = allAITools

export default function Feed({ user, highlightedToolId, searchQuery = '', categoryFilter }: FeedProps) {
  const [tools, setTools] = useState<AITool[]>([])
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [filteredTools, setFilteredTools] = useState<AITool[]>([])
  const [toolExplanations, setToolExplanations] = useState<Record<string, string>>({})

  useEffect(() => {
    // Simula caricamento dati
    const loadTools = async () => {
      // In futuro, caricherà da API/Supabase
      // Per ora usa mock data
      // Filtra i tool che sono già nella CircularGallery per evitare duplicati
      const circularGalleryToolIds = new Set(allAITools.map(tool => tool.id))
      const filteredTools = mockAITools.filter(tool => !circularGalleryToolIds.has(tool.id))
      
      const toolsWithLikes = await Promise.all(
        filteredTools.map(async (tool) => {
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

  // Filtro intelligente basato su LLM per i tools
  useEffect(() => {
      if (!searchQuery && !categoryFilter) {
      setFilteredTools([])
      setToolExplanations({}) // Pulisci spiegazioni
      setSearching(false)
      return
    }

    // Debounce per evitare troppe chiamate API
    const performSearch = async () => {
      // Se c'è solo categoryFilter senza searchQuery, filtra per categoria
      if (!searchQuery && categoryFilter) {
        const filtered = tools.filter((tool) =>
          tool.category.toLowerCase().includes(categoryFilter.toLowerCase())
        )
        setFilteredTools(filtered)
        setToolExplanations({}) // Pulisci spiegazioni quando non c'è ricerca
        setSearching(false)
        return
      }

      // Se c'è searchQuery, usa l'API LLM per ricerca intelligente
      if (searchQuery && searchQuery.trim().length > 0) {
        setSearching(true)
        try {
          const response = await fetch('/api/tools/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: searchQuery.trim() }),
          })

          if (response.ok) {
            const data = await response.json()
            const relevantToolIds = data.toolIds || []
            const explanations = data.explanations || {}

            // Salva le spiegazioni
            setToolExplanations(explanations)

            // Filtra i tools basandosi sugli ID rilevanti
            let filtered = tools.filter((tool) => {
              // Se ci sono toolIds rilevanti dall'LLM, usa quelli
              if (relevantToolIds.length > 0) {
                return relevantToolIds.includes(tool.id)
              }
              // Altrimenti fallback a ricerca semplice
              const toolText = `${tool.name} ${tool.description} ${tool.category}`.toLowerCase()
              return toolText.includes(searchQuery.toLowerCase())
            })

            // Applica anche il filtro categoria se presente
            if (categoryFilter) {
              filtered = filtered.filter((tool) =>
                tool.category.toLowerCase().includes(categoryFilter.toLowerCase())
              )
            }

            setFilteredTools(filtered)
          } else {
            // Fallback a ricerca semplice in caso di errore
            const query = searchQuery.toLowerCase().trim()
            const filtered = tools.filter((tool) => {
              if (categoryFilter && !tool.category.toLowerCase().includes(categoryFilter.toLowerCase())) {
                return false
              }
              const toolText = `${tool.name} ${tool.description} ${tool.category}`.toLowerCase()
              return toolText.includes(query)
            })
            setFilteredTools(filtered)
          }
        } catch (error) {
          console.error('Errore nella ricerca intelligente:', error)
          // Fallback a ricerca semplice
          const query = searchQuery.toLowerCase().trim()
          const filtered = tools.filter((tool) => {
            if (categoryFilter && !tool.category.toLowerCase().includes(categoryFilter.toLowerCase())) {
              return false
            }
            const toolText = `${tool.name} ${tool.description} ${tool.category}`.toLowerCase()
            return toolText.includes(query)
          })
          setFilteredTools(filtered)
        } finally {
          setSearching(false)
        }
      }
    }

    // Debounce di 500ms solo per ricerche con query
    const delay = searchQuery && searchQuery.trim().length > 0 ? 500 : 0
    const timeoutId = setTimeout(() => {
      performSearch()
    }, delay)

    return () => clearTimeout(timeoutId)
  }, [tools, searchQuery, categoryFilter])

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

  const displayTools = (filteredTools.length > 0 || searchQuery || categoryFilter) ? filteredTools : tools

  return (
    <div className="space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="text-4xl font-bold gradient-text mb-2">AI Tools Feed</h1>
        <p className="text-coral-red/70">Scopri e interagisci con i migliori strumenti AI</p>
        {searching && (
          <p className="text-sm text-coral-red/60 mt-2">🔍 Ricerca intelligente in corso...</p>
        )}
        {searchQuery && !searching && filteredTools.length === 0 && (
          <p className="text-sm text-coral-red/60 mt-2">Nessun risultato trovato per "{searchQuery}"</p>
        )}
        {searchQuery && !searching && filteredTools.length > 0 && (
          <p className="text-sm text-coral-red/60 mt-2">
            Trovati {filteredTools.length} strumento{filteredTools.length !== 1 ? 'i' : ''} per "{searchQuery}"
          </p>
        )}
      </motion.div>

      {displayTools.map((tool, index) => (
        <motion.div
          key={tool.id}
          id={`tool-${tool.id}`}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.1 }}
          className="space-y-3"
        >
          {/* Mostra spiegazione se disponibile (solo per risultati di ricerca) */}
          {toolExplanations[tool.id] && searchQuery && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-[var(--accent-blue)]/10 border border-[var(--accent-blue)]/30 rounded-lg p-4 mb-2"
            >
              <div className="flex items-start gap-2">
                <span className="text-[var(--accent-blue)] text-lg">💡</span>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-[var(--text-primary)] mb-1">
                    Perché questo tool:
                  </p>
                  <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                    {toolExplanations[tool.id]}
                  </p>
                </div>
              </div>
            </motion.div>
          )}
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

