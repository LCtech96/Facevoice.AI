import { SITE_URL } from '@/lib/seo/site'

/**
 * Indirizzo per le chiamate del server a se stesso (giri dell'automazione e della
 * super chat). Il cron di Vercel arriva sull'indirizzo della singola versione
 * (facevoice-xxxx.vercel.app), protetto dal login di Vercel: le chiamate li'
 * venivano rifiutate (401) e l'automazione delle 15:30 non partiva mai, o si
 * fermava quando doveva riprendere. In produzione si usa sempre il dominio.
 */
export function internalOrigin(requestOrigin: string): string {
  return process.env.VERCEL_ENV === 'production' ? SITE_URL : requestOrigin
}
