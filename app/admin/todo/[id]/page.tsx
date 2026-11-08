import type { Metadata } from 'next'
import Navigation from '@/components/Navigation'
import AdminBoardClient from './AdminBoardClient'

export const metadata: Metadata = { title: 'Progetto · Facevoice AI', robots: { index: false, follow: false } }

export default async function TodoAdminBoardPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string | string[] }> }) {
  const { id } = await params
  const { t } = await searchParams
  return (
    <main className="min-h-screen overflow-x-hidden bg-[var(--background)]">
      <Navigation />
      <AdminBoardClient id={id} task={typeof t === 'string' ? t : null} />
    </main>
  )
}
