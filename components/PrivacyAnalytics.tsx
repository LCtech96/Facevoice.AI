'use client'

import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'

// Statistiche di Vercel senza i link segreti dei contratti e delle todo list: /c/<token> diventa /c/[link], /todo/<token> diventa /todo/[link]
// prima dell'invio (il token, anche se da solo non apre niente, non finisce nelle statistiche).

const redact = (url: string) => url.replace(/\/c\/[A-Za-z0-9_-]{16,}/g, '/c/[link]').replace(/\/todo\/[A-Za-z0-9_-]{16,}/g, '/todo/[link]')

export default function PrivacyAnalytics() {
  return (
    <>
      <Analytics beforeSend={(event) => ({ ...event, url: redact(event.url) })} />
      <SpeedInsights beforeSend={(event) => ({ ...event, url: redact(event.url) })} />
    </>
  )
}
