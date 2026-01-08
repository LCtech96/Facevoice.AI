'use client'

interface StructuredDataProps {
  type: 'organization' | 'service' | 'software'
  page?: string
}

export default function StructuredData({ type, page = 'home' }: StructuredDataProps) {
  const baseSchema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Facevoice AI',
    url: 'https://www.facevoice.ai',
    logo: 'https://www.facevoice.ai/Facevoice.png',
    description: 'Sviluppo software su misura, integrazione AI e consulenza tecnologica a Palermo',
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Palermo',
      addressRegion: 'Sicilia',
      addressCountry: 'IT'
    },
    contactPoint: {
      '@type': 'ContactPoint',
      telephone: '+39-351-367-1340',
      contactType: 'customer service',
      email: 'luca@facevoice.ai',
      areaServed: 'IT',
      availableLanguage: ['Italian', 'English']
    },
    areaServed: {
      '@type': 'City',
      name: 'Palermo'
    },
    sameAs: [
      'https://www.facevoice.ai'
    ]
  }

  const serviceSchema = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    serviceType: 'Sviluppo Software e Integrazione AI',
    provider: {
      '@type': 'Organization',
      name: 'Facevoice AI',
      url: 'https://www.facevoice.ai'
    },
    areaServed: {
      '@type': 'City',
      name: 'Palermo',
      '@id': 'https://www.wikidata.org/wiki/Q90'
    },
    description: 'Sviluppo software su misura per automazione aziendale, integrazione intelligenza artificiale per e-commerce, consulenza SEO, chatbot AI personalizzati, ottimizzazione performance siti web, soluzioni cloud per digitalizzazione imprese siciliane',
    offers: {
      '@type': 'Offer',
      priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock'
    },
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: 'Servizi Facevoice AI',
      itemListElement: [
        {
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Service',
            name: 'Sviluppo software su misura per automazione aziendale a Palermo'
          }
        },
        {
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Service',
            name: 'Integrazione intelligenza artificiale per gestione magazzino e-commerce'
          }
        },
        {
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Service',
            name: 'Consulenza SEO per e-commerce Shopify e WooCommerce'
          }
        },
        {
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Service',
            name: 'Creazione chatbot AI personalizzati per assistenza clienti h24'
          }
        },
        {
          '@type': 'Offer',
          itemOffered: {
            '@type': 'Service',
            name: 'Sviluppo applicazioni web progressive (PWA) con tecnologia AI'
          }
        }
      ]
    }
  }

  const softwareSchema = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Facevoice AI Platform',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    description: 'Piattaforma software per automazione aziendale, gestione e-commerce e integrazione AI',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'EUR'
    },
    creator: {
      '@type': 'Organization',
      name: 'Facevoice AI'
    },
    featureList: [
      'Automazione processi aziendali',
      'Gestione magazzino e-commerce',
      'Chatbot AI assistenza clienti',
      'Analisi predittiva vendite',
      'Marketing automation',
      'Integrazione API personalizzate'
    ]
  }

  let schema = baseSchema
  if (type === 'service') {
    schema = serviceSchema as any
  } else if (type === 'software') {
    schema = softwareSchema as any
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema, null, 2) }}
    />
  )
}

