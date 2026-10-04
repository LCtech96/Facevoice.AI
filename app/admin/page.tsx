'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Shield, MessageCircle, RefreshCw, Plus, Trash2, Users } from 'lucide-react'
import Navigation from '@/components/Navigation'
import { createClient } from '@/lib/supabase-client'
import type { User } from '@supabase/supabase-js'
import { useTranslation } from '@/lib/i18n/LanguageContext'
import { isAdminEmail } from '@/lib/admin-auth'

interface AIKnowledge {
  id: string
  title: string
  content: string
  is_active: boolean
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
  const { t } = useTranslation()
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [knowledgeItems, setKnowledgeItems] = useState<AIKnowledge[]>([])
  const [loadingKnowledge, setLoadingKnowledge] = useState(false)
  const [showKnowledgeForm, setShowKnowledgeForm] = useState(false)
  const [knowledgeTitle, setKnowledgeTitle] = useState('')
  const [knowledgeContent, setKnowledgeContent] = useState('')
  const [users, setUsers] = useState<UserSummary[]>([])
  const [loadingUsers, setLoadingUsers] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user || !isAdminEmail(user.email)) {
        router.push('/home')
        return
      }
      setUser(user)
      setLoading(false)
      loadKnowledge()
      loadUsers()
    }
    checkUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user || !isAdminEmail(session.user.email)) {
        router.push('/home')
      } else {
        setUser(session.user)
        setLoading(false)
        loadKnowledge()
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

  return (
    <main className="min-h-screen bg-[var(--background)] overflow-x-hidden">
      <Navigation />
      <div className="pt-20 md:pt-24 pb-24 md:pb-0">
        <div className="container mx-auto px-4 py-6 md:py-8 max-w-6xl">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
            <div className="flex items-start gap-3 min-w-0">
              <Shield className="w-7 h-7 md:w-8 md:h-8 text-yellow-500 shrink-0 mt-1" />
              <div className="min-w-0">
                <h1 className="text-2xl md:text-3xl font-bold text-[var(--text-primary)]">Pannello Admin</h1>
                <p className="text-[var(--text-secondary)]">Memoria AI e utenti</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                  <a
                    href="/admin/inbox"
                    className="text-sm text-[var(--accent-blue)] hover:underline"
                  >
                    Messaggi social &rarr;
                  </a>
                  <a
                    href="/admin/usage"
                    className="text-sm text-[var(--accent-blue)] hover:underline"
                  >
                    Consumo AI del team &rarr;
                  </a>
                  <a
                    href="/admin/control"
                    className="text-sm text-[var(--accent-blue)] hover:underline"
                  >
                    Centro di controllo AI &rarr;
                  </a>
                </div>
              </div>
            </div>
            <button
              onClick={() => {
                loadKnowledge()
                loadUsers()
              }}
              disabled={loadingKnowledge || loadingUsers}
              className="self-start sm:self-auto px-4 py-2 bg-[var(--accent-blue)] text-white rounded-lg hover:bg-[var(--accent-blue)]/90 flex items-center gap-2 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${(loadingKnowledge || loadingUsers) ? 'animate-spin' : ''}`} />
              Aggiorna
            </button>
          </div>

          {/* AI Knowledge Section */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-12"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
              <h2 className="text-xl md:text-2xl font-bold text-[var(--text-primary)] flex items-center gap-3">
                <MessageCircle className="w-6 h-6" />
                {t('admin.aiKnowledge')}
              </h2>
              <button
                onClick={() => setShowKnowledgeForm((prev) => !prev)}
                className="px-4 py-2 bg-[var(--accent-blue)] text-white rounded-lg hover:bg-[var(--accent-blue)]/90 flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                {t('admin.aiKnowledge')}
              </button>
            </div>

            {showKnowledgeForm && (
              <div className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg p-4 md:p-6 mb-6">
                <div className="grid grid-cols-1 gap-4">
                  <input
                    type="text"
                    value={knowledgeTitle}
                    onChange={(e) => setKnowledgeTitle(e.target.value)}
                    placeholder={t('admin.knowledgeTitle')}
                    className="w-full px-4 py-2 rounded-lg bg-[var(--background)] border border-[var(--border-color)]"
                  />
                  <textarea
                    value={knowledgeContent}
                    onChange={(e) => setKnowledgeContent(e.target.value)}
                    placeholder={t('admin.knowledgeContent')}
                    rows={4}
                    className="w-full px-4 py-2 rounded-lg bg-[var(--background)] border border-[var(--border-color)]"
                  />
                  <button
                    onClick={handleCreateKnowledge}
                    disabled={loadingKnowledge}
                    className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                  >
                    {t('common.save')}
                  </button>
                </div>
              </div>
            )}

            {loadingKnowledge ? (
              <div className="text-center py-8 text-[var(--text-secondary)]">{t('common.loading')}</div>
            ) : knowledgeItems.length > 0 ? (
              <div className="space-y-4">
                {knowledgeItems.map((item) => (
                  <div
                    key={item.id}
                    className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg p-4 md:p-6"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0 break-words">
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
                        title={t('common.delete')}
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[var(--text-secondary)]">{t('admin.noKnowledge')}</div>
            )}
          </motion.div>

          {/* Users Section */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-12"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
              <h2 className="text-xl md:text-2xl font-bold text-[var(--text-primary)] flex items-center gap-3">
                <Users className="w-6 h-6" />
                {t('admin.users')} ({users.length})
              </h2>
            </div>

            {loadingUsers ? (
              <div className="text-center py-8 text-[var(--text-secondary)]">{t('common.loading')}</div>
            ) : users.length > 0 ? (
              <div className="space-y-3">
                {users.map((item) => (
                  <div
                    key={item.id}
                    className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg p-4"
                  >
                    <p className="text-[var(--text-primary)] font-medium">{item.email}</p>
                    <p className="text-xs text-[var(--text-secondary)]">
                      {t('admin.created')}: {new Date(item.created_at).toLocaleString('it-IT')} · {t('admin.lastAccess')}:{' '}
                      {item.last_sign_in_at ? new Date(item.last_sign_in_at).toLocaleString('it-IT') : t('admin.never')}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[var(--text-secondary)]">{t('admin.noUsers')}</div>
            )}
          </motion.div>
        </div>
      </div>
    </main>
  )
}

