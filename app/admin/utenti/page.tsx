import type { Metadata } from 'next'
import { Suspense } from 'react'
import Navigation from '@/components/Navigation'
import UtentiClient from './UtentiClient'

export const metadata: Metadata = { title: 'Utenti · Facevoice AI', robots: { index: false } }

// Utenti iscritti alla beta (beta.facevoice.ai) e i loro consumi AI. Solo admin:
// la pagina controlla l'accesso, l'API lo controlla di nuovo sul server.
export default function UtentiPage() {
  return (
    <main className="min-h-screen bg-[var(--background)] overflow-x-hidden">
      <Navigation />
      <Suspense>
        <UtentiClient />
      </Suspense>
    </main>
  )
}
