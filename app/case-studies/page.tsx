import type { Metadata } from 'next'
import Link from 'next/link'
import Navigation from '@/components/Navigation'
import { PROJECTS } from '@/lib/seo/projects'
import { ORG, SITE_URL } from '@/lib/seo/site'

export const metadata: Metadata = {
  title: `Progetti realizzati | ${ORG.name}`,
  description:
    'I progetti sviluppati da Facevoice AI: piattaforme per affitti brevi, e-commerce, siti con pannello di amministrazione e assistenti AI integrati.',
  alternates: { canonical: `${SITE_URL}/case-studies` },
}

export default function CaseStudiesPage() {
  return (
    <main className="min-h-screen bg-[var(--background)]">
      <Navigation />
      <div className="max-w-3xl mx-auto px-5 pt-28 pb-20">
        <h1 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)]">
          Progetti realizzati
        </h1>
        <p className="mt-5 text-lg text-[var(--text-secondary)] leading-relaxed">
          Lavori sviluppati da {ORG.name}: cosa serviva, cosa è stato costruito
          e, dove c&apos;è stata, la rassegna stampa.
        </p>

        <div className="mt-10 space-y-3">
          {PROJECTS.map((project) => (
            <Link
              key={project.slug}
              href={`/case-studies/${project.slug}`}
              className="block p-5 rounded-xl border border-[var(--border-color)] hover:border-[var(--accent-blue)] transition-colors"
            >
              <div className="flex items-baseline gap-2 flex-wrap">
                <h2 className="font-semibold text-[var(--text-primary)]">
                  {project.name}
                </h2>
                {project.location && (
                  <span className="text-xs text-[var(--text-secondary)]">
                    {project.location}
                  </span>
                )}
                {project.inProgress && (
                  <span className="text-xs px-2 py-0.5 rounded-full border border-[var(--border-color)] text-[var(--text-secondary)]">
                    in sviluppo
                  </span>
                )}
              </div>
              <p className="text-sm text-[var(--text-secondary)] mt-1 leading-relaxed">
                {project.summary}
              </p>
              {project.press && project.press.length > 0 && (
                <p className="text-xs text-[var(--accent-blue)] mt-2">
                  {project.press.length} articoli sulla stampa
                </p>
              )}
            </Link>
          ))}
        </div>
      </div>
    </main>
  )
}
