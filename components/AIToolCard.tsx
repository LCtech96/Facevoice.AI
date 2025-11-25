'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Image from 'next/image'
import { Heart, MessageCircle, Share2, Send, X } from 'lucide-react'
import type { AITool } from './Feed'
import type { User } from '@supabase/supabase-js'

interface AIToolCardProps {
  tool: AITool
  user: User | null
  onLike: () => void
  onComment: (comment: string) => void
  onShare: () => void
  isHighlighted?: boolean
}

export default function AIToolCard({ tool, user, onLike, onComment, onShare, isHighlighted = false }: AIToolCardProps) {
  const [showComments, setShowComments] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [comments, setComments] = useState<Array<{ id: string; userId: string; userName: string; text: string; createdAt: string }>>([])
  const [loadingComments, setLoadingComments] = useState(false)

  const loadComments = async () => {
    if (showComments && comments.length === 0) {
      setLoadingComments(true)
      try {
        const response = await fetch(`/api/tools/${tool.id}/comments`)
        if (response.ok) {
          const data = await response.json()
          setComments(data.comments || [])
        }
      } catch (error) {
        console.error('Error loading comments:', error)
      } finally {
        setLoadingComments(false)
      }
    }
  }

  const handleToggleComments = () => {
    setShowComments(!showComments)
    if (!showComments) {
      loadComments()
    }
  }

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!commentText.trim() || !user) return

    const commentToSubmit = commentText
    setCommentText('')
    
    // Aggiungi commento localmente immediatamente
    const newComment = {
      id: Date.now().toString(),
      userId: user.id,
      userName: user.email?.split('@')[0] || user.user_metadata?.full_name || 'User',
      text: commentToSubmit,
      createdAt: new Date().toISOString(),
    }
    setComments((prev) => [newComment, ...prev])
    
    // Invia al server
    onComment(commentToSubmit)
  }

  return (
    <motion.div
      whileHover={{ scale: 1.01 }}
      className={`glass-strong rounded-3xl overflow-hidden border-2 ${
        isHighlighted ? 'border-coral-red ring-4 ring-coral-red ring-opacity-50' : 'border-coral-red/20'
      }`}
    >
      {/* Cover Image */}
      <div className="relative w-full h-64 bg-gradient-to-br from-coral-red/20 to-coral-red/5">
        <Image
          src={tool.coverImage}
          alt={tool.name}
          fill
          className="object-cover"
          onError={(e) => {
            // Fallback se l'immagine non carica
            const target = e.target as HTMLImageElement
            target.style.display = 'none'
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
        
        {/* Category Badge */}
        <div className="absolute top-4 left-4">
          <span className="px-3 py-1 glass rounded-full text-xs font-medium text-coral-red">
            {tool.category}
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {/* Title and Description */}
        <div className="flex items-start justify-between mb-2">
          <h3 className="text-2xl font-bold text-coral-red-light">{tool.name}</h3>
          {tool.link && (
            <a
              href={tool.link}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 glass rounded-lg text-sm font-medium text-coral-red hover:glass-strong transition-all"
            >
              Visita →
            </a>
          )}
        </div>
        <p className="text-coral-red/70 mb-4 leading-relaxed">{tool.description}</p>

        {/* Actions */}
        <div className="flex items-center gap-4 pt-4 border-t border-coral-red/20">
          {/* Like Button */}
          <button
            onClick={user ? onLike : undefined}
            disabled={!user}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl glass transition-all ${
              tool.isLiked
                ? 'text-red-500 hover:text-red-400'
                : 'text-coral-red/70 hover:text-coral-red'
            } ${!user ? 'opacity-50 cursor-not-allowed' : 'hover:glass-strong'}`}
          >
            <motion.div
              animate={{ scale: tool.isLiked ? [1, 1.3, 1] : 1 }}
              transition={{ duration: 0.3 }}
            >
              <Heart className={`w-5 h-5 ${tool.isLiked ? 'fill-current' : ''}`} />
            </motion.div>
            <span className="font-medium">{tool.likes}</span>
          </button>

          {/* Comments Button */}
          <button
            onClick={handleToggleComments}
            className="flex items-center gap-2 px-4 py-2 rounded-xl glass text-coral-red/70 hover:text-coral-red hover:glass-strong transition-all"
          >
            <MessageCircle className="w-5 h-5" />
            <span className="font-medium">{tool.comments}</span>
          </button>

          {/* Share Button */}
          <button
            onClick={onShare}
            className="flex items-center gap-2 px-4 py-2 rounded-xl glass text-coral-red/70 hover:text-coral-red hover:glass-strong transition-all ml-auto"
          >
            <Share2 className="w-5 h-5" />
            <span className="font-medium">{tool.shares}</span>
          </button>
        </div>

        {/* Comments Section */}
        <AnimatePresence>
          {showComments && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="mt-4 pt-4 border-t border-coral-red/20 overflow-hidden"
            >
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-lg font-semibold text-coral-red">Recensioni</h4>
                <button
                  onClick={handleToggleComments}
                  className="p-1 hover:glass rounded-lg transition-all"
                >
                  <X className="w-4 h-4 text-coral-red/70" />
                </button>
              </div>

              {/* Comments List */}
              <div className="space-y-3 max-h-64 overflow-y-auto mb-4">
                {loadingComments ? (
                  <div className="text-center py-4 text-coral-red/70">Caricamento...</div>
                ) : comments.length === 0 ? (
                  <div className="text-center py-4 text-coral-red/70">Nessuna recensione ancora</div>
                ) : (
                  comments.map((comment) => (
                    <div key={comment.id} className="glass p-3 rounded-xl">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold text-coral-red text-sm">{comment.userName}</span>
                        <span className="text-xs text-coral-red/50">
                          {new Date(comment.createdAt).toLocaleDateString('it-IT')}
                        </span>
                      </div>
                      <p className="text-coral-red/80 text-sm">{comment.text}</p>
                    </div>
                  ))
                )}
              </div>

              {/* Comment Form */}
              {user && (
                <form onSubmit={handleSubmitComment} className="flex gap-2">
                  <input
                    type="text"
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Scrivi una recensione..."
                    className="flex-1 px-4 py-2 glass rounded-xl text-coral-red placeholder-coral-red/50 focus:outline-none focus:border-coral-red border-2 border-coral-red/30 transition-all"
                  />
                  <button
                    type="submit"
                    disabled={!commentText.trim()}
                    className="px-4 py-2 glass-strong rounded-xl text-coral-red hover:border-coral-red border-2 border-transparent transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </form>
              )}

              {!user && (
                <div className="text-center py-2 text-coral-red/70 text-sm">
                  Accedi per lasciare una recensione
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}

