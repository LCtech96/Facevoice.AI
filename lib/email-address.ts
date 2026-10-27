// Indirizzi email: riconoscere quelli automatici (no-reply, notifiche…) e il
// dominio dell'azienda, per rispondere a un indirizzo che qualcuno legge davvero.

const AUTOMATIC_LOCAL = /(^|[^a-z])(no-?reply|do-?not-?reply|donotreply|automated|mailer-daemon|notifications?|notify|bounces?|postmaster)([^a-z]|$)/i

/** Indirizzo a cui non risponde nessuno (no-reply, notifiche automatiche…). */
export const isAutomaticEmail = (address: string) => AUTOMATIC_LOCAL.test(address.split('@')[0] || '')

/** Dominio principale: "fiumicino.galdierirent.it" → "galdierirent.it". */
export function baseDomain(address: string): string | null {
  const host = address.split('@')[1]?.toLowerCase().trim()
  if (!host || !host.includes('.')) return null
  return host.split('.').slice(-2).join('.')
}

/** Indirizzi email scritti in un testo. */
export const emailsInText = (text: string) =>
  [...new Set((text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((e) => e.toLowerCase().replace(/[.,;:]+$/, '')))]
