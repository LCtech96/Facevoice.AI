'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import Navigation from '@/components/Navigation'
import Hero from '@/components/Hero'
import Feed from '@/components/Feed'
import { WhatsAppContactForm } from '@/components/ui/whatsapp-contact-form'
import { MarketingBadgesHero } from '@/components/ui/marketing-badges-hero'
import AIToolsCircularGallery from '@/components/AIToolsCircularGallery'
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
      <Navigation 
        activeSection={activeSection} 
        setActiveSection={setActiveSection} 
      />
      
      {/* Spacing per desktop navigation */}
      <div className="hidden md:block h-12" />
      
      {/* Spacing per mobile navigation */}
      <div className="md:hidden h-2" />
      
      {/* Hero Section */}
      <div id="hero">
        <Hero />
      </div>
      
      {/* Call to Action Section */}
      <div className="container mx-auto px-4 py-2 md:py-4 max-w-4xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="flex flex-col items-center text-center"
        >
          <p className="text-sm sm:text-base md:text-lg text-[var(--text-primary)] mb-3 md:mb-4 max-w-3xl leading-relaxed">
            Se stai cercando più visibilità, e vuoi essere trovato facilmente dai tuoi clienti o attrarne di nuovi, o possiedi un codice sconto, compila i tre step in basso con nome, numero e inviaci un messaggio
          </p>
          
          {/* Freccia animata che punta al form */}
          <motion.button
            onClick={() => {
              const contactSection = document.getElementById('contact')
              if (contactSection) {
                contactSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            }}
            className="flex flex-col items-center gap-1 text-[var(--accent-blue)] hover:text-[var(--accent-blue-light)] transition-colors cursor-pointer group"
            aria-label="Scorri al form di contatto"
          >
            <motion.div
              animate={{
                y: [0, 8, 0],
              }}
              transition={{
                duration: 1.5,
                repeat: Infinity,
                ease: "easeInOut",
              }}
              className="flex items-center justify-center"
            >
              <ChevronDown className="w-6 h-6 md:w-8 md:h-8" />
            </motion.div>
            <span className="text-xs sm:text-sm text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors">
              Compila il form
            </span>
          </motion.button>
        </motion.div>
      </div>
      
      {/* Contact Form Section */}
      <div id="contact" className="container mx-auto px-4 py-4 md:py-6 max-w-4xl">
        <div className="flex flex-col items-center justify-center">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold text-[var(--text-primary)] mb-2 md:mb-3 text-center">
            Contattaci
          </h2>
          <p className="text-sm sm:text-base text-[var(--text-secondary)] mb-4 md:mb-6 text-center max-w-2xl">
            Compila il form per inviarci una richiesta direttamente su WhatsApp. Ti risponderemo il prima possibile!
          </p>
          <WhatsAppContactForm />
        </div>
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
      
      {/* AI Tools Circular Gallery alla fine della pagina */}
      <div id="ai-tools" className="container mx-auto px-4 py-4 md:py-6 max-w-6xl">
        <div className="text-center mb-3 md:mb-4">
          <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-[var(--text-primary)] mb-1 md:mb-2">
            AI Tools
          </h2>
          <p className="text-xs sm:text-sm md:text-base text-[var(--text-secondary)] max-w-2xl mx-auto">
            Esplora la nostra collezione di strumenti AI per potenziare il tuo business
          </p>
        </div>
        <div className="relative w-full min-h-[300px] sm:min-h-[400px] md:min-h-[500px] lg:min-h-[550px]">
          <AIToolsCircularGallery />
        </div>
      </div>
      
      {/* Marketing Badges alla fine della pagina */}
      <div className="container mx-auto px-4 py-4 md:py-6 max-w-4xl">
        <div className="relative min-h-[250px] sm:min-h-[300px] md:min-h-[350px] flex items-center justify-center">
          <MarketingBadgesHero />
        </div>
      </div>
      
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
