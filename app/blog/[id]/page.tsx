'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import Image from 'next/image'
import { ArrowLeft, Calendar, User } from 'lucide-react'
import Navigation from '@/components/Navigation'
import Link from 'next/link'

interface BlogPost {
  id: string
  title: string
  content: string
  image_url?: string
  author: string
  created_at: string
}

// Funzione per convertire URL in link cliccabili
function renderContentWithLinks(content: string) {
  // Regex per trovare URL (http, https, www)
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/g
  
  const parts = content.split(urlRegex)
  
  return parts.map((part, index) => {
    if (part.match(urlRegex)) {
      const href = part.startsWith('http') ? part : `https://${part}`
      return (
        <a
          key={index}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--accent-blue)] hover:underline break-all"
        >
          {part}
        </a>
      )
    }
    return <span key={index}>{part}</span>
  })
}

export default function BlogPostPage() {
  const params = useParams()
  const router = useRouter()
  const [post, setPost] = useState<BlogPost | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadPost = async () => {
      if (!params.id || typeof params.id !== 'string') {
        setError('ID post non valido')
        setLoading(false)
        return
      }

      try {
        const response = await fetch(`/api/blog/posts/${params.id}`)
        
        if (!response.ok) {
          if (response.status === 404) {
            setError('Post non trovato')
          } else {
            setError('Errore nel caricare il post')
          }
          setLoading(false)
          return
        }

        const data = await response.json()
        setPost(data.post)
      } catch (error) {
        console.error('Error loading post:', error)
        setError('Errore nel caricare il post')
      } finally {
        setLoading(false)
      }
    }

    loadPost()
  }, [params.id])

  if (loading) {
    return (
      <main className="min-h-screen bg-[var(--background)]">
        <Navigation />
        <div className="container mx-auto px-4 py-12 max-w-4xl">
          <div className="text-center text-[var(--text-secondary)] py-20">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--accent-blue)]"></div>
            <p className="mt-4">Caricamento...</p>
          </div>
        </div>
      </main>
    )
  }

  if (error || !post) {
    return (
      <main className="min-h-screen bg-[var(--background)]">
        <Navigation />
        <div className="container mx-auto px-4 py-12 max-w-4xl">
          <div className="text-center py-20">
            <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-4">
              {error || 'Post non trovato'}
            </h1>
            <Link
              href="/home#blog"
              className="inline-flex items-center gap-2 px-4 py-2 bg-[var(--accent-blue)] text-white rounded-lg hover:bg-[var(--accent-blue)]/90 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Torna al Blog
            </Link>
          </div>
        </div>
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

      <div className="container mx-auto px-4 py-8 max-w-4xl">
        {/* Pulsante Torna Indietro */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="mb-6"
        >
          <Link
            href="/home#blog"
            className="inline-flex items-center gap-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors group"
          >
            <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform" />
            <span>Torna al Blog</span>
          </Link>
        </motion.div>

        {/* Post */}
        <motion.article
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg overflow-hidden"
        >
          {post.image_url && (
            <div className="relative w-full h-64 md:h-96 bg-[var(--background-secondary)]">
              <Image
                src={post.image_url}
                alt={post.title}
                fill
                className="object-cover"
                unoptimized
              />
            </div>
          )}
          
          <div className="p-6 md:p-8">
            <h1 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)] mb-4">
              {post.title}
            </h1>
            
            <div className="flex items-center gap-4 text-sm text-[var(--text-secondary)] mb-6 pb-6 border-b border-[var(--border-color)]">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4" />
                <span className="font-semibold">{post.author}</span>
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                <time dateTime={post.created_at}>
                  {new Date(post.created_at).toLocaleDateString('it-IT', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </time>
              </div>
            </div>

            <div className="text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed prose prose-invert max-w-none">
              <div className="text-base md:text-lg">
                {renderContentWithLinks(post.content)}
              </div>
            </div>
          </div>
        </motion.article>

        {/* Pulsante Torna Indietro in fondo */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mt-8 flex justify-center"
        >
          <Link
            href="/home#blog"
            className="inline-flex items-center gap-2 px-6 py-3 bg-[var(--accent-blue)] text-white rounded-lg hover:bg-[var(--accent-blue)]/90 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Torna al Blog
          </Link>
        </motion.div>
      </div>

      {/* Spacing per mobile navigation bottom */}
      <div className="md:hidden h-20" />
    </main>
  )
}
