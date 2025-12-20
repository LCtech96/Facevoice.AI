'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CircularGallery, type GalleryItem } from './ui/circular-gallery-2'
import { X, ExternalLink, Heart, MessageCircle, Share2, Send } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import type { AITool } from './Feed'
import { allAITools } from '@/lib/ai-tools-data'
import { createClient } from '@/lib/supabase-client'
import type { User } from '@supabase/supabase-js'

const mockAITools: AITool[] = allAITools

export default function AIToolsCircularGallery() {
  const [selectedTool, setSelectedTool] = useState<AITool | null>(null)
  const [showComments, setShowComments] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [showEmailInput, setShowEmailInput] = useState(false)
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null)
  const [comments, setComments] = useState<Array<{ id: string; user_id: string; user_name: string; comment: string; created_at: string }>>([])
  const [loadingComments, setLoadingComments] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const searchParams = useSearchParams()
  const supabase = createClient()

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
    }
    checkUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  // Controlla se siamo tornati dalla verifica e apri/ricarica i commenti
  useEffect(() => {
    const verified = searchParams?.get('verified')
    const toolId = searchParams?.get('tool')
    
    if (verified === 'success' && toolId && selectedTool?.id === toolId) {
      setShowComments(true)
      loadComments()
      setVerificationMessage('Commento verificato con successo! Il tuo commento è ora visibile.')
      setTimeout(() => {
        setVerificationMessage(null)
      }, 5000)
    }
  }, [searchParams, selectedTool?.id])

  const loadComments = async () => {
    if (!selectedTool) return
    setLoadingComments(true)
    try {
      const response = await fetch(`/api/tools/${selectedTool.id}/comments`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
        }
      })
      
      if (response.ok) {
        const data = await response.json()
        setComments(data.comments || [])
      } else {
        setComments([])
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
    if (newShowComments) {
      loadComments()
    }
  }

  useEffect(() => {
    if (showComments && selectedTool) {
      loadComments()
    }
  }, [showComments, selectedTool?.id])

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!commentText.trim() || !selectedTool) return

    // Se l'email non è stata inserita, mostra il campo email
    if (!userEmail.trim() && !user?.email) {
      setShowEmailInput(true)
      return
    }

    const commentToSubmit = commentText.trim()
    const emailToUse = user?.email || userEmail.trim()
    
    // Validazione email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(emailToUse)) {
      alert('Inserisci un\'email valida')
      return
    }
    
    // Genera nome utente
    const userName = user 
      ? (user.email?.split('@')[0] || user.user_metadata?.full_name || 'User')
      : emailToUse.split('@')[0] || 'Guest'
    const userId = user?.id || `anon_${Date.now()}`
    
    // Invia al server (non aggiungere localmente, aspetta verifica)
    try {
      const response = await fetch(`/api/tools/${selectedTool.id}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId,
          comment: commentToSubmit,
          userName: userName,
          userEmail: emailToUse,
        }),
      })
      
      if (response.ok) {
        const data = await response.json()
        
        // Mostra messaggio di verifica
        if (data.requiresVerification) {
          let message = data.message || 'Commento salvato! Controlla la tua email per verificarlo.'
          
          // Se c'è un link di verifica (email non configurata), mostralo
          if (data.verificationLink) {
            message += `\n\nLink di verifica: ${data.verificationLink}`
          }
          
          setVerificationMessage(message)
          setCommentText('')
          setUserEmail('')
          setShowEmailInput(false)
          // Ricarica commenti dopo un po'
          setTimeout(() => {
            loadComments()
          }, 2000)
        } else {
          // Se non richiede verifica (utente autenticato), aggiorna subito
          loadComments()
        }
      } else {
        const errorData = await response.json().catch(() => ({}))
        console.error('Failed to submit comment:', response.status, errorData)
        alert(errorData.error || 'Errore nel salvare il commento. Riprova più tardi.')
      }
    } catch (error) {
      console.error('Error submitting comment:', error)
      alert('Errore nel salvare il commento. Riprova più tardi.')
    }
  }

  // Converti AI tools in GalleryItems
  const galleryItems: GalleryItem[] = mockAITools.map(tool => ({
    image: tool.coverImage.startsWith('http') 
      ? tool.coverImage 
      : `${typeof window !== 'undefined' ? window.location.origin : ''}${tool.coverImage}`,
    text: tool.name,
  }))

  const handleItemClick = (index: number) => {
    setSelectedTool(mockAITools[index])
  }

  const handleShare = async () => {
    if (!selectedTool) return

    const shareUrl = `${window.location.origin}/home?tool=${selectedTool.id}`
    
    try {
      if (navigator.share) {
        await navigator.share({
          title: selectedTool.name,
          text: selectedTool.description,
          url: shareUrl,
        })
      } else {
        await navigator.clipboard.writeText(shareUrl)
        alert('Link copiato negli appunti!')
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error('Error sharing:', error)
      }
    }
  }

  const handleViewTool = () => {
    if (!selectedTool) return
    window.open(selectedTool.link, '_blank', 'noopener,noreferrer')
  }

  return (
    <>
      <div className="w-full h-[500px] md:h-[600px]">
        <CircularGallery
          items={galleryItems}
          bend={3}
          borderRadius={0.05}
          scrollEase={0.02}
          onItemClick={handleItemClick}
        />
      </div>

      {/* Modal per dettagli tool */}
      <AnimatePresence>
        {selectedTool && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-end md:items-center justify-center p-0 md:p-4"
            onClick={() => setSelectedTool(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white dark:bg-zinc-900 rounded-t-3xl md:rounded-2xl shadow-2xl max-w-2xl w-full h-[95vh] md:h-auto md:max-h-[90vh] flex flex-col overflow-hidden border-0 md:border border-zinc-200 dark:border-zinc-800"
            >
              {/* Header con immagine */}
              <div className="relative h-48 sm:h-56 md:h-64 bg-gradient-to-br from-blue-500 to-purple-600 flex-shrink-0">
                <img
                  src={selectedTool.coverImage.startsWith('http') 
                    ? selectedTool.coverImage 
                    : `${typeof window !== 'undefined' ? window.location.origin : ''}${selectedTool.coverImage}`}
                  alt={selectedTool.name}
                  className="w-full h-full object-cover"
                />
                <button
                  onClick={() => setSelectedTool(null)}
                  className="absolute top-4 right-4 p-2 bg-white/20 hover:bg-white/30 backdrop-blur-sm rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-white" />
                </button>
              </div>

              {/* Contenuto */}
              <div className="p-4 sm:p-5 md:p-6 flex-1 overflow-y-auto min-h-0">
                <div className="flex items-start justify-between mb-3 sm:mb-4">
                  <div className="flex-1 min-w-0 pr-2">
                    <span className="text-xs sm:text-sm text-zinc-500 dark:text-zinc-400 mb-1 block">
                      {selectedTool.category}
                    </span>
                    <h3 className="text-lg sm:text-xl md:text-2xl font-bold text-zinc-900 dark:text-white mb-1 sm:mb-2 break-words">
                      {selectedTool.name}
                    </h3>
                  </div>
                </div>

                <p className="text-zinc-700 dark:text-zinc-300 mb-3 sm:mb-4 md:mb-6 leading-relaxed text-sm sm:text-base">
                  {selectedTool.description}
                </p>

                {/* Statistiche */}
                <div className="flex items-center gap-3 sm:gap-4 md:gap-6 mb-3 sm:mb-4 md:mb-6 pb-3 sm:pb-4 md:pb-6 border-b border-zinc-200 dark:border-zinc-800">
                  <div className="flex items-center gap-1.5 sm:gap-2 text-zinc-600 dark:text-zinc-400">
                    <Heart className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" />
                    <span className="font-semibold text-sm sm:text-base">{selectedTool.likes}</span>
                  </div>
                  <div className="flex items-center gap-1.5 sm:gap-2 text-zinc-600 dark:text-zinc-400">
                    <MessageCircle className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" />
                    <span className="font-semibold text-sm sm:text-base">{selectedTool.comments}</span>
                  </div>
                  <div className="flex items-center gap-1.5 sm:gap-2 text-zinc-600 dark:text-zinc-400">
                    <Share2 className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" />
                    <span className="font-semibold text-sm sm:text-base">{selectedTool.shares}</span>
                  </div>
                </div>

                {/* Azioni */}
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 mb-4">
                  <button
                    onClick={handleViewTool}
                    className="flex-1 flex items-center justify-center gap-1.5 sm:gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3 sm:px-4 md:px-6 py-2 sm:py-2.5 md:py-3 rounded-lg text-xs sm:text-sm md:text-base font-semibold transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5 sm:w-4 sm:h-4 md:w-5 md:h-5 flex-shrink-0" />
                    <span className="hidden sm:inline">Visita il sito</span>
                    <span className="sm:hidden">Visita</span>
                  </button>
                  <button
                    onClick={handleShare}
                    className="flex items-center justify-center gap-1.5 sm:gap-2 bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-900 dark:text-white px-3 sm:px-4 md:px-6 py-2 sm:py-2.5 md:py-3 rounded-lg text-xs sm:text-sm md:text-base font-semibold transition-colors"
                  >
                    <Share2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 md:w-5 md:h-5 flex-shrink-0" />
                    <span className="hidden sm:inline">Condividi</span>
                  </button>
                  <button
                    onClick={handleToggleComments}
                    className="flex items-center justify-center gap-1.5 sm:gap-2 bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-900 dark:text-white px-3 sm:px-4 md:px-6 py-2 sm:py-2.5 md:py-3 rounded-lg text-xs sm:text-sm md:text-base font-semibold transition-colors"
                  >
                    <MessageCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 md:w-5 md:h-5 flex-shrink-0" />
                    <span className="hidden sm:inline">Commenta ({selectedTool.comments})</span>
                    <span className="sm:hidden">{selectedTool.comments}</span>
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
                      className="pt-4 border-t border-zinc-200 dark:border-zinc-800 overflow-hidden flex flex-col max-h-[60vh] md:max-h-[70vh]"
                    >
                      <div className="flex items-center justify-between mb-3 sm:mb-4 flex-shrink-0">
                        <h4 className="text-base sm:text-lg font-semibold text-zinc-900 dark:text-white">Recensioni</h4>
                        <button
                          onClick={handleToggleComments}
                          className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-all"
                        >
                          <X className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
                        </button>
                      </div>

                      {/* Comments List */}
                      <div className="space-y-3 overflow-y-auto mb-3 sm:mb-4 pr-2 flex-1 min-h-0">
                        {loadingComments ? (
                          <div className="text-center py-4 text-zinc-600 dark:text-zinc-400">Caricamento commenti...</div>
                        ) : comments.length === 0 ? (
                          <div className="text-center py-4 text-zinc-600 dark:text-zinc-400">
                            <p>Nessuna recensione ancora</p>
                            <p className="text-xs mt-2 text-zinc-500 dark:text-zinc-500">Sii il primo a lasciare una recensione!</p>
                          </div>
                        ) : (
                          <>
                            <div className="text-xs text-zinc-500 dark:text-zinc-500 mb-2">
                              {comments.length} {comments.length === 1 ? 'recensione' : 'recensioni'} verificata{comments.length === 1 ? '' : 'e'}
                            </div>
                            {comments.map((comment) => (
                              <div key={comment.id} className="bg-zinc-50 dark:bg-zinc-800 p-4 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600 transition-all">
                                <div className="flex items-center gap-2 mb-2">
                                  <div className="w-8 h-8 rounded-full bg-blue-600/20 flex items-center justify-center">
                                    <span className="text-blue-600 dark:text-blue-400 text-xs font-bold">
                                      {comment.user_name.charAt(0).toUpperCase()}
                                    </span>
                                  </div>
                                  <div className="flex-1">
                                    <span className="font-semibold text-zinc-900 dark:text-white text-sm block">{comment.user_name}</span>
                                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                                      {new Date(comment.created_at).toLocaleDateString('it-IT', {
                                        day: 'numeric',
                                        month: 'long',
                                        year: 'numeric'
                                      })}
                                    </span>
                                  </div>
                                </div>
                                <p className="text-zinc-700 dark:text-zinc-300 text-sm leading-relaxed pl-10">{comment.comment}</p>
                              </div>
                            ))}
                          </>
                        )}
                      </div>

                      {/* Messaggio di verifica */}
                      {verificationMessage && (
                        <div className="mb-3 sm:mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl border-2 border-blue-200 dark:border-blue-800 flex-shrink-0">
                          <p className="text-xs sm:text-sm text-blue-900 dark:text-blue-100 whitespace-pre-line">{verificationMessage}</p>
                          <button
                            onClick={() => setVerificationMessage(null)}
                            className="mt-2 text-xs text-blue-700 dark:text-blue-300 hover:text-blue-900 dark:hover:text-blue-100 underline"
                          >
                            Chiudi
                          </button>
                        </div>
                      )}

                      {/* Comment Form - Richiede email per verifica */}
                      <form onSubmit={handleSubmitComment} className="space-y-2 flex-shrink-0 mt-auto">
                        {showEmailInput && !user?.email && (
                          <input
                            type="email"
                            value={userEmail}
                            onChange={(e) => setUserEmail(e.target.value)}
                            placeholder="Inserisci la tua email per verificare il commento"
                            className="w-full px-3 sm:px-4 py-2 text-sm sm:text-base bg-zinc-50 dark:bg-zinc-800 rounded-xl text-zinc-900 dark:text-white placeholder-zinc-500 dark:placeholder-zinc-400 focus:outline-none focus:border-blue-500 border-2 border-zinc-200 dark:border-zinc-700 transition-all"
                            required
                          />
                        )}
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={commentText}
                            onChange={(e) => setCommentText(e.target.value)}
                            placeholder="Scrivi un commento..."
                            className="flex-1 px-3 sm:px-4 py-2 text-sm sm:text-base bg-zinc-50 dark:bg-zinc-800 rounded-xl text-zinc-900 dark:text-white placeholder-zinc-500 dark:placeholder-zinc-400 focus:outline-none focus:border-blue-500 border-2 border-zinc-200 dark:border-zinc-700 transition-all"
                          />
                          <button
                            type="submit"
                            disabled={!commentText.trim() || (showEmailInput && !userEmail.trim())}
                            className="px-3 sm:px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                          >
                            <Send className="w-4 h-4 sm:w-5 sm:h-5" />
                          </button>
                        </div>
                        {!user && (
                          <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            * Sarà richiesta la verifica email per pubblicare il commento
                          </p>
                        )}
                      </form>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

