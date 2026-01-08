'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import Navigation from '@/components/Navigation'
import Hero from '@/components/Hero'
import Feed from '@/components/Feed'
import AIToolsFeed from '@/components/AIToolsFeed'
import BlogSection from '@/components/BlogSection'
import SemanticContent from '@/components/SEO/SemanticContent'
import SEOHead from '@/components/SEO/SEOHead'
import InternalLinks from '@/components/SEO/InternalLinks'
import { createClient } from '@/lib/supabase-client'
import type { User } from '@supabase/supabase-js'

function HomeContent({ user, loading }: { user: User | null; loading: boolean }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const toolIdRef = useRef<string | null>(null)
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>(undefined)

  // Gestisci redirect da link condiviso
  useEffect(() => {
    const toolId = searchParams.get('tool')
    if (toolId) {
      toolIdRef.current = toolId
    }
  }, [searchParams])

  // Gestisci scroll alle sezioni quando si naviga con hash
  useEffect(() => {
    const hash = window.location.hash.replace('#', '')
    if (hash) {
      setActiveSection(hash)
      setTimeout(() => {
        const element = document.getElementById(hash)
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      }, 100)
    }
  }, [])

  // Gestisci scroll quando cambia activeSection
  useEffect(() => {
    if (activeSection) {
      const element = document.getElementById(activeSection)
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }
  }, [activeSection])

  if (loading) {
    return (
      <main className="min-h-screen bg-[var(--background)] flex items-center justify-center">
        <div className="text-[var(--text-secondary)]">Caricamento...</div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[var(--background)]">
      <SEOHead
        title="Facevoice AI | Sviluppo Software e Integrazione AI a Palermo | Automazione Aziendale"
        description="Sviluppo software su misura per automazione aziendale a Palermo. Integrazione intelligenza artificiale per gestione magazzino e-commerce, consulenza SEO per Shopify e WooCommerce, chatbot AI personalizzati per assistenza clienti h24. Ottimizzazione velocità siti e-commerce professionali."
        keywords={[
          'sviluppo software su misura Palermo',
          'automazione aziendale Palermo',
          'intelligenza artificiale e-commerce',
          'gestione magazzino AI',
          'consulenza SEO Shopify',
          'consulenza SEO WooCommerce',
          'chatbot AI personalizzati',
          'assistenza clienti h24',
          'ottimizzazione velocità e-commerce',
          'machine learning analisi dati',
          'soluzioni cloud Sicilia',
          'digitalizzazione imprese'
        ]}
        canonical="https://www.facevoice.ai/home"
        page="home"
      />
      <Navigation 
        activeSection={activeSection} 
        setActiveSection={setActiveSection} 
      />
      
      {/* Spacing per desktop navigation */}
      <div className="hidden md:block h-8" />
      
      {/* Spacing per mobile navigation */}
      <div className="md:hidden h-1" />
      
      {/* Hero Section */}
      <div id="hero">
        <Hero />
      </div>
      
      {/* Feed Section - Stile Social Media - Solo quando c'è ricerca/filtro */}
      {(searchQuery || categoryFilter) && (
        <div id="ai-tools-feed" className="container mx-auto px-4 py-8 max-w-4xl">
          <Feed 
            user={user} 
            highlightedToolId={toolIdRef.current}
            searchQuery={searchQuery}
            categoryFilter={categoryFilter}
          />
        </div>
      )}
      
      {/* AI Tools Feed - Stile Instagram */}
      <div id="ai-tools" className="container mx-auto px-4 py-8 max-w-7xl">
        <div className="text-center mb-6">
          <h2 className="text-2xl md:text-3xl font-bold text-[var(--text-primary)] mb-2">
            AI Tools
          </h2>
          <p className="text-sm md:text-base text-[var(--text-secondary)] max-w-2xl mx-auto">
            Esplora la nostra collezione di strumenti AI per potenziare il tuo business
          </p>
        </div>
        <AIToolsFeed user={user} />
      </div>

      {/* Blog Section */}
      <BlogSection user={user} />

      {/* Internal Links Section - SEO */}
      <InternalLinks />

      {/* Semantic Content - SEO */}
      <SemanticContent page="home" />
      
      {/* Spacing per mobile navigation bottom */}
      <div className="md:hidden h-20" />
    </main>
  )
}

export default function HomePage() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
      setLoading(false)
    }

    checkUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  return (
    <Suspense fallback={
      <main className="min-h-screen bg-[var(--background)] flex items-center justify-center">
        <div className="text-[var(--text-secondary)]">Caricamento...</div>
      </main>
    }>
      <HomeContent user={user} loading={loading} />
    </Suspense>
  )
}
