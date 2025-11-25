'use client'

import { motion } from 'framer-motion'
import { Users, Briefcase, Star, Home } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-client'
import type { User } from '@supabase/supabase-js'

interface NavigationProps {
  activeSection?: string | null
  setActiveSection?: (section: string | null) => void
}

export default function Navigation({ activeSection, setActiveSection }: NavigationProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const supabase = createClient()
  
  // Check authentication status
  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
    }
    
    checkUser()
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    
    return () => {
      subscription.unsubscribe()
    }
  }, [])
  
  const navItems = [
    { id: 'home', label: 'Home', icon: Home, href: '/' },
    { id: 'services', label: 'Services', icon: Briefcase, href: '/#services' },
    { id: 'team', label: 'Team', icon: Users, href: '/#team' },
    { id: 'clients', label: 'Clients', icon: Star, href: '/#clients' },
  ]

  const handleNavClick = (item: typeof navItems[0]) => {
    if (item.href.startsWith('/#')) {
      // Navigate to home page and scroll to section
      if (pathname !== '/') {
        router.push(item.href)
      } else {
        const section = item.href.replace('/#', '')
        setActiveSection?.(section)
        const element = document.getElementById(section)
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      }
    } else if (item.href === '/') {
      // Navigate to home
      if (pathname !== '/') {
        router.push('/')
      } else {
        // Scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' })
        setActiveSection?.(null)
      }
    }
  }

  const isActive = (item: typeof navItems[0]) => {
    if (item.id === 'home') {
      return pathname === '/' && !activeSection
    }
    return pathname === '/' && activeSection === item.id
  }

  const handleItemClick = (item: typeof navItems[0], e: React.MouseEvent) => {
    e.preventDefault()
    handleNavClick(item)
  }

  return (
    <>
      {/* Desktop Navigation - Top */}
      <nav className="hidden md:flex fixed top-0 left-0 right-0 z-50 glass-strong">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              onClick={() => router.push('/ai-chat')}
              className="text-2xl font-bold gradient-text cursor-pointer"
            >
              FacevoiceAI
            </motion.div>
            
            <div className="flex items-center gap-6">
              {navItems.map((item) => {
                const Icon = item.icon
                const active = isActive(item)
                
                return (
                  <motion.button
                    key={item.id}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={(e) => handleItemClick(item, e)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg glass transition-all ${
                      active
                        ? 'text-coral-light border-coral-red border-2'
                        : 'text-coral hover:glass-strong'
                    }`}
                  >
                    <Icon size={20} />
                    <span className="hidden sm:inline">{item.label}</span>
                  </motion.button>
                )
              })}
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile Navigation - Bottom */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 glass-strong border-t border-coral-red/20">
        <div className="flex items-center justify-around px-2 py-2 safe-area-bottom">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = isActive(item)
            
            return (
              <motion.button
                key={item.id}
                whileTap={{ scale: 0.9 }}
                onClick={(e) => handleItemClick(item, e)}
                className={`flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-xl glass transition-all min-w-[60px] ${
                  active
                    ? 'text-coral-light border-coral-red border-2'
                    : 'text-coral hover:glass-strong'
                }`}
              >
                <Icon size={22} />
                <span className="text-xs font-medium">{item.label}</span>
              </motion.button>
            )
          })}
        </div>
      </nav>
    </>
  )
}

