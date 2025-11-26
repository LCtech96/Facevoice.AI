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
  X,
  Plus,
  ChevronDown
} from 'lucide-react'

// Settori di business
const businessSectors = [
  'Restaurant',
  'Insurance',
  'Sales',
  'Recruiter',
  'Healthcare',
  'E-commerce',
  'Real Estate',
  'Education',
  'Finance',
  'Legal',
  'Manufacturing',
  'Hospitality',
  'Retail',
  'Transportation',
  'Marketing',
]

// Esempi pratici per ogni combinazione servizio + settore
const getSectorExamples = (serviceId: number, sector: string): string[] => {
  const examples: Record<string, Record<string, string[]>> = {
    '1': { // AI Integration & Solutions
      'Restaurant': [
        'Sistema AI che suggerisce menu personalizzati in base alle preferenze dei clienti',
        'Analisi predittiva per ottimizzare gli ordini e ridurre gli sprechi alimentari',
        'Chatbot per prenotazioni e risposte rapide alle domande dei clienti',
      ],
      'Insurance': [
        'AI per valutare automaticamente i rischi e calcolare premi personalizzati',
        'Sistema di riconoscimento documenti per velocizzare le pratiche',
        'Analisi predittiva per prevenire frodi e ottimizzare i processi',
      ],
      'Sales': [
        'AI che analizza i dati dei clienti per suggerire prodotti migliori',
        'Sistema di previsione vendite basato su dati storici e tendenze',
        'Assistente AI che aiuta i venditori con risposte immediate ai clienti',
      ],
      'Recruiter': [
        'AI che analizza CV e trova i candidati più adatti alle posizioni',
        'Sistema di matching automatico tra candidati e offerte di lavoro',
        'Chatbot per rispondere alle domande dei candidati 24/7',
      ],
    },
    '2': { // Blockchain Development
      'Restaurant': [
        'Tracciabilità completa della filiera alimentare dal produttore al piatto',
        'Sistema di pagamenti sicuri e trasparenti per clienti e fornitori',
        'Certificazioni digitali per ingredienti biologici e di qualità',
      ],
      'Insurance': [
        'Smart contract per polizze automatiche e pagamenti istantanei',
        'Registro immutabile di tutte le pratiche e sinistri',
        'Sistema di verifica identità per prevenire frodi',
      ],
      'Sales': [
        'Contratti intelligenti per automatizzare le vendite',
        'Sistema di loyalty program basato su blockchain',
        'Tracciabilità prodotti per garantire autenticità',
      ],
      'Recruiter': [
        'Verifica certificati e qualifiche su blockchain',
        'Sistema di pagamento automatico per consulenti',
        'Portfolio digitale verificato per i candidati',
      ],
    },
    '3': { // Full-Stack Development
      'Restaurant': [
        'App mobile per ordinare e pagare direttamente dal tavolo',
        'Sistema di gestione completo: ordini, inventario, personale',
        'Piattaforma per delivery integrata con mappe e tracciamento',
      ],
      'Insurance': [
        'Portale clienti per gestire polizze e sinistri online',
        'App mobile per richiedere assistenza e caricare documenti',
        'Dashboard per agenti con statistiche e analisi in tempo reale',
      ],
      'Sales': [
        'CRM personalizzato per gestire clienti e opportunità',
        'App mobile per venditori con catalogo prodotti e ordini',
        'E-commerce completo con gestione inventario e pagamenti',
      ],
      'Recruiter': [
        'Piattaforma per candidati e aziende con matching intelligente',
        'Dashboard per recruiter con pipeline e statistiche',
        'App mobile per candidati per cercare e candidarsi a posizioni',
      ],
    },
    '4': { // Technical Consulting
      'Restaurant': [
        'Consulenza per scegliere il sistema POS migliore per il tuo ristorante',
        'Strategia digitale per aumentare la presenza online e le prenotazioni',
        'Ottimizzazione dei processi per ridurre costi e aumentare efficienza',
      ],
      'Insurance': [
        'Analisi dei sistemi esistenti e raccomandazioni per miglioramenti',
        'Strategia per digitalizzare i processi e migliorare l\'esperienza clienti',
        'Consulenza su sicurezza dati e conformità normativa',
      ],
      'Sales': [
        'Strategia per integrare CRM e sistemi di vendita esistenti',
        'Consulenza su automazione processi di vendita',
        'Analisi dati per identificare opportunità di crescita',
      ],
      'Recruiter': [
        'Strategia per digitalizzare il processo di recruiting',
        'Consulenza su ATS (Applicant Tracking System) e strumenti HR',
        'Ottimizzazione del processo di selezione e onboarding',
      ],
    },
    '5': { // Automation Systems
      'Restaurant': [
        'Automazione ordini dalla cucina al servizio al tavolo',
        'Sistema automatico per gestire inventario e ordinazioni fornitori',
        'Automazione prenotazioni e notifiche ai clienti',
      ],
      'Insurance': [
        'Automazione processi di underwriting e valutazione rischi',
        'Sistema automatico per gestire sinistri e comunicazioni',
        'Automazione fatturazione e pagamenti ricorrenti',
      ],
      'Sales': [
        'Automazione follow-up clienti e lead nurturing',
        'Sistema automatico per generare preventivi e contratti',
        'Automazione reporting e analisi vendite',
      ],
      'Recruiter': [
        'Automazione screening CV e invio email ai candidati',
        'Sistema automatico per programmare colloqui e inviare reminder',
        'Automazione onboarding nuovi dipendenti',
      ],
    },
    '6': { // AI Agents Development
      'Restaurant': [
        'Assistente AI per rispondere a domande su menu e allergeni',
        'Agente AI per gestire prenotazioni e modifiche',
        'Chatbot per suggerimenti piatti e promozioni personalizzate',
      ],
      'Insurance': [
        'Agente AI per guidare clienti nella scelta della polizza',
        'Assistente virtuale per gestire richieste di preventivo',
        'AI agent per supporto clienti 24/7 su sinistri e pratiche',
      ],
      'Sales': [
        'Agente AI per qualificare lead e prenotare appuntamenti',
        'Assistente virtuale per rispondere a domande prodotti',
        'AI agent per follow-up automatico e nurturing clienti',
      ],
      'Recruiter': [
        'Agente AI per rispondere a domande dei candidati',
        'Assistente virtuale per pre-screening candidati',
        'AI agent per programmare colloqui e inviare feedback',
      ],
    },
  }

  // Esempi generici se il settore non ha esempi specifici
  const genericExamples: Record<string, string[]> = {
    '1': [
      'Integrazione AI personalizzata per le tue esigenze specifiche',
      'Analisi dati intelligente per ottimizzare i processi aziendali',
      'Sistema di raccomandazioni basato su machine learning',
    ],
    '2': [
      'Sistema blockchain sicuro e trasparente per la tua azienda',
      'Smart contract personalizzati per automatizzare processi',
      'Registro immutabile per tracciabilità e verifica',
    ],
    '3': [
      'Sviluppo completo di applicazioni web e mobile',
      'Sistema integrato per gestire tutti gli aspetti del business',
      'Piattaforma personalizzata su misura per le tue esigenze',
    ],
    '4': [
      'Consulenza strategica per ottimizzare i processi tecnologici',
      'Analisi e raccomandazioni per migliorare l\'efficienza',
      'Supporto nella scelta delle migliori soluzioni tecnologiche',
    ],
    '5': [
      'Automazione completa dei processi ripetitivi',
      'Sistema intelligente per ridurre errori e aumentare velocità',
      'Integrazione automatica tra diversi sistemi aziendali',
    ],
    '6': [
      'Assistente AI personalizzato per il tuo business',
      'Agente virtuale che impara e migliora nel tempo',
      'Sistema di supporto intelligente 24/7',
    ],
  }

  return examples[serviceId.toString()]?.[sector] || genericExamples[serviceId.toString()] || []
}

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
  const [selectedSector, setSelectedSector] = useState<string | null>(null)
  const [showMoreSectors, setShowMoreSectors] = useState(false)
  
  // Settori principali visibili (primi 4)
  const mainSectors = businessSectors.slice(0, 4)
  // Settori aggiuntivi (dal 5° in poi)
  const additionalSectors = businessSectors.slice(4)

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
            onClick={() => {
              setSelectedService(null)
              setSelectedSector(null)
              setShowMoreSectors(false)
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-[var(--card-background)] rounded-2xl border border-[var(--border-color)] max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl"
            >
              <div className="sticky top-0 bg-[var(--card-background)] z-10 p-6 border-b border-[var(--border-color)]">
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
                    onClick={() => {
                      setSelectedService(null)
                      setSelectedSector(null)
                      setShowMoreSectors(false)
                    }}
                    className="p-2 hover:bg-[var(--background-secondary)] rounded-lg transition-colors"
                  >
                    <X className="w-5 h-5 text-[var(--text-secondary)]" />
                  </button>
                </div>
                <p className="text-base text-[var(--text-secondary)] leading-relaxed mb-6">
                  {selectedService.detailedDescription}
                </p>

                {/* Selezione settore */}
                {!selectedSector ? (
                  <div>
                    <p className="text-sm font-semibold text-[var(--text-primary)] mb-3">
                      Seleziona il tuo settore di business:
                    </p>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {mainSectors.map((sector) => (
                        <button
                          key={sector}
                          onClick={() => setSelectedSector(sector)}
                          className="px-4 py-2 bg-[var(--accent-blue)]/10 hover:bg-[var(--accent-blue)]/20 border border-[var(--accent-blue)]/30 rounded-lg text-sm text-[var(--text-primary)] transition-colors"
                        >
                          {sector}
                        </button>
                      ))}
                      <button
                        onClick={() => setShowMoreSectors(!showMoreSectors)}
                        className="px-4 py-2 bg-[var(--background-secondary)] hover:bg-[var(--background-hover)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] transition-colors flex items-center gap-2"
                      >
                        <Plus className="w-4 h-4" />
                        Altri settori
                      </button>
                    </div>
                    {showMoreSectors && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex flex-wrap gap-2"
                      >
                        {additionalSectors.map((sector) => (
                          <button
                            key={sector}
                            onClick={() => {
                              setSelectedSector(sector)
                              setShowMoreSectors(false)
                            }}
                            className="px-4 py-2 bg-[var(--accent-blue)]/10 hover:bg-[var(--accent-blue)]/20 border border-[var(--accent-blue)]/30 rounded-lg text-sm text-[var(--text-primary)] transition-colors"
                          >
                            {sector}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-sm font-semibold text-[var(--text-primary)]">
                        Esempi pratici per <span className="text-[var(--accent-blue)]">{selectedSector}</span>:
                      </p>
                      <button
                        onClick={() => setSelectedSector(null)}
                        className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                      >
                        Cambia settore
                      </button>
                    </div>
                    <div className="space-y-3">
                      {getSectorExamples(selectedService.id, selectedSector).map((example, idx) => (
                        <motion.div
                          key={idx}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: idx * 0.1 }}
                          className="p-4 bg-[var(--background-secondary)] rounded-lg border border-[var(--border-color)]"
                        >
                          <p className="text-sm text-[var(--text-primary)] leading-relaxed">
                            {example}
                          </p>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
