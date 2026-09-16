import Link from 'next/link'
import Navigation from '@/components/Navigation'
import {
  BreadcrumbJsonLd,
  FaqJsonLd,
  ServiceJsonLd,
  type FaqItem,
} from '@/components/SEO/JsonLd'
import { ORG, SITE_URL, SICILY_CITIES } from '@/lib/seo/site'
import {
  AUDIENCE,
  CAPABILITIES,
  DIFFERENTIATORS,
} from '@/lib/seo/property-management'

/**
 * Impaginazione condivisa fra la pagina del settore e le pagine citta'.
 *
 * E' un componente server di proposito: il testo deve stare nell'HTML
 * iniziale. Se fosse reso dal client, i crawler dei motori generativi
 * troverebbero una pagina vuota.
 */
export default function VerticalPage({
  cityName,
  intro,
  faq,
  canonicalPath,
}: {
  cityName?: string
  intro: string
  faq: FaqItem[]
  canonicalPath: string
}) {
  const url = `${SITE_URL}${canonicalPath}`
  const areaName = cityName ?? 'Sicilia'
  const heading = cityName
    ? `Software e AI per property management e affitti brevi a ${cityName}`
    : 'Software e AI per property management e affitti brevi in Sicilia'

  return (
    <main className="min-h-screen bg-[var(--background)]">
      {/* L'entita' azienda e' gia' nel layout: qui basta riferirla
          tramite il suo @id, che ServiceJsonLd usa come provider. */}
      <ServiceJsonLd
        name={heading}
        description={intro}
        url={url}
        areaName={areaName}
      />
      <FaqJsonLd items={faq} url={url} />
      <BreadcrumbJsonLd
        items={[
          { name: 'Home', url: `${SITE_URL}/home` },
          {
            name: 'Property management',
            url: `${SITE_URL}/settori/property-management`,
          },
          ...(cityName ? [{ name: cityName, url }] : []),
        ]}
      />

      <Navigation />

      <div className="max-w-3xl mx-auto px-5 pt-28 pb-20">
        <article>
          <h1 className="text-3xl md:text-4xl font-bold text-[var(--text-primary)] leading-tight">
            {heading}
          </h1>

          {/* Prima frase in chiaro: e' quella che un motore generativo
              cita quando deve dire chi siamo e cosa facciamo. */}
          <p className="mt-5 text-lg text-[var(--text-secondary)] leading-relaxed">
            {intro}
          </p>

          <section className="mt-12">
            <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-5">
              Che cosa sviluppiamo
            </h2>
            <div className="space-y-5">
              {CAPABILITIES.map((item) => (
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
              {AUDIENCE.map((item) => (
                <li
                  key={item}
                  className="text-[var(--text-secondary)] leading-relaxed pl-5 relative before:content-['—'] before:absolute before:left-0 before:text-[var(--accent-blue)]"
                >
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-12">
            <h2 className="text-2xl font-semibold text-[var(--text-primary)] mb-5">
              Come lavoriamo
            </h2>
            <div className="space-y-5">
              {DIFFERENTIATORS.map((item) => (
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
              {ORG.name} ha sede a {ORG.city} e segue property manager e
              agenzie immobiliari in tutta la Sicilia.
            </p>
            <div className="flex flex-wrap gap-2">
              {SICILY_CITIES.map((city) => (
                <Link
                  key={city.slug}
                  href={`/settori/property-management/${city.slug}`}
                  className="px-3 py-1.5 text-sm rounded-lg border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--accent-blue)] hover:border-[var(--accent-blue)] transition-colors"
                >
                  {city.name}
                </Link>
              ))}
            </div>
          </section>

          <section className="mt-12 p-6 rounded-2xl border border-[var(--border-color)] bg-[var(--card-background)]">
            <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-2">
              Parliamone
            </h2>
            <p className="text-[var(--text-secondary)] leading-relaxed">
              La prima analisi del processo è gratuita: si guarda dove se ne
              vanno le ore e si dice con franchezza se l’automazione conviene
              o no.
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
              <a
                href={`tel:${ORG.phone.replace(/\s/g, '')}`}
                className="px-4 py-2 rounded-lg border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--background-secondary)] transition-colors"
              >
                {ORG.phone}
              </a>
            </div>
          </section>
        </article>
      </div>
    </main>
  )
}
