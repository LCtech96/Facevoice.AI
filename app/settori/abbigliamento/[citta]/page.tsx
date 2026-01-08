'use client'

import { useParams } from 'next/navigation'
import Navigation from '@/components/Navigation'
import SEOHead from '@/components/SEO/SEOHead'
import RegionalStructuredData from '@/components/SEO/RegionalStructuredData'
import RegionalNavigation from '@/components/SEO/RegionalNavigation'
import { motion } from 'framer-motion'
import { Shirt, ShoppingCart, Package, TrendingUp, Users, Smartphone } from 'lucide-react'

const cittaData = {
  palermo: {
    name: 'Palermo',
    displayName: 'Palermo',
    keywords: [
      'software abbigliamento Palermo',
      'e-commerce abbigliamento Palermo',
      'gestione magazzino abbigliamento Palermo',
      'inventario taglie Palermo',
      'app mobile abbigliamento Palermo',
      'loyalty program abbigliamento Palermo',
      'analisi vendite abbigliamento Palermo',
      'marketing digitale abbigliamento Palermo',
      'POS abbigliamento Palermo',
      'CRM abbigliamento Palermo'
    ]
  },
  catania: {
    name: 'Catania',
    displayName: 'Catania',
    keywords: [
      'software abbigliamento Catania',
      'e-commerce abbigliamento Catania',
      'gestione magazzino abbigliamento Catania',
      'inventario taglie Catania',
      'app mobile abbigliamento Catania',
      'loyalty program abbigliamento Catania',
      'analisi vendite abbigliamento Catania',
      'marketing digitale abbigliamento Catania',
      'POS abbigliamento Catania',
      'CRM abbigliamento Catania'
    ]
  },
  trapani: {
    name: 'Trapani',
    displayName: 'Trapani',
    keywords: [
      'software abbigliamento Trapani',
      'e-commerce abbigliamento Trapani',
      'gestione magazzino abbigliamento Trapani',
      'inventario taglie Trapani',
      'app mobile abbigliamento Trapani',
      'loyalty program abbigliamento Trapani',
      'analisi vendite abbigliamento Trapani',
      'marketing digitale abbigliamento Trapani',
      'POS abbigliamento Trapani',
      'CRM abbigliamento Trapani'
    ]
  }
}

export default function AbbigliamentoPage() {
  const params = useParams()
  const cittaParam = (params?.citta as string) || 'palermo'
  const citta = (cittaParam.toLowerCase() as 'palermo' | 'catania' | 'trapani') || 'palermo'
  const data = cittaData[citta] || cittaData.palermo

  const title = `Soluzioni Software e AI per Abbigliamento a ${data.displayName} | Facevoice AI`
  const description = `Sviluppo software personalizzato per negozi abbigliamento a ${data.displayName}. E-commerce, gestione magazzino, inventario taglie, app mobile, loyalty program, analisi vendite e marketing digitale. Soluzioni AI per ottimizzare la gestione del tuo negozio di abbigliamento a ${data.displayName}.`
  const canonical = `https://www.facevoice.ai/settori/abbigliamento/${citta}`

  const content = `Facevoice AI sviluppa soluzioni software innovative e personalizzate per il settore dell'abbigliamento a ${data.displayName}. La nostra piattaforma integrata permette ai negozi di abbigliamento siciliani di gestire e-commerce, magazzino, inventario e marketing in modo efficiente e moderno.

Il sistema e-commerce che creiamo per i negozi di abbigliamento di ${data.displayName} consente di vendere online con un'interfaccia moderna e intuitiva. L'integrazione con i sistemi di magazzino permette di mostrare disponibilità in tempo reale, gestire taglie e colori, e sincronizzare automaticamente gli ordini online con il punto vendita fisico.

La gestione del magazzino per negozi di abbigliamento a ${data.displayName} è completamente automatizzata. Il sistema traccia ogni capo per taglia, colore e modello, avvisa quando le scorte stanno per esaurirsi, gestisce ordini ai fornitori e calcola automaticamente i margini di guadagno. L'inventario è sincronizzato tra negozio fisico e e-commerce.

L'inventario taglie intelligente che sviluppiamo per i negozi di abbigliamento di ${data.displayName} permette di monitorare la disponibilità per ogni combinazione taglia-colore-modello. Il sistema suggerisce automaticamente alternative quando un prodotto non è disponibile nella taglia richiesta, aumentando le possibilità di vendita.

L'app mobile personalizzata per i negozi di abbigliamento di ${data.displayName} permette ai clienti di sfogliare il catalogo, ricevere notifiche su nuove collezioni e promozioni, prenotare capi per la prova in negozio, e accedere a sconti esclusivi. L'app può includere anche funzionalità di realtà aumentata per provare virtualmente gli abiti.

I programmi di loyalty personalizzati per i negozi di abbigliamento di ${data.displayName} aumentano la fidelizzazione dei clienti, permettendo di accumulare punti ad ogni acquisto, ricevere sconti esclusivi, accedere a preview di nuove collezioni e partecipare a eventi speciali. Il sistema ricorda le preferenze e suggerisce prodotti simili.

L'analisi delle vendite tramite dashboard intuitive permette ai negozi di abbigliamento di ${data.displayName} di monitorare performance, identificare i capi più venduti per taglia e colore, analizzare i trend stagionali, e prendere decisioni basate sui dati per ottimizzare gli acquisti e le promozioni.

Le strategie di marketing digitale che implementiamo per i negozi di abbigliamento di ${data.displayName} includono campagne email personalizzate basate sulle preferenze dei clienti, promozioni mirate per collezioni specifiche, gestione social media automatizzata con pubblicazione automatica di nuovi prodotti, e programmi di referral per acquisire nuovi clienti.

Il sistema POS integrato per i negozi di abbigliamento di ${data.displayName} gestisce vendite in negozio, sincronizza automaticamente con l'inventario, applica sconti e promozioni, gestisce resi e cambi taglia, e genera report di vendita in tempo reale. L'integrazione con i sistemi contabili semplifica la gestione amministrativa.

Il CRM integrato per i negozi di abbigliamento di ${data.displayName} gestisce tutte le interazioni con i clienti, dalle prime visite agli acquisti ricorrenti, permettendo di programmare promozioni personalizzate, ricordare compleanni e occasioni speciali, e mantenere una comunicazione costante con la propria clientela per aumentare le vendite.`

  return (
    <main className="min-h-screen bg-[var(--background)]">
      <SEOHead
        title={title}
        description={description}
        keywords={data.keywords}
        canonical={canonical}
        page={`abbigliamento-${citta}`}
      />
      <RegionalStructuredData
        settore="abbigliamento"
        citta={citta}
        serviceName={`Soluzioni Software e AI per Abbigliamento a ${data.displayName}`}
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
              Soluzioni Software e AI per Abbigliamento a {data.displayName}
            </h1>
            <p className="text-lg text-[var(--text-secondary)] max-w-3xl mx-auto">
              Sistemi innovativi per gestire e-commerce, magazzino, inventario e marketing del tuo negozio di abbigliamento a {data.displayName}
            </p>
          </motion.div>
        </div>
      </section>

      <section className="py-16 px-4">
        <div className="container mx-auto max-w-6xl">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
            {[
              { icon: ShoppingCart, title: 'E-commerce', desc: 'Piattaforma vendita online integrata con negozio fisico' },
              { icon: Package, title: 'Gestione Magazzino', desc: 'Tracciamento scorte per taglia, colore e modello' },
              { icon: Shirt, title: 'Inventario Taglie', desc: 'Sistema intelligente per gestione taglie e colori' },
              { icon: Smartphone, title: 'App Mobile', desc: 'App personalizzata per clienti con notifiche e promozioni' },
              { icon: Users, title: 'Loyalty Program', desc: 'Programmi fedeltà personalizzati per aumentare vendite' },
              { icon: TrendingUp, title: 'Analisi Vendite', desc: 'Dashboard con report dettagliati e trend stagionali' }
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

      <RegionalNavigation settore="abbigliamento" currentCitta={citta} />

      <div className="md:hidden h-20" />
    </main>
  )
}

