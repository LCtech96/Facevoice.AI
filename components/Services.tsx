'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  Brain, 
  Link as LinkIcon, 
  Code, 
  MessageSquare, 
  Settings, 
  Bot,
  X
} from 'lucide-react'

const services = [
  {
    id: 1,
    title: 'AI Integration & Solutions',
    icon: Brain,
    description: 'Seamless integration of AI technologies into your existing infrastructure',
    detailedDescription: 'Ti aiutiamo a integrare l\'intelligenza artificiale nella tua azienda in modo semplice e naturale. Non serve essere esperti: trasformiamo le tue idee in soluzioni AI concrete che migliorano il tuo lavoro quotidiano. Pensiamo a tutto noi, tu vedi solo i risultati.',
  },
  {
    id: 2,
    title: 'Blockchain Development',
    icon: LinkIcon,
    description: 'Building secure and scalable blockchain solutions for your business',
    detailedDescription: 'Creiamo sistemi blockchain sicuri e trasparenti per la tua azienda. Immagina di avere un registro digitale impossibile da falsificare, dove ogni transazione è verificabile. Perfetto per contratti, tracciabilità prodotti o sistemi di pagamento innovativi. Ti spieghiamo tutto in modo chiaro, senza tecnicismi.',
  },
  {
    id: 3,
    title: 'Full-Stack Development',
    icon: Code,
    description: 'End-to-end web and mobile application development',
    detailedDescription: 'Sviluppiamo app e siti web completi, dalla parte che vedi tu a quella che funziona dietro le quinte. Come costruire una casa: pensiamo a tutto, dalle fondamenta al tetto. Tu ci dici cosa vuoi, noi lo realizziamo. Semplice, veloce, fatto bene.',
  },
  {
    id: 4,
    title: 'Technical Consulting',
    icon: MessageSquare,
    description: 'Expert guidance on technology strategy and implementation',
    detailedDescription: 'Hai bisogno di consigli tecnologici? Siamo qui per aiutarti. Ti guidiamo nelle scelte giuste per la tua azienda, senza venderti soluzioni che non ti servono. Come un consulente di fiducia che ti aiuta a capire cosa è meglio per te, spiegandoti tutto in modo chiaro e onesto.',
  },
  {
    id: 5,
    title: 'Automation Systems',
    icon: Settings,
    description: 'Streamline your operations with intelligent automation',
    detailedDescription: 'Automatizziamo i processi noiosi e ripetitivi della tua azienda. Immagina di non dover più fare manualmente quelle attività che ti rubano tempo: le facciamo fare al computer. Tu ti concentri su quello che conta davvero, mentre il sistema lavora per te 24/7. Risparmi tempo e denaro.',
  },
  {
    id: 6,
    title: 'AI Agents Development',
    icon: Bot,
    description: 'Custom AI agents tailored to your specific business needs',
    detailedDescription: 'Creiamo assistenti AI personalizzati per la tua azienda. Come avere un dipendente virtuale che risponde alle domande dei clienti, gestisce appuntamenti o aiuta il tuo team. Impara dalle tue esigenze e migliora nel tempo. Un aiuto concreto che funziona davvero.',
  },
]

export default function Services() {
  const [selectedService, setSelectedService] = useState<typeof services[0] | null>(null)

  return (
    <section id="services" className="min-h-screen py-24 px-6 bg-[var(--background)]">
      <motion.div
        initial={{ opacity: 0, y: 50 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8 }}
        className="container mx-auto max-w-6xl"
      >
        <h2 className="text-4xl md:text-5xl font-bold text-center mb-4 text-[var(--text-primary)]">
          Our Services
        </h2>
        <p className="text-lg text-[var(--text-secondary)] text-center mb-16 max-w-2xl mx-auto">
          Comprehensive solutions to drive your business forward
        </p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {services.map((service, index) => {
            const Icon = service.icon
            return (
              <motion.div
                key={service.id}
                initial={{ opacity: 0, y: 50 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: index * 0.1 }}
                whileHover={{ scale: 1.02, y: -5 }}
                onClick={() => setSelectedService(service)}
                className="bg-[var(--card-background)] border border-[var(--border-color)] p-6 rounded-2xl cursor-pointer hover:shadow-lg transition-all"
              >
                <div className="mb-4">
                  <div className="w-12 h-12 bg-[var(--accent-blue)]/10 rounded-xl flex items-center justify-center mb-4">
                    <Icon className="w-6 h-6 text-[var(--accent-blue)]" />
                  </div>
                  <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-2">
                    {service.title}
                  </h3>
                  <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                    {service.description}
                  </p>
                </div>
              </motion.div>
            )
          })}
        </div>
      </motion.div>

      {/* Modal per spiegazione dettagliata */}
      <AnimatePresence>
        {selectedService && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setSelectedService(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-[var(--card-background)] rounded-2xl border border-[var(--border-color)] max-w-2xl w-full p-6 shadow-2xl"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-[var(--accent-blue)]/10 rounded-xl flex items-center justify-center">
                    {selectedService.icon && (
                      <selectedService.icon className="w-6 h-6 text-[var(--accent-blue)]" />
                    )}
                  </div>
                  <h3 className="text-2xl font-bold text-[var(--text-primary)]">
                    {selectedService.title}
                  </h3>
                </div>
                <button
                  onClick={() => setSelectedService(null)}
                  className="p-2 hover:bg-[var(--background-secondary)] rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-[var(--text-secondary)]" />
                </button>
              </div>
              <p className="text-base text-[var(--text-secondary)] leading-relaxed">
                {selectedService.detailedDescription}
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
