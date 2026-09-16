import type { MetadataRoute } from 'next'
import { SITE_URL, SICILY_CITIES } from '@/lib/seo/site'

/**
 * Sostituisce public/sitemap.xml, che andava aggiornato a mano e si era
 * gia' disallineato dalle pagine reali.
 */

const STATIC_PAGES: Array<{ path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'] }> = [
  { path: '/home', priority: 1, changeFrequency: 'weekly' },
  { path: '/services', priority: 0.9, changeFrequency: 'monthly' },
  { path: '/settori/property-management', priority: 0.9, changeFrequency: 'monthly' },
  { path: '/team', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/bookings', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/blog', priority: 0.7, changeFrequency: 'weekly' },
  { path: '/lavora-con-noi', priority: 0.5, changeFrequency: 'yearly' },
]

const LEGACY_SECTORS = ['ristorazione', 'ottica', 'abbigliamento']
const LEGACY_CITIES = ['palermo', 'catania', 'trapani']

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()

  return [
    ...STATIC_PAGES.map((page) => ({
      url: `${SITE_URL}${page.path}`,
      lastModified,
      changeFrequency: page.changeFrequency,
      priority: page.priority,
    })),
    ...SICILY_CITIES.map((city) => ({
      url: `${SITE_URL}/settori/property-management/${city.slug}`,
      lastModified,
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
    ...LEGACY_SECTORS.flatMap((sector) =>
      LEGACY_CITIES.map((city) => ({
        url: `${SITE_URL}/settori/${sector}/${city}`,
        lastModified,
        changeFrequency: 'monthly' as const,
        priority: 0.6,
      }))
    ),
  ]
}
