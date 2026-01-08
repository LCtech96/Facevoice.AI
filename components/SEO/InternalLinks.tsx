'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

const internalLinks = [
  {
    keyword: 'Sviluppo software su misura per automazione aziendale a Palermo',
    href: '/services',
    anchor: 'automazione-aziendale'
  },
  {
    keyword: 'Integrazione intelligenza artificiale per gestione magazzino e-commerce',
    href: '/services',
    anchor: 'ai-ecommerce'
  },
  {
    keyword: 'Consulenza SEO per e-commerce Shopify e WooCommerce',
    href: '/services',
    anchor: 'seo-ecommerce'
  },
  {
    keyword: 'Creazione chatbot AI personalizzati per assistenza clienti h24',
    href: '/services',
    anchor: 'chatbot-ai'
  },
  {
    keyword: 'Ottimizzazione velocità di caricamento per siti e-commerce professionali',
    href: '/services',
    anchor: 'ottimizzazione-performance'
  },
  {
    keyword: 'Sviluppo algoritmi di machine learning per analisi dati aziendali',
    href: '/services',
    anchor: 'machine-learning'
  },
  {
    keyword: 'Soluzioni software in cloud per la digitalizzazione delle imprese siciliane',
    href: '/services',
    anchor: 'cloud-digitalizzazione'
  },
  {
    keyword: 'Restyling sito web e-commerce per migliorare il tasso di conversione',
    href: '/case-studies',
    anchor: 'restyling-ecommerce'
  },
  {
    keyword: 'Implementazione sistemi di pagamento sicuri per shop online',
    href: '/services',
    anchor: 'pagamenti-sicuri'
  },
  {
    keyword: 'Sviluppo applicazioni web progressive (PWA) con tecnologia AI',
    href: '/services',
    anchor: 'pwa-ai'
  }
]

export default function InternalLinks() {
  return (
    <section className="container mx-auto px-4 py-12 max-w-6xl">
      <div className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-xl p-6 md:p-8">
        <h2 className="text-2xl md:text-3xl font-bold text-[var(--text-primary)] mb-6">
          Servizi Correlati
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {internalLinks.map((link, index) => (
            <Link
              key={index}
              href={`${link.href}#${link.anchor}`}
              className="group flex items-start gap-3 p-4 bg-[var(--background-secondary)] hover:bg-[var(--background)] rounded-lg transition-all border border-transparent hover:border-[var(--border-color)]"
            >
              <ArrowRight className="w-5 h-5 text-[var(--accent-blue)] mt-0.5 group-hover:translate-x-1 transition-transform flex-shrink-0" />
              <span className="text-sm text-[var(--text-primary)] group-hover:text-[var(--accent-blue)] transition-colors leading-relaxed">
                {link.keyword}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}

