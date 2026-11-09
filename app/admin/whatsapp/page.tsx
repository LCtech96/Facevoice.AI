import type { Metadata } from 'next'
import Navigation from '@/components/Navigation'
import WhatsAppClient from './WhatsAppClient'

export const metadata: Metadata = { title: 'Campagne WhatsApp · Facevoice AI', robots: { index: false } }

// Campagne WhatsApp (solo admin): contattabili con consenso, modelli, campagne e costi.
// La pagina controlla l'accesso, l'API lo controlla di nuovo sul server.
export default function WhatsAppPage() {
  return (
    <main className="min-h-screen bg-[var(--background)] overflow-x-hidden">
      <Navigation />
      <WhatsAppClient />
    </main>
  )
}
