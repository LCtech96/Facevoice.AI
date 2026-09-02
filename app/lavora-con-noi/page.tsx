'use client'

import { useState, useEffect } from 'react'
import Navigation from '@/components/Navigation'
import WorkWithUs from '@/components/WorkWithUs'
import SEOHead from '@/components/SEO/SEOHead'
import { createClient } from '@/lib/supabase-client'

export default function LavoraConNoiPage() {
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    const checkUser = async () => {
      await supabase.auth.getUser()
      setLoading(false)
    }

    checkUser()
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
        title="Lavora con noi | Facevoice AI"
        description="Candidati a Facevoice AI o con uno dei nostri partner: Nomadiqe, Trattoria da Piero Mondello e Lucas Appartaments. Invia la tua candidatura online."
        keywords={[
          'lavora con noi Facevoice AI',
          'candidature Palermo',
          'carriere tecnologia',
          'lavoro marketing digitale',
        ]}
        canonical="https://www.facevoice.ai/lavora-con-noi"
        page="careers"
      />
      <Navigation />

      <div className="hidden md:block h-16" />
      <div className="md:hidden h-14" />

      <WorkWithUs />

      <div className="md:hidden h-20" />
    </main>
  )
}
