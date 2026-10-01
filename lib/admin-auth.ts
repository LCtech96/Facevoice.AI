/**
 * Chi può accedere al pannello admin (contenuti, prenotazioni, pagamenti,
 * e la futura sezione memoria AI / canali social).
 *
 * Centralizzato qui perché prima era una stringa ripetuta identica in
 * una quindicina di file: aggiungere un secondo amministratore avrebbe
 * richiesto modificarli tutti, uno per uno, con il rischio concreto di
 * dimenticarne qualcuno e lasciare un varco.
 */
export const ADMIN_EMAILS = ['luca@facevoice.ai', 'lucacorrao1996@gmail.com'] as const

export function isAdminEmail(email?: string | null): boolean {
  if (!email) return false
  const normalized = email.trim().toLowerCase()
  return ADMIN_EMAILS.some((admin) => admin === normalized)
}
