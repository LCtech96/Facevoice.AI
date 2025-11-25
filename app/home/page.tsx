'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import Hero from '@/components/Hero'
import Feed from '@/components/Feed'
import { createClient } from '@/lib/supabase-client'
import type { User } from '@supabase/supabase-js'

function HomeContent({ user, loading }: { user: User | null; loading: boolean }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const toolIdRef = useRef<string | null>(null)
  const [activeSection, setActiveSection] = useState<string | null>(null)

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
      <Navigation activeSection={activeSection} setActiveSection={setActiveSection} />
      
      {/* Spacing per desktop navigation */}
      <div className="hidden md:block h-16" />
      
      {/* Spacing per mobile navigation */}
      <div className="md:hidden h-4" />
      
      {/* Hero Section */}
      <div id="hero">
        <Hero />
      </div>
      
      {/* Feed Section - Stile Social Media */}
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Feed user={user} highlightedToolId={toolIdRef.current} />
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
