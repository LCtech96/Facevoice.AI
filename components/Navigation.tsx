'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Users, Briefcase, Star, Home, MessageSquare, LogIn, UserPlus, LogOut, User as UserIcon, Shield } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState, useRef } from 'react'
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
  const [showUserMenu, setShowUserMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
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

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false)
      }
    }

    if (showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showUserMenu])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    setShowUserMenu(false)
    router.push('/home')
  }
  
  const navItems = [
    { id: 'home', label: 'Home', icon: Home, href: '/home' },
    { id: 'services', label: 'Services', icon: Briefcase, href: '/services' },
    { id: 'case-studies', label: 'Case Studies', icon: Star, href: '/case-studies' },
    { id: 'team', label: 'Team', icon: Users, href: '/team' },
    // Mostra Chat solo agli utenti autenticati
    ...(user ? [{ id: 'chat', label: 'Chat', icon: MessageSquare, href: '/ai-chat' }] : []),
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
              
              {/* Auth Buttons */}
              {!user ? (
                <div className="flex items-center gap-2 ml-2">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => router.push('/auth')}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent-blue)] text-white text-sm font-medium hover:bg-[var(--accent-blue-light)] transition-all"
                  >
                    <LogIn size={18} />
                    <span>Sign In</span>
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => router.push('/auth')}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--background-secondary)] text-[var(--text-primary)] text-sm font-medium hover:bg-[var(--background)] border border-[var(--border-color)] transition-all"
                  >
                    <UserPlus size={18} />
                    <span>Sign Up</span>
                  </motion.button>
                </div>
              ) : (
                <div className="relative ml-2" ref={menuRef}>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setShowUserMenu(!showUserMenu)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--background-secondary)] text-[var(--text-primary)] text-sm font-medium hover:bg-[var(--background)] border border-[var(--border-color)] transition-all"
                  >
                    <UserIcon size={18} />
                    <span className="max-w-[150px] truncate">{user.email}</span>
                  </motion.button>
                  
                  <AnimatePresence>
                    {showUserMenu && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="absolute right-0 top-full mt-2 w-48 bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg shadow-xl z-50 overflow-hidden"
                      >
                        <button
                          onClick={handleLogout}
                          className="w-full flex items-center gap-2 px-4 py-2 text-left text-red-600 hover:bg-[var(--background-secondary)] transition-colors"
                        >
                          <LogOut className="w-4 h-4" />
                          <span className="text-sm">Logout</span>
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile Navigation - Top (for auth buttons) */}
      <nav className="md:hidden fixed top-0 left-0 right-0 z-40 bg-[var(--background)]/80 backdrop-blur-xl border-b border-[var(--border-color)]">
        <div className="flex items-center justify-between px-4 py-3">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            onClick={() => router.push('/home')}
            className="text-lg font-semibold text-[var(--text-primary)] cursor-pointer"
          >
            FacevoiceAI
          </motion.div>
          
          {!user ? (
            <div className="flex items-center gap-2">
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => router.push('/auth')}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--accent-blue)] text-white text-xs font-medium"
              >
                <LogIn size={16} />
                <span>Sign In</span>
              </motion.button>
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => router.push('/auth')}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--background-secondary)] text-[var(--text-primary)] text-xs font-medium border border-[var(--border-color)]"
              >
                <UserPlus size={16} />
                <span>Sign Up</span>
              </motion.button>
            </div>
          ) : (
            <div className="relative" ref={menuRef}>
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--background-secondary)] text-[var(--text-primary)] text-xs font-medium border border-[var(--border-color)]"
              >
                {user.email === 'luca@facevoice.ai' ? (
                  <Shield size={16} className="text-yellow-500" />
                ) : (
                  <UserIcon size={16} />
                )}
                <span className="max-w-[100px] truncate">{user.email}</span>
                {user.email === 'luca@facevoice.ai' && (
                  <span className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-600 rounded text-[10px] font-bold">ADMIN</span>
                )}
              </motion.button>
              
              <AnimatePresence>
                {showUserMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="absolute right-0 top-full mt-2 w-40 bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg shadow-xl z-50 overflow-hidden"
                  >
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-2 px-4 py-2 text-left text-red-600 hover:bg-[var(--background-secondary)] transition-colors text-xs"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>Logout</span>
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
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
