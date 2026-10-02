import type { Metadata } from 'next'
import { Montserrat } from 'next/font/google'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'
import './globals.css'
import AIChatWidget from '@/components/AIChatWidget'
import ContactsFooter from '@/components/ContactsFooter'
import RecoveryRedirect from '@/components/RecoveryRedirect'
import {
  OrganizationJsonLd,
  ProjectsJsonLd,
  WebSiteJsonLd,
} from '@/components/SEO/JsonLd'
import { SITE_URL } from '@/lib/seo/site'
import { LanguageProvider } from '@/lib/i18n/LanguageContext'

const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800', '900'],
  variable: '--font-montserrat',
})

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  alternates: { canonical: '/' },
  title: 'Facevoice AI | Sviluppo Software e Integrazione AI a Palermo | Automazione Aziendale',
  description: 'Sviluppo software su misura per automazione aziendale a Palermo. Integrazione intelligenza artificiale per gestione magazzino e-commerce, consulenza SEO per Shopify e WooCommerce, chatbot AI personalizzati per assistenza clienti h24. Ottimizzazione velocità siti e-commerce professionali.',
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
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icon-512.png', type: 'image/png', sizes: '512x512' },
    ],
    shortcut: '/icon-180.png',
    apple: { url: '/icon-180.png', sizes: '180x180' },
  },
  // Su iPhone le notifiche push funzionano solo se il sito è aggiunto alla Home come app.
  manifest: '/site.webmanifest',
  appleWebApp: { capable: true, title: 'Facevoice AI', statusBarStyle: 'black-translucent' },
  openGraph: {
    title: 'Facevoice AI | Sviluppo Software e AI a Palermo',
    description: 'Sviluppo software su misura, integrazione AI e consulenza tecnologica per imprese siciliane',
    url: `${SITE_URL}/home`,
    siteName: 'Facevoice AI',
    locale: 'it_IT',
    type: 'website',
    images: [
      {
        url: `${SITE_URL}/Facevoice.png`,
        width: 1200,
        height: 630,
        alt: 'Facevoice AI - Sviluppo Software e Integrazione AI',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Facevoice AI | Sviluppo Software e AI a Palermo',
    description: 'Sviluppo software su misura, integrazione AI e consulenza tecnologica',
    images: [`${SITE_URL}/Facevoice.png`],
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="it" className="dark">
      <body className={montserrat.className}>
        <OrganizationJsonLd />
        <WebSiteJsonLd />
        <ProjectsJsonLd />
        <LanguageProvider>
          <RecoveryRedirect />
          {children}
          <ContactsFooter />
          <AIChatWidget />
          <Analytics />
          <SpeedInsights />
        </LanguageProvider>
      </body>
    </html>
  )
}

