'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Shield, Check, X, MessageCircle, FileText, RefreshCw, Calendar, Mail, Phone, Clock, Plus, Trash2, Wallet, Users } from 'lucide-react'
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

interface AIKnowledge {
  id: string
  title: string
  content: string
  is_active: boolean
  created_at: string
}

interface Payment {
  id: string
  collaborator_name?: string | null
  collaborator_email: string
  amount: number
  currency: string
  note?: string | null
  entry_date: string
  entry_time: string
  due_date: string
  created_at: string
}

interface UserSummary {
  id: string
  email: string
  created_at: string
  last_sign_in_at: string | null
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
  const [knowledgeItems, setKnowledgeItems] = useState<AIKnowledge[]>([])
  const [loadingKnowledge, setLoadingKnowledge] = useState(false)
  const [showKnowledgeForm, setShowKnowledgeForm] = useState(false)
  const [knowledgeTitle, setKnowledgeTitle] = useState('')
  const [knowledgeContent, setKnowledgeContent] = useState('')
  const [payments, setPayments] = useState<Payment[]>([])
  const [loadingPayments, setLoadingPayments] = useState(false)
  const [paymentForm, setPaymentForm] = useState({
    collaborator_name: '',
    collaborator_email: '',
    amount: '',
    note: '',
    entry_date: '',
    entry_time: '',
    due_date: '',
  })
  const [shareEmailByPayment, setShareEmailByPayment] = useState<Record<string, string>>({})
  const [users, setUsers] = useState<UserSummary[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
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
      loadKnowledge()
      loadPayments()
      loadUsers()
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
        loadKnowledge()
        loadPayments()
        loadUsers()
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [router])

  const getAccessToken = async () => {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token || null
  }

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

  const loadKnowledge = async () => {
    setLoadingKnowledge(true)
    try {
      const token = await getAccessToken()
      if (!token) return

      const response = await fetch('/api/admin/ai-knowledge', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Errore nel caricare la conoscenza AI')
      }

      setKnowledgeItems(data.items || [])
    } catch (error: any) {
      console.error('Knowledge load error:', error)
    } finally {
      setLoadingKnowledge(false)
    }
  }

  const handleCreateKnowledge = async () => {
    if (!knowledgeTitle.trim() || !knowledgeContent.trim()) return
    setLoadingKnowledge(true)
    try {
      const token = await getAccessToken()
      if (!token) return

      const response = await fetch('/api/admin/ai-knowledge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: knowledgeTitle,
          content: knowledgeContent,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Errore nel salvare la conoscenza AI')
      }
      setKnowledgeTitle('')
      setKnowledgeContent('')
      setShowKnowledgeForm(false)
      loadKnowledge()
    } catch (error: any) {
      alert(error.message || 'Errore nel salvare la conoscenza AI')
    } finally {
      setLoadingKnowledge(false)
    }
  }

  const handleDeleteKnowledge = async (id: string) => {
    setLoadingKnowledge(true)
    try {
      const token = await getAccessToken()
      if (!token) return

      const response = await fetch(`/api/admin/ai-knowledge/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Errore nell\'eliminazione')
      }
      loadKnowledge()
    } catch (error: any) {
      alert(error.message || 'Errore nell\'eliminazione')
    } finally {
      setLoadingKnowledge(false)
    }
  }

  const loadPayments = async () => {
    setLoadingPayments(true)
    try {
      const token = await getAccessToken()
      if (!token) return

      const response = await fetch('/api/admin/payments', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Errore nel caricare i pagamenti')
      }

      setPayments(data.payments || [])
    } catch (error: any) {
      console.error('Payments load error:', error)
    } finally {
      setLoadingPayments(false)
    }
  }

  const handleCreatePayment = async () => {
    if (
      !paymentForm.collaborator_email ||
      !paymentForm.amount ||
      !paymentForm.entry_date ||
      !paymentForm.entry_time ||
      !paymentForm.due_date
    ) {
      alert('Compila tutti i campi obbligatori')
      return
    }

    setLoadingPayments(true)
    try {
      const token = await getAccessToken()
      if (!token) return

      const response = await fetch('/api/admin/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          collaborator_name: paymentForm.collaborator_name,
          collaborator_email: paymentForm.collaborator_email,
          amount: Number(paymentForm.amount),
          note: paymentForm.note,
          entry_date: paymentForm.entry_date,
          entry_time: paymentForm.entry_time,
          due_date: paymentForm.due_date,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Errore nel creare il pagamento')
      }
      setPaymentForm({
        collaborator_name: '',
        collaborator_email: '',
        amount: '',
        note: '',
        entry_date: '',
        entry_time: '',
        due_date: '',
      })
      loadPayments()
    } catch (error: any) {
      alert(error.message || 'Errore nel creare il pagamento')
    } finally {
      setLoadingPayments(false)
    }
  }

  const handleDeletePayment = async (id: string) => {
    setLoadingPayments(true)
    try {
      const token = await getAccessToken()
      if (!token) return

      const response = await fetch(`/api/admin/payments/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Errore nell\'eliminazione')
      }
      loadPayments()
    } catch (error: any) {
      alert(error.message || 'Errore nell\'eliminazione')
    } finally {
      setLoadingPayments(false)
    }
  }

  const handleSharePayment = async (paymentId: string) => {
    const sharedEmail = shareEmailByPayment[paymentId]?.trim()
    if (!sharedEmail) return

    setLoadingPayments(true)
    try {
      const token = await getAccessToken()
      if (!token) return

      const response = await fetch('/api/admin/payments/share', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          payment_id: paymentId,
          shared_with_email: sharedEmail,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || 'Errore nella condivisione')
      }
      setShareEmailByPayment((prev) => ({ ...prev, [paymentId]: '' }))
      alert('Condivisione salvata')
    } catch (error: any) {
      alert(error.message || 'Errore nella condivisione')
    } finally {
      setLoadingPayments(false)
    }
  }

  const loadUsers = async () => {
    setLoadingUsers(true)
    try {
      const token = await getAccessToken()
      if (!token) return

      const response = await fetch('/api/admin/users', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Errore nel caricare gli utenti')
      }

      setUsers(data.users || [])
    } catch (error: any) {
      console.error('Users load error:', error)
    } finally {
      setLoadingUsers(false)
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
                loadKnowledge()
                loadPayments()
                loadUsers()
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

          {/* AI Knowledge Section */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-12"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-[var(--text-primary)] flex items-center gap-3">
                <MessageCircle className="w-6 h-6" />
                Conoscenza AI
              </h2>
              <button
                onClick={() => setShowKnowledgeForm((prev) => !prev)}
                className="px-4 py-2 bg-[var(--accent-blue)] text-white rounded-lg hover:bg-[var(--accent-blue)]/90 flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Conoscenza AI
              </button>
            </div>

            {showKnowledgeForm && (
              <div className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg p-6 mb-6">
                <div className="grid grid-cols-1 gap-4">
                  <input
                    type="text"
                    value={knowledgeTitle}
                    onChange={(e) => setKnowledgeTitle(e.target.value)}
                    placeholder="Titolo"
                    className="w-full px-4 py-2 rounded-lg bg-[var(--background)] border border-[var(--border-color)]"
                  />
                  <textarea
                    value={knowledgeContent}
                    onChange={(e) => setKnowledgeContent(e.target.value)}
                    placeholder="Inserisci informazioni ufficiali"
                    rows={4}
                    className="w-full px-4 py-2 rounded-lg bg-[var(--background)] border border-[var(--border-color)]"
                  />
                  <button
                    onClick={handleCreateKnowledge}
                    disabled={loadingKnowledge}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                  >
                    Salva
                  </button>
                </div>
              </div>
            )}

            {loadingKnowledge ? (
              <div className="text-center py-8 text-[var(--text-secondary)]">Caricamento...</div>
            ) : knowledgeItems.length > 0 ? (
              <div className="space-y-4">
                {knowledgeItems.map((item) => (
                  <div
                    key={item.id}
                    className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg p-6"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
                          {item.title}
                        </h3>
                        <p className="text-[var(--text-secondary)] mb-2">{item.content}</p>
                        <p className="text-xs text-[var(--text-secondary)]">
                          {new Date(item.created_at).toLocaleString('it-IT')}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDeleteKnowledge(item.id)}
                        className="p-2 bg-red-500/20 hover:bg-red-500/30 text-red-600 rounded-lg transition-colors"
                        title="Elimina"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[var(--text-secondary)]">Nessuna conoscenza inserita.</div>
            )}
          </motion.div>

          {/* Payments Section */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-12"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-[var(--text-primary)] flex items-center gap-3">
                <Wallet className="w-6 h-6" />
                Pagamenti Collaboratori
              </h2>
            </div>

            <div className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg p-6 mb-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input
                  type="text"
                  value={paymentForm.collaborator_name}
                  onChange={(e) => setPaymentForm((prev) => ({ ...prev, collaborator_name: e.target.value }))}
                  placeholder="Nome collaboratore"
                  className="w-full px-4 py-2 rounded-lg bg-[var(--background)] border border-[var(--border-color)]"
                />
                <input
                  type="email"
                  value={paymentForm.collaborator_email}
                  onChange={(e) => setPaymentForm((prev) => ({ ...prev, collaborator_email: e.target.value }))}
                  placeholder="Email collaboratore"
                  className="w-full px-4 py-2 rounded-lg bg-[var(--background)] border border-[var(--border-color)]"
                  required
                />
                <input
                  type="number"
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm((prev) => ({ ...prev, amount: e.target.value }))}
                  placeholder="Importo"
                  className="w-full px-4 py-2 rounded-lg bg-[var(--background)] border border-[var(--border-color)]"
                  required
                />
                <input
                  type="date"
                  value={paymentForm.entry_date}
                  onChange={(e) => setPaymentForm((prev) => ({ ...prev, entry_date: e.target.value }))}
                  className="w-full px-4 py-2 rounded-lg bg-[var(--background)] border border-[var(--border-color)]"
                  required
                />
                <input
                  type="time"
                  value={paymentForm.entry_time}
                  onChange={(e) => setPaymentForm((prev) => ({ ...prev, entry_time: e.target.value }))}
                  className="w-full px-4 py-2 rounded-lg bg-[var(--background)] border border-[var(--border-color)]"
                  required
                />
                <input
                  type="date"
                  value={paymentForm.due_date}
                  onChange={(e) => setPaymentForm((prev) => ({ ...prev, due_date: e.target.value }))}
                  className="w-full px-4 py-2 rounded-lg bg-[var(--background)] border border-[var(--border-color)]"
                  required
                />
                <textarea
                  value={paymentForm.note}
                  onChange={(e) => setPaymentForm((prev) => ({ ...prev, note: e.target.value }))}
                  placeholder="Nota descrizione"
                  rows={2}
                  className="w-full px-4 py-2 rounded-lg bg-[var(--background)] border border-[var(--border-color)] md:col-span-2"
                />
              </div>
              <button
                onClick={handleCreatePayment}
                disabled={loadingPayments}
                className="mt-4 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                Salva pagamento
              </button>
            </div>

            {loadingPayments ? (
              <div className="text-center py-8 text-[var(--text-secondary)]">Caricamento...</div>
            ) : payments.length > 0 ? (
              <div className="space-y-4">
                {payments.map((payment) => (
                  <div
                    key={payment.id}
                    className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg p-6"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-1">
                          {payment.collaborator_name || payment.collaborator_email}
                        </h3>
                        <p className="text-sm text-[var(--text-secondary)] mb-2">
                          {payment.collaborator_email}
                        </p>
                        <p className="text-[var(--accent-blue)] font-bold mb-2">
                          {Number(payment.amount).toFixed(2)} {payment.currency}
                        </p>
                        <p className="text-sm text-[var(--text-secondary)]">
                          Inserito: {payment.entry_date} {payment.entry_time} · Scadenza: {payment.due_date}
                        </p>
                        {payment.note && (
                          <p className="text-[var(--text-secondary)] mt-2">{payment.note}</p>
                        )}
                        <div className="mt-4 flex flex-col sm:flex-row gap-2">
                          <input
                            type="email"
                            value={shareEmailByPayment[payment.id] || ''}
                            onChange={(e) =>
                              setShareEmailByPayment((prev) => ({
                                ...prev,
                                [payment.id]: e.target.value,
                              }))
                            }
                            placeholder="Condividi con (email)"
                            className="w-full sm:max-w-xs px-3 py-2 rounded-lg bg-[var(--background)] border border-[var(--border-color)]"
                          />
                          <button
                            onClick={() => handleSharePayment(payment.id)}
                            className="px-3 py-2 bg-[var(--accent-blue)] text-white rounded-lg hover:bg-[var(--accent-blue)]/90"
                          >
                            Condividi
                          </button>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeletePayment(payment.id)}
                        className="p-2 bg-red-500/20 hover:bg-red-500/30 text-red-600 rounded-lg transition-colors"
                        title="Elimina"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[var(--text-secondary)]">Nessun pagamento inserito.</div>
            )}
          </motion.div>

          {/* Users Section */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-12"
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-[var(--text-primary)] flex items-center gap-3">
                <Users className="w-6 h-6" />
                Utenti Registrati ({users.length})
              </h2>
            </div>

            {loadingUsers ? (
              <div className="text-center py-8 text-[var(--text-secondary)]">Caricamento...</div>
            ) : users.length > 0 ? (
              <div className="space-y-3">
                {users.map((item) => (
                  <div
                    key={item.id}
                    className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg p-4"
                  >
                    <p className="text-[var(--text-primary)] font-medium">{item.email}</p>
                    <p className="text-xs text-[var(--text-secondary)]">
                      Creato: {new Date(item.created_at).toLocaleString('it-IT')} · Ultimo accesso:{' '}
                      {item.last_sign_in_at ? new Date(item.last_sign_in_at).toLocaleString('it-IT') : 'mai'}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[var(--text-secondary)]">Nessun utente trovato.</div>
            )}
          </motion.div>
        </div>
      </div>
    </main>
  )
}

