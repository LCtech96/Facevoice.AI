import type { Metadata } from 'next'
import AppShell from '@/components/app/AppShell'

export const metadata: Metadata = {
  title: 'Area clienti · Facevoice AI',
  robots: { index: false, follow: false },
}

export default function ClientAreaLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="theme-ember min-h-[100dvh] bg-[var(--background)] text-[var(--text-primary)]">
      <AppShell>{children}</AppShell>
    </main>
  )
}
