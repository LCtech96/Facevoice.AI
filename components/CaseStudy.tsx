'use client'

import { motion } from 'framer-motion'
import { MapPin, Star, ExternalLink, CheckCircle2, Menu, Calendar, ShoppingCart, Image, FileText, Settings, MessageSquare, Mail, Phone, Bot, UserPlus, Globe } from 'lucide-react'
import CaseStudyComments from './CaseStudyComments'
import { createClient } from '@/lib/supabase-client'
import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'

interface CaseStudyData {
  id: string
  title: string
  location?: string
  description: string
  url: string
  backgroundImage?: string
  content: {
    mainDescription: string
    features?: Array<{ icon: any, text: string }>
    specialSections?: Array<{ icon: any, title: string, description: string }>
    integrations?: Array<{ icon: any, label: string }>
    cta?: { text: string, action: () => void }
  }
}

const caseStudies: CaseStudyData[] = [
  {
    id: 'trattoria-piero',
    title: 'Trattoria da Piero',
    location: 'Mondello, Palermo',
    description: 'Una bellissima e tipica trattoria del palermitano che ha ospitato alcuni dei più famosi personaggi italiani e internazionali',
    url: 'https://trattoriadapieromondello.site',
    content: {
      mainDescription: 'Questo progetto è stato realizzato esattamente come richiesto dal cliente, dimostrando la nostra capacità di personalizzare ogni aspetto e funzione del sito. La trattoria, situata nel suggestivo quartiere di Mondello a Palermo, ha una storia ricca che include ospiti illustri, tutti visitabili nella sezione dedicata del sito.',
      specialSections: [
        {
          icon: Star,
          title: 'Sezione VIP',
          description: 'Il sito include una pagina dedicata ai personaggi famosi che hanno visitato la trattoria, celebrando la storia e il prestigio del locale.'
        }
      ],
      features: [
        { icon: Image, text: 'Modifica immagini e gallerie' },
        { icon: FileText, text: 'Aggiorna testi e contenuti' },
        { icon: Menu, text: 'Gestione menù e prezzi' },
        { icon: Calendar, text: 'Prenotazioni tavoli' },
        { icon: ShoppingCart, text: 'Ordini da asporto' },
        { icon: MessageSquare, text: 'Gestione post e news' },
      ],
      integrations: [
        { icon: MapPin, label: 'Google Maps' },
        { icon: MessageSquare, label: 'WhatsApp' },
        { icon: Mail, label: 'Email' },
        { icon: Phone, label: 'Contatti' },
        { icon: ExternalLink, label: 'Social Media' },
      ]
    }
  },
  {
    id: 'luca-corrao',
    title: 'Luca Corrao',
    description: 'Sito personale professionale con assistente AI integrato per supporto clienti e altre funzionalità avanzate',
    url: 'https://lucacorrao.com',
    backgroundImage: '/lucacorrao.png',
    content: {
      mainDescription: 'Un sito web professionale completo dotato di assistente AI integrato per assistere i clienti in tempo reale. Il sito offre una piattaforma moderna e interattiva che migliora l\'esperienza utente attraverso tecnologie all\'avanguardia.',
      specialSections: [
        {
          icon: Bot,
          title: 'Assistente AI Integrato',
          description: 'Il sito include un assistente AI avanzato che fornisce supporto ai clienti 24/7, rispondendo alle domande e guidando i visitatori attraverso i servizi offerti.'
        },
        {
          icon: Globe,
          title: 'Pubblica la tua struttura in vetrina',
          description: 'Pubblica la tua struttura in vetrina e aspetta per essere approvato. Un sistema semplice e intuitivo per mostrare il tuo business al pubblico.'
        }
      ],
      features: [
        { icon: Bot, text: 'Assistente AI per supporto clienti' },
        { icon: FileText, text: 'Portfolio e progetti' },
        { icon: MessageSquare, text: 'Sistema di contatto integrato' },
        { icon: Settings, text: 'Pannello admin completo' },
        { icon: Image, text: 'Gallerie e media management' },
        { icon: Globe, text: 'Design responsive e moderno' },
      ],
      integrations: [
        { icon: MessageSquare, label: 'Chat AI' },
        { icon: Mail, label: 'Email' },
        { icon: ExternalLink, label: 'Social Media' },
        { icon: Phone, label: 'Contatti' },
      ]
    }
  },
  {
    id: 'nomadiqe',
    title: 'Nomadiqe',
    description: 'Il punto di incontro tra chi lavora viaggiando e le realtà locali',
    url: 'https://www.nomadiqe.com',
    backgroundImage: '/nomadiqe.png',
    content: {
      mainDescription: 'Nomadiqe è il punto di incontro tra chi lavora viaggiando e le realtà locali. Mettiamo in contatto creatori digitali, host, piccoli imprenditori e attività commerciali per creare nuove opportunità e collaborazioni, in modo semplice e umano.',
      specialSections: [
        {
          icon: UserPlus,
          title: 'Community di Nomadi Digitali',
          description: 'Crea il tuo profilo e unisciti a una community globale di professionisti che lavorano viaggiando. Connettiti, condividi esperienze e scopri nuove opportunità.'
        }
      ],
      features: [
        { icon: UserPlus, text: 'Creazione profilo personalizzato' },
        { icon: Globe, text: 'Network globale di nomadi' },
        { icon: MessageSquare, text: 'Sistema di messaggistica' },
        { icon: FileText, text: 'Risorse e guide per nomadi' },
        { icon: Calendar, text: 'Eventi e meetup' },
        { icon: Settings, text: 'Dashboard personalizzato' },
      ],
      integrations: [
        { icon: ExternalLink, label: 'Social Network' },
        { icon: MapPin, label: 'Mappe e localizzazione' },
        { icon: MessageSquare, label: 'Messaggistica' },
      ],
      cta: {
        text: 'Crea il tuo profilo su Nomadiqe',
        action: () => {
          window.open('https://www.nomadiqe.com', '_blank')
        }
      }
    }
  },
  {
    id: 'barinello',
    title: 'Barinello',
    description: 'Sito web completo con pannello di controllo admin per la gestione completa di ogni aspetto',
    url: 'https://barinello.com',
    backgroundImage: '/Barinello.png',
    content: {
      mainDescription: 'Barinello.com è un sito web completo dotato di un pannello di controllo admin avanzato che permette di modificare e gestire ogni aspetto del proprio sito web in modo semplice e intuitivo. Il sistema offre controllo totale sui contenuti, design e funzionalità.',
      specialSections: [
        {
          icon: Settings,
          title: 'Pannello di Controllo Admin Completo',
          description: 'Accesso al pannello admin su barinello.com/admin per modificare ogni aspetto del sito: contenuti, immagini, layout, configurazioni e molto altro. Gestione completa in autonomia senza bisogno di competenze tecniche.'
        }
      ],
      features: [
        { icon: Settings, text: 'Pannello admin completo (barinello.com/admin)' },
        { icon: Bot, text: 'Assistente AI h24' },
        { icon: Image, text: 'Gestione immagini e media' },
        { icon: FileText, text: 'Modifica contenuti e testi' },
        { icon: Globe, text: 'Personalizzazione design e layout' },
        { icon: Menu, text: 'Gestione menu e navigazione' },
        { icon: MessageSquare, text: 'Configurazione contatti e form' },
      ],
      integrations: [
        { icon: Settings, label: 'Pannello Admin' },
        { icon: Mail, label: 'Email' },
        { icon: Phone, label: 'Contatti' },
        { icon: ExternalLink, label: 'Social Media' },
      ]
    }
  }
]

export default function CaseStudy() {
  const [user, setUser] = useState<User | null>(null)
  const supabase = createClient()

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)
    }
    checkUser()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])
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
          <h1 className="text-4xl md:text-5xl font-bold mb-4 text-[var(--text-primary)]">
            Case Studies - Progetti Software e E-commerce Realizzati a Palermo
          </h1>
          <p className="text-lg text-[var(--text-secondary)] max-w-2xl mx-auto">
            Scopri come abbiamo trasformato la presenza digitale dei nostri clienti con sviluppo software personalizzato, restyling e-commerce, integrazione AI e soluzioni cloud per imprese siciliane
          </p>
        </div>

        {/* Grid di Case Studies */}
        <div className="grid grid-cols-1 gap-8">
          {caseStudies.map((study, studyIndex) => (
            <motion.div
              key={study.id}
              initial={{ opacity: 0, y: 50 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, delay: studyIndex * 0.2 }}
              className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-2xl overflow-hidden shadow-xl"
            >
              {/* Header con immagine/header */}
              <div 
                className="relative p-8 md:p-12 text-white overflow-hidden"
                style={{
                  backgroundImage: `url(${study.backgroundImage || '/sfondo.png'})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  backgroundRepeat: 'no-repeat',
                }}
              >
                {/* Overlay scuro per leggibilità */}
                <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/60 to-black/50 z-0"></div>
                <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                  <div>
                    {study.location && (
                      <div className="flex items-center gap-2 mb-2">
                        <MapPin className="w-5 h-5" />
                        <span className="text-sm opacity-90">{study.location}</span>
                      </div>
                    )}
                    <h3 className="text-3xl md:text-4xl font-bold mb-2">
                      {study.title}
                    </h3>
                    <p className="text-lg opacity-90">
                      {study.description}
                    </p>
                  </div>
                  <a
                    href={study.url}
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
                    {study.content.mainDescription}
                  </p>
                  
                  {/* Sezioni Speciali */}
                  {study.content.specialSections && study.content.specialSections.map((section, index) => (
                    <div key={index} className="bg-[var(--accent-blue)]/10 border border-[var(--accent-blue)]/30 rounded-xl p-6 mb-6">
                      <div className="flex items-center gap-3 mb-3">
                        <section.icon className="w-6 h-6 text-[var(--accent-blue)]" />
                        <h4 className="text-xl font-semibold text-[var(--text-primary)]">
                          {section.title}
                        </h4>
                      </div>
                      <p className="text-[var(--text-secondary)]">
                        {section.description}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Funzionalità */}
                {study.content.features && (
                  <div className="mb-8">
                    <h4 className="text-2xl font-bold text-[var(--text-primary)] mb-6 flex items-center gap-3">
                      <Settings className="w-6 h-6 text-[var(--accent-blue)]" />
                      Funzionalità Principali
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {study.content.features.map((feature, index) => (
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
                )}

                {/* Integrazioni */}
                {study.content.integrations && study.content.integrations.length > 0 && (
                  <div className="mb-8">
                    <h4 className="text-2xl font-bold text-[var(--text-primary)] mb-6">
                      Integrazioni Complete
                    </h4>
                    <div className="flex flex-wrap gap-3">
                      {study.content.integrations.map((integration, index) => (
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
                )}

                {/* CTA Speciale per Nomadiqe */}
                {study.id === 'nomadiqe' && study.content.cta && (
                  <div className="mb-8">
                    <div className="bg-gradient-to-br from-[var(--accent-blue)]/10 to-[var(--accent-blue)]/5 border border-[var(--accent-blue)]/30 rounded-xl p-6 text-center">
                      <h4 className="text-xl font-bold text-[var(--text-primary)] mb-3 flex items-center justify-center gap-2">
                        <UserPlus className="w-5 h-5 text-[var(--accent-blue)]" />
                        Unisciti alla Community
                      </h4>
                      <p className="text-[var(--text-secondary)] mb-4">
                        Crea il tuo profilo su Nomadiqe e inizia a connetterti con nomadi digitali da tutto il mondo
                      </p>
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={study.content.cta.action}
                        className="w-full flex items-center justify-center gap-2 bg-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/90 text-white px-6 py-3 rounded-lg transition-colors font-medium"
                      >
                        <UserPlus className="w-5 h-5" />
                        <span>{study.content.cta.text}</span>
                      </motion.button>
                    </div>
                  </div>
                )}

                {/* Prezzo (solo per Barinello) */}
                {study.id === 'barinello' && (
                  <div className="border-t border-[var(--border-color)] pt-8">
                    <div className="bg-[var(--accent-blue)]/10 rounded-xl p-6 text-center">
                      <p className="text-sm text-[var(--text-secondary)] mb-2">Prezzo base</p>
                      <p className="text-4xl font-bold text-[var(--text-primary)] mb-2">
                        €899
                      </p>
                      <p className="text-lg text-[var(--text-secondary)]">
                        Sito "chiavi in mano" completo di tutte le funzionalità
                      </p>
                      <p className="text-sm text-[var(--text-secondary)] mt-2 opacity-80">
                        Personalizzabile e scalabile in base alle tue esigenze
                      </p>
                      <p className="text-[10px] text-[var(--text-secondary)] mt-3 opacity-60 leading-relaxed">
                        Manutenzione gratuita per i primi 5 mesi. Successivamente, il costo è di €25/mese minimo con possibilità di bloccare un tetto massimo mensile.
                      </p>
                      
                      {/* Bottone WhatsApp */}
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => {
                          const phoneNumber = '+393514206353'
                          const message = encodeURIComponent('Ciao! Sono interessato al servizio per Barinello. Vorrei maggiori informazioni.')
                          const whatsappUrl = `https://wa.me/${phoneNumber.replace(/[^0-9]/g, '')}?text=${message}`
                          window.open(whatsappUrl, '_blank')
                        }}
                        className="mt-6 w-full flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white px-6 py-3 rounded-lg transition-colors font-medium"
                      >
                        <MessageSquare className="w-5 h-5" />
                        <span>Contattaci su WhatsApp</span>
                      </motion.button>
                    </div>
                  </div>
                )}

                {/* Personalizzazione (solo per Trattoria da Piero) */}
                {study.id === 'trattoria-piero' && (
                  <>
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
                          €699
                        </p>
                        <p className="text-lg text-[var(--text-secondary)]">
                          Sito "chiavi in mano" completo di tutte le funzionalità
                        </p>
                        <p className="text-sm text-[var(--text-secondary)] mt-2 opacity-80">
                          Personalizzabile e scalabile in base alle tue esigenze
                        </p>
                        <p className="text-[10px] text-[var(--text-secondary)] mt-3 opacity-60 leading-relaxed">
                          Manutenzione gratuita per i primi 5 mesi. Successivamente, il costo parte da €10/mese fino al 12° mese, dopo i quali parte da €15/mese in su.
                        </p>
                        
                        {/* Bottone WhatsApp */}
                        <motion.button
                          whileHover={{ scale: 1.05 }}
                          whileTap={{ scale: 0.95 }}
                          onClick={() => {
                            const phoneNumber = '+393514206353'
                            const message = encodeURIComponent('Ciao! Sono interessato al servizio di Personalizzazione Totale. Vorrei maggiori informazioni.')
                            const whatsappUrl = `https://wa.me/${phoneNumber.replace(/[^0-9]/g, '')}?text=${message}`
                            window.open(whatsappUrl, '_blank')
                          }}
                          className="mt-6 w-full flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white px-6 py-3 rounded-lg transition-colors font-medium"
                        >
                          <MessageSquare className="w-5 h-5" />
                          <span>Contattaci su WhatsApp</span>
                        </motion.button>
                      </div>
                    </div>
                  </>
                )}

                {/* Sezione Commenti */}
                <CaseStudyComments caseStudyId={study.id} user={user} />
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </section>
  )
}

