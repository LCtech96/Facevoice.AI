'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { Users, Briefcase, Home, MessageSquare, LogIn, UserPlus, LogOut, User as UserIcon, Shield, Calendar, Wallet, Menu, Handshake, Inbox, Bot, BarChart3, LayoutDashboard, Target } from 'lucide-react'
import LanguageSelector from './LanguageSelector'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState, useRef } from 'react'
import { createClient } from '@/lib/supabase-client'
import type { User } from '@supabase/supabase-js'
import { useTranslation } from '@/lib/i18n/LanguageContext'
import { isAdminEmail } from '@/lib/admin-auth'

interface NavigationProps {
  activeSection?: string | null
  setActiveSection?: (section: string | null) => void
}

export default function Navigation({ activeSection, setActiveSection }: NavigationProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showDropdownMenu, setShowDropdownMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const dropdownMenuRef = useRef<HTMLDivElement>(null)
  const mobileMenuRef = useRef<HTMLDivElement>(null)
  const mobileDropdownMenuRef = useRef<HTMLDivElement>(null)
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

  // Close menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false)
      }
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false)
      }
      if (dropdownMenuRef.current && !dropdownMenuRef.current.contains(event.target as Node)) {
        setShowDropdownMenu(false)
      }
      if (mobileDropdownMenuRef.current && !mobileDropdownMenuRef.current.contains(event.target as Node)) {
        setShowDropdownMenu(false)
      }
    }

    if (showUserMenu || showDropdownMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showUserMenu, showDropdownMenu])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    setShowUserMenu(false)
    router.push('/home')
  }
  
  const isAdmin = isAdminEmail(user?.email)
  const isChatPage = pathname?.startsWith('/ai-chat')
  const { t } = useTranslation()

  // L'admin non usa il sito pubblico: dalle sue pagine va dritto alla dashboard.
  useEffect(() => {
    if (isAdmin && ['/', '/home', '/team', '/services'].includes(pathname || '')) {
      router.replace('/admin/inbox')
    }
  }, [isAdmin, pathname, router])

  type NavItem = { id: string; label: string; icon: typeof Home; href: string }

  const mainNavItems: NavItem[] = isAdmin
    ? [
        { id: 'admin-inbox', label: 'Messaggi', icon: Inbox, href: '/admin/inbox' },
        { id: 'admin-leads', label: 'Clienti', icon: Target, href: '/admin/leads' },
        { id: 'admin-control', label: 'Canali e AI', icon: Bot, href: '/admin/control' },
        { id: 'admin-usage', label: 'Consumi', icon: BarChart3, href: '/admin/usage' },
        { id: 'admin', label: 'Gestione', icon: LayoutDashboard, href: '/admin' },
      ]
    : [
        { id: 'home', label: t('nav.home'), icon: Home, href: '/home' },
        { id: 'services', label: t('nav.services'), icon: Briefcase, href: '/services' },
        { id: 'team', label: t('nav.team'), icon: Users, href: '/team' },
        ...(user ? [{ id: 'chat', label: t('nav.chat'), icon: MessageSquare, href: '/ai-chat' }] : []),
      ]

  const dropdownMenuItems: NavItem[] = isAdmin
    ? [
        { id: 'chat', label: 'Assistente AI interno', icon: MessageSquare, href: '/ai-chat' },
      ]
    : [
        { id: 'lavora-con-noi', label: t('nav.workWithUs'), icon: Handshake, href: '/lavora-con-noi' },
        ...(user ? [
          { id: 'bookings', label: t('nav.bookings'), icon: Calendar, href: '/bookings' },
          { id: 'payments', label: t('nav.payments'), icon: Wallet, href: '/payments' },
        ] : []),
      ]

  const handleNavClick = (item: NavItem) => {
    if (item.href.startsWith('/home#') && pathname === '/home') {
      const section = item.href.replace('/home#', '')
      setActiveSection?.(section)
      setTimeout(() => {
        document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 100)
      return
    }
    router.push(item.href)
  }

  const isActive = (item: NavItem) => {
    if (item.id === 'home') return pathname === '/home' && !activeSection
    if (item.href.startsWith('/home#')) return pathname === '/home' && activeSection === item.id
    return pathname === item.href
  }

  const handleItemClick = (item: NavItem, e: React.MouseEvent) => {
    e.preventDefault()
    handleNavClick(item)
    setShowDropdownMenu(false)
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
              onClick={() => router.push(isAdmin ? '/admin/inbox' : '/ai-chat')}
              className="text-xl font-semibold text-[var(--text-primary)] cursor-pointer"
            >
              FacevoiceAI
            </motion.div>
            
            <div className="flex items-center gap-2">
              {/* Main Navigation Items */}
              {mainNavItems.map((item) => {
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
              
              {/* Dropdown Menu */}
              {dropdownMenuItems.length > 0 && (
                <div className="relative ml-2" ref={dropdownMenuRef}>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setShowDropdownMenu(!showDropdownMenu)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all text-sm font-medium ${
                      dropdownMenuItems.some(item => isActive(item))
                        ? 'bg-[var(--accent-blue)] text-white'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--background-secondary)]'
                    }`}
                  >
                    <Menu size={18} />
                    <span>{t('common.more') || 'Altro'}</span>
                  </motion.button>
                  
                  <AnimatePresence>
                    {showDropdownMenu && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="absolute right-0 top-full mt-2 w-56 bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg shadow-xl z-50 overflow-hidden"
                      >
                        {dropdownMenuItems.map((item) => {
                          const Icon = item.icon
                          const active = isActive(item)
                          
                          return (
                            <button
                              key={item.id}
                              onClick={(e) => handleItemClick(item, e)}
                              className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                                active
                                  ? 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]'
                                  : 'text-[var(--text-primary)] hover:bg-[var(--background-secondary)]'
                              }`}
                            >
                              <Icon size={18} />
                              <span className="text-sm font-medium">{item.label}</span>
                            </button>
                          )
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
              
              {/* Language Selector */}
              <div className="ml-2">
                <LanguageSelector />
              </div>
              
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
                    <span>{t('auth.signIn')}</span>
                  </motion.button>
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => router.push('/auth')}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--background-secondary)] text-[var(--text-primary)] text-sm font-medium hover:bg-[var(--background)] border border-[var(--border-color)] transition-all"
                  >
                    <UserPlus size={18} />
                    <span>{t('auth.signUp')}</span>
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
                          <span className="text-sm">{t('auth.signOut')}</span>
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

      {/* Mobile Navigation - Top (hidden on chat — uses bottom nav + chat header) */}
      {!isChatPage && (
      <nav className="md:hidden fixed top-0 left-0 right-0 z-40 bg-[var(--background)]/95 backdrop-blur-xl border-b border-[var(--border-color)] pt-[env(safe-area-inset-top)]">
        <div className="flex items-center gap-2 px-3 py-2.5 min-h-14">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            onClick={() => router.push(isAdmin ? '/admin/inbox' : '/home')}
            className="text-base font-semibold text-[var(--text-primary)] cursor-pointer truncate min-w-0 flex-1"
          >
            FacevoiceAI
          </motion.div>

          <div className="flex items-center gap-1.5 shrink-0">
            <LanguageSelector />

            {dropdownMenuItems.length > 0 && (
              <div className="relative" ref={mobileDropdownMenuRef}>
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setShowDropdownMenu(!showDropdownMenu)}
                  className={`flex items-center justify-center h-9 w-9 rounded-lg border transition-all ${
                    dropdownMenuItems.some(item => isActive(item))
                      ? 'bg-[var(--accent-blue)] text-white border-[var(--accent-blue)]'
                      : 'bg-[var(--background-secondary)] text-[var(--text-primary)] border-[var(--border-color)]'
                  }`}
                  aria-label="Menu"
                >
                  <Menu size={18} />
                </motion.button>

                <AnimatePresence>
                  {showDropdownMenu && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="absolute right-0 top-full mt-2 w-48 bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg shadow-xl z-50 overflow-hidden"
                    >
                      {dropdownMenuItems.map((item) => {
                        const Icon = item.icon
                        const active = isActive(item)

                        return (
                          <button
                            key={item.id}
                            onClick={(e) => handleItemClick(item, e)}
                            className={`w-full flex items-center gap-2 px-4 py-2.5 text-left transition-colors text-xs ${
                              active
                                ? 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]'
                                : 'text-[var(--text-primary)] hover:bg-[var(--background-secondary)]'
                            }`}
                          >
                            <Icon size={16} />
                            <span>{item.label}</span>
                          </button>
                        )
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {!user ? (
              <motion.button
                whileTap={{ scale: 0.9 }}
                onClick={() => router.push('/auth')}
                className="flex items-center justify-center h-9 w-9 rounded-lg bg-[var(--accent-blue)] text-white"
                aria-label={t('auth.signIn')}
              >
                <LogIn size={18} />
              </motion.button>
            ) : (
              <div className="relative" ref={mobileMenuRef}>
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="flex items-center justify-center h-9 w-9 rounded-lg bg-[var(--background-secondary)] text-[var(--text-primary)] border border-[var(--border-color)]"
                  aria-label="Account"
                >
                  {isAdminEmail(user.email) ? (
                    <Shield size={18} className="text-yellow-500" />
                  ) : (
                    <UserIcon size={18} />
                  )}
                </motion.button>

                <AnimatePresence>
                  {showUserMenu && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="absolute right-0 top-full mt-2 w-52 bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg shadow-xl z-50 overflow-hidden"
                    >
                      <div className="px-4 py-2.5 border-b border-[var(--border-color)] text-xs text-[var(--text-secondary)] truncate">
                        {user.email}
                      </div>
                      <button
                        onClick={handleLogout}
                        className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-red-600 hover:bg-[var(--background-secondary)] transition-colors text-xs"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>{t('auth.signOut')}</span>
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
      </nav>
      )}

      {/* Mobile Navigation - Bottom */}
      <nav className={`md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[var(--background)] border-t border-[var(--border-color)] safe-area-bottom ${isChatPage ? 'z-30' : ''}`}>
        <div className="flex items-stretch justify-around px-1 pt-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          {mainNavItems.map((item) => {
            const Icon = item.icon
            const active = isActive(item)
            const displayLabel = item.label

            return (
              <motion.button
                key={item.id}
                whileTap={{ scale: 0.9 }}
                onClick={(e) => handleItemClick(item, e)}
                className={`flex flex-col items-center justify-center gap-1 px-1 py-1.5 min-h-[52px] rounded-xl transition-all min-w-0 flex-1 ${
                  active
                    ? 'text-[var(--accent-blue)]'
                    : 'text-[var(--text-secondary)]'
                }`}
              >
                <Icon size={24} className="shrink-0" />
                <span className="text-[11px] sm:text-xs font-medium text-center leading-tight w-full px-0.5 truncate">
                  {displayLabel}
                </span>
              </motion.button>
            )
          })}
        </div>
      </nav>
    </>
  )
}
