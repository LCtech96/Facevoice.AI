'use client'

import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'

// Statistiche di Vercel per tutto il sito, tranne le pagine dei contratti condivisi (/c/<token>):
// l'indirizzo contiene il token del link, che non deve finire nelle statistiche.
const isPrivate = (url: string) => {
  try {
    const path = new URL(url, 'https://x').pathname
    // Anche il recupero della password: l'indirizzo contiene il permesso per cambiarla e l'email.
    return /^\/(c|v)\//.test(path) || path.startsWith('/auth/reset-password') || path.startsWith('/auth/callback')
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
