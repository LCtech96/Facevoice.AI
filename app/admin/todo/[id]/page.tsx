import type { Metadata } from 'next'
import Navigation from '@/components/Navigation'
import AdminBoardClient from './AdminBoardClient'

export const metadata: Metadata = { title: 'Todo · Facevoice AI', robots: { index: false, follow: false } }

export default async function TodoAdminBoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <main className="min-h-screen overflow-x-hidden bg-[var(--background)]">
      <Navigation />
      <AdminBoardClient id={id} />
    </main>
  )
}
