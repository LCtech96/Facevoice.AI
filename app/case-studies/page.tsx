'use client'

import { useState, useEffect } from 'react'
import Navigation from '@/components/Navigation'
import CaseStudy from '@/components/CaseStudy'
import { createClient } from '@/lib/supabase-client'
import type { User } from '@supabase/supabase-js'
import SEOHead from '@/components/SEO/SEOHead'
import SemanticContent from '@/components/SEO/SemanticContent'

export default function CaseStudiesPage() {
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
        title="Case Studies Facevoice AI | Progetti Software, E-commerce e AI Realizzati a Palermo"
        description="Scopri i progetti realizzati da Facevoice AI: sviluppo software personalizzato, restyling e-commerce, integrazione API, piattaforme e-learning con AI, cybersecurity per siti web a Palermo. Case studies di successo per imprese siciliane."
        keywords={[
          'case studies software Palermo',
          'progetti e-commerce',
          'restyling sito web',
          'migliorare conversione e-commerce',
          'integrazione API software',
          'piattaforme e-learning AI',
          'cybersecurity Palermo',
          'protezione dati e-commerce',
          'marketing automation progetti',
          'software gestionale case study',
          'digitalizzazione aziende Sicilia',
          'progetti AI completati'
        ]}
        canonical="https://www.facevoice.ai/case-studies"
        page="case-studies"
      />
      <Navigation />
      
      {/* Spacing per desktop navigation */}
      <div className="hidden md:block h-16" />
      
      {/* Spacing per mobile navigation top */}
      <div className="md:hidden h-14" />
      
      {/* Case Studies Section */}
      <CaseStudy />

      {/* Semantic Content - SEO */}
      <SemanticContent page="case-studies" />
      
      {/* Spacing per mobile navigation bottom */}
      <div className="md:hidden h-20" />
    </main>
  )
}

