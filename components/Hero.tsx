'use client'

import { motion } from 'framer-motion'

export default function Hero() {
  return (
    <section className="min-h-screen flex items-center justify-center relative pt-24 px-6 bg-[var(--background)]">
      <div className="text-center z-10 max-w-5xl">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          <h1 className="text-6xl md:text-8xl font-bold text-[var(--text-primary)] mb-4">
            FacevoiceAI
          </h1>
          <p className="text-xl md:text-2xl text-[var(--text-secondary)]">
            Innovative AI solutions for your business
          </p>
        </motion.div>
      </div>
    </section>
  )
}
