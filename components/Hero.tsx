'use client'

import { motion } from 'framer-motion'
import Image from 'next/image'
import ParticleBackground from './ParticleBackground'

interface HeroProps {
  // Props mantenute per compatibilità ma non più usate
}

export default function Hero({}: HeroProps = {}) {

  return (
    <section className="min-h-[30vh] sm:min-h-[35vh] md:min-h-[40vh] flex items-center justify-center relative pt-0 sm:pt-1 md:pt-1 px-4 sm:px-6 bg-black overflow-hidden">
      {/* Particle Background */}
      <ParticleBackground />
      
      {/* Content */}
      <div className="text-center z-10 max-w-5xl relative w-full flex flex-col justify-center py-0 sm:py-0.5 md:py-1">
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
            className="mb-0 w-full max-w-full flex justify-center flex-shrink-0"
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
          <p className="text-xs sm:text-sm md:text-base lg:text-lg text-gray-300 mb-0 sm:mb-1 md:mb-1.5 px-2 flex-shrink-0">
            Innovative AI solutions for your business
          </p>
        </motion.div>
      </div>
    </section>
  )
}
