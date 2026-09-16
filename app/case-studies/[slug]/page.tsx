import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { BreadcrumbJsonLd } from '@/components/SEO/JsonLd'
import { PROJECTS, findProject } from '@/lib/seo/projects'
import { ORG_ID } from '@/components/SEO/JsonLd'
import { ORG, SITE_URL } from '@/lib/seo/site'
import { findSector } from '@/lib/seo/sectors'

type Params = { params: Promise<{ slug: string }> }

export function generateStaticParams() {
  return PROJECTS.map((project) => ({ slug: project.slug }))
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const project = findProject(slug)
  if (!project) return {}

  const url = `${SITE_URL}/case-studies/${project.slug}`
  return {
    title: `${project.name} — progetto realizzato da ${ORG.name}`,
    description: project.summary,
    alternates: { canonical: url },
    openGraph: {
      title: `${project.name} — progetto di ${ORG.name}`,
      description: project.description,
      url,
      type: 'article',
    },
  }
}

export default async function Page({ params }: Params) {
  const { slug } = await params
  const project = findProject(slug)
  if (!project) notFound()

  const url = `${SITE_URL}/case-studies/${project.slug}`

  return (
    <main className="min-h-screen bg-[var(--background)]">
      {/* Il progetto dichiarato come opera di Facevoice AI, con gli
          articoli che ne hanno parlato: e' cio' che collega una fonte
          indipendente a chi il lavoro l'ha fatto. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'CreativeWork',
            '@id': `${url}#project`,
            name: project.name,
            url: project.url,
            description: project.description,
            creator: { '@id': ORG_ID },
            ...(project.press?.length
              ? {
                  subjectOf: project.press.map((article) => ({
                    '@type': 'NewsArticle',
                    headline: article.title,
                    url: article.url,
                    publisher: {
                      '@type': 'Organization',
                      name: article.publisher,
                    },
                  })),
                }
              : {}),
          }),
        }}
      />
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', url: `${SITE_URL}/home` },
          { name: 'Progetti', url: `${SITE_URL}/case-studies` },
          { name: project.name, url },
        ]}
      />

      <Navigation />

      <div className="max-w-3xl mx-auto px-5 pt-28 pb-20">
        <article>
          <h1 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)]">
            {project.name}
          </h1>
          {project.location && (
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              {project.location}
            </p>
          )}

          <p className="mt-5 text-lg text-[var(--text-secondary)] leading-relaxed">
            {project.description}
          </p>

          <a
            href={project.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block mt-5 px-4 py-2 rounded-lg bg-[var(--accent-blue)] text-white font-medium hover:opacity-90 transition-opacity"
          >
            Visita {project.name}
          </a>

          {project.highlights.length > 0 && (
            <section className="mt-12">
              <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-5">
                Cosa lo caratterizza
              </h2>
              <div className="space-y-5">
                {project.highlights.map((item) => (
                  <div key={item.title}>
                    <h3 className="font-semibold text-[var(--text-primary)]">
                      {item.title}
                    </h3>
                    <p className="text-[var(--text-secondary)] leading-relaxed mt-1">
                      {item.body}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="mt-12">
            <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-4">
              Funzionalità
            </h2>
            <ul className="space-y-2">
              {project.features.map((feature) => (
                <li
                  key={feature}
                  className="text-[var(--text-secondary)] leading-relaxed pl-5 relative before:content-['—'] before:absolute before:left-0 before:text-[var(--accent-blue)]"
                >
                  {feature}
                </li>
              ))}
            </ul>
          </section>

          {project.press && project.press.length > 0 && (
            <section className="mt-12">
              <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-4">
                Ne hanno parlato
              </h2>
              <div className="space-y-3">
                {project.press.map((article) => (
                  <a
                    key={article.url}
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block p-4 rounded-xl border border-[var(--border-color)] hover:border-[var(--accent-blue)] transition-colors"
                  >
                    <span className="text-xs text-[var(--accent-blue)]">
                      {article.publisher}
                    </span>
                    <span className="block text-[var(--text-primary)] mt-1">
                      {article.title}
                    </span>
                  </a>
                ))}
              </div>
            </section>
          )}

          <section className="mt-12">
            <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-4">
              Settori collegati
            </h2>
            <div className="flex flex-wrap gap-2">
              {project.sectors.map((slug) => {
                const sector = findSector(slug)
                if (!sector) return null
                return (
                  <Link
                    key={slug}
                    href={`/settori/${slug}`}
                    className="px-3 py-1.5 text-sm rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--accent-blue)] hover:border-[var(--accent-blue)] transition-colors"
                  >
                    {sector.name}
                  </Link>
                )
              })}
            </div>
          </section>
        </article>
      </div>
    </main>
  )
}
