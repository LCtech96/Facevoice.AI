import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import SectorPage from '@/components/SEO/SectorPage'
import { SECTORS, findSector } from '@/lib/seo/sectors'
import { ORG, SICILY_CITIES, SITE_URL, findCity } from '@/lib/seo/site'

type Params = { params: Promise<{ settore: string; citta: string }> }

/** Solo i settori con intento di ricerca locale generano pagine citta'. */
export function generateStaticParams() {
  return SECTORS.filter((sector) => sector.hasCities).flatMap((sector) =>
    SICILY_CITIES.map((city) => ({ settore: sector.slug, citta: city.slug }))
  )
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { settore, citta } = await params
  const sector = findSector(settore)
  const city = findCity(citta)
  if (!sector?.hasCities || !city) return {}

  const url = `${SITE_URL}/settori/${sector.slug}/${city.slug}`
  return {
    title: `${sector.heading} a ${city.name} | ${ORG.name}`,
    description: `${sector.metaDescription} A ${city.name} e in tutta la Sicilia.`,
    alternates: { canonical: url },
  }
}

export default async function Page({ params }: Params) {
  const { settore, citta } = await params
  const sector = findSector(settore)
  const city = findCity(citta)

  if (!sector?.hasCities || !city) notFound()

  return <SectorPage sector={sector} cityName={city.name} />
}
