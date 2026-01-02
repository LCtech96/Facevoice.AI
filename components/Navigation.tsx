'use client'

import { motion } from 'framer-motion'
import { Users, Briefcase, Star, Home, MessageSquare } from 'lucide-react'
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
    { id: 'chat', label: 'Chat', icon: MessageSquare, href: '/ai-chat' },
    { id: 'home', label: 'Home', icon: Home, href: '/home' },
    { id: 'services', label: 'Services', icon: Briefcase, href: '/services' },
    { id: 'case-studies', label: 'Case Studies', icon: Star, href: '/case-studies' },
    { id: 'team', label: 'Team', icon: Users, href: '/team' },
  ]

  const handleNavClick = (item: typeof navItems[0]) => {
    if (item.href.startsWith('/home#')) {
      // Navigate to home page and scroll to section
      if (pathname !== '/home') {
        router.push(item.href)
      } else {
        const section = item.href.replace('/home#', '')
        setActiveSection?.(section)
        setTimeout(() => {
          const element = document.getElementById(section)
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }
        }, 100)
      }
    } else if (item.href === '/home') {
      router.push('/home')
    } else if (item.href === '/ai-chat') {
      router.push('/ai-chat')
    } else if (item.href === '/team') {
      router.push('/team')
    } else if (item.href === '/services') {
      router.push('/services')
    } else if (item.href === '/case-studies') {
      router.push('/case-studies')
    }
  }

  const isActive = (item: typeof navItems[0]) => {
    if (item.id === 'chat') {
      return pathname === '/ai-chat'
    }
    if (item.id === 'home') {
      return pathname === '/home' && !activeSection
    }
    if (item.id === 'team') {
      return pathname === '/team'
    }
    if (item.id === 'services') {
      return pathname === '/services'
    }
    if (item.id === 'case-studies') {
      return pathname === '/case-studies'
    }
    return pathname === '/home' && activeSection === item.id
  }

  const handleItemClick = (item: typeof navItems[0], e: React.MouseEvent) => {
    e.preventDefault()
    handleNavClick(item)
  }

  return (
    <>
      {/* Desktop Navigation - Top */}
      <nav className="hidden md:flex fixed top-0 left-0 right-0 z-50 bg-[var(--background)]/80 backdrop-blur-xl border-b border-[var(--border-color)]">
        <div className="container mx-auto px-6 py-3">
          <div className="flex items-center justify-between">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              onClick={() => router.push('/ai-chat')}
              className="text-xl font-semibold text-[var(--text-primary)] cursor-pointer"
            >
              FacevoiceAI
            </motion.div>
            
            <div className="flex items-center gap-2">
              {navItems.map((item) => {
                const Icon = item.icon
                const active = isActive(item)
                
                return (
                  <motion.button
                    key={item.id}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={(e) => handleItemClick(item, e)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all text-sm font-medium ${
                      active
                        ? 'bg-[var(--accent-blue)] text-white'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--background-secondary)]'
                    }`}
                  >
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </motion.button>
                )
              })}
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile Navigation - Bottom */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[var(--background)]/95 backdrop-blur-xl border-t border-[var(--border-color)] safe-area-bottom">
        <div className="flex items-center justify-around px-2 py-2">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = isActive(item)
            
            return (
              <motion.button
                key={item.id}
                whileTap={{ scale: 0.9 }}
                onClick={(e) => handleItemClick(item, e)}
                className={`flex flex-col items-center justify-center gap-1 px-3 py-2 rounded-xl transition-all min-w-[60px] ${
                  active
                    ? 'text-[var(--accent-blue)]'
                    : 'text-[var(--text-secondary)]'
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
