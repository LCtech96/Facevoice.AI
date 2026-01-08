'use client'

import { useEffect } from 'react'
import StructuredData from './StructuredData'

interface SEOHeadProps {
  title: string
  description: string
  keywords?: string[]
  canonical?: string
  ogImage?: string
  page?: string
}

export default function SEOHead({
  title,
  description,
  keywords = [],
  canonical,
  ogImage = 'https://www.facevoice.ai/Facevoice.png',
  page = 'home'
}: SEOHeadProps) {
  useEffect(() => {
    // Aggiorna title
    if (typeof document !== 'undefined') {
      document.title = title

      // Aggiorna o crea meta description
      let metaDescription = document.querySelector('meta[name="description"]')
      if (!metaDescription) {
        metaDescription = document.createElement('meta')
        metaDescription.setAttribute('name', 'description')
        document.head.appendChild(metaDescription)
      }
      metaDescription.setAttribute('content', description)

      // Aggiorna o crea meta keywords
      if (keywords.length > 0) {
        let metaKeywords = document.querySelector('meta[name="keywords"]')
        if (!metaKeywords) {
          metaKeywords = document.createElement('meta')
          metaKeywords.setAttribute('name', 'keywords')
          document.head.appendChild(metaKeywords)
        }
        metaKeywords.setAttribute('content', keywords.join(', '))
      }

      // Aggiorna canonical link
      if (canonical) {
        let linkCanonical = document.querySelector('link[rel="canonical"]')
        if (!linkCanonical) {
          linkCanonical = document.createElement('link')
          linkCanonical.setAttribute('rel', 'canonical')
          document.head.appendChild(linkCanonical)
        }
        linkCanonical.setAttribute('href', canonical)
      }

      // Open Graph tags
      const ogTags = [
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        { property: 'og:image', content: ogImage },
        { property: 'og:url', content: canonical || 'https://www.facevoice.ai' },
        { property: 'og:type', content: 'website' },
        { property: 'og:locale', content: 'it_IT' },
        { property: 'og:site_name', content: 'Facevoice AI' },
      ]

      ogTags.forEach(tag => {
        let metaTag = document.querySelector(`meta[property="${tag.property}"]`)
        if (!metaTag) {
          metaTag = document.createElement('meta')
          metaTag.setAttribute('property', tag.property)
          document.head.appendChild(metaTag)
        }
        metaTag.setAttribute('content', tag.content)
      })

      // Twitter Card tags
      const twitterTags = [
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:title', content: title },
        { name: 'twitter:description', content: description },
        { name: 'twitter:image', content: ogImage },
      ]

      twitterTags.forEach(tag => {
        let metaTag = document.querySelector(`meta[name="${tag.name}"]`)
        if (!metaTag) {
          metaTag = document.createElement('meta')
          metaTag.setAttribute('name', tag.name)
          document.head.appendChild(metaTag)
        }
        metaTag.setAttribute('content', tag.content)
      })
    }
  }, [title, description, keywords, canonical, ogImage])

  return (
    <>
      <StructuredData type="organization" page={page} />
      {page === 'home' && <StructuredData type="service" page={page} />}
      {page === 'services' && <StructuredData type="software" page={page} />}
    </>
  )
}

