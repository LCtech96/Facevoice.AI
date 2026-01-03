import type { Metadata } from 'next'
import { Montserrat } from 'next/font/google'
import './globals.css'
import AIChatWidget from '@/components/AIChatWidget'

const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800', '900'],
  variable: '--font-montserrat',
})

export const metadata: Metadata = {
  title: 'Facevoice AI - Advanced AI Solutions',
  description: 'AI Integration, Blockchain Development, and Technical Consulting',
  icons: {
    icon: '/Trinacria.jpg',
    shortcut: '/Trinacria.jpg',
    apple: '/Trinacria.jpg',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="it" className="dark">
      <head>
        <link rel="icon" href="/Trinacria.jpg" type="image/jpeg" />
        <link rel="shortcut icon" href="/Trinacria.jpg" type="image/jpeg" />
        <link rel="apple-touch-icon" href="/Trinacria.jpg" />
      </head>
      <body className={montserrat.className}>
        {children}
        <AIChatWidget />
      </body>
    </html>
  )
}

