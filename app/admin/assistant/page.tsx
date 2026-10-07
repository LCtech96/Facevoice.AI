import type { Metadata } from 'next'
import Navigation from '@/components/Navigation'
import SuperChat from './SuperChat'

export const metadata: Metadata = { title: 'Super chat · Facevoice AI', robots: { index: false } }

export default function AssistantPage() {
  return (
    <main className="min-h-[100dvh] bg-[var(--background)]">
      <Navigation />
      <SuperChat />
    </main>
  )
}
