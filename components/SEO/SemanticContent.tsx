'use client'

interface SemanticContentProps {
  page: 'home' | 'services' | 'case-studies' | 'team'
}

const semanticContents: Record<string, string> = {
  home: `Facevoice AI offre soluzioni avanzate di sviluppo software su misura per automazione aziendale a Palermo. Specializzati nell'integrazione di intelligenza artificiale per la gestione magazzino e-commerce, forniamo consulenza SEO per e-commerce Shopify e WooCommerce. I nostri chatbot AI personalizzati garantiscono assistenza clienti h24, mentre ottimizziamo la velocità di caricamento per siti e-commerce professionali. Sviluppiamo algoritmi di machine learning per analisi dati aziendali e soluzioni software in cloud per la digitalizzazione delle imprese siciliane.`,
  
  services: `Sviluppiamo soluzioni software in cloud per la digitalizzazione delle imprese siciliane, offrendo restyling sito web e-commerce per migliorare il tasso di conversione. Implementiamo sistemi di pagamento sicuri per shop online e sviluppiamo applicazioni web progressive (PWA) con tecnologia AI. Automatizziamo i processi di vendita tramite intelligenza artificiale e forniamo consulenza informatica specializzata in e-commerce scalabili. Gestiamo migrazione dati e database per piattaforme software complesse, con analisi predittiva delle vendite tramite modelli di intelligenza artificiale.`,
  
  'case-studies': `Integriamo API personalizzate per software gestionali esistenti e sviluppiamo piattaforme e-learning con tutor basati su AI. Forniamo servizi di cybersecurity e protezione dati per siti e-commerce a Palermo. Progettiamo strategie di marketing automation per e-commerce B2B e sviluppiamo software gestionale per studi professionali e PMI. Ottimizziamo SEO semantica per servizi di intelligenza artificiale, combinando sviluppo software su misura con automazione aziendale avanzata.`,
  
  team: `Il team di Facevoice AI è specializzato in sviluppo software su misura per automazione aziendale a Palermo, con competenze in integrazione intelligenza artificiale per gestione magazzino e-commerce. Offriamo consulenza SEO per e-commerce Shopify e WooCommerce, creando chatbot AI personalizzati per assistenza clienti h24. Il nostro team ottimizza velocità di caricamento per siti e-commerce professionali e sviluppa algoritmi di machine learning per analisi dati aziendali.`
}

export default function SemanticContent({ page }: SemanticContentProps) {
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      <div className="text-sm text-[var(--text-secondary)] leading-relaxed opacity-80">
        {semanticContents[page]}
      </div>
    </div>
  )
}

