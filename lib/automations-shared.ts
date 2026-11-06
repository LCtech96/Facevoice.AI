// Regole delle Automazioni usate sia dal server (lib/saas/automations.ts) sia dalla
// pagina (app/app/automazioni): limite del giorno, destinatari e giorni della settimana.

/** Email al giorno per spazio, dalle automazioni (giorno di calendario italiano). */
export const AUTOMATIONS_DAILY_LIMIT = 20
/** Destinatari per automazione. */
export const MAX_RECIPIENTS = 20

const EMAIL_RE = /^[a-z0-9.!#$%&*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/

export const isEmail = (value: string) => value.length <= 254 && EMAIL_RE.test(value)

/** Destinatari scritti dal cliente (virgole, punti e virgola, a capo o spazi; anche "Nome <email>"), senza doppioni. */
export function parseRecipients(input: unknown): { emails: string[]; invalid: string[] } {
  const parts = (Array.isArray(input) ? input.map(String) : [String(input ?? '')])
    .flatMap((v) => v.split(/[,;\n\r]+/))
    // "Luca Rossi <luca@esempio.it>": vale l'indirizzo tra < >.
    .flatMap((chunk) => {
      const inside = chunk.match(/<([^<>]+)>/)
      return inside ? [inside[1]] : chunk.split(/[\t ]+/)
    })
    .map((v) => v.trim().replace(/^mailto:/i, '').replace(/^[<("']+|[>)"'.]+$/g, '').toLowerCase())
    .filter(Boolean)
  const emails: string[] = []
  const invalid: string[] = []
  for (const p of parts) {
    if (!isEmail(p)) {
      if (!invalid.includes(p)) invalid.push(p)
    } else if (!emails.includes(p)) emails.push(p)
  }
  return { emails, invalid }
}

/** Giorni della settimana: 0 = domenica … 6 = sabato (come Date.getDay), mostrati da lunedi'. */
export const WEEKDAYS = [
  { day: 1, short: 'Lun' },
  { day: 2, short: 'Mar' },
  { day: 3, short: 'Mer' },
  { day: 4, short: 'Gio' },
  { day: 5, short: 'Ven' },
  { day: 6, short: 'Sab' },
  { day: 0, short: 'Dom' },
] as const
