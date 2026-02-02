'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import AIToolCardCompact from './AIToolCardCompact'
import type { User } from '@supabase/supabase-js'
import { allAITools } from '@/lib/ai-tools-data'
import type { AITool } from './Feed'
import { createClient } from '@/lib/supabase-client'

interface AIToolsFeedProps {
  user: User | null
}

export default function AIToolsFeed({ user }: AIToolsFeedProps) {
  const [tools, setTools] = useState<AITool[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    loadTools()
  }, [user])

  const loadTools = async () => {
    setLoading(true)
    try {
      // Carica tutti i tool con i loro like
      const toolsWithLikes = await Promise.all(
        allAITools.map(async (tool) => {
          const isLiked = user ? await checkUserLike(tool.id, user.id) : false
          return { ...tool, isLiked }
        })
      )
      setTools(toolsWithLikes)
    } catch (error) {
      console.error('Error loading tools:', error)
      setTools(allAITools.map(tool => ({ ...tool, isLiked: false })))
    } finally {
      setLoading(false)
    }
  }

  const checkUserLike = async (toolId: string, userId: string): Promise<boolean> => {
    try {
      const { data, error } = await supabase
        .from('tool_likes')
        .select('id')
        .eq('tool_id', toolId)
        .eq('user_id', userId)
        .maybeSingle()
      
      // Se c'è un errore o la tabella non esiste, restituisci false
      if (error) {
        // Ignora errori 404 (tabella non trovata) o PGRST116 (nessun risultato)
        if (error.code === 'PGRST116' || error.message?.includes('404')) {
          return false
        }
        console.error('Error checking like:', error)
        return false
      }
      
      return !!data
    } catch (error) {
      console.error('Error in checkUserLike:', error)
      return false
    }
  }

  const handleLike = async (toolId: string) => {
    if (!user) {
      alert('Accedi per mettere like')
      return
    }

    const tool = tools.find(t => t.id === toolId)
    if (!tool) return

    try {
      const { data: existing, error: checkError } = await supabase
        .from('tool_likes')
        .select('id')
        .eq('tool_id', toolId)
        .eq('user_id', user.id)
        .maybeSingle()
      
      // Se c'è un errore (es. tabella non esiste), ignora silenziosamente
      if (checkError && checkError.code !== 'PGRST116') {
        console.error('Error checking existing like:', checkError)
        return
      }

      if (existing) {
        // Rimuovi like
        await supabase
          .from('tool_likes')
          .delete()
          .eq('tool_id', toolId)
          .eq('user_id', user.id)
        
        setTools(prev => prev.map(t => 
          t.id === toolId 
            ? { ...t, likes: Math.max(0, t.likes - 1), isLiked: false }
            : t
        ))
      } else {
        // Aggiungi like
        await supabase
          .from('tool_likes')
          .insert({ tool_id: toolId, user_id: user.id })
        
        setTools(prev => prev.map(t => 
          t.id === toolId 
            ? { ...t, likes: (t.likes || 0) + 1, isLiked: true }
            : t
        ))
      }
    } catch (error) {
      console.error('Error toggling like:', error)
    }
  }

  const handleComment = async (toolId: string, comment: string) => {
    // La gestione commenti è dentro AIToolCard
  }

  const handleShare = async (toolId: string) => {
    const url = `${window.location.origin}/home?tool=${toolId}`
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Scopri questo AI Tool su Facevoice AI`,
          url,
        })
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          await navigator.clipboard.writeText(url)
          alert('Link copiato negli appunti!')
        }
      }
    } else {
      await navigator.clipboard.writeText(url)
      alert('Link copiato negli appunti!')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-[var(--text-secondary)]">Caricamento...</div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
      {tools.map((tool, index) => (
        <motion.div
          key={tool.id}
          id={`tool-${tool.id}`}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.05 }}
          className="w-full"
        >
          <AIToolCardCompact
            tool={tool}
            user={user}
            onLike={() => handleLike(tool.id)}
            onComment={(comment) => handleComment(tool.id, comment)}
            onShare={() => handleShare(tool.id)}
          />
        </motion.div>
      ))}
    </div>
  )
}

