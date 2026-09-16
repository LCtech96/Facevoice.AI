import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import SectorPage from '@/components/SEO/SectorPage'
import { SECTORS, findSector } from '@/lib/seo/sectors'
import { SITE_URL } from '@/lib/seo/site'

type Params = { params: Promise<{ settore: string }> }

export function generateStaticParams() {
  return SECTORS.map((sector) => ({ settore: sector.slug }))
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { settore } = await params
  const sector = findSector(settore)
  if (!sector) return {}

  const url = `${SITE_URL}/settori/${sector.slug}`
  return {
    title: sector.metaTitle,
    description: sector.metaDescription,
    alternates: { canonical: url },
    openGraph: {
      title: sector.heading,
      description: sector.intro,
      url,
      type: 'website',
    },
  }
}

export default async function Page({ params }: Params) {
  const { settore } = await params
  const sector = findSector(settore)
  if (!sector) notFound()

  return <SectorPage sector={sector} />
}
