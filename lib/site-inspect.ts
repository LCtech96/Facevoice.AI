import { fetchPage, isPublicUrl, visibleText } from '@/lib/leads'

// Analisi approfondita di un sito per la super chat: quali pagine ha, di cosa
// parlano, quanto e' aggiornato, su che piattaforma e' fatto, cosa offre
// (prenotazioni, shop, blog). Legge solo pagine pubbliche, poche e in fretta.

const MAX_PAGES = 10
const SKIP_LINK = /\.(pdf|jpe?g|png|gif|webp|svg|zip|mp4|mp3|docx?|xlsx?)(\?|$)|^(mailto|tel|javascript|whatsapp):|\/wp-(admin|login)|\/(cart|carrello|checkout|account|login)\b|#/i

export type PageInfo = { path: string; title: string; h1: string; description: string; excerpt: string; latestYear: number | null }

export type SiteInspection = {
  url: string
  reachable: boolean
  platform: string | null
  pages: PageInfo[]
  latestYearMentioned: number | null
  copyrightYear: number | null
  features: string[]
  socials: string[]
}

const tag = (html: string, re: RegExp) => visibleText(html.match(re)?.[1] || '').slice(0, 160)

function yearsIn(text: string): number[] {
  const now = new Date().getFullYear()
  return (text.match(/\b20[0-3]\d\b/g) || []).map(Number).filter((y) => y >= 2005 && y <= now)
}

function platformOf(html: string): string | null {
  if (/wp-content|wp-includes/i.test(html)) return 'WordPress'
  if (/cdn\.shopify|Shopify\.theme/i.test(html)) return 'Shopify'
  if (/wixstatic|wix\.com/i.test(html)) return 'Wix'
  if (/squarespace/i.test(html)) return 'Squarespace'
  if (/webflow/i.test(html)) return 'Webflow'
  if (/jimdo/i.test(html)) return 'Jimdo'
  if (/__next|_next\/static/i.test(html)) return 'Next.js (su misura)'
  return null
}

function featuresOf(html: string): string[] {
  const text = html.toLowerCase()
  const out: string[] = []
  if (/prenota|booking|thefork|quandoo|opentable|reserv/.test(text)) out.push('prenotazioni online')
  if (/carrello|add-to-cart|woocommerce|shopify|aggiungi al carrello/.test(text)) out.push('shop / e-commerce')
  if (/\/blog|\/news|\/notizie|\/articoli/.test(text)) out.push('blog o notizie')
  if (/newsletter|mailchimp|iscriviti/.test(text)) out.push('newsletter')
  if (/wa\.me|whatsapp/.test(text)) out.push('contatto WhatsApp')
  if (/menu|menù/.test(text) && /\.pdf/.test(text)) out.push('menu in PDF')
  if (/google-analytics|gtag\(|googletagmanager/.test(text)) out.push('Google Analytics')
  if (/fbq\(|connect\.facebook\.net/.test(text)) out.push('Pixel Meta')
  return out
}

function socialsOf(html: string): string[] {
  const found = html.match(/https?:\/\/(?:www\.)?(instagram|facebook|tiktok|linkedin|youtube)\.com\/[A-Za-z0-9_.\-/]+/gi) || []
  return [...new Set(found.map((s) => s.replace(/\/+$/, '')).filter((s) => !/sharer|share|plugins|dialog/i.test(s)))].slice(0, 6)
}

function pageInfo(path: string, html: string): PageInfo {
  const text = visibleText(html)
  const years = yearsIn(text)
  return {
    path,
    title: tag(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
    h1: tag(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i),
    description: (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)?.[1] || '').slice(0, 200),
    excerpt: text.slice(0, 500),
    latestYear: years.length ? Math.max(...years) : null,
  }
}

export async function inspectWebsite(website: string): Promise<SiteInspection> {
  let base: URL
  try {
    base = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`)
  } catch {
    return { url: website, reachable: false, platform: null, pages: [], latestYearMentioned: null, copyrightYear: null, features: [], socials: [] }
  }
  const empty = { url: base.href, reachable: false, platform: null, pages: [], latestYearMentioned: null, copyrightYear: null, features: [], socials: [] }
  if (!isPublicUrl(base)) return empty
  const home = await fetchPage(base.href)
  if (!home) return empty

  // Link interni della home (menu e pagine principali), senza doppioni.
  const paths = new Set<string>()
  for (const m of home.matchAll(/href=["']([^"']+)["']/gi)) {
    const href = m[1].trim()
    if (!href || SKIP_LINK.test(href)) continue
    try {
      const u = new URL(href, base)
      if (u.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) continue
      const path = u.pathname.replace(/\/+$/, '') || '/'
      if (path !== '/' && !paths.has(path)) paths.add(path)
    } catch {}
    if (paths.size >= MAX_PAGES) break
  }

  const pages: PageInfo[] = [pageInfo('/', home)]
  const list = [...paths]
  for (let i = 0; i < list.length; i += 4) {
    const results = await Promise.all(
      list.slice(i, i + 4).map(async (path) => {
        const html = await fetchPage(new URL(path, base).href)
        return html ? pageInfo(path, html) : null
      })
    )
    for (const r of results) if (r) pages.push(r)
  }

  const allYears = pages.map((p) => p.latestYear).filter((y): y is number => y !== null)
  const copyright = visibleText(home).match(/(?:©|copyright)\s*(?:20\d{2}\s*[-–]\s*)?(20\d{2})/i)?.[1]
  return {
    url: base.href,
    reachable: true,
    platform: platformOf(home),
    pages,
    latestYearMentioned: allYears.length ? Math.max(...allYears) : null,
    copyrightYear: copyright ? Number(copyright) : null,
    features: featuresOf(home),
    socials: socialsOf(home),
  }
}
