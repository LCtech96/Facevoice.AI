import type { NextRequest } from 'next/server'

/** Indirizzo dell'area clienti per i link nelle email: quello configurato, altrimenti quello della richiesta. */
export function appBaseUrl(req: NextRequest): string {
  const configured = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '')
  // Come per i pagamenti: solo un indirizzo completo (https://…), altrimenti quello della richiesta.
  return /^https?:\/\//i.test(configured) ? configured : req.nextUrl.origin
}
