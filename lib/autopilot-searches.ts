// Ricerche automatiche del Motore clienti. Google Maps cerca come un utente sulla
// mappa: funziona con "categoria + citta'" ("ristoranti Palermo"), non con una
// descrizione ("business che potrebbero aver bisogno di software…", che trova 1
// risultato). Quando le ricerche della lista non portano attivita' nuove,
// l'automazione usa queste, a rotazione, cosi' ogni giorno c'e' qualcuno di nuovo.

/** Attivita' a cui servono di piu' sito, automazioni, social e AI. */
export const AUTO_CATEGORIES = [
  'ristoranti',
  'pizzerie',
  'hotel',
  'B&B',
  'case vacanza',
  'agenzie immobiliari',
  'centri estetici',
  'parrucchieri',
  'barbieri',
  'palestre',
  'studi dentistici',
  'autonoleggi',
  'negozi di abbigliamento',
  'commercialisti',
  'officine meccaniche',
  'agriturismi',
  'cantine vinicole',
  'pasticcerie',
  'studi legali',
  'scuole guida',
  'agenzie di viaggio',
  'fisioterapisti',
  'ottici',
  'gioiellerie',
  'negozi di arredamento',
  'imprese edili',
  'concessionarie auto',
  'wedding planner',
  'fotografi',
  'centri medici',
]

/** Citta', partendo dalla zona di Terrasini e allargando. */
export const AUTO_CITIES = [
  'Palermo',
  'Terrasini',
  'Carini',
  'Cinisi',
  'Partinico',
  'Trapani',
  'Marsala',
  'Alcamo',
  'Castellammare del Golfo',
  'Bagheria',
  'Monreale',
  'Cefalù',
  'Mazara del Vallo',
  'Agrigento',
  'Sciacca',
  'Catania',
  'Messina',
  'Siracusa',
  'Ragusa',
  'Milano',
  'Roma',
  'Napoli',
  'Torino',
  'Bologna',
  'Firenze',
]

export const AUTO_TOTAL = AUTO_CATEGORIES.length * AUTO_CITIES.length

/** Ricerca automatica n-esima: tutte le categorie in una citta', poi la citta' successiva. */
export function autoQuery(n: number): string {
  const i = ((n % AUTO_TOTAL) + AUTO_TOTAL) % AUTO_TOTAL
  return `${AUTO_CATEGORIES[i % AUTO_CATEGORIES.length]} ${AUTO_CITIES[Math.floor(i / AUTO_CATEGORIES.length)]}`
}

/** Una ricerca scritta come descrizione (tante parole) su Maps non trova quasi niente. */
export const looksLikeDescription = (query: string) => query.trim().split(/\s+/).length > 6
