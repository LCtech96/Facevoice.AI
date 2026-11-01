// Nome con cui l'AI puo' chiamare una persona, ricavato dal nome del profilo
// (Instagram, Facebook, WhatsApp) o dallo username. Meglio nessun nome che uno
// sbagliato: "Ciao Pizzeria!" o "Ciao Xx_dark_92!" fanno peggio di un "Ciao!".

const BUSINESS_WORDS =
  /\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|ltd|llc|inc|gmbh|srl|spa|pizzeria|ristorante|trattoria|osteria|bar|caf+[eè]|pub|hotel|b&b|bnb|resort|agriturismo|studio|agenzia|agency|shop|store|boutique|official|ufficiale|group|gruppo|company|azienda|salon|salone|parrucchier\w*|barber\w*|estetica|beauty|nails|fitness|palestra|gym|immobiliare|real\s?estate|rent|noleggio|auto|moto|farmacia|clinica|dental|dentist\w*|medical|food|wine|vini|cantina|pasticceria|gelateria|panificio|macelleria|market|design|media|marketing|consulting|services?|servizi|tours?|travel|viaggi|events?|eventi|wedding|foto|photo\w*|music|records|tv|radio|news|magazine|club|team|academy|scuola|school|lab)\b/i

const capitalize = (word: string) => word.charAt(0).toLocaleUpperCase('it-IT') + word.slice(1).toLocaleLowerCase('it-IT')

/** Una parola che sembra un nome di battesimo: solo lettere, lunghezza normale. */
const looksLikeName = (word: string) => /^\p{L}{2,20}$/u.test(word) && !/^(\p{L})\1+$/u.test(word.toLowerCase())

export type NameHint = {
  /** Nome di battesimo da usare, se affidabile. */
  first: string | null
  /** Il profilo sembra di un'attivita', non di una persona. */
  business: boolean
}

export function nameHint(profileName: string | null | undefined): NameHint {
  const raw = (profileName || '').trim()
  if (!raw) return { first: null, business: false }

  // Solo username (@marco.rossi): il nome si ricava solo se e' evidente (marco.rossi, marco_rossi).
  if (raw.startsWith('@')) {
    const handle = raw.slice(1)
    if (BUSINESS_WORDS.test(handle.replace(/[._-]+/g, ' '))) return { first: null, business: true }
    const parts = handle.split(/[._-]+/).filter(Boolean)
    const first = parts[0] || ''
    return parts.length >= 2 && looksLikeName(first) && looksLikeName(parts[1].replace(/\d+$/, ''))
      ? { first: capitalize(first), business: false }
      : { first: null, business: false }
  }

  if (BUSINESS_WORDS.test(raw)) return { first: null, business: true }
  // Toglie emoji e simboli, poi prende la prima parola (es. "✨ GIULIA Bianchi ✨" → Giulia).
  const words = raw
    .replace(/[^\p{L}\s'’-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
  // Nomi composti con il trattino (Ana-Maria) restano interi.
  const parts = (words[0] || '').split(/[-'’]/).filter(Boolean)
  return parts.length && parts.length <= 2 && parts.every(looksLikeName)
    ? { first: parts.map(capitalize).join('-'), business: false }
    : { first: null, business: false }
}
