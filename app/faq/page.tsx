import type { Metadata } from 'next'
import Link from 'next/link'
import Navigation from '@/components/Navigation'
import { FAQ, PRICES, PRICES_NOTE, formatEuro } from '@/lib/faq'
import { ORG, SITE_URL } from '@/lib/seo/site'

export const metadata: Metadata = {
  title: `Domande frequenti | ${ORG.name} – Agenzia digitale a Palermo`,
  description:
    'Cosa fa Facevoice AI e quanto costa: prezzi indicativi per sito vetrina, e-commerce, gestione social, chat AI e software gestionale su misura. Dove lavoriamo e come contattarci.',
  alternates: { canonical: `${SITE_URL}/faq` },
}

// Dati strutturati FAQPage: aiutano Google e gli assistenti AI a citare le risposte.
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQ.map((item) => ({
    '@type': 'Question',
    name: item.question,
    acceptedAnswer: { '@type': 'Answer', text: item.answer },
  })),
}

export default function FaqPage() {
  return (
    <main className="theme-ember min-h-screen bg-[var(--background)]">
      <Navigation />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="max-w-3xl mx-auto px-5 pt-28 pb-20">
        <h1 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)]">Domande frequenti</h1>
        <p className="mt-5 text-lg text-[var(--text-secondary)] leading-relaxed">
          Le risposte alle domande che ci fanno più spesso. Se non trovi quello che cerchi, scrivici.
        </p>

        {/* Prezzi indicativi, sempre visibili */}
        <section className="mt-10 rounded-xl border border-[var(--border-color)] p-5" aria-labelledby="prezzi">
          <h2 id="prezzi" className="text-xl font-semibold text-[var(--text-primary)]">
            Prezzi indicativi
          </h2>
          <ul className="mt-4 divide-y divide-[var(--border-color)]">
            {PRICES.map((p) => (
              <li key={p.service} className="flex items-baseline justify-between gap-4 py-3">
                <span className="text-[var(--text-primary)]">{p.service}</span>
                <span className="shrink-0 text-[var(--text-secondary)]">
                  a partire da <strong className="text-[var(--text-primary)]">{formatEuro(p.from)}</strong>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-[var(--text-secondary)] leading-relaxed">{PRICES_NOTE}</p>
        </section>

        <div className="mt-10 space-y-3">
          {FAQ.map((item) => (
            <details
              key={item.question}
              className="group rounded-xl border border-[var(--border-color)] p-5 open:border-[var(--accent-blue)] transition-colors"
            >
              <summary className="cursor-pointer list-none flex items-start justify-between gap-4 font-semibold text-[var(--text-primary)]">
                <h2 className="text-base">{item.question}</h2>
                <span className="text-[var(--accent-blue)] transition-transform group-open:rotate-45" aria-hidden="true">
                  +
                </span>
              </summary>
              <p className="mt-3 text-[var(--text-secondary)] leading-relaxed">{item.answer}</p>
              {item.links && (
                <div className="mt-3 flex flex-wrap gap-3">
                  {item.links.map((link) => (
                    <Link key={link.href} href={link.href} className="text-sm font-medium text-[var(--accent-blue)]">
                      {link.label} →
                    </Link>
                  ))}
                </div>
              )}
            </details>
          ))}
        </div>
      </div>
    </main>
  )
}
