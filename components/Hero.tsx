'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Send } from 'lucide-react'
import Image from 'next/image'
import ParticleBackground from './ParticleBackground'
import { MarketingBadgesHero } from './ui/marketing-badges-hero'

interface HeroProps {
  onSearchChange?: (query: string) => void
  onCategoryFilter?: (category: string) => void
}

export default function Hero({ onSearchChange, onCategoryFilter }: HeroProps) {
  const router = useRouter()
  const [input, setInput] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return

    // Se c'è un callback per il filtro, usa quello per filtrare i tool
    if (onSearchChange) {
      onSearchChange(input.trim())
      // Scroll al feed
      setTimeout(() => {
        const feedElement = document.getElementById('ai-tools-feed')
        if (feedElement) {
          feedElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
      }, 100)
      return
    }

    // Altrimenti, comportamento originale: salva e naviga alla chat
    const initialMessage = input.trim()
    localStorage.setItem('initial-message', initialMessage)
    router.push('/ai-chat')
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setInput(value)
    // Aggiorna il filtro in tempo reale se c'è il callback
    if (onSearchChange) {
      onSearchChange(value)
    }
  }

  return (
    <section className="min-h-screen flex items-center justify-center relative pt-16 px-6 bg-black overflow-hidden">
      {/* Particle Background */}
      <ParticleBackground />
      
      {/* Content */}
      <div className="text-center z-10 max-w-5xl relative w-full">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="flex flex-col items-center"
        >
          {/* Marketing Badges sopra il titolo */}
          <div className="mb-6 w-full max-w-md">
            <MarketingBadgesHero />
          </div>
          
          {/* Logo FacevoiceAI */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.1 }}
            className="mb-4 w-full max-w-full flex justify-center"
          >
            <div className="relative w-full max-w-[280px] sm:max-w-[380px] md:max-w-[480px] lg:max-w-[600px] xl:max-w-[700px] aspect-auto">
              <Image
                src="/Facevoice.png"
                alt="FacevoiceAI"
                width={700}
                height={200}
                className="w-full h-auto object-contain"
                priority
                quality={90}
              />
            </div>
          </motion.div>
          <p className="text-xl md:text-2xl text-gray-300 mb-8">
            Innovative AI solutions for your business
          </p>

          {/* Barra di input */}
          <form onSubmit={handleSubmit} className="w-full max-w-2xl">
            <div className="relative bg-white/10 backdrop-blur-md rounded-2xl border border-white/20 shadow-lg focus-within:border-white/40 transition-all">
              <input
                type="text"
                value={input}
                onChange={handleInputChange}
                placeholder={onSearchChange ? "Cerca AI tools per categoria o nome..." : "Chiedi qualcosa all'AI..."}
                className="w-full px-6 py-4 pr-14 bg-transparent rounded-2xl text-white placeholder-gray-400 focus:outline-none text-lg"
              />
              <button
                type="submit"
                disabled={!input.trim()}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 p-3 bg-white text-black rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </section>
  )
}
