'use client'

import { motion } from 'framer-motion'
import { Sparkles, ArrowDown } from 'lucide-react'
import Image from 'next/image'

export default function Hero() {
  return (
    <section className="min-h-screen flex items-center justify-center relative pt-24 px-6 overflow-hidden">
      {/* Immagine di sfondo Trinacria solo nella sezione Hero */}
      <div className="absolute inset-0 z-0">
        <Image
          src="/team/Trinacria.jpg"
          alt="Trinacria background"
          fill
          className="object-cover opacity-30"
          priority
          quality={90}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[var(--background-end)]" />
      </div>
      
      {/* Elementi decorativi */}
      <div className="absolute inset-0 overflow-hidden z-0">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-coral-red opacity-15 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-coral-red-light opacity-15 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>
      
      <div className="text-center z-10 max-w-5xl">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          <Sparkles className="w-16 h-16 mx-auto mb-6 text-coral-red" />
          <h1 className="text-6xl md:text-8xl font-bold mb-6 gradient-text">
            Facevoice AI
          </h1>
          <p className="text-2xl md:text-3xl text-coral-red-light mb-8">
            Advanced AI Solutions & Blockchain Development
          </p>
          <p className="text-xl text-coral-red/80 max-w-2xl mx-auto">
            Transforming businesses with cutting-edge AI integration, 
            blockchain technology, and innovative automation systems.
          </p>
        </motion.div>
        
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1, duration: 0.8 }}
          className="mt-12"
        >
          <ArrowDown className="w-8 h-8 mx-auto text-coral-red animate-bounce" />
        </motion.div>
      </div>
    </section>
  )
}

