'use client'

import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'

// Statistiche di Vercel per tutto il sito, tranne le pagine dei contratti condivisi (/c/<token>):
// l'indirizzo contiene il token del link, che non deve finire nelle statistiche.
const isPrivate = (url: string) => {
  try {
    return new URL(url, 'https://x').pathname.startsWith('/c/')
  } catch {
    return false
  }
}

export default function PrivateAnalytics() {
  return (
    <>
      <Analytics beforeSend={(event) => (isPrivate(event.url) ? null : event)} />
      <SpeedInsights beforeSend={(event) => (isPrivate(event.url) ? null : event)} />
    </>
  )
}
