import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: "Facevoice AI | Sviluppo software e integrazioni AI per PMI",
  description: "Facevoice AI sviluppa software su misura e integra l'intelligenza artificiale nelle piccole e medie imprese: gestionali, app, automazioni e assistenti AI. Sede a Terrasini (Palermo), clienti in tutta Italia.",
  keywords: [
    'sviluppo software su misura Palermo',
    'automazione aziendale Palermo',
    'intelligenza artificiale e-commerce',
    'gestione magazzino AI',
    'consulenza SEO Shopify',
    'consulenza SEO WooCommerce',
    'chatbot AI personalizzati',
    'assistenza clienti h24',
    'ottimizzazione velocità e-commerce',
    'machine learning analisi dati',
    'soluzioni cloud Sicilia',
    'digitalizzazione imprese',
    'restyling e-commerce',
    'sistemi pagamento sicuri',
    'PWA intelligenza artificiale',
    'marketing automation e-commerce',
    'cybersecurity Palermo',
    'software gestionale PMI'
  ],
  openGraph: {
    title: "Facevoice AI | La tua azienda ha un volto, noi le diamo una voce",
    description: "Sviluppo software su misura e integrazioni di intelligenza artificiale per piccole e medie imprese.",
    url: 'https://www.facevoice.ai',
    siteName: 'Facevoice AI',
    locale: 'it_IT',
    type: 'website',
    images: [
      {
        url: 'https://www.facevoice.ai/Facevoice.png',
        width: 1200,
        height: 630,
        alt: 'Facevoice AI - Sviluppo Software e Integrazione AI',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: "Facevoice AI | La tua azienda ha un volto, noi le diamo una voce",
    description: 'Sviluppo software su misura, integrazione AI e consulenza tecnologica',
    images: ['https://www.facevoice.ai/Facevoice.png'],
  },
  alternates: {
    canonical: 'https://www.facevoice.ai/home',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
}

