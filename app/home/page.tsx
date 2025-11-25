'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Navigation from '@/components/Navigation'
import LiquidGlass from '@/components/LiquidGlass'
import ThemeSwitcher from '@/components/ThemeSwitcher'
import Feed from '@/components/Feed'
import { createClient } from '@/lib/supabase-client'
import type { User } from '@supabase/supabase-js'

function HomeContent({ user, loading }: { user: User | null; loading: boolean }) {
  const searchParams = useSearchParams()
  const toolIdRef = useRef<string | null>(null)

  // Gestisci redirect da link condiviso
  useEffect(() => {
    const toolId = searchParams.get('tool')
    if (toolId) {
      toolIdRef.current = toolId
    }
  }, [searchParams])

  if (loading) {
    return (
      <main className="min-h-screen relative flex items-center justify-center">
        <LiquidGlass />
        <ThemeSwitcher />
        <div className="text-coral-red">Caricamento...</div>
      </main>
    )
  }

  return (
    <main className="min-h-screen relative">
      <LiquidGlass />
      <ThemeSwitcher />
      <Navigation />
      
      {/* Spacing per desktop navigation */}
      <div className="hidden md:block h-20" />
      
      {/* Spacing per mobile navigation */}
      <div className="md:hidden h-4" />
      
      <div className="container mx-auto px-4 py-8 max-w-2xl">
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
      <main className="min-h-screen relative flex items-center justify-center">
        <LiquidGlass />
        <ThemeSwitcher />
        <div className="text-coral-red">Caricamento...</div>
      </main>
    }>
      <HomeContent user={user} loading={loading} />
    </Suspense>
  )
}

