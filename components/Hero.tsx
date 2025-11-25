'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Send } from 'lucide-react'
import ParticleBackground from './ParticleBackground'

export default function Hero() {
  const router = useRouter()
  const [input, setInput] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return

    // Salva il messaggio iniziale nel localStorage per la chat
    const initialMessage = input.trim()
    localStorage.setItem('initial-message', initialMessage)
    
    // Naviga alla pagina AI chat
    router.push('/ai-chat')
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
          {/* Titolo spostato più in alto */}
          <h1 className="text-6xl md:text-8xl font-bold text-white mb-4">
            FacevoiceAI
          </h1>
          <p className="text-xl md:text-2xl text-gray-300 mb-8">
            Innovative AI solutions for your business
          </p>

          {/* Barra di input */}
          <form onSubmit={handleSubmit} className="w-full max-w-2xl">
            <div className="relative bg-white/10 backdrop-blur-md rounded-2xl border border-white/20 shadow-lg focus-within:border-white/40 transition-all">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Chiedi qualcosa all'AI..."
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
