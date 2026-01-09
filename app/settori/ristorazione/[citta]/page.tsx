'use client'

import { useParams } from 'next/navigation'
import Navigation from '@/components/Navigation'
import SEOHead from '@/components/SEO/SEOHead'
import RegionalStructuredData from '@/components/SEO/RegionalStructuredData'
import RegionalNavigation from '@/components/SEO/RegionalNavigation'
import GoogleBusinessLink from '@/components/SEO/GoogleBusinessLink'
import Image from 'next/image'
import { motion } from 'framer-motion'
import { Utensils, Clock, Smartphone, TrendingUp, Shield, Zap } from 'lucide-react'

const cittaData = {
  palermo: {
    name: 'Palermo',
    displayName: 'Palermo',
    keywords: [
      'software ristorazione Palermo',
      'sistema prenotazioni Palermo',
      'gestione tavoli ristorante Palermo',
      'POS ristorante Palermo',
      'app delivery Palermo',
      'automazione cucina Palermo',
      'analisi vendite ristorante Palermo',
      'loyalty program ristorante Palermo',
      'gestione magazzino ristorante Palermo',
      'marketing digitale ristorante Palermo'
    ]
  },
  catania: {
    name: 'Catania',
    displayName: 'Catania',
    keywords: [
      'software ristorazione Catania',
      'sistema prenotazioni Catania',
      'gestione tavoli ristorante Catania',
      'POS ristorante Catania',
      'app delivery Catania',
      'automazione cucina Catania',
      'analisi vendite ristorante Catania',
      'loyalty program ristorante Catania',
      'gestione magazzino ristorante Catania',
      'marketing digitale ristorante Catania'
    ]
  },
  trapani: {
    name: 'Trapani',
    displayName: 'Trapani',
    keywords: [
      'software ristorazione Trapani',
      'sistema prenotazioni Trapani',
      'gestione tavoli ristorante Trapani',
      'POS ristorante Trapani',
      'app delivery Trapani',
      'automazione cucina Trapani',
      'analisi vendite ristorante Trapani',
      'loyalty program ristorante Trapani',
      'gestione magazzino ristorante Trapani',
      'marketing digitale ristorante Trapani'
    ]
  }
}

export default function RistorazionePage() {
  const params = useParams()
  const cittaParam = (params?.citta as string) || 'palermo'
  const citta = (cittaParam.toLowerCase() as 'palermo' | 'catania' | 'trapani') || 'palermo'
  const data = cittaData[citta] || cittaData.palermo

  const title = `Soluzioni Software e AI per Ristorazione a ${data.displayName} | Facevoice AI`
  const description = `Sviluppo software personalizzato per ristoranti a ${data.displayName}. Sistema prenotazioni online, gestione tavoli, POS integrato, app delivery, automazione cucina, analisi vendite e marketing digitale. Soluzioni AI per ottimizzare la gestione del tuo ristorante a ${data.displayName}.`
  const canonical = `https://www.facevoice.ai/settori/ristorazione/${citta}`

  const content = `Facevoice AI offre soluzioni software innovative e personalizzate per il settore della ristorazione a ${data.displayName}. La nostra piattaforma integrata permette ai ristoratori siciliani di gestire ogni aspetto del proprio business in modo efficiente e moderno.

Il sistema di prenotazioni online che sviluppiamo per i ristoranti di ${data.displayName} consente ai clienti di prenotare tavoli in tempo reale, riducendo le chiamate telefoniche e ottimizzando l'occupazione dei tavoli. Integriamo anche sistemi di gestione tavoli che mostrano in tempo reale la disponibilità e permettono al personale di organizzare meglio il servizio.

Per quanto riguarda i sistemi POS, creiamo soluzioni integrate che gestiscono ordini, pagamenti e inventario in un'unica piattaforma. Questo permette ai ristoranti di ${data.displayName} di avere una visione completa delle vendite e delle scorte, facilitando la gestione quotidiana.

Le app delivery personalizzate che sviluppiamo permettono ai ristoranti di ${data.displayName} di gestire ordini da asporto e consegne in modo autonomo, senza dipendere da piattaforme terze che applicano commissioni elevate. L'app può includere tracciamento ordini in tempo reale, programmi fedeltà e promozioni personalizzate.

L'automazione della cucina attraverso intelligenza artificiale aiuta i ristoranti di ${data.displayName} a ottimizzare i tempi di preparazione, gestire le priorità degli ordini e ridurre gli sprechi alimentari. I sistemi AI analizzano i dati storici per prevedere la domanda e suggerire le quantità da preparare.

L'analisi delle vendite tramite dashboard intuitive permette ai ristoratori di ${data.displayName} di monitorare performance, identificare i piatti più venduti, analizzare i trend stagionali e prendere decisioni basate sui dati. I report automatici facilitano la gestione finanziaria e la pianificazione futura.

I programmi di loyalty personalizzati aumentano la fidelizzazione dei clienti a ${data.displayName}, permettendo di raccogliere punti, ricevere sconti esclusivi e partecipare a promozioni speciali. L'integrazione con i sistemi esistenti rende l'esperienza fluida per i clienti.

La gestione del magazzino automatizzata aiuta i ristoranti di ${data.displayName} a tenere traccia delle scorte, ricevere avvisi quando i prodotti stanno per finire e ottimizzare gli ordini ai fornitori. Questo riduce sprechi e costi operativi.

Infine, le strategie di marketing digitale che implementiamo per i ristoranti di ${data.displayName} includono campagne social media automatizzate, email marketing personalizzate e promozioni mirate basate sul comportamento dei clienti.`

  return (
    <main className="min-h-screen bg-[var(--background)]">
      <SEOHead
        title={title}
        description={description}
        keywords={data.keywords}
        canonical={canonical}
        page={`ristorazione-${citta}`}
      />
      <RegionalStructuredData
        settore="ristorazione"
        citta={citta}
        serviceName={`Soluzioni Software e AI per Ristorazione a ${data.displayName}`}
        serviceDescription={description}
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
            <h1 className="text-4xl md:text-5xl font-bold mb-4 text-[var(--text-primary)]">
              Soluzioni Software e AI per Ristorazione a {data.displayName}
            </h1>
            <p className="text-lg text-[var(--text-secondary)] max-w-3xl mx-auto">
              Sistemi innovativi per gestire prenotazioni, tavoli, POS, delivery e marketing del tuo ristorante a {data.displayName}
            </p>
          </motion.div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-16 px-4">
        <div className="container mx-auto max-w-6xl">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
            {[
              { icon: Utensils, title: 'Sistema Prenotazioni', desc: 'Prenotazioni online in tempo reale per ottimizzare l\'occupazione' },
              { icon: Clock, title: 'Gestione Tavoli', desc: 'Monitoraggio tavoli e organizzazione servizio efficiente' },
              { icon: Smartphone, title: 'App Delivery', desc: 'App personalizzata per ordini da asporto e consegne' },
              { icon: TrendingUp, title: 'Analisi Vendite', desc: 'Dashboard con report dettagliati e analisi performance' },
              { icon: Shield, title: 'POS Integrato', desc: 'Sistema pagamenti completo con gestione inventario' },
              { icon: Zap, title: 'Automazione AI', desc: 'Intelligenza artificiale per ottimizzare cucina e previsioni' }
            ].map((feature, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: index * 0.1 }}
                className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-xl p-6 hover:shadow-lg transition-all"
              >
                <feature.icon className="w-8 h-8 text-[var(--accent-blue)] mb-4" />
                <h3 className="text-xl font-semibold text-[var(--text-primary)] mb-2">{feature.title}</h3>
                <p className="text-sm text-[var(--text-secondary)]">{feature.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Content Section */}
      <section className="py-16 px-4 bg-[var(--background-secondary)]">
        <div className="container mx-auto max-w-4xl">
          <div className="prose prose-invert max-w-none">
            <div className="text-[var(--text-secondary)] leading-relaxed whitespace-pre-line">
              {content}
            </div>
          </div>
        </div>
      </section>

      {/* Google Business Link */}
      <GoogleBusinessLink citta={data.displayName} />

      {/* Regional Navigation */}
      <RegionalNavigation settore="ristorazione" currentCitta={citta} />

      {/* Spacing per mobile navigation bottom */}
      <div className="md:hidden h-20" />
    </main>
  )
}

