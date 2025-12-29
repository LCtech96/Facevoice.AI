'use client'

import { motion } from 'framer-motion'
import Image from 'next/image'
import ParticleBackground from './ParticleBackground'

interface HeroProps {
  // Props mantenute per compatibilità ma non più usate
}

export default function Hero({}: HeroProps = {}) {

  return (
    <section className="min-h-[40vh] sm:min-h-[50vh] md:min-h-[55vh] flex items-center justify-center relative pt-1 sm:pt-2 md:pt-3 px-4 sm:px-6 bg-black overflow-hidden">
      {/* Particle Background */}
      <ParticleBackground />
      
      {/* Content */}
      <div className="text-center z-10 max-w-5xl relative w-full flex flex-col justify-center py-1 sm:py-2 md:py-3">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="flex flex-col items-center w-full h-full"
        >
          {/* Logo FacevoiceAI */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.1 }}
            className="mb-1 sm:mb-2 md:mb-3 w-full max-w-full flex justify-center flex-shrink-0"
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
          <p className="text-sm sm:text-base md:text-lg lg:text-xl text-gray-300 mb-2 sm:mb-3 md:mb-4 px-2 flex-shrink-0">
            Innovative AI solutions for your business
          </p>
        </motion.div>
      </div>
    </section>
  )
}
