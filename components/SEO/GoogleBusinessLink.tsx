'use client'

import Link from 'next/link'
import { MapPin, Star, ExternalLink } from 'lucide-react'
import { motion } from 'framer-motion'

interface GoogleBusinessLinkProps {
  citta?: string
}

const GOOGLE_BUSINESS_URL = 'https://share.google/o1Lk6hzwOJQ6eEDjs'

export default function GoogleBusinessLink({ citta }: GoogleBusinessLinkProps) {
  return (
    <section className="container mx-auto px-4 py-12 max-w-6xl">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="bg-gradient-to-r from-[var(--accent-blue)]/10 to-[var(--accent-blue)]/5 border-2 border-[var(--accent-blue)]/20 rounded-xl p-6 md:p-8"
      >
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-start gap-4 flex-1">
            <div className="w-12 h-12 bg-[var(--accent-blue)] rounded-lg flex items-center justify-center flex-shrink-0">
              <MapPin className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-xl md:text-2xl font-bold text-[var(--text-primary)] mb-2">
                Trova Facevoice AI su Google Business
              </h3>
              <p className="text-sm md:text-base text-[var(--text-secondary)] mb-3">
                {citta ? (
                  <>
                    Sei a <span className="font-semibold text-[var(--text-primary)]">{citta}</span>? Scopri la nostra presenza su Google Business a Palermo. Visita la nostra scheda per leggere recensioni, vedere i nostri progetti e contattarci facilmente.
                  </>
                ) : (
                  <>
                    Visita la nostra scheda Google Business a Palermo per scoprire i nostri servizi, leggere le recensioni dei clienti e vedere i progetti realizzati.
                  </>
                )}
              </p>
              <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                <span className="font-medium">Verifica le nostre recensioni e i progetti completati</span>
              </div>
            </div>
          </div>
          <Link
            href={GOOGLE_BUSINESS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-2 px-6 py-3 bg-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/90 text-white rounded-lg font-semibold transition-all duration-300 hover:shadow-lg hover:shadow-[var(--accent-blue)]/30 whitespace-nowrap"
            aria-label="Visita la scheda Google Business di Facevoice AI a Palermo"
          >
            <span>Visita Google Business</span>
            <ExternalLink className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>
      </motion.div>
    </section>
  )
}

