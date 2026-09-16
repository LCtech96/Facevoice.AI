import { GEO, ORG, SITE_URL, SICILY_CITIES } from '@/lib/seo/site'
import { PROJECTS } from '@/lib/seo/projects'

/**
 * Componente server: lo script finisce nell'HTML iniziale, quindi lo
 * vedono anche i crawler che non eseguono JavaScript — cioe' quasi tutti
 * quelli dei motori generativi.
 */
function Script({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  )
}

/**
 * L'entita' azienda, con un @id stabile a cui le altre pagine si
 * riferiscono. Senza un identificatore condiviso, ogni pagina descrive
 * un'azienda diversa che si chiama allo stesso modo.
 */
export const ORG_ID = `${SITE_URL}/#organization`

export function OrganizationJsonLd() {
  return (
    <Script
      data={{
        '@context': 'https://schema.org',
        '@type': 'ProfessionalService',
        '@id': ORG_ID,
        name: ORG.name,
        legalName: ORG.legalName,
        url: ORG.url,
        logo: ORG.logo,
        image: ORG.logo,
        description: ORG.oneLiner,
        email: ORG.email,
        telephone: ORG.phone,
        founder: { '@type': 'Person', name: ORG.founder },
        // Nessun indirizzo civico: la sede e' legale, non aperta al
        // pubblico. Comune, provincia e regione bastano a collocare
        // l'azienda senza promettere un ufficio dove presentarsi.
        address: {
          '@type': 'PostalAddress',
          addressLocality: ORG.city,
          addressRegion: ORG.province,
          addressCountry: ORG.country,
        },
        geo: {
          '@type': 'GeoCoordinates',
          latitude: GEO.latitude,
          longitude: GEO.longitude,
        },
        // L'area servita, non il luogo in cui si sta: e' la risposta
        // alla domanda "quali aziende in Sicilia fanno X".
        areaServed: [
          { '@type': 'Country', name: 'Italia' },
          { '@type': 'AdministrativeArea', name: 'Sicilia' },
          ...SICILY_CITIES.map((city) => ({ '@type': 'City', name: city.name })),
        ],
        // serviceArea dichiara che si opera presso il cliente: e' il
        // modo corretto di descrivere un'attivita' senza sede visitabile.
        serviceArea: [
          { '@type': 'AdministrativeArea', name: 'Sicilia' },
          { '@type': 'Country', name: 'Italia' },
        ],
        knowsAbout: [
          'Intelligenza artificiale applicata alle imprese',
          'Agenti AI e chatbot per assistenza clienti',
          'Automazione della messaggistica',
          'Property management e affitti brevi',
          'Software gestionale su misura',
          'Integrazioni API',
          'Sviluppo full-stack',
          'Blockchain',
        ],
        ...(ORG.sameAs.length > 0 ? { sameAs: ORG.sameAs } : {}),
      }}
    />
  )
}

export function WebSiteJsonLd() {
  return (
    <Script
      data={{
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        url: SITE_URL,
        name: ORG.name,
        publisher: { '@id': ORG_ID },
        inLanguage: 'it-IT',
      }}
    />
  )
}

export function ServiceJsonLd({
  name,
  description,
  url,
  areaName,
}: {
  name: string
  description: string
  url: string
  areaName: string
}) {
  return (
    <Script
      data={{
        '@context': 'https://schema.org',
        '@type': 'Service',
        name,
        description,
        url,
        serviceType: 'Sviluppo software e automazioni AI',
        provider: { '@id': ORG_ID },
        areaServed: { '@type': 'AdministrativeArea', name: areaName },
        audience: {
          '@type': 'BusinessAudience',
          name: 'Property manager, gestori di affitti brevi, agenzie immobiliari',
        },
      }}
    />
  )
}

export type FaqItem = { question: string; answer: string }

/**
 * Le FAQ sono il formato che i motori generativi riusano piu' volentieri:
 * domanda e risposta sono gia' separate, quindi la risposta si puo'
 * citare senza doverla ricostruire dal testo attorno.
 */
export function FaqJsonLd({ items, url }: { items: FaqItem[]; url: string }) {
  return (
    <Script
      data={{
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        '@id': `${url}#faq`,
        mainEntity: items.map((item) => ({
          '@type': 'Question',
          name: item.question,
          acceptedAnswer: { '@type': 'Answer', text: item.answer },
        })),
      }}
    />
  )
}

export function BreadcrumbJsonLd({
  items,
}: {
  items: Array<{ name: string; url: string }>
}) {
  return (
    <Script
      data={{
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: items.map((item, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: item.name,
          item: item.url,
        })),
      }}
    />
  )
}

/**
 * I lavori realizzati, dichiarati come opere di cui Facevoice AI e'
 * l'autore, con i riferimenti agli articoli che ne hanno parlato.
 *
 * E' cosi' che si collega la rassegna stampa esistente all'azienda: un
 * articolo su Nomadiqe parla di affitti brevi in Sicilia, ma da solo non
 * dice a nessuna macchina chi ha costruito Nomadiqe.
 */
export function ProjectsJsonLd() {
  return (
    <Script
      data={{
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        '@id': `${SITE_URL}/#projects`,
        name: `Progetti realizzati da ${ORG.name}`,
        itemListElement: PROJECTS.map((project, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          item: {
            '@type': 'WebSite',
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
                    publisher: { '@type': 'Organization', name: article.publisher },
                  })),
                }
              : {}),
          },
        })),
      }}
    />
  )
}
