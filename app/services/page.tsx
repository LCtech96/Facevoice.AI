'use client'

import { useState, useEffect } from 'react'
import Navigation from '@/components/Navigation'
import Services from '@/components/Services'
import EarbudShowcase from '@/components/ui/spatial-product-showcase'
import { MarketingBadges } from '@/components/ui/marketing-badges'
import { createClient } from '@/lib/supabase-client'
import type { User } from '@supabase/supabase-js'

export default function ServicesPage() {
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
      <Navigation />
      
      {/* Spacing per desktop navigation */}
      <div className="hidden md:block h-16" />
      
      {/* Spacing per mobile navigation */}
      <div className="md:hidden h-4" />
      
      {/* Services Section */}
      <Services />
      
      {/* Website Examples & Effects Section */}
      <section className="py-24 px-6 bg-[var(--background)]">
        <div className="container mx-auto max-w-7xl">
          <h2 className="text-4xl md:text-5xl font-bold text-center mb-4 text-[var(--text-primary)]">
            Website Examples & Effects
          </h2>
          <p className="text-lg text-[var(--text-secondary)] text-center mb-16 max-w-2xl mx-auto">
            Interactive components and effects to enhance your website experience
          </p>
          
          {/* Componenti disposti a coppie */}
          <div className="space-y-12">
            {/* Prima coppia */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="w-full">
                <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-4 text-center">
                  Spatial Product Showcase
                </h3>
                <EarbudShowcase />
              </div>
              <div className="w-full">
                <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-4 text-center">
                  Marketing Badges
                </h3>
                <MarketingBadges />
              </div>
            </div>
          </div>
        </div>
      </section>
      
      {/* Spacing per mobile navigation bottom */}
      <div className="md:hidden h-20" />
    </main>
  )
}

