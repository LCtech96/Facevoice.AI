'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Plus, Image as ImageIcon, X } from 'lucide-react'
import Image from 'next/image'
import { createClient } from '@/lib/supabase-client'
import type { User } from '@supabase/supabase-js'

interface BlogPost {
  id: string
  title: string
  content: string
  image_url?: string
  author: string
  created_at: string
}

export default function BlogSection({ user }: { user: User | null }) {
  const [posts, setPosts] = useState<BlogPost[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const isAdmin = user?.email === 'luca@facevoice.ai'
  const supabase = createClient()

  useEffect(() => {
    loadPosts()
  }, [])

  const loadPosts = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/blog/posts')
      if (response.ok) {
        const data = await response.json()
        setPosts(data.posts || [])
      }
    } catch (error) {
      console.error('Error loading posts:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !content.trim()) return

    setSubmitting(true)
    try {
      const response = await fetch('/api/blog/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          content: content.trim(),
          image_url: imageUrl.trim() || null,
        }),
      })

      if (response.ok) {
        setTitle('')
        setContent('')
        setImageUrl('')
        setShowForm(false)
        loadPosts()
      }
    } catch (error) {
      alert('Errore nel pubblicare il post')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div id="blog" className="container mx-auto px-4 py-12 max-w-4xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-3xl font-bold text-[var(--text-primary)] mb-2">Blog</h2>
          <p className="text-[var(--text-secondary)]">Notizie e aggiornamenti dal team Facevoice AI</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 bg-[var(--accent-blue)] text-white rounded-lg hover:bg-[var(--accent-blue)]/90 flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Nuovo Post
          </button>
        )}
      </div>

      {isAdmin && showForm && (
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
              className="w-full px-4 py-2 bg-[var(--background)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
              required
            />
            <input
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="URL immagine (opzionale)"
              className="w-full px-4 py-2 bg-[var(--background)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
            />
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Contenuto del post"
              rows={6}
              className="w-full px-4 py-2 bg-[var(--background)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)] resize-none"
              required
            />
            <button
              type="submit"
              disabled={submitting}
              className="w-full px-4 py-2 bg-[var(--accent-blue)] text-white rounded-lg hover:bg-[var(--accent-blue)]/90 disabled:opacity-50"
            >
              {submitting ? 'Pubblicazione...' : 'Pubblica Post'}
            </button>
          </form>
        </motion.div>
      )}

      <div className="space-y-8">
        {loading ? (
          <div className="text-center text-[var(--text-secondary)] py-8">Caricamento...</div>
        ) : posts.length === 0 ? (
          <div className="text-center text-[var(--text-secondary)] py-8">
            <p>Nessun post ancora</p>
            {isAdmin && <p className="text-sm mt-2">Crea il primo post!</p>}
          </div>
        ) : (
          posts.map((post) => (
            <motion.article
              key={post.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg overflow-hidden"
            >
              {post.image_url && (
                <div className="relative w-full h-64 bg-[var(--background-secondary)]">
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
                <h3 className="text-2xl font-bold text-[var(--text-primary)] mb-2">{post.title}</h3>
                <p className="text-sm text-[var(--text-secondary)] mb-4">
                  <span className="font-semibold">{post.author}</span> •{' '}
                  {new Date(post.created_at).toLocaleDateString('it-IT', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </p>
                <div className="text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
                  {post.content}
                </div>
              </div>
            </motion.article>
          ))
        )}
      </div>
    </div>
  )
}

