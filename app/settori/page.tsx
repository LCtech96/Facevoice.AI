import type { Metadata } from 'next'
import Link from 'next/link'
import Navigation from '@/components/Navigation'
import { SECTORS } from '@/lib/seo/sectors'
import { ORG, SITE_URL } from '@/lib/seo/site'

export const metadata: Metadata = {
  title: `Settori in cui sviluppiamo software e AI | ${ORG.name}`,
  description:
    'Property management, trasporti e logistica, gestionali, e-commerce, turismo, studi professionali, sanità, manifatturiero, edilizia, agroalimentare e retail: software e automazioni su misura.',
  alternates: { canonical: `${SITE_URL}/settori` },
}

export default function SettoriPage() {
  return (
    <main className="min-h-screen bg-[var(--background)]">
      <Navigation />
      <div className="max-w-3xl mx-auto px-5 pt-28 pb-20">
        <h1 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)]">
          I settori in cui lavoriamo
        </h1>
        <p className="mt-5 text-lg text-[var(--text-secondary)] leading-relaxed">
          {ORG.oneLiner} Ogni settore ha problemi suoi: qui trovi cosa
          sviluppiamo per ciascuno, con esempi concreti invece di elenchi di
          tecnologie.
        </p>

        <div className="mt-10 space-y-3">
          {SECTORS.map((sector) => (
            <Link
              key={sector.slug}
              href={`/settori/${sector.slug}`}
              className="block p-5 rounded-xl border border-[var(--border-color)] hover:border-[var(--accent-blue)] transition-colors"
            >
              <h2 className="font-semibold text-[var(--text-primary)]">
                {sector.name}
              </h2>
              <p className="text-sm text-[var(--text-secondary)] mt-1 leading-relaxed">
                {sector.metaDescription}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </main>
  )
}
