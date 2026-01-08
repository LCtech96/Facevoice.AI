'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, X, Shield } from 'lucide-react'
import { createClient } from '@/lib/supabase-client'
import type { User } from '@supabase/supabase-js'

interface CaseStudyCommentsProps {
  caseStudyId: string
  user: User | null
}

interface Comment {
  id: string
  user_name: string
  user_email: string
  comment: string
  created_at: string
  is_approved: boolean
}

export default function CaseStudyComments({ caseStudyId, user }: CaseStudyCommentsProps) {
  const [comments, setComments] = useState<Comment[]>([])
  const [commentText, setCommentText] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [showEmailInput, setShowEmailInput] = useState(false)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const supabase = createClient()
  const isAdmin = user?.email === 'luca@facevoice.ai'

  useEffect(() => {
    loadComments()
  }, [caseStudyId, isAdmin])

  const loadComments = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/case-studies/${caseStudyId}/comments`)
      if (response.ok) {
        const data = await response.json()
        // Mostra tutti i commenti approvati, o tutti se admin
        const approvedComments = isAdmin 
          ? data.comments || []
          : (data.comments || []).filter((c: Comment) => c.is_approved)
        setComments(approvedComments)
      }
    } catch (error) {
      console.error('Error loading comments:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!commentText.trim()) return

    if (!userEmail.trim() && !user?.email) {
      setShowEmailInput(true)
      return
    }

    const emailToUse = user?.email || userEmail.trim()
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(emailToUse)) {
      setMessage('Inserisci un\'email valida')
      return
    }

    setSubmitting(true)
    try {
      const response = await fetch(`/api/case-studies/${caseStudyId}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comment: commentText.trim(),
          userEmail: emailToUse,
          userName: user?.email?.split('@')[0] || emailToUse.split('@')[0] || 'Guest',
        }),
      })

      if (response.ok) {
        setCommentText('')
        setUserEmail('')
        setShowEmailInput(false)
        setMessage('Aspetta che l\'amministratore accetti il tuo commento. Sarà pubblicato dopo l\'approvazione.')
        setTimeout(() => setMessage(null), 5000)
        // Se admin, ricarica subito i commenti
        if (isAdmin) {
          loadComments()
        }
      }
    } catch (error) {
      setMessage('Errore nel salvare il commento')
    } finally {
      setSubmitting(false)
    }
  }

  const handleApprove = async (commentId: string) => {
    try {
      const response = await fetch(`/api/admin/approve-case-comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId, caseStudyId }),
      })
      if (response.ok) {
        loadComments()
      }
    } catch (error) {
      alert('Errore nell\'approvazione')
    }
  }

  const handleReject = async (commentId: string) => {
    try {
      const response = await fetch(`/api/admin/reject-case-comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId, caseStudyId }),
      })
      if (response.ok) {
        loadComments()
      }
    } catch (error) {
      alert('Errore nel rifiutare il commento')
    }
  }

  return (
    <div className="mt-8 pt-8 border-t border-[var(--border-color)]">
      <h3 className="text-2xl font-bold text-[var(--text-primary)] mb-6">Commenti</h3>

      {/* Comments List */}
      <div className="space-y-4 mb-6">
        {loading ? (
          <div className="text-center text-[var(--text-secondary)] py-4">Caricamento commenti...</div>
        ) : comments.length === 0 ? (
          <div className="text-center text-[var(--text-secondary)] py-8">
            <p>Nessun commento ancora</p>
            <p className="text-sm mt-2">Sii il primo a lasciare un commento!</p>
          </div>
        ) : (
          comments.map((comment) => (
            <div key={comment.id} className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg p-4">
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-[var(--text-primary)]">{comment.user_name}</span>
                    <span className="text-sm text-[var(--text-secondary)]">{comment.user_email}</span>
                    {isAdmin && !comment.is_approved && (
                      <span className="px-2 py-0.5 bg-orange-500/20 text-orange-600 rounded text-xs">Da approvare</span>
                    )}
                  </div>
                  <p className="text-sm text-[var(--text-secondary)] opacity-70">
                    {new Date(comment.created_at).toLocaleDateString('it-IT', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </p>
                </div>
                {isAdmin && (
                  <div className="flex gap-2">
                    {!comment.is_approved && (
                      <>
                        <button
                          onClick={() => handleApprove(comment.id)}
                          className="p-1 text-green-500 hover:bg-green-500/10 rounded"
                          title="Approva"
                        >
                          ✓
                        </button>
                        <button
                          onClick={() => handleReject(comment.id)}
                          className="p-1 text-red-500 hover:bg-red-500/10 rounded"
                          title="Rifiuta"
                        >
                          ✕
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
              <p className="text-[var(--text-primary)] leading-relaxed">{comment.comment}</p>
            </div>
          ))
        )}
      </div>

      {/* Comment Form */}
      <form onSubmit={handleSubmit} className="space-y-3">
        {message && (
          <div className={`p-3 rounded-lg text-sm ${
            message.includes('errore') || message.includes('Errore')
              ? 'bg-red-500/10 text-red-600 border border-red-500/30'
              : 'bg-green-500/10 text-green-600 border border-green-500/30'
          }`}>
            {message}
          </div>
        )}
        {showEmailInput && !user?.email && (
          <input
            type="email"
            value={userEmail}
            onChange={(e) => setUserEmail(e.target.value)}
            placeholder="La tua email (sarà visibile nel commento)"
            className="w-full px-4 py-2 bg-[var(--background)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
            required
          />
        )}
        <div className="flex gap-2">
          <textarea
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Lascia un commento..."
            rows={3}
            className="flex-1 px-4 py-2 bg-[var(--background)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)] resize-none"
          />
          <button
            type="submit"
            disabled={!commentText.trim() || submitting || (showEmailInput && !userEmail.trim())}
            className="px-4 py-2 bg-[var(--accent-blue)] text-white rounded-lg hover:bg-[var(--accent-blue)]/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
        <p className="text-xs text-[var(--text-secondary)]">
          * Il commento verrà pubblicato dopo l'approvazione dell'admin
        </p>
      </form>
    </div>
  )
}

