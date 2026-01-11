'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Plus, Image as ImageIcon, X } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
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
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
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

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      // Valida tipo file
      if (!file.type.startsWith('image/')) {
        alert('Seleziona un file immagine')
        return
      }
      // Valida dimensione (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        alert('L\'immagine deve essere inferiore a 5MB')
        return
      }
      setImageFile(file)
      setImageUrl('') // Reset URL se si carica un file
      // Crea preview
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

      // Se c'è un file, caricalo su Supabase Storage
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

      // Crea il post con l'URL dell'immagine
      const response = await fetch('/api/blog/post', {
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
            <div className="space-y-2">
              <label className="block text-sm font-medium text-[var(--text-primary)]">
                Immagine (Opzionale)
              </label>
              <div className="space-y-2">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  className="w-full px-4 py-2 bg-[var(--background)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)] text-sm file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-[var(--accent-blue)] file:text-white hover:file:bg-[var(--accent-blue)]/90 cursor-pointer"
                />
                <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                  <span className="flex-1 border-t border-[var(--border-color)]"></span>
                  <span>oppure</span>
                  <span className="flex-1 border-t border-[var(--border-color)]"></span>
                </div>
                <input
                  type="url"
                  value={imageUrl}
                  onChange={(e) => {
                    setImageUrl(e.target.value)
                    if (e.target.value) {
                      setImageFile(null)
                      setImagePreview(null)
                    }
                  }}
                  placeholder="URL immagine (opzionale)"
                  className="w-full px-4 py-2 bg-[var(--background)] border border-[var(--border-color)] rounded-lg text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
                />
              </div>
              {imagePreview && (
                <div className="mt-2 relative">
                  <img
                    src={imagePreview}
                    alt="Preview"
                    className="w-full h-48 object-cover rounded-lg border border-[var(--border-color)]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setImageFile(null)
                      setImagePreview(null)
                    }}
                    className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
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
            <Link key={post.id} href={`/blog/${post.id}`}>
              <motion.article
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg overflow-hidden cursor-pointer hover:border-[var(--accent-blue)]/50 transition-colors"
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
                  <h3 className="text-2xl font-bold text-[var(--text-primary)] mb-2 hover:text-[var(--accent-blue)] transition-colors">
                    {post.title}
                  </h3>
                  <p className="text-sm text-[var(--text-secondary)] mb-4">
                    <span className="font-semibold">{post.author}</span> •{' '}
                    {new Date(post.created_at).toLocaleDateString('it-IT', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </p>
                  <div className="text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed line-clamp-3">
                    {post.content}
                  </div>
                  <div className="mt-4 text-sm text-[var(--accent-blue)] font-medium">
                    Leggi di più →
                  </div>
                </div>
              </motion.article>
            </Link>
          ))
        )}
      </div>
    </div>
  )
}

