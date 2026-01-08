'use client'

import { useState, useEffect } from 'react'
import Navigation from '@/components/Navigation'
import { BookingForm } from '@/components/ui/booking-form'
import { motion } from 'framer-motion'
import { Calendar, MessageSquare } from 'lucide-react'
import SEOHead from '@/components/SEO/SEOHead'

export default function BookingsPage() {
  return (
    <main className="min-h-screen bg-[var(--background)]">
      <SEOHead
        title="Prenotazioni | Facevoice AI - Richiedi un Preventivo o Consulenza"
        description="Compila il form per richiedere una prenotazione o consulenza con Facevoice AI. Sviluppo software, integrazione AI, consulenza tecnologica per la tua azienda. Ti risponderemo il prima possibile!"
        keywords={[
          'prenotazione consulenza software',
          'richiesta preventivo AI',
          'contatto Facevoice AI',
          'consulenza tecnologica',
          'prenotazione servizi software'
        ]}
        canonical="https://www.facevoice.ai/bookings"
        page="bookings"
      />
      <Navigation />
      
      {/* Spacing per desktop navigation */}
      <div className="hidden md:block h-16" />
      <div className="md:hidden h-14" />

      {/* Hero Section */}
      <section className="py-16 px-4 bg-gradient-to-b from-[var(--background)] to-[var(--background-secondary)]">
        <div className="container mx-auto max-w-6xl">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center mb-12"
          >
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 bg-[var(--accent-blue)]/10 rounded-full flex items-center justify-center">
                <Calendar className="w-8 h-8 text-[var(--accent-blue)]" />
              </div>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold mb-4 text-[var(--text-primary)]">
              Prenotazioni
            </h1>
            <p className="text-lg text-[var(--text-secondary)] max-w-3xl mx-auto mb-4">
              Se stai cercando più visibilità, e vuoi essere trovato facilmente dai tuoi clienti o attrarne di nuovi, o possiedi un codice sconto, compila i quattro step in basso con nome, email, numero e inviaci un messaggio
            </p>
            <p className="text-sm text-[var(--text-secondary)] max-w-2xl mx-auto">
              Compila il form per inviarci una richiesta direttamente su WhatsApp. Ti risponderemo il prima possibile!
            </p>
          </motion.div>

          {/* Booking Form */}
          <div className="flex justify-center">
            <BookingForm />
          </div>
        </div>
      </section>

      {/* Spacing per mobile navigation bottom */}
      <div className="md:hidden h-20" />
    </main>
  )
}

