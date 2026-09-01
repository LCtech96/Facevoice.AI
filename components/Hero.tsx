'use client'

import { motion } from 'framer-motion'
import Image from 'next/image'
import ParticleBackground from './ParticleBackground'
import { Megaphone, Code2, BrainCircuit, LayoutDashboard } from 'lucide-react'

const services = [
  {
    icon: Megaphone,
    title: 'Social & Marketing',
    description: 'Gestione social, marketing e comunicazione',
  },
  {
    icon: Code2,
    title: 'Sviluppo Software',
    description: 'Soluzioni digitali su misura',
  },
  {
    icon: BrainCircuit,
    title: 'Integrazione AI',
    description: 'Intelligenza artificiale per il tuo business',
  },
  {
    icon: LayoutDashboard,
    title: 'Gestionali',
    description: 'ERP, CRM e automazione aziendale',
  },
]

export default function Hero() {
  return (
    <section className="min-h-[50vh] md:min-h-[55vh] flex items-center relative pt-2 md:pt-4 px-4 sm:px-6 bg-black overflow-hidden">
      <ParticleBackground />

      <div className="container mx-auto max-w-6xl z-10 relative">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center py-6 md:py-10">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center lg:text-left"
          >
            <div className="mb-4 flex justify-center lg:justify-start">
              <Image
                src="/Facevoice.png"
                alt="Facevoice AI - Sviluppo software su misura, automazione aziendale e integrazione intelligenza artificiale"
                width={400}
                height={120}
                className="w-full max-w-[280px] sm:max-w-[340px] h-auto object-contain"
                priority
                quality={90}
              />
            </div>

            <p className="text-sm sm:text-base md:text-lg text-gray-300 mb-6 max-w-xl mx-auto lg:mx-0 leading-relaxed">
              Trasformiamo le idee in soluzioni digitali. Ci occupiamo di{' '}
              <span className="text-white font-medium">gestione social, marketing e comunicazione</span>,{' '}
              <span className="text-white font-medium">sviluppo software</span>,{' '}
              <span className="text-white font-medium">integrazione AI</span> e{' '}
              <span className="text-white font-medium">gestionali</span> per far crescere la tua azienda.
            </p>

            <div className="grid grid-cols-2 gap-3 max-w-md mx-auto lg:mx-0">
              {services.map((service, index) => {
                const Icon = service.icon
                return (
                  <motion.div
                    key={service.title}
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.2 + index * 0.1 }}
                    className="flex items-start gap-2.5 p-3 rounded-xl bg-white/5 border border-white/10 backdrop-blur-sm"
                  >
                    <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-[var(--accent-blue)]/20 flex items-center justify-center">
                      <Icon className="w-4 h-4 text-[var(--accent-blue)]" />
                    </div>
                    <div className="text-left min-w-0">
                      <p className="text-xs sm:text-sm font-semibold text-white truncate">{service.title}</p>
                      <p className="text-[10px] sm:text-xs text-gray-400 leading-tight">{service.description}</p>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="flex justify-center lg:justify-end"
          >
            <div className="relative w-full max-w-[480px]">
              <div className="absolute -inset-4 bg-gradient-to-r from-[var(--accent-blue)]/20 to-purple-500/20 rounded-3xl blur-2xl" />
              <Image
                src="/hero-services.svg"
                alt="Facevoice AI - Servizi digitali: social marketing, sviluppo software, AI e gestionali"
                width={600}
                height={500}
                className="relative w-full h-auto rounded-2xl shadow-2xl"
                priority
              />
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
