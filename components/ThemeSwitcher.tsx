'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Moon, Sun } from 'lucide-react'

export default function ThemeSwitcher() {
  const [isDark, setIsDark] = useState(true)

  useEffect(() => {
    // Controlla se c'è una preferenza salvata o usa dark come default
    const savedTheme = localStorage.getItem('theme')
    if (savedTheme === 'light') {
      setIsDark(false)
      document.documentElement.classList.remove('dark')
    } else {
      setIsDark(true)
      document.documentElement.classList.add('dark')
    }
  }, [])

  const toggleTheme = () => {
    const newTheme = !isDark
    setIsDark(newTheme)
    
    if (newTheme) {
      document.documentElement.classList.add('dark')
      localStorage.setItem('theme', 'dark')
    } else {
      document.documentElement.classList.remove('dark')
      localStorage.setItem('theme', 'light')
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 1, duration: 0.5 }}
      className="fixed bottom-6 right-6 z-50"
    >
      <button
        onClick={toggleTheme}
        className="relative w-20 h-10 glass-strong rounded-full p-1 flex items-center cursor-pointer transition-all duration-300 hover:scale-105"
        aria-label="Toggle theme"
      >
        {/* Background gradient slider */}
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{
            background: isDark 
              ? 'linear-gradient(90deg, rgba(0, 191, 255, 0.3) 0%, rgba(64, 224, 255, 0.2) 100%)'
              : 'linear-gradient(90deg, rgba(255, 200, 87, 0.3) 0%, rgba(255, 140, 0, 0.2) 100%)',
          }}
          initial={false}
          animate={{
            opacity: [0.5, 1, 0.5],
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
        
        {/* Toggle circle */}
        <motion.div
          className="relative z-10 w-8 h-8 rounded-full glass-strong flex items-center justify-center"
          animate={{
            x: isDark ? 0 : 40,
          }}
          transition={{
            type: 'spring',
            stiffness: 500,
            damping: 30,
          }}
        >
          {isDark ? (
            <Moon className="w-4 h-4 text-coral-red" />
          ) : (
            <Sun className="w-4 h-4 text-yellow-400" />
          )}
        </motion.div>

        {/* Icons in background */}
        <div className="absolute inset-0 flex items-center justify-between px-2 pointer-events-none">
          <Moon 
            className={`w-4 h-4 transition-opacity duration-300 ${
              isDark ? 'opacity-100' : 'opacity-30'
            }`} 
          />
          <Sun 
            className={`w-4 h-4 transition-opacity duration-300 ${
              !isDark ? 'opacity-100' : 'opacity-30'
            }`} 
          />
        </div>
      </button>
    </motion.div>
  )
}

