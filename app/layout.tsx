import type { Metadata } from 'next'
import { Montserrat } from 'next/font/google'
import './globals.css'

const montserrat = Montserrat({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800', '900'],
  variable: '--font-montserrat',
})

export const metadata: Metadata = {
  title: 'Facevoice AI - Advanced AI Solutions',
  description: 'AI Integration, Blockchain Development, and Technical Consulting',
  icons: {
    icon: '/team/Trinacria.jpg',
    shortcut: '/team/Trinacria.jpg',
    apple: '/team/Trinacria.jpg',
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
        <link rel="icon" href="/team/Trinacria.jpg" type="image/jpeg" />
        <link rel="shortcut icon" href="/team/Trinacria.jpg" type="image/jpeg" />
        <link rel="apple-touch-icon" href="/team/Trinacria.jpg" />
      </head>
      <body className={montserrat.className}>{children}</body>
    </html>
  )
}

