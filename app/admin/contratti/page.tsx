import type { Metadata } from 'next'
import { Suspense } from 'react'
import Navigation from '@/components/Navigation'
import ContrattiClient from './ContrattiClient'

export const metadata: Metadata = { title: 'Contratti · Facevoice AI', robots: { index: false, follow: false } }

// Contratti del sito: solo l'admin (la pagina controlla l'accesso, l'API lo ricontrolla).
export default function ContrattiPage() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-[var(--background)]">
      <Navigation />
      <Suspense>
        <ContrattiClient />
      </Suspense>
    </main>
  )
}
