'use client'

import { useState, useEffect } from 'react'
import Navigation from '@/components/Navigation'
import Team from '@/components/Team'
import SEOHead from '@/components/SEO/SEOHead'
import { createClient } from '@/lib/supabase-client'
import type { User } from '@supabase/supabase-js'

export default function TeamPage() {
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
        title="Il Nostro Team | Facevoice AI"
        description="Conosci il team di Facevoice AI: le persone che guidano e costruiscono innovazione ogni giorno."
        keywords={[
          'team Facevoice AI',
          'Luca Corrao',
          'Sevara Urmanaeva',
          'Leonardo Alotta',
        ]}
        canonical="https://www.facevoice.ai/team"
        page="team"
      />
      <Navigation />
      
      {/* Spacing per desktop navigation */}
      <div className="hidden md:block h-16" />
      
      {/* Spacing per mobile navigation top */}
      <div className="md:hidden h-14" />
      
      {/* Team Section */}
      <Team />
      
      {/* Spacing per mobile navigation bottom */}
      <div className="md:hidden h-20" />
    </main>
  )
}








