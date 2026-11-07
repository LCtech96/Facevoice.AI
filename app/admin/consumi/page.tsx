import type { Metadata } from 'next'
import { Suspense } from 'react'
import Navigation from '@/components/Navigation'
import ConsumiClient from './ConsumiClient'

export const metadata: Metadata = { title: 'Consumi · Facevoice AI', robots: { index: false } }

// Consumi reali (Google, Anthropic, utenti della beta, sito). Solo admin:
// la pagina controlla l'accesso, l'API lo controlla di nuovo sul server.
export default function ConsumiPage() {
  return (
    <main className="min-h-screen bg-[var(--background)] overflow-x-hidden">
      <Navigation />
      <Suspense>
        <ConsumiClient />
      </Suspense>
    </main>
  )
}
