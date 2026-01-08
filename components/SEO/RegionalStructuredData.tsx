'use client'

interface RegionalStructuredDataProps {
  settore: 'ristorazione' | 'ottica' | 'abbigliamento'
  citta: 'palermo' | 'catania' | 'trapani'
  serviceName: string
  serviceDescription: string
}

const cityData = {
  palermo: {
    name: 'Palermo',
    wikidataId: 'https://www.wikidata.org/wiki/Q90',
    region: 'Sicilia'
  },
  catania: {
    name: 'Catania',
    wikidataId: 'https://www.wikidata.org/wiki/Q90',
    region: 'Sicilia'
  },
  trapani: {
    name: 'Trapani',
    wikidataId: 'https://www.wikidata.org/wiki/Q90',
    region: 'Sicilia'
  }
}

export default function RegionalStructuredData({
  settore,
  citta,
  serviceName,
  serviceDescription
}: RegionalStructuredDataProps) {
  const city = cityData[citta]
  
  const serviceSchema = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    serviceType: `Soluzioni Software e AI per ${settore.charAt(0).toUpperCase() + settore.slice(1)}`,
    provider: {
      '@type': 'Organization',
      name: 'Facevoice AI',
      url: 'https://www.facevoice.ai',
      address: {
        '@type': 'PostalAddress',
        addressLocality: city.name,
        addressRegion: city.region,
        addressCountry: 'IT'
      }
    },
    areaServed: {
      '@type': 'City',
      name: city.name,
      '@id': city.wikidataId
    },
    description: serviceDescription,
    offers: {
      '@type': 'Offer',
      priceCurrency: 'EUR',
      availability: 'https://schema.org/InStock'
    },
    name: serviceName
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceSchema, null, 2) }}
    />
  )
}

