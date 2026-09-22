/**
 * Fatti sull'azienda in un posto solo.
 *
 * Servono a tre consumatori: i dati strutturati (schema.org), llms.txt e
 * il testo delle pagine di settore. Tenerli qui evita che le tre fonti
 * si contraddicano — ed e' proprio la coerenza fra fonti che un motore
 * generativo usa per decidere se una cosa e' vera.
 */

/**
 * Dominio di produzione su Vercel. L'apex facevoice.ai risponde con un
 * 308 verso questo indirizzo, quindi il canonical deve essere il www:
 * puntare all'apex manderebbe ogni crawler su un redirect.
 */
export const SITE_URL = 'https://www.facevoice.ai'

export const ORG = {
  name: 'Facevoice AI',
  legalName: 'Facevoice AI',
  url: SITE_URL,
  logo: `${SITE_URL}/Facevoice.png`,
  email: 'info@facevoice.ai',
  phone: '+39 351 367 1340',
  whatsapp: '+39 351 420 6353',
  /** Sede legale. Non e' una sede aperta al pubblico: nei dati
   *  strutturati si dichiara il comune, non un indirizzo civico. */
  city: 'Terrasini',
  province: 'Palermo',
  region: 'Sicilia',
  country: 'IT',
  founder: 'Luca Corrao',
  /**
   * Una frase che definisce l'entita'. E' il tipo di riga che un motore
   * generativo cita testualmente quando gli si chiede "chi e' X".
   */
  oneLiner:
    'Facevoice AI è una software house con sede a Terrasini, in provincia di Palermo, che sviluppa software su misura, agenti AI e automazioni per le imprese in tutta la Sicilia e in Italia.',
  /**
   * Profili esterni della STESSA entita'.
   *
   * sameAs significa "questo e' lo stesso soggetto, altrove": serve a far
   * combaciare il sito con l'azienda reale. Vanno solo profili di
   * Facevoice AI e della ditta individuale che la esercita — i marchi
   * collegati (Nomadiqe) sono un'altra entita' e si dichiarano a parte,
   * altrimenti si confondono le due identita' invece di chiarirle.
   *
   * Gli URL vanno senza parametri di tracciamento: quelli cambiano a ogni
   * condivisione e non identificano una risorsa stabile.
   */
  sameAs: [
    'https://www.linkedin.com/company/facevoice/',
    'https://www.instagram.com/facevoice.ai',
    // Ditta individuale Corrao Luca, l'entita' giuridica dietro il marchio
    'https://registroaziende.it/azienda/corrao-luca-terrasini',
    'https://www.ufficiocamerale.it/4345/corrao-luca',
    // Profilo Google Business (link di condivisione ufficiale)
    'https://share.google/dY2KYXGKGULpkzcKT',
  ] as string[],
} as const

/**
 * Coordinate del comune di Terrasini, a livello di centro abitato.
 *
 * Volutamente non un indirizzo civico: la sede non riceve pubblico e un
 * punto preciso suggerirebbe un ufficio dove presentarsi.
 */
export const GEO = { latitude: 38.1509, longitude: 13.0844 } as const

export type CityKey =
  | 'palermo'
  | 'catania'
  | 'messina'
  | 'siracusa'
  | 'trapani'
  | 'ragusa'
  | 'agrigento'
  | 'caltanissetta'
  | 'enna'
  | 'taormina'
  | 'cefalu'
  | 'noto'

export type City = {
  slug: CityKey
  name: string
  /** Contesto locale reale: serve a rendere la pagina utile, non riempitiva. */
  context: string
}

export const SICILY_CITIES: City[] = [
  {
    slug: 'palermo',
    name: 'Palermo',
    context:
      'capoluogo di regione, con un mercato di affitti brevi concentrato nel centro storico fra Ballarò, Vucciria e Kalsa e una forte stagionalità legata a crociere e voli low cost',
  },
  {
    slug: 'catania',
    name: 'Catania',
    context:
      'principale scalo aereo dell’isola, con domanda mista fra turismo, business e studenti universitari, e quindi molti immobili gestiti su contratti brevi e transitori insieme',
  },
  {
    slug: 'messina',
    name: 'Messina',
    context:
      'porta d’ingresso dell’isola, con flussi legati al traffico dello Stretto e ai comuni costieri vicini',
  },
  {
    slug: 'siracusa',
    name: 'Siracusa',
    context:
      'con Ortigia come polo di affitti brevi ad alta rotazione e forte concorrenza sul prezzo nei mesi estivi',
  },
  {
    slug: 'trapani',
    name: 'Trapani',
    context:
      'con la domanda distribuita fra città, Erice, San Vito Lo Capo e le Egadi, quindi portafogli immobiliari sparsi su più comuni',
  },
  {
    slug: 'ragusa',
    name: 'Ragusa',
    context:
      'con Ibla e la costa di Marina di Ragusa, dove i soggiorni medi sono più lunghi della media regionale',
  },
  {
    slug: 'agrigento',
    name: 'Agrigento',
    context:
      'con la Valle dei Templi e Scala dei Turchi a generare picchi di richieste concentrate in poche ore della giornata',
  },
  {
    slug: 'caltanissetta',
    name: 'Caltanissetta',
    context:
      'con un mercato più orientato agli affitti a lungo termine e alla gestione di piccoli portafogli residenziali',
  },
  {
    slug: 'enna',
    name: 'Enna',
    context:
      'con volumi contenuti e una gestione che deve restare a costo quasi zero per essere sostenibile',
  },
  {
    slug: 'taormina',
    name: 'Taormina',
    context:
      'fra le destinazioni più richieste della Sicilia, con prezzi alti, ospiti internazionali e aspettative di risposta immediata in più lingue',
  },
  {
    slug: 'cefalu',
    name: 'Cefalù',
    context:
      'con stagionalità estrema fra estate e inverno, dove il pricing dinamico incide più che altrove sul rendimento annuo',
  },
  {
    slug: 'noto',
    name: 'Noto',
    context:
      'con un turismo di fascia alta e soggiorni brevi, dove l’esperienza di check-in pesa quanto l’immobile',
  },
]

export function findCity(slug: string): City | undefined {
  return SICILY_CITIES.find((city) => city.slug === slug)
}
