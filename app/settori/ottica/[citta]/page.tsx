'use client'

import { useParams } from 'next/navigation'
import Navigation from '@/components/Navigation'
import SEOHead from '@/components/SEO/SEOHead'
import RegionalStructuredData from '@/components/SEO/RegionalStructuredData'
import RegionalNavigation from '@/components/SEO/RegionalNavigation'
import GoogleBusinessLink from '@/components/SEO/GoogleBusinessLink'
import { motion } from 'framer-motion'
import { Eye, ShoppingBag, Users, BarChart3, Calendar, CreditCard } from 'lucide-react'

const cittaData = {
  palermo: {
    name: 'Palermo',
    displayName: 'Palermo',
    keywords: [
      'software ottica Palermo',
      'gestione clienti ottica Palermo',
      'prenotazioni visite ottica Palermo',
      'inventario occhiali Palermo',
      'fatturazione elettronica ottica Palermo',
      'loyalty program ottica Palermo',
      'app clienti ottica Palermo',
      'analisi vendite ottica Palermo',
      'marketing digitale ottica Palermo',
      'CRM ottica Palermo'
    ]
  },
  catania: {
    name: 'Catania',
    displayName: 'Catania',
    keywords: [
      'software ottica Catania',
      'gestione clienti ottica Catania',
      'prenotazioni visite ottica Catania',
      'inventario occhiali Catania',
      'fatturazione elettronica ottica Catania',
      'loyalty program ottica Catania',
      'app clienti ottica Catania',
      'analisi vendite ottica Catania',
      'marketing digitale ottica Catania',
      'CRM ottica Catania'
    ]
  },
  trapani: {
    name: 'Trapani',
    displayName: 'Trapani',
    keywords: [
      'software ottica Trapani',
      'gestione clienti ottica Trapani',
      'prenotazioni visite ottica Trapani',
      'inventario occhiali Trapani',
      'fatturazione elettronica ottica Trapani',
      'loyalty program ottica Trapani',
      'app clienti ottica Trapani',
      'analisi vendite ottica Trapani',
      'marketing digitale ottica Trapani',
      'CRM ottica Trapani'
    ]
  }
}

export default function OtticaPage() {
  const params = useParams()
  const cittaParam = (params?.citta as string) || 'palermo'
  const citta = (cittaParam.toLowerCase() as 'palermo' | 'catania' | 'trapani') || 'palermo'
  const data = cittaData[citta] || cittaData.palermo

  const title = `Soluzioni Software e AI per Ottica a ${data.displayName} | Facevoice AI`
  const description = `Sviluppo software personalizzato per ottiche a ${data.displayName}. Gestione clienti, prenotazioni visite, inventario occhiali, fatturazione elettronica, app clienti, analisi vendite e marketing digitale. Soluzioni AI per ottimizzare la gestione del tuo negozio ottico a ${data.displayName}.`
  const canonical = `https://www.facevoice.ai/settori/ottica/${citta}`

  const content = `Facevoice AI sviluppa soluzioni software innovative e personalizzate per il settore dell'ottica a ${data.displayName}. La nostra piattaforma integrata permette agli ottici siciliani di gestire clienti, prenotazioni, inventario e marketing in modo efficiente e moderno.

Il sistema di gestione clienti che creiamo per le ottiche di ${data.displayName} consente di archiviare tutte le informazioni dei pazienti, inclusi dati anamnestici, prescrizioni, acquisti precedenti e preferenze. Questo permette agli ottici di ${data.displayName} di offrire un servizio personalizzato e di ricordare le esigenze di ogni cliente.

Le prenotazioni visite online che implementiamo per le ottiche di ${data.displayName} permettono ai clienti di prenotare esami della vista e consulenze direttamente dal sito web o dall'app, riducendo le chiamate telefoniche e ottimizzando l'agenda. Il sistema invia promemoria automatici via SMS o email.

La gestione dell'inventario di occhiali e lenti a contatto per le ottiche di ${data.displayName} è completamente automatizzata. Il sistema traccia le scorte, avvisa quando i prodotti stanno per esaurirsi, gestisce ordini ai fornitori e calcola automaticamente i margini di guadagno per ogni prodotto.

La fatturazione elettronica integrata permette alle ottiche di ${data.displayName} di emettere fatture elettroniche conformi alle normative vigenti, gestire note di credito e debito, e mantenere tutti i documenti fiscali organizzati digitalmente. L'integrazione con i sistemi contabili semplifica la gestione amministrativa.

I programmi di loyalty personalizzati per le ottiche di ${data.displayName} aumentano la fidelizzazione dei clienti, permettendo di accumulare punti ad ogni acquisto, ricevere sconti esclusivi e partecipare a promozioni speciali. L'app clienti rende l'esperienza fluida e coinvolgente.

L'app mobile per clienti che sviluppiamo per le ottiche di ${data.displayName} permette ai pazienti di prenotare visite, consultare la propria cartella clinica, ricevere promemoria per controlli periodici, visualizzare la storia degli acquisti e accedere a promozioni esclusive.

L'analisi delle vendite tramite dashboard intuitive permette agli ottici di ${data.displayName} di monitorare performance, identificare i prodotti più venduti, analizzare i trend stagionali e prendere decisioni basate sui dati. I report automatici facilitano la gestione finanziaria e la pianificazione degli acquisti.

Le strategie di marketing digitale che implementiamo per le ottiche di ${data.displayName} includono campagne email personalizzate, promozioni mirate basate sul comportamento dei clienti, gestione social media automatizzata e programmi di referral per acquisire nuovi clienti.

Il CRM integrato per le ottiche di ${data.displayName} gestisce tutte le interazioni con i clienti, dalle prime visite ai follow-up, permettendo di programmare richiami automatici per controlli periodici e di mantenere una comunicazione costante con la propria clientela.`

  return (
    <main className="min-h-screen bg-[var(--background)]">
      <SEOHead
        title={title}
        description={description}
        keywords={data.keywords}
        canonical={canonical}
        page={`ottica-${citta}`}
      />
      <RegionalStructuredData
        settore="ottica"
        citta={citta}
        serviceName={`Soluzioni Software e AI per Ottica a ${data.displayName}`}
        serviceDescription={description}
      />
      <Navigation />
      
      <div className="hidden md:block h-16" />
      <div className="md:hidden h-14" />

      <section className="py-16 px-4 bg-gradient-to-b from-[var(--background)] to-[var(--background-secondary)]">
        <div className="container mx-auto max-w-6xl">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center mb-12"
          >
            <h1 className="text-4xl md:text-5xl font-bold mb-4 text-[var(--text-primary)]">
              Soluzioni Software e AI per Ottica a {data.displayName}
            </h1>
            <p className="text-lg text-[var(--text-secondary)] max-w-3xl mx-auto">
              Sistemi innovativi per gestire clienti, prenotazioni, inventario e marketing del tuo negozio ottico a {data.displayName}
            </p>
          </motion.div>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="container mx-auto max-w-6xl">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
            {[
              { icon: Eye, title: 'Gestione Clienti', desc: 'CRM completo con cartelle cliniche e storia acquisti' },
              { icon: Calendar, title: 'Prenotazioni Visite', desc: 'Sistema prenotazioni online con promemoria automatici' },
              { icon: ShoppingBag, title: 'Inventario Occhiali', desc: 'Gestione scorte e ordini automatizzata' },
              { icon: CreditCard, title: 'Fatturazione Elettronica', desc: 'Emissione fatture conformi alle normative' },
              { icon: Users, title: 'Loyalty Program', desc: 'Programmi fedeltà personalizzati per clienti' },
              { icon: BarChart3, title: 'Analisi Vendite', desc: 'Dashboard con report dettagliati e trend' }
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
      <RegionalNavigation settore="ottica" currentCitta={citta} />

      <div className="md:hidden h-20" />
    </main>
  )
}

