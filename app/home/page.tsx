'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import EmberHero from '@/components/landing/EmberHero'
import HomeCta from '@/components/landing/HomeCta'
import BlogSection from '@/components/BlogSection'
import SEOHead from '@/components/SEO/SEOHead'
import { createClient } from '@/lib/supabase-client'
import type { User } from '@supabase/supabase-js'

// Home del sito: si apre sulla hero (payoff e cosa facciamo: software su misura e
// integrazioni AI per le PMI), poi il blog e la chiusura con il contatto. Le sezioni
// si aprono con un link diretto (es. /home#blog) solo quando lo si chiede.

const HOME_TITLE = 'Facevoice AI | Sviluppo software e integrazioni AI per PMI'
const HOME_DESCRIPTION =
  'Facevoice AI sviluppa software su misura e integra l’intelligenza artificiale nelle piccole e medie imprese: gestionali, app, automazioni e assistenti AI. Sede a Terrasini (Palermo), clienti in tutta Italia.'

export default function HomePage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [activeSection, setActiveSection] = useState<string | null>(null)

  // Chi ha fatto l'accesso (serve al blog); la pagina non lo aspetta per mostrarsi.
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => setUser(data.user))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  // Link diretto a una sezione (es. /home#blog): ci si va; senza, si resta sulla hero.
  useEffect(() => {
    const hash = window.location.hash.replace('#', '')
    if (hash === 'lavora-con-noi') {
      router.push('/lavora-con-noi')
      return
    }
    if (hash) setActiveSection(hash)
  }, [router])

  useEffect(() => {
    if (!activeSection) return
    const timer = setTimeout(() => document.getElementById(activeSection)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100)
    return () => clearTimeout(timer)
  }, [activeSection])

  return (
    <main className="theme-ember min-h-screen bg-[var(--background)]">
      <SEOHead
        title={HOME_TITLE}
        description={HOME_DESCRIPTION}
        keywords={[
          'sviluppo software PMI',
          'software su misura Palermo',
          'integrazione intelligenza artificiale aziende',
          'software house Palermo',
          'gestionale su misura',
          'automazione aziendale',
          'assistenti AI per aziende',
          'chatbot AI personalizzati',
          'digitalizzazione imprese',
        ]}
        canonical="https://www.facevoice.ai/home"
        page="home"
      />
      <Navigation activeSection={activeSection} setActiveSection={setActiveSection} />

      {/* Spazio per la barra in alto (computer) */}
      <div className="hidden md:block h-8" />

      {/* Spazio per la barra in alto (telefono) */}
      <div className="md:hidden h-14 shrink-0" aria-hidden="true" />

      <div id="hero" className="scroll-mt-14">
        <EmberHero />
      </div>

      <BlogSection user={user} />

      <HomeCta />

      {/* Spazio per la barra in basso (telefono) */}
      <div className="md:hidden h-20" />
    </main>
  )
}
