import type { MetadataRoute } from 'next'
import { SITE_URL, SICILY_CITIES } from '@/lib/seo/site'
import { SECTORS } from '@/lib/seo/sectors'
import { PROJECTS } from '@/lib/seo/projects'
import { blogPath, listBlogPosts } from '@/lib/blog'

// Rigenerata ogni ora: i nuovi articoli del blog entrano da soli.
export const revalidate = 3600

/**
 * Generata dalle stesse strutture dati che generano le pagine, cosi' non
 * puo' disallinearsi dalle rotte reali come faceva quella scritta a mano.
 */

const STATIC_PAGES: Array<{
  path: string
  priority: number
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency']
}> = [
  { path: '/home', priority: 1, changeFrequency: 'weekly' },
  { path: '/services', priority: 0.9, changeFrequency: 'monthly' },
  { path: '/settori', priority: 0.9, changeFrequency: 'monthly' },
  { path: '/case-studies', priority: 0.9, changeFrequency: 'monthly' },
  { path: '/team', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/bookings', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/blog', priority: 0.7, changeFrequency: 'weekly' },
  { path: '/lavora-con-noi', priority: 0.5, changeFrequency: 'yearly' },
  { path: '/privacy', priority: 0.3, changeFrequency: 'yearly' },
  { path: '/privacy/cancellazione-dati', priority: 0.2, changeFrequency: 'yearly' },
]

const LEGACY_SECTORS = ['ristorazione', 'ottica', 'abbigliamento']
const LEGACY_CITIES = ['palermo', 'catania', 'trapani']

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const lastModified = new Date()
  const posts = await listBlogPosts()

  return [
    ...STATIC_PAGES.map((page) => ({
      url: `${SITE_URL}${page.path}`,
      lastModified,
      changeFrequency: page.changeFrequency,
      priority: page.priority,
    })),
    ...SECTORS.map((sector) => ({
      url: `${SITE_URL}/settori/${sector.slug}`,
      lastModified,
      changeFrequency: 'monthly' as const,
      priority: 0.85,
    })),
    ...SECTORS.filter((sector) => sector.hasCities).flatMap((sector) =>
      SICILY_CITIES.map((city) => ({
        url: `${SITE_URL}/settori/${sector.slug}/${city.slug}`,
        lastModified,
        changeFrequency: 'monthly' as const,
        priority: 0.75,
      }))
    ),
    ...PROJECTS.map((project) => ({
      url: `${SITE_URL}/case-studies/${project.slug}`,
      lastModified,
      changeFrequency: 'monthly' as const,
      priority: 0.8,
    })),
    ...posts.map((post) => ({
      url: `${SITE_URL}${blogPath(post)}`,
      lastModified: new Date(post.created_at),
      changeFrequency: 'monthly' as const,
      priority: 0.65,
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
