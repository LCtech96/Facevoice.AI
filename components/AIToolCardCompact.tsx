'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Image from 'next/image'
import { Heart, MessageCircle, Share2, Send, X, ExternalLink } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import type { AITool } from './Feed'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase-client'

interface AIToolCardCompactProps {
  tool: AITool
  user: User | null
  onLike: () => void
  onComment: (comment: string) => void
  onShare: () => void
}

export default function AIToolCardCompact({ tool, user, onLike, onComment, onShare }: AIToolCardCompactProps) {
  const searchParams = useSearchParams()
  const [showComments, setShowComments] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [showEmailInput, setShowEmailInput] = useState(false)
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null)
  const [comments, setComments] = useState<Array<{ id: string; user_id: string; user_name: string; user_email: string; comment: string; created_at: string; is_approved: boolean }>>([])
  const [loadingComments, setLoadingComments] = useState(false)
  const supabase = createClient()
  const isAdmin = user?.email === 'luca@facevoice.ai'

  useEffect(() => {
    const verified = searchParams?.get('verified')
    const toolId = searchParams?.get('tool')
    if (verified === 'success' && toolId === tool.id) {
      setShowComments(true)
      loadComments()
      setVerificationMessage('Commento verificato con successo!')
      setTimeout(() => setVerificationMessage(null), 5000)
    }
  }, [searchParams, tool.id])

  const loadComments = async () => {
    setLoadingComments(true)
    try {
      const response = await fetch(`/api/tools/${tool.id}/comments`, {
        cache: 'no-store',
      })
      if (response.ok) {
        const data = await response.json()
        // Mostra solo commenti approvati (limitati a 3 dall'API), o tutti se admin
        const approvedComments = isAdmin 
          ? (data.comments || []).slice(0, 3) // Admin vede solo ultimi 3
          : (data.comments || []).filter((c: any) => c.is_approved || c.is_verified).slice(0, 3)
        setComments(approvedComments)
      }
    } catch (error) {
      console.error('Error loading comments:', error)
      setComments([])
    } finally {
      setLoadingComments(false)
    }
  }

  const handleToggleComments = () => {
    const newShowComments = !showComments
    setShowComments(newShowComments)
    if (newShowComments) loadComments()
  }

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!commentText.trim()) return
    if (!userEmail.trim() && !user?.email) {
      setShowEmailInput(true)
      return
    }

    const emailToUse = user?.email || userEmail.trim()
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(emailToUse)) {
      alert('Inserisci un\'email valida')
      return
    }

    try {
      const response = await fetch(`/api/tools/${tool.id}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user?.id || `anon_${Date.now()}`,
          comment: commentText.trim(),
          userName: user?.email?.split('@')[0] || emailToUse.split('@')[0] || 'Guest',
          userEmail: emailToUse,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setCommentText('')
        setUserEmail('')
        setShowEmailInput(false)
        if (data.requiresVerification) {
          setVerificationMessage(data.message || 'Aspetta che l\'amministratore accetti il tuo commento.')
        } else {
          loadComments()
        }
      }
    } catch (error) {
      alert('Errore nel salvare il commento')
    }
  }

  const handleApproveComment = async (commentId: string) => {
    try {
      const response = await fetch(`/api/admin/approve-comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId, toolId: tool.id }),
      })
      if (response.ok) {
        loadComments()
      }
    } catch (error) {
      alert('Errore nell\'approvazione')
    }
  }

  const handleRejectComment = async (commentId: string) => {
    try {
      const response = await fetch(`/api/admin/reject-comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId, toolId: tool.id }),
      })
      if (response.ok) {
        loadComments()
      }
    } catch (error) {
      alert('Errore nel rifiutare il commento')
    }
  }

  return (
    <div className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      {/* Immagine */}
      <div className="relative w-full aspect-square bg-gradient-to-br from-[var(--accent-blue)]/10 to-[var(--accent-blue)]/5">
        {tool.videoUrl ? (
          <video src={tool.videoUrl} className="w-full h-full object-cover" controls loop muted playsInline />
        ) : (
          <>
            <Image
              src={tool.coverImage}
              alt={`${tool.name} - ${tool.category} - AI Tool per ${tool.description.slice(0, 60)}`}
              fill
              className="object-cover"
              loading="lazy"
              sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
              unoptimized
              onError={(e) => {
                const target = e.target as HTMLImageElement
                target.src = '/team/placeholder.svg'
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          </>
        )}
        {/* Link esterno */}
        {tool.link && (
          <a
            href={tool.link}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute top-2 right-2 p-2 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        )}
      </div>

      {/* Contenuto */}
      <div className="p-3">
        {/* Titolo e categoria */}
        <div className="mb-2">
          <span className="text-xs text-[var(--text-secondary)] uppercase tracking-wide">{tool.category}</span>
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mt-1 line-clamp-1">{tool.name}</h3>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2 border-t border-[var(--border-color)]">
          <button
            onClick={user ? onLike : undefined}
            disabled={!user}
            className={`flex items-center gap-1 ${tool.isLiked ? 'text-red-500' : 'text-[var(--text-secondary)]'} ${!user ? 'opacity-50 cursor-not-allowed' : 'hover:text-red-500'}`}
          >
            <Heart className={`w-4 h-4 ${tool.isLiked ? 'fill-current' : ''}`} />
            <span className="text-xs font-medium">{tool.likes}</span>
          </button>

          <button
            onClick={handleToggleComments}
            className="flex items-center gap-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            <MessageCircle className="w-4 h-4" />
            <span className="text-xs font-medium">{tool.comments}</span>
          </button>

          <button
            onClick={onShare}
            className="flex items-center gap-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] ml-auto"
          >
            <Share2 className="w-4 h-4" />
          </button>
        </div>

        {/* Comments Section */}
        <AnimatePresence>
          {showComments && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="mt-3 pt-3 border-t border-[var(--border-color)] overflow-hidden"
            >
              <div className="max-h-48 overflow-y-auto space-y-2 mb-3">
                {loadingComments ? (
                  <div className="text-xs text-center text-[var(--text-secondary)] py-2">Caricamento...</div>
                ) : comments.length === 0 ? (
                  <div className="text-xs text-center text-[var(--text-secondary)] py-2">Nessun commento</div>
                ) : (
                  <>
                    {comments.length === 3 && (
                      <div className="text-xs text-center text-[var(--text-secondary)] mb-2 opacity-70">
                        Visibili solo gli ultimi 3 commenti
                      </div>
                    )}
                    {comments.map((comment) => (
                    <div key={comment.id} className="bg-[var(--background-secondary)] p-2 rounded text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1">
                          <span className="font-semibold text-[var(--text-primary)]">{comment.user_name}</span>
                          {isAdmin && !comment.is_approved && (
                            <span className="text-orange-500 text-[10px]">(da approvare)</span>
                          )}
                        </div>
                        {isAdmin && (
                          <div className="flex gap-1">
                            {!comment.is_approved && (
                              <>
                                <button
                                  onClick={() => handleApproveComment(comment.id)}
                                  className="text-green-500 hover:text-green-600 text-[10px]"
                                >
                                  ✓
                                </button>
                                <button
                                  onClick={() => handleRejectComment(comment.id)}
                                  className="text-red-500 hover:text-red-600 text-[10px]"
                                >
                                  ✕
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                      <p className="text-[var(--text-secondary)] text-[11px]">{comment.comment}</p>
                      {isAdmin && (
                        <p className="text-[10px] text-[var(--text-secondary)] mt-1">{comment.user_email}</p>
                      )}
                    </div>
                  ))}
                  </>
                )}
              </div>

              {verificationMessage && (
                <div className="mb-2 p-2 bg-green-500/10 border border-green-500/30 rounded text-xs text-green-600">
                  {verificationMessage}
                </div>
              )}

              <form onSubmit={handleSubmitComment} className="space-y-2">
                {showEmailInput && !user?.email && (
                  <input
                    type="email"
                    value={userEmail}
                    onChange={(e) => setUserEmail(e.target.value)}
                    placeholder="Email"
                    className="w-full px-2 py-1 text-xs bg-[var(--background)] border border-[var(--border-color)] rounded"
                    required
                  />
                )}
                <div className="flex gap-1">
                  <input
                    type="text"
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Aggiungi un commento..."
                    className="flex-1 px-2 py-1 text-xs bg-[var(--background)] border border-[var(--border-color)] rounded"
                  />
                  <button
                    type="submit"
                    disabled={!commentText.trim()}
                    className="px-2 py-1 bg-[var(--accent-blue)] text-white rounded text-xs disabled:opacity-50"
                  >
                    <Send className="w-3 h-3" />
                  </button>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

