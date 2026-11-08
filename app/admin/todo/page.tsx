import type { Metadata } from 'next'
import Navigation from '@/components/Navigation'
import TodoAdminClient from './TodoAdminClient'

export const metadata: Metadata = { title: 'Todo · Facevoice AI', robots: { index: false, follow: false } }

// Todo list condivise: solo l'admin (la pagina controlla l'accesso, l'API lo ricontrolla).
export default function TodoAdminPage() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-[var(--background)]">
      <Navigation />
      <TodoAdminClient />
    </main>
  )
}
