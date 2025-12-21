'use client'

import { motion } from 'framer-motion'
import Image from 'next/image'
import ParticleBackground from './ParticleBackground'
import { MarketingBadgesHero } from './ui/marketing-badges-hero'
import AIToolsCircularGallery from './AIToolsCircularGallery'

interface HeroProps {
  // Props mantenute per compatibilità ma non più usate
}

export default function Hero({}: HeroProps = {}) {

  return (
    <section className="min-h-screen flex items-center justify-center relative pt-12 sm:pt-16 px-4 sm:px-6 bg-black overflow-hidden">
      {/* Particle Background */}
      <ParticleBackground />
      
      {/* Content */}
      <div className="text-center z-10 max-w-5xl relative w-full h-full flex flex-col justify-center py-6 sm:py-8 md:py-12">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="flex flex-col items-center w-full"
        >
          {/* Marketing Badges sopra il titolo */}
          <div className="mb-4 sm:mb-6 w-full max-w-md">
            <MarketingBadgesHero />
          </div>
          
          {/* Logo FacevoiceAI */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.1 }}
            className="mb-3 sm:mb-4 w-full max-w-full flex justify-center"
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
          <p className="text-lg sm:text-xl md:text-2xl text-gray-300 mb-4 sm:mb-6 md:mb-8 px-2">
            Innovative AI solutions for your business
          </p>

          {/* Circular Gallery con AI Tools */}
          <div className="w-full mt-2 sm:mt-4 md:mt-8 px-1 sm:px-2 md:px-0 flex-1 min-h-0 flex items-center justify-center">
            <AIToolsCircularGallery />
          </div>
        </motion.div>
      </div>
    </section>
  )
}
