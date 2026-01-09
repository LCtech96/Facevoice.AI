'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Shield, Check, X, MessageCircle, FileText, RefreshCw, Calendar, Mail, Phone, Clock } from 'lucide-react'
import Navigation from '@/components/Navigation'
import { createClient } from '@/lib/supabase-client'
import type { User } from '@supabase/supabase-js'

interface PendingComment {
  id: string
  tool_id?: string
  case_study_id?: string
  user_name: string
  user_email: string
  comment: string
  created_at: string
  is_approved: boolean
  is_verified?: boolean
}

interface Booking {
  id: string
  name: string
  email: string
  whatsapp: string
  service: string
  datetime?: string
  status: 'pending' | 'contacted' | 'completed' | 'cancelled'
  created_at: string
  updated_at?: string
}

export default function AdminPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [toolComments, setToolComments] = useState<PendingComment[]>([])
  const [caseComments, setCaseComments] = useState<PendingComment[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loadingComments, setLoadingComments] = useState(false)
  const [loadingBookings, setLoadingBookings] = useState(false)
  const [bookingStatusFilter, setBookingStatusFilter] = useState<'all' | 'pending' | 'contacted' | 'completed' | 'cancelled'>('pending')
  const supabase = createClient()

  useEffect(() => {
    if (user?.email === 'luca@facevoice.ai') {
      loadBookings()
    }
  }, [bookingStatusFilter, user])

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || user.email !== 'luca@facevoice.ai') {
        router.push('/home')
        return
      }
      setUser(user)
      setLoading(false)
      loadPendingComments()
      loadBookings()
    }
    checkUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user || session.user.email !== 'luca@facevoice.ai') {
        router.push('/home')
      } else {
        setUser(session.user)
        setLoading(false)
        loadPendingComments()
        loadBookings()
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [router])

  const loadPendingComments = async () => {
    setLoadingComments(true)
    try {
      const response = await fetch('/api/admin/pending-comments')
      if (response.ok) {
        const data = await response.json()
        setToolComments(data.toolComments || [])
        setCaseComments(data.caseComments || [])
      }
    } catch (error) {
      console.error('Error loading pending comments:', error)
    } finally {
      setLoadingComments(false)
    }
  }

  const handleApproveToolComment = async (commentId: string) => {
    try {
      const response = await fetch('/api/admin/approve-comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId }),
      })
      if (response.ok) {
        loadPendingComments()
      }
    } catch (error) {
      alert('Errore nell\'approvazione')
    }
  }

  const handleRejectToolComment = async (commentId: string) => {
    try {
      const response = await fetch('/api/admin/reject-comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId }),
      })
      if (response.ok) {
        loadPendingComments()
      }
    } catch (error) {
      alert('Errore nel rifiutare il commento')
    }
  }

  const handleApproveCaseComment = async (commentId: string) => {
    try {
      const response = await fetch('/api/admin/approve-case-comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId }),
      })
      if (response.ok) {
        loadPendingComments()
      }
    } catch (error) {
      alert('Errore nell\'approvazione')
    }
  }

  const handleRejectCaseComment = async (commentId: string) => {
    try {
      const response = await fetch('/api/admin/reject-case-comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commentId }),
      })
      if (response.ok) {
        loadPendingComments()
      }
    } catch (error) {
      alert('Errore nel rifiutare il commento')
    }
  }

  const loadBookings = async () => {
    setLoadingBookings(true)
    try {
      const response = await fetch(`/api/admin/bookings?status=${bookingStatusFilter}`)
      if (response.ok) {
        const data = await response.json()
        setBookings(data.bookings || [])
      }
    } catch (error) {
      console.error('Error loading bookings:', error)
    } finally {
      setLoadingBookings(false)
    }
  }

  const handleUpdateBookingStatus = async (bookingId: string, status: string) => {
    try {
      const response = await fetch(`/api/admin/bookings/${bookingId}/update-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (response.ok) {
        loadBookings()
      }
    } catch (error) {
      alert('Errore nell\'aggiornare lo status')
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[var(--background)] flex items-center justify-center">
        <div className="text-[var(--text-secondary)]">Caricamento...</div>
      </main>
    )
  }

  const totalPending = toolComments.length + caseComments.length

  return (
    <main className="min-h-screen bg-[var(--background)]">
      <Navigation />
      <div className="pt-20 md:pt-24">
        <div className="container mx-auto px-4 py-8 max-w-6xl">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <Shield className="w-8 h-8 text-yellow-500" />
              <div>
                <h1 className="text-3xl font-bold text-[var(--text-primary)]">Pannello Admin</h1>
                <p className="text-[var(--text-secondary)]">Gestisci commenti e prenotazioni</p>
              </div>
            </div>
            <button
              onClick={() => {
                loadPendingComments()
                loadBookings()
              }}
              disabled={loadingComments || loadingBookings}
              className="px-4 py-2 bg-[var(--accent-blue)] text-white rounded-lg hover:bg-[var(--accent-blue)]/90 flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${(loadingComments || loadingBookings) ? 'animate-spin' : ''}`} />
              Aggiorna
            </button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            <div className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[var(--text-secondary)] mb-1">Totale in sospeso</p>
                  <p className="text-3xl font-bold text-[var(--text-primary)]">{totalPending}</p>
                </div>
                <MessageCircle className="w-8 h-8 text-[var(--accent-blue)]" />
              </div>
            </div>
            <div className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[var(--text-secondary)] mb-1">Da AI Tools</p>
                  <p className="text-3xl font-bold text-[var(--text-primary)]">{toolComments.length}</p>
                </div>
                <FileText className="w-8 h-8 text-[var(--accent-blue)]" />
              </div>
            </div>
            <div className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-[var(--text-secondary)] mb-1">Prenotazioni</p>
                  <p className="text-3xl font-bold text-[var(--text-primary)]">{bookings.filter(b => b.status === 'pending').length}</p>
                </div>
                <Calendar className="w-8 h-8 text-[var(--accent-blue)]" />
              </div>
            </div>
          </div>

          {/* Tool Comments */}
          {toolComments.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-8"
            >
              <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-4">
                Commenti AI Tools ({toolComments.length})
              </h2>
              <div className="space-y-4">
                {toolComments.map((comment) => (
                  <div
                    key={comment.id}
                    className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg p-6"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-semibold text-[var(--text-primary)]">{comment.user_name}</span>
                          <span className="text-sm text-[var(--text-secondary)]">{comment.user_email}</span>
                          <span className="px-2 py-0.5 bg-orange-500/20 text-orange-600 rounded text-xs">
                            {comment.tool_id}
                          </span>
                        </div>
                        <p className="text-sm text-[var(--text-secondary)] mb-3">
                          {new Date(comment.created_at).toLocaleString('it-IT')}
                        </p>
                        <p className="text-[var(--text-primary)] leading-relaxed">{comment.comment}</p>
                      </div>
                      <div className="flex gap-2 ml-4">
                        <button
                          onClick={() => handleApproveToolComment(comment.id)}
                          className="p-2 bg-green-500/20 hover:bg-green-500/30 text-green-600 rounded-lg transition-colors"
                          title="Approva"
                        >
                          <Check className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => handleRejectToolComment(comment.id)}
                          className="p-2 bg-red-500/20 hover:bg-red-500/30 text-red-600 rounded-lg transition-colors"
                          title="Rifiuta"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Case Study Comments */}
          {caseComments.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-4">
                Commenti Case Studies ({caseComments.length})
              </h2>
              <div className="space-y-4">
                {caseComments.map((comment) => (
                  <div
                    key={comment.id}
                    className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg p-6"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="font-semibold text-[var(--text-primary)]">{comment.user_name}</span>
                          <span className="text-sm text-[var(--text-secondary)]">{comment.user_email}</span>
                          <span className="px-2 py-0.5 bg-purple-500/20 text-purple-600 rounded text-xs">
                            {comment.case_study_id}
                          </span>
                        </div>
                        <p className="text-sm text-[var(--text-secondary)] mb-3">
                          {new Date(comment.created_at).toLocaleString('it-IT')}
                        </p>
                        <p className="text-[var(--text-primary)] leading-relaxed">{comment.comment}</p>
                      </div>
                      <div className="flex gap-2 ml-4">
                        <button
                          onClick={() => handleApproveCaseComment(comment.id)}
                          className="p-2 bg-green-500/20 hover:bg-green-500/30 text-green-600 rounded-lg transition-colors"
                          title="Approva"
                        >
                          <Check className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => handleRejectCaseComment(comment.id)}
                          className="p-2 bg-red-500/20 hover:bg-red-500/30 text-red-600 rounded-lg transition-colors"
                          title="Rifiuta"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {totalPending === 0 && toolComments.length === 0 && caseComments.length === 0 && (
            <div className="text-center py-12">
              <Shield className="w-16 h-16 text-[var(--text-secondary)] mx-auto mb-4 opacity-50" />
              <p className="text-xl text-[var(--text-primary)] mb-2">Nessun commento in sospeso</p>
              <p className="text-[var(--text-secondary)]">Tutti i commenti sono stati gestiti!</p>
            </div>
          )}

          {/* Bookings Section */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-12"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-[var(--text-primary)] flex items-center gap-3">
                <Calendar className="w-6 h-6" />
                Prenotazioni ({bookings.length})
              </h2>
              <div className="flex gap-2">
                {['all', 'pending', 'contacted', 'completed', 'cancelled'].map((status) => (
                  <button
                    key={status}
                    onClick={() => setBookingStatusFilter(status as any)}
                    className={`px-3 py-1 text-sm rounded-lg transition-colors ${
                      bookingStatusFilter === status
                        ? 'bg-[var(--accent-blue)] text-white'
                        : 'bg-[var(--card-background)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:bg-[var(--background-secondary)]'
                    }`}
                  >
                    {status === 'all' ? 'Tutte' : status === 'pending' ? 'In attesa' : status === 'contacted' ? 'Contattate' : status === 'completed' ? 'Completate' : 'Cancellate'}
                  </button>
                ))}
              </div>
            </div>
            {loadingBookings ? (
              <div className="text-center py-12">
                <RefreshCw className="w-8 h-8 text-[var(--accent-blue)] mx-auto mb-4 animate-spin" />
                <p className="text-[var(--text-secondary)]">Caricamento prenotazioni...</p>
              </div>
            ) : bookings.length > 0 ? (
              <div className="space-y-4">
                {bookings.map((booking) => (
                  <div
                    key={booking.id}
                    className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg p-6"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <span className="text-lg font-semibold text-[var(--text-primary)]">{booking.name}</span>
                          <span className={`px-2 py-0.5 rounded text-xs ${
                            booking.status === 'pending' ? 'bg-orange-500/20 text-orange-600' :
                            booking.status === 'contacted' ? 'bg-blue-500/20 text-blue-600' :
                            booking.status === 'completed' ? 'bg-green-500/20 text-green-600' :
                            'bg-red-500/20 text-red-600'
                          }`}>
                            {booking.status === 'pending' ? 'In attesa' : 
                             booking.status === 'contacted' ? 'Contattata' : 
                             booking.status === 'completed' ? 'Completata' : 'Cancellata'}
                          </span>
                        </div>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-sm text-[var(--text-secondary)] mb-3">
                          <div className="flex items-center gap-2">
                            <Mail className="w-4 h-4" />
                            <span>{booking.email}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Phone className="w-4 h-4" />
                            <span>{booking.whatsapp}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Calendar className="w-4 h-4" />
                            <span>{new Date(booking.created_at).toLocaleString('it-IT')}</span>
                          </div>
                        </div>
                        <div className="bg-[var(--background-secondary)] rounded-lg p-4">
                          <p className="text-sm font-semibold text-[var(--text-primary)] mb-2">Motivo del booking:</p>
                          <p className="text-[var(--text-secondary)] leading-relaxed">{booking.service}</p>
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 ml-4">
                        {booking.status === 'pending' && (
                          <>
                            <button
                              onClick={() => handleUpdateBookingStatus(booking.id, 'contacted')}
                              className="p-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-600 rounded-lg transition-colors"
                              title="Segna come contattata"
                            >
                              <Phone className="w-5 h-5" />
                            </button>
                            <button
                              onClick={() => handleUpdateBookingStatus(booking.id, 'completed')}
                              className="p-2 bg-green-500/20 hover:bg-green-500/30 text-green-600 rounded-lg transition-colors"
                              title="Segna come completata"
                            >
                              <Check className="w-5 h-5" />
                            </button>
                            <button
                              onClick={() => handleUpdateBookingStatus(booking.id, 'cancelled')}
                              className="p-2 bg-red-500/20 hover:bg-red-500/30 text-red-600 rounded-lg transition-colors"
                              title="Cancella"
                            >
                              <X className="w-5 h-5" />
                            </button>
                          </>
                        )}
                        {booking.status === 'contacted' && (
                          <>
                            <button
                              onClick={() => handleUpdateBookingStatus(booking.id, 'completed')}
                              className="p-2 bg-green-500/20 hover:bg-green-500/30 text-green-600 rounded-lg transition-colors"
                              title="Segna come completata"
                            >
                              <Check className="w-5 h-5" />
                            </button>
                            <button
                              onClick={() => handleUpdateBookingStatus(booking.id, 'cancelled')}
                              className="p-2 bg-red-500/20 hover:bg-red-500/30 text-red-600 rounded-lg transition-colors"
                              title="Cancella"
                            >
                              <X className="w-5 h-5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <Calendar className="w-16 h-16 text-[var(--text-secondary)] mx-auto mb-4 opacity-50" />
                <p className="text-xl text-[var(--text-primary)] mb-2">Nessuna prenotazione</p>
                <p className="text-[var(--text-secondary)]">
                  {bookingStatusFilter === 'pending' ? 'Non ci sono prenotazioni in attesa' :
                   bookingStatusFilter === 'all' ? 'Non ci sono prenotazioni' :
                   `Non ci sono prenotazioni ${bookingStatusFilter === 'contacted' ? 'contattate' : bookingStatusFilter === 'completed' ? 'completate' : 'cancellate'}`}
                </p>
              </div>
            )}
          </motion.div>
        </div>
      </div>
    </main>
  )
}

