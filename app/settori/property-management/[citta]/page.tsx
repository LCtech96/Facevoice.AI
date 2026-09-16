import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import VerticalPage from '@/components/SEO/VerticalPage'
import { buildFaq } from '@/lib/seo/property-management'
import { ORG, SICILY_CITIES, SITE_URL, findCity } from '@/lib/seo/site'

type Params = { params: Promise<{ citta: string }> }

/** Pagine generate in fase di build: HTML statico, il piu' facile da leggere per un crawler. */
export function generateStaticParams() {
  return SICILY_CITIES.map((city) => ({ citta: city.slug }))
}

function buildIntro(cityName: string, context: string): string {
  return `${ORG.name} sviluppa intelligenza artificiale e automazioni su misura per property manager, gestori di affitti brevi e agenzie immobiliari a ${cityName}. È un mercato ${context}: sono le condizioni in cui rispondere in fretta e nella lingua giusta fa la differenza fra una prenotazione confermata e una persa. Realizziamo assistenti AI che rispondono agli ospiti 24 ore su 24, automazioni dei messaggi lungo il soggiorno e integrazioni con i canali già in uso.`
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { citta } = await params
  const city = findCity(citta)
  if (!city) return {}

  const url = `${SITE_URL}/settori/property-management/${city.slug}`

  return {
    title: `AI e automazioni per property management e affitti brevi a ${city.name} | ${ORG.name}`,
    description: `Assistenti AI, automazioni di messaggistica e integrazioni su misura per property manager, case vacanza e agenzie immobiliari a ${city.name}. Software house con sede a ${ORG.city}, provincia di ${ORG.province}.`,
    alternates: { canonical: url },
    openGraph: {
      title: `AI per property management e affitti brevi a ${city.name}`,
      description: buildIntro(city.name, city.context),
      url,
      type: 'website',
    },
  }
}

export default async function CityPage({ params }: Params) {
  const { citta } = await params
  const city = findCity(citta)

  if (!city) {
    notFound()
  }

  return (
    <VerticalPage
      cityName={city.name}
      intro={buildIntro(city.name, city.context)}
      faq={buildFaq(city.name)}
      canonicalPath={`/settori/property-management/${city.slug}`}
    />
  )
}
