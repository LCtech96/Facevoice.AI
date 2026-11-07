import type { Metadata } from 'next'
import Link from 'next/link'
import Navigation from '@/components/Navigation'
import TermsDocument from '@/components/terms/TermsDocument'
import { SITE_URL } from '@/lib/seo/site'
import { CURRENT_TERMS, TERMS_PATH, TERMS_TITLE, TERMS_VERSION, termsVersions, versionDateLabel } from '@/lib/terms'

// Termini e condizioni in vigore (lib/terms.ts). Le versioni precedenti restano, identiche,
// a /termini/<versione>.

export const metadata: Metadata = {
  title: `${TERMS_TITLE} | Facevoice AI`,
  description:
    "Termini e condizioni d'uso della piattaforma Facevoice AI per imprese e professionisti: servizio, responsabilità, intelligenza artificiale, documenti, contratti e firma elettronica, dati personali.",
  alternates: { canonical: `${SITE_URL}${TERMS_PATH}` },
  openGraph: { url: `${SITE_URL}${TERMS_PATH}`, type: 'website', siteName: 'Facevoice AI' },
}

const link = 'text-[var(--accent-blue)] hover:underline'

export default function TermsPage() {
  const older = termsVersions().filter((v) => v !== TERMS_VERSION).reverse()
  return (
    <main className="theme-ember min-h-screen bg-[var(--background)]">
      <Navigation />
      <div className="max-w-3xl mx-auto px-5 pt-28 pb-24">
        <TermsDocument terms={CURRENT_TERMS} />
        <p className="mt-10 text-sm text-[var(--text-secondary)]">
          Link fisso a questa versione:{' '}
          <Link href={`${TERMS_PATH}/${TERMS_VERSION}`} className={link}>
            {TERMS_PATH}/{TERMS_VERSION}
          </Link>
        </p>
        {older.length > 0 && (
          <section className="mt-6 text-sm text-[var(--text-secondary)]">
            <h2 className="font-semibold text-[var(--text-primary)]">Versioni precedenti</h2>
            <ul className="mt-2 space-y-1">
              {older.map((v) => (
                <li key={v}>
                  <Link href={`${TERMS_PATH}/${v}`} className={link}>
                    Versione del {versionDateLabel(v)}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  )
}
