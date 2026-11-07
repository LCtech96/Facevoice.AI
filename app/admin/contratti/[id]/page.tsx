import type { Metadata } from 'next'
import { Suspense } from 'react'
import Navigation from '@/components/Navigation'
import ContrattoClient from './ContrattoClient'

export const metadata: Metadata = { title: 'Contratto · Facevoice AI', robots: { index: false, follow: false } }

export default async function ContrattoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <main className="min-h-screen overflow-x-hidden bg-[var(--background)]">
      <Navigation />
      <Suspense>
        <ContrattoClient id={id} />
      </Suspense>
    </main>
  )
}
