import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/seo/site'

/**
 * Sostituisce public/robots.txt.
 *
 * I crawler dei motori generativi sono nominati uno per uno. Con
 * "User-agent: *" sarebbero gia' ammessi, ma diversi operatori trattano
 * una regola esplicita come consenso esplicito, e alcuni strumenti di
 * audit segnalano l'assenza del nome come blocco.
 *
 * Distinzione utile: GPTBot / ClaudeBot / Google-Extended raccolgono
 * materiale per l'addestramento; OAI-SearchBot, ChatGPT-User,
 * Claude-SearchBot e PerplexityBot leggono le pagine al momento della
 * risposta. Servono entrambi: i primi per essere conosciuti, i secondi
 * per essere citati.
 */

const DISALLOW = ['/auth', '/ai-chat', '/admin', '/api/']

const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'anthropic-ai',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'Bytespider',
  'CCBot',
  'cohere-ai',
  'Meta-ExternalAgent',
  'DuckAssistBot',
  'Amazonbot',
  'YouBot',
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: DISALLOW },
      ...AI_CRAWLERS.map((userAgent) => ({
        userAgent,
        allow: '/',
        disallow: DISALLOW,
      })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
