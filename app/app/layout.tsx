import type { Metadata } from 'next'
import AppShell from '@/components/app/AppShell'

export const metadata: Metadata = {
  title: 'Area clienti · Facevoice AI',
  robots: { index: false, follow: false },
  // L'area clienti ha il suo interruttore IT / EN: la traduzione del browser
  // sopra la nostra rompe la pagina, quindi Chrome non deve proporla.
  other: { google: 'notranslate' },
}

export default function ClientAreaLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="theme-ember min-h-[100dvh] bg-[var(--background)] text-[var(--text-primary)]">
      <AppShell>{children}</AppShell>
    </main>
  )
}
