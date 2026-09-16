import Link from 'next/link'
import Navigation from '@/components/Navigation'
import {
  BreadcrumbJsonLd,
  FaqJsonLd,
  ServiceJsonLd,
} from '@/components/SEO/JsonLd'
import { ORG, SITE_URL, SICILY_CITIES } from '@/lib/seo/site'
import type { Sector } from '@/lib/seo/sectors'
import { projectsForSector } from '@/lib/seo/projects'

/**
 * Pagina di settore, renderizzata lato server.
 *
 * Deve restare un componente server: i crawler dei motori generativi in
 * gran parte non eseguono JavaScript, quindi una pagina costruita dal
 * client per loro e' vuota.
 */
export default function SectorPage({
  sector,
  cityName,
}: {
  sector: Sector
  cityName?: string
}) {
  const path = cityName
    ? `/settori/${sector.slug}/${cityName.toLowerCase().replace(/[^a-z]/g, '')}`
    : `/settori/${sector.slug}`
  const url = `${SITE_URL}${path}`
  const heading = cityName ? `${sector.heading} a ${cityName}` : sector.heading
  const faq = cityName && sector.faqForCity ? sector.faqForCity(cityName) : sector.faq
  const projects = projectsForSector(sector.slug)

  return (
    <main className="min-h-screen bg-[var(--background)]">
      <ServiceJsonLd
        name={heading}
        description={sector.intro}
        url={url}
        areaName={cityName ?? 'Sicilia'}
      />
      <FaqJsonLd items={faq} url={url} />
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', url: `${SITE_URL}/home` },
          { name: 'Settori', url: `${SITE_URL}/settori` },
          { name: sector.name, url: `${SITE_URL}/settori/${sector.slug}` },
          ...(cityName ? [{ name: cityName, url }] : []),
        ]}
      />

      <Navigation />

      <div className="max-w-3xl mx-auto px-5 pt-28 pb-20">
        <article>
          <h1 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)] leading-tight">
            {heading}
          </h1>

          <p className="mt-5 text-lg text-[var(--text-secondary)] leading-relaxed">
            {sector.intro}
          </p>

          {sector.problems && sector.problems.length > 0 && (
            <section className="mt-12">
              <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-4">
                I problemi da cui si parte
              </h2>
              <ul className="space-y-2">
                {sector.problems.map((item) => (
                  <li
                    key={item}
                    className="text-[var(--text-secondary)] leading-relaxed pl-5 relative before:content-['—'] before:absolute before:left-0 before:text-[var(--accent-blue)]"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="mt-12">
            <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-5">
              Che cosa sviluppiamo
            </h2>
            <div className="space-y-5">
              {sector.capabilities.map((item) => (
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

          <section className="mt-12">
            <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-4">
              Per chi lavoriamo
            </h2>
            <ul className="space-y-2">
              {sector.audience.map((item) => (
                <li
                  key={item}
                  className="text-[var(--text-secondary)] leading-relaxed pl-5 relative before:content-['—'] before:absolute before:left-0 before:text-[var(--accent-blue)]"
                >
                  {item}
                </li>
              ))}
            </ul>
          </section>

          {projects.length > 0 && (
            <section className="mt-12">
              <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-4">
                Progetti realizzati in questo settore
              </h2>
              <div className="space-y-3">
                {projects.map((project) => (
                  <Link
                    key={project.slug}
                    href={`/case-studies/${project.slug}`}
                    className="block p-4 rounded-xl border border-[var(--border-color)] hover:border-[var(--accent-blue)] transition-colors"
                  >
                    <span className="font-semibold text-[var(--text-primary)]">
                      {project.name}
                    </span>
                    <span className="block text-sm text-[var(--text-secondary)] mt-1">
                      {project.summary}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section className="mt-12">
            <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-5">
              Domande frequenti
            </h2>
            <div className="space-y-6">
              {faq.map((item) => (
                <div key={item.question}>
                  <h3 className="font-semibold text-[var(--text-primary)]">
                    {item.question}
                  </h3>
                  <p className="text-[var(--text-secondary)] leading-relaxed mt-1">
                    {item.answer}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-12">
            <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-4">
              Dove operiamo
            </h2>
            <p className="text-[var(--text-secondary)] leading-relaxed mb-4">
              {ORG.name} ha sede a {ORG.city}, in provincia di {ORG.province}, e
              segue clienti in tutta la Sicilia e nel resto d&apos;Italia.
            </p>
            {sector.hasCities && (
              <div className="flex flex-wrap gap-2">
                {SICILY_CITIES.map((city) => (
                  <Link
                    key={city.slug}
                    href={`/settori/${sector.slug}/${city.slug}`}
                    className="px-3 py-1.5 text-sm rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--accent-blue)] hover:border-[var(--accent-blue)] transition-colors"
                  >
                    {city.name}
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="mt-12 p-6 rounded-2xl border border-[var(--border-color)] bg-[var(--card-background)]">
            <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-2">
              Parliamone
            </h2>
            <p className="text-[var(--text-secondary)] leading-relaxed">
              La prima analisi del processo è gratuita: si guarda dove se ne
              vanno le ore e si dice con franchezza se l&apos;automazione
              conviene o no.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href="/bookings"
                className="px-4 py-2 rounded-lg bg-[var(--accent-blue)] text-white font-medium hover:opacity-90 transition-opacity"
              >
                Prenota una consulenza
              </Link>
              <a
                href={`mailto:${ORG.email}`}
                className="px-4 py-2 rounded-lg border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--background-secondary)] transition-colors"
              >
                {ORG.email}
              </a>
            </div>
          </section>
        </article>
      </div>
    </main>
  )
}
