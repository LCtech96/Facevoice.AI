'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import Image from 'next/image'
import { Calendar, User, Plus, X } from 'lucide-react'
import Navigation from '@/components/Navigation'
import { useTranslation } from '@/lib/i18n/LanguageContext'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-client'
import type { User as SupabaseUser } from '@supabase/supabase-js'

interface EntertainmentPost {
  id: string
  title: string
  content: string
  image_url?: string
  author: string
  slug?: string
  created_at: string
}

export default function EntertainmentPage() {
  const router = useRouter()
  const { t } = useTranslation()
  const [posts, setPosts] = useState<EntertainmentPost[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [user, setUser] = useState<SupabaseUser | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const supabase = createClient()
  const isFischietto = user?.email === 'umberto.fischietto@gmail.com'

  useEffect(() => {
    checkUser()
    loadPosts()
  }, [])

  const checkUser = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    setUser(user)
  }

  const loadPosts = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/entertainment/posts')
      if (response.ok) {
        const data = await response.json()
        setPosts(data.posts || [])
      } else {
        setError(t('common.error'))
      }
    } catch (error) {
      console.error('Error loading posts:', error)
      setError(t('common.error'))
    } finally {
      setLoading(false)
    }
  }

  const getPostUrl = (post: EntertainmentPost) => {
    if (post.slug) {
      return `/intrattenimento/${post.slug}`
    }
    // Fallback: genera slug dal titolo
    const slug = post.title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    return `/intrattenimento/${slug}`
  }

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (!file.type.startsWith('image/')) {
        alert('Seleziona un file immagine')
        return
      }
      if (file.size > 5 * 1024 * 1024) {
        alert('L\'immagine deve essere inferiore a 5MB')
        return
      }
      setImageFile(file)
      setImageUrl('')
      const reader = new FileReader()
      reader.onloadend = () => {
        setImagePreview(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !content.trim()) return

    setSubmitting(true)
    try {
      let finalImageUrl = imageUrl.trim() || null

      if (imageFile) {
        const uploadFormData = new FormData()
        uploadFormData.append('file', imageFile)

        const uploadResponse = await fetch('/api/blog/upload-image', {
          method: 'POST',
          body: uploadFormData,
        })

        if (!uploadResponse.ok) {
          const errorData = await uploadResponse.json().catch(() => ({}))
          throw new Error(errorData.error || 'Errore nel caricare l\'immagine')
        }

        const uploadData = await uploadResponse.json()
        finalImageUrl = uploadData.imageUrl
      }

      const response = await fetch('/api/entertainment/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          content: content.trim(),
          image_url: finalImageUrl,
        }),
      })

      if (response.ok) {
        setTitle('')
        setContent('')
        setImageUrl('')
        setImageFile(null)
        setImagePreview(null)
        setShowForm(false)
        loadPosts()
      } else {
        const errorData = await response.json().catch(() => ({}))
        alert(errorData.error || 'Errore nel pubblicare il post')
      }
    } catch (error: any) {
      console.error('Error submitting post:', error)
      alert(error.message || 'Errore nel pubblicare il post')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[var(--background)]">
        <Navigation />
        <div className="hidden md:block h-16" />
        <div className="md:hidden h-14" />
        <div className="container mx-auto px-4 py-12 max-w-6xl">
          <div className="text-center text-[var(--text-secondary)] py-20">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--accent-blue)]"></div>
            <p className="mt-4">{t('common.loading')}</p>
          </div>
        </div>
        <div className="md:hidden h-20" />
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[var(--background)]">
      <Navigation />
      
      {/* Spacing per desktop navigation */}
      <div className="hidden md:block h-16" />
      
      {/* Spacing per mobile navigation top */}
      <div className="md:hidden h-14" />

      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex-1"></div>
            <div className="flex-1 text-center">
              <h1 className="text-4xl md:text-5xl font-bold text-[var(--text-primary)] mb-4">
                {t('entertainment.title')}
              </h1>
              <p className="text-lg text-[var(--text-secondary)]">
                {t('entertainment.subtitle')}
              </p>
            </div>
            <div className="flex-1 flex justify-end">
              {isFischietto && (
                <button
                  onClick={() => setShowForm(!showForm)}
                  className="px-4 py-2 bg-[var(--accent-blue)] text-white rounded-lg hover:bg-[var(--accent-blue)]/90 flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  {t('blog.newPost')}
                </button>
              )}
            </div>
          </div>
        </motion.div>

        {/* Form di pubblicazione */}
        {isFischietto && showForm && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg p-6"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-[var(--text-primary)]">Nuovo Post</h3>
              <button onClick={() => setShowForm(false)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Titolo del post"
                className="w-full px-4 py-2 bg-[var(--background)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
                required
              />
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Contenuto del post"
                rows={10}
                className="w-full px-4 py-2 bg-[var(--background)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)] resize-none"
                required
              />
              <div className="space-y-2">
                <label className="block text-sm font-medium text-[var(--text-primary)]">
                  Immagine (URL o file)
                </label>
                <input
                  type="text"
                  value={imageUrl}
                  onChange={(e) => {
                    setImageUrl(e.target.value)
                    setImageFile(null)
                    setImagePreview(null)
                  }}
                  placeholder="URL immagine"
                  className="w-full px-4 py-2 bg-[var(--background)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
                />
                <div className="text-center text-sm text-[var(--text-secondary)]">oppure</div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  className="w-full px-4 py-2 bg-[var(--background)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]"
                />
                {imagePreview && (
                  <div className="mt-2">
                    <Image
                      src={imagePreview}
                      alt="Preview"
                      width={200}
                      height={200}
                      className="rounded-lg object-cover"
                      unoptimized
                    />
                  </div>
                )}
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full px-4 py-2 bg-[var(--accent-blue)] text-white rounded-lg hover:bg-[var(--accent-blue)]/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? t('common.loading') : t('common.submit')}
              </button>
            </form>
          </motion.div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-600 rounded-lg p-4 mb-6 text-center">
            {error}
          </div>
        )}

        {/* Posts Grid */}
        {posts.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-20"
          >
            <p className="text-[var(--text-secondary)] text-lg">
              {t('entertainment.noPosts')}
            </p>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {posts.map((post, index) => (
              <motion.article
                key={post.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg overflow-hidden hover:shadow-lg transition-shadow cursor-pointer"
                onClick={() => router.push(getPostUrl(post))}
              >
                {post.image_url && (
                  <div className="relative w-full h-48 bg-[var(--background-secondary)]">
                    <Image
                      src={post.image_url}
                      alt={post.title}
                      fill
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                )}
                
                <div className="p-6">
                  <h2 className="text-xl font-bold text-[var(--text-primary)] mb-3 line-clamp-2">
                    {post.title}
                  </h2>
                  
                  <p className="text-[var(--text-secondary)] text-sm mb-4 line-clamp-3">
                    {post.content.substring(0, 150)}...
                  </p>
                  
                  <div className="flex items-center justify-between text-xs text-[var(--text-secondary)] mb-4 pb-4 border-b border-[var(--border-color)]">
                    <div className="flex items-center gap-2">
                      <User className="w-3 h-3" />
                      <span>{post.author}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Calendar className="w-3 h-3" />
                      <time dateTime={post.created_at}>
                        {new Date(post.created_at).toLocaleDateString('it-IT', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </time>
                    </div>
                  </div>
                  
                  <Link
                    href={getPostUrl(post)}
                    className="inline-flex items-center text-[var(--accent-blue)] hover:underline text-sm font-medium"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {t('entertainment.readMore')} →
                  </Link>
                </div>
              </motion.article>
            ))}
          </div>
        )}
      </div>

      {/* Spacing per mobile navigation bottom */}
      <div className="md:hidden h-20" />
    </main>
  )
}
