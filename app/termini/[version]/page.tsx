import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Navigation from '@/components/Navigation'
import TermsDocument from '@/components/terms/TermsDocument'
import { SITE_URL } from '@/lib/seo/site'
import { TERMS_PATH, TERMS_TITLE, termsFor, termsVersions, versionDateLabel } from '@/lib/terms'

// Una versione dei termini, con il testo esatto conservato in lib/terms.ts (mai modificato).
// Serve a mostrare cosa ha accettato chi si e' registrato in quella data.

export const dynamicParams = false

export function generateStaticParams() {
  return termsVersions().map((version) => ({ version }))
}

export async function generateMetadata({ params }: { params: Promise<{ version: string }> }): Promise<Metadata> {
  const { version } = await params
  const terms = termsFor(version)
  if (!terms) return { title: 'Pagina non trovata | Facevoice AI', robots: { index: false, follow: false } }
  return {
    title: `${TERMS_TITLE} · versione del ${versionDateLabel(version)} | Facevoice AI`,
    alternates: { canonical: `${SITE_URL}${TERMS_PATH}/${version}` },
    robots: { index: false, follow: true },
  }
}

export default async function TermsVersionPage({ params }: { params: Promise<{ version: string }> }) {
  const { version } = await params
  const terms = termsFor(version)
  if (!terms) notFound()
  return (
    <main className="theme-ember min-h-screen bg-[var(--background)]">
      <Navigation />
      <div className="max-w-3xl mx-auto px-5 pt-28 pb-24">
        <TermsDocument terms={terms} />
      </div>
    </main>
  )
}
