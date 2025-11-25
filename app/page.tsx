'use client'

import { useState, useEffect } from 'react'
import Navigation from '@/components/Navigation'
import Hero from '@/components/Hero'
import Services from '@/components/Services'
import Team from '@/components/Team'
import Clients from '@/components/Clients'
import LiquidGlass from '@/components/LiquidGlass'
import ThemeSwitcher from '@/components/ThemeSwitcher'

export default function Home() {
  const [activeSection, setActiveSection] = useState<string | null>(null)

  useEffect(() => {
    // Check if there's a hash in the URL
    if (typeof window !== 'undefined') {
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
    }
  }, [])

  useEffect(() => {
    if (activeSection && activeSection !== 'chat') {
      const element = document.getElementById(activeSection)
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }
  }, [activeSection])

  return (
    <main className="min-h-screen relative">
      <LiquidGlass />
      <ThemeSwitcher />
      <Navigation 
        activeSection={activeSection} 
        setActiveSection={setActiveSection} 
      />
      
      {/* Spacing per desktop navigation */}
      <div className="hidden md:block h-20" />
      
      <Hero />
      <div id="services">
        <Services />
      </div>
      <div id="team">
        <Team />
      </div>
      <div id="clients">
        <Clients />
      </div>
      
      {/* Spacing per mobile navigation bottom */}
      <div className="md:hidden h-20" />
    </main>
  )
}

