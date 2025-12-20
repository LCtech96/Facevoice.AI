'use client'

import { motion } from 'framer-motion'
import { MapPin, Star, ExternalLink, CheckCircle2, Menu, Calendar, ShoppingCart, Image, FileText, Settings, MessageSquare, Mail, Phone } from 'lucide-react'

export default function CaseStudy() {
  return (
    <section className="py-24 px-6 bg-[var(--background)]">
      <motion.div
        initial={{ opacity: 0, y: 50 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8 }}
        className="container mx-auto max-w-6xl"
      >
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold mb-4 text-[var(--text-primary)]">
            Case Study
          </h2>
          <p className="text-lg text-[var(--text-secondary)] max-w-2xl mx-auto">
            Scopri come abbiamo trasformato la presenza digitale dei nostri clienti
          </p>
        </div>

        {/* Case Study Card */}
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-2xl overflow-hidden shadow-xl"
        >
          {/* Header con immagine/header */}
          <div className="bg-gradient-to-r from-orange-600 to-red-600 p-8 md:p-12 text-white">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <MapPin className="w-5 h-5" />
                  <span className="text-sm opacity-90">Mondello, Palermo</span>
                </div>
                <h3 className="text-3xl md:text-4xl font-bold mb-2">
                  Trattoria da Piero
                </h3>
                <p className="text-lg opacity-90">
                  Una bellissima e tipica trattoria del palermitano che ha ospitato alcuni dei più famosi personaggi italiani e internazionali
                </p>
              </div>
              <a
                href="https://trattoriadapieromondello.site"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 bg-white/20 hover:bg-white/30 backdrop-blur-sm px-6 py-3 rounded-lg transition-all group"
              >
                <span>Visita il sito</span>
                <ExternalLink className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </a>
            </div>
          </div>

          {/* Contenuto principale */}
          <div className="p-8 md:p-12">
            {/* Descrizione */}
            <div className="mb-8">
              <p className="text-lg text-[var(--text-secondary)] leading-relaxed mb-6">
                Questo progetto è stato realizzato esattamente come richiesto dal cliente, 
                dimostrando la nostra capacità di personalizzare ogni aspetto e funzione del sito. 
                La trattoria, situata nel suggestivo quartiere di Mondello a Palermo, ha una storia 
                ricca che include ospiti illustri, tutti visitabili nella sezione dedicata del sito.
              </p>
              
              {/* Sezione VIP */}
              <div className="bg-[var(--accent-blue)]/10 border border-[var(--accent-blue)]/30 rounded-xl p-6 mb-6">
                <div className="flex items-center gap-3 mb-3">
                  <Star className="w-6 h-6 text-[var(--accent-blue)]" />
                  <h4 className="text-xl font-semibold text-[var(--text-primary)]">
                    Sezione VIP
                  </h4>
                </div>
                <p className="text-[var(--text-secondary)]">
                  Il sito include una pagina dedicata ai personaggi famosi che hanno visitato la trattoria, 
                  celebrando la storia e il prestigio del locale.
                </p>
              </div>
            </div>

            {/* Funzionalità Admin */}
            <div className="mb-8">
              <h4 className="text-2xl font-bold text-[var(--text-primary)] mb-6 flex items-center gap-3">
                <Settings className="w-6 h-6 text-[var(--accent-blue)]" />
                Pannello di Controllo Admin
              </h4>
              <p className="text-[var(--text-secondary)] mb-6">
                Ogni sito realizzato include una sezione admin intuitiva che permette ai proprietari 
                di gestire autonomamente ogni aspetto del proprio sito:
              </p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { icon: Image, text: 'Modifica immagini e gallerie' },
                  { icon: FileText, text: 'Aggiorna testi e contenuti' },
                  { icon: Menu, text: 'Gestione menù e prezzi' },
                  { icon: Calendar, text: 'Prenotazioni tavoli' },
                  { icon: ShoppingCart, text: 'Ordini da asporto' },
                  { icon: MessageSquare, text: 'Gestione post e news' },
                ].map((feature, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.5, delay: index * 0.1 }}
                    className="flex items-center gap-3 bg-[var(--background-secondary)] p-4 rounded-lg"
                  >
                    <feature.icon className="w-5 h-5 text-[var(--accent-blue)] flex-shrink-0" />
                    <span className="text-[var(--text-primary)]">{feature.text}</span>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Integrazioni */}
            <div className="mb-8">
              <h4 className="text-2xl font-bold text-[var(--text-primary)] mb-6">
                Integrazioni Complete
              </h4>
              <div className="flex flex-wrap gap-3">
                {[
                  { icon: MapPin, label: 'Google Maps' },
                  { icon: MessageSquare, label: 'WhatsApp' },
                  { icon: Mail, label: 'Email' },
                  { icon: Phone, label: 'Contatti' },
                  { icon: ExternalLink, label: 'Social Media' },
                ].map((integration, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 bg-[var(--background-secondary)] px-4 py-2 rounded-full border border-[var(--border-color)]"
                  >
                    <integration.icon className="w-4 h-4 text-[var(--accent-blue)]" />
                    <span className="text-sm text-[var(--text-primary)]">{integration.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Personalizzazione */}
            <div className="bg-gradient-to-br from-[var(--accent-blue)]/10 to-[var(--accent-blue)]/5 border border-[var(--accent-blue)]/30 rounded-xl p-6 mb-8">
              <h4 className="text-xl font-bold text-[var(--text-primary)] mb-3 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-[var(--accent-blue)]" />
                Personalizzazione Totale
              </h4>
              <p className="text-[var(--text-secondary)]">
                È possibile personalizzare ogni aspetto e funzione del sito secondo le esigenze specifiche 
                del cliente. Ogni progetto è unico e realizzato su misura, garantendo un risultato che 
                riflette perfettamente l'identità e le necessità del business.
              </p>
            </div>

            {/* Prezzo */}
            <div className="border-t border-[var(--border-color)] pt-8">
              <div className="bg-[var(--accent-blue)]/10 rounded-xl p-6 text-center">
                <p className="text-sm text-[var(--text-secondary)] mb-2">Prezzo base</p>
                <p className="text-4xl font-bold text-[var(--text-primary)] mb-2">
                  €499
                </p>
                <p className="text-lg text-[var(--text-secondary)]">
                  Sito "chiavi in mano" completo di tutte le funzionalità
                </p>
                <p className="text-sm text-[var(--text-secondary)] mt-2 opacity-80">
                  Personalizzabile e scalabile in base alle tue esigenze
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </section>
  )
}

