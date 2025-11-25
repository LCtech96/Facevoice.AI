'use client'

import { motion } from 'framer-motion'
import ParticleBackground from './ParticleBackground'

export default function Hero() {
  return (
    <section className="min-h-screen flex items-center justify-center relative pt-24 px-6 bg-black overflow-hidden">
      {/* Particle Background */}
      <ParticleBackground />
      
      {/* Content */}
      <div className="text-center z-10 max-w-5xl relative">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          <h1 className="text-6xl md:text-8xl font-bold text-white mb-4">
            FacevoiceAI
          </h1>
          <p className="text-xl md:text-2xl text-gray-300">
            Innovative AI solutions for your business
          </p>
        </motion.div>
      </div>
    </section>
  )
}
