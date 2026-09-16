/**
 * I progetti realizzati, con la loro rassegna stampa.
 *
 * Il contenuto viene da components/CaseStudy.tsx, che non era montato in
 * nessuna pagina: la rassegna stampa esisteva nel repository ma non era
 * pubblicata da nessuna parte. Qui diventa la sorgente delle pagine
 * /case-studies, renderizzate lato server.
 *
 * Gli articoli di terze parti sono il segnale piu' forte per un motore
 * generativo: sono fonti indipendenti che confermano cosa fa l'azienda.
 */

export type PressLink = {
  title: string
  url: string
  publisher: string
}

export type Project = {
  slug: string
  name: string
  /** Riassunto in una riga, usato negli elenchi e nei metadati. */
  summary: string
  url: string
  location?: string
  image?: string
  /** Settori a cui il progetto fa capo, per i collegamenti incrociati. */
  sectors: string[]
  description: string
  highlights: Array<{ title: string; body: string }>
  features: string[]
  press?: PressLink[]
  inProgress?: boolean
}

export const PROJECTS: Project[] = [
  {
    slug: 'nomadiqe',
    name: 'Nomadiqe',
    summary:
      'Piattaforma per gli affitti brevi che mette in contatto chi lavora viaggiando con host e attività locali.',
    url: 'https://www.nomadiqe.com',
    image: '/nomadiqe.png',
    sectors: ['property-management', 'turismo-e-ricettivita'],
    description:
      'Nomadiqe è il punto di incontro tra chi lavora viaggiando e le realtà locali: mette in contatto creatori digitali, host, piccoli imprenditori e attività commerciali per creare collaborazioni. È un progetto nato nel settore degli affitti brevi e sviluppato da Facevoice AI.',
    highlights: [
      {
        title: 'Community di nomadi digitali',
        body:
          'Ogni utente crea il proprio profilo e accede a una community di professionisti che lavorano viaggiando, per connettersi, condividere esperienze e trovare opportunità.',
      },
      {
        title: 'Incontro fra host e ospiti di lungo periodo',
        body:
          'La piattaforma è pensata per soggiorni più lunghi della media degli affitti brevi, dove il rapporto fra host e ospite conta quanto l’immobile.',
      },
    ],
    features: [
      'Creazione del profilo personalizzato',
      'Network di nomadi digitali',
      'Sistema di messaggistica interno',
      'Risorse e guide',
      'Eventi e incontri',
      'Dashboard personale',
    ],
    press: [
      {
        title: 'Nomadiqe: la startup che vuole cambiare gli affitti brevi',
        url: 'https://capitalist.it/w6tn',
        publisher: 'Capitalist.it',
      },
      {
        title:
          'Affitti brevi, nasce la start-up Nomadiqe: il progetto di un giovane imprenditore di Terrasini',
        url: 'https://www.telejato.it/cronaca/affitti-brevi-nasce-la-start-up-nomadiqe-linnovativo-progetto-di-un-giovane-imprenditore-di-terrasini/',
        publisher: 'Telejato',
      },
      {
        title:
          'Terrasini punta sull’innovazione turistica: il plauso del Sindaco al progetto Nomadiqe',
        url: 'https://www.radioamica.it/terrasini-punta-sullinnovazione-turistica-il-plauso-del-sindaco-maniaci-al-progetto-nomadiqe/',
        publisher: 'Radio Amica',
      },
    ],
  },
  {
    slug: 'otticafocus',
    name: 'Otticafocus',
    summary:
      'E-commerce per un’ottica, con vetrina prodotti, carrello, pagamenti rateali e pannello di amministrazione.',
    url: 'https://otticafocus.com',
    image: '/Otticafocus.png',
    sectors: ['ecommerce', 'retail'],
    inProgress: true,
    description:
      'Otticafocus.com è un e-commerce professionale sviluppato in TypeScript e Next.js per un’ottica: vetrina di occhiali e accessori, schede prodotto dettagliate, carrello e checkout, con un pannello di amministrazione per gestire il catalogo in autonomia.',
    highlights: [
      {
        title: 'E-commerce completo',
        body:
          'Vetrina, descrizioni prodotto, carrello e sistema di pagamento con più opzioni, incluse quelle a rate, per non perdere l’acquisto al momento del checkout.',
      },
      {
        title: 'Gestione in autonomia',
        body:
          'Il pannello di amministrazione permette di aggiungere e modificare articoli senza passare da uno sviluppatore.',
      },
    ],
    features: [
      'Vetrina occhiali e accessori',
      'Schede prodotto dettagliate',
      'Carrello e checkout ottimizzato',
      'Pagamenti Satispay, Klarna, PayPal, Revolut',
      'Pannello admin per la gestione degli articoli',
      'Sezione blog per l’indicizzazione',
      'Ottimizzazione di velocità e performance',
    ],
  },
  {
    slug: 'barinello',
    name: 'Barinello',
    summary:
      'Sito con pannello di amministrazione che permette di modificare ogni aspetto dei contenuti senza competenze tecniche.',
    url: 'https://barinello.com',
    image: '/Barinello.png',
    sectors: ['retail', 'gestionali-aziendali'],
    description:
      'Barinello.com è un sito completo con un pannello di amministrazione avanzato: contenuti, immagini, layout, menu e configurazioni si modificano dall’interno, senza bisogno di competenze tecniche e senza dover richiedere un intervento di sviluppo per ogni cambiamento.',
    highlights: [
      {
        title: 'Controllo totale sui contenuti',
        body:
          'Testi, immagini, menu e impostazioni si aggiornano dal pannello. È la differenza fra un sito che invecchia e uno che resta vivo.',
      },
      {
        title: 'Assistente AI sempre attivo',
        body:
          'Un assistente risponde ai visitatori 24 ore su 24, riducendo le richieste ripetitive che arrivano per telefono.',
      },
    ],
    features: [
      'Pannello di amministrazione completo',
      'Assistente AI attivo h24',
      'Gestione immagini e media',
      'Modifica di contenuti e testi',
      'Personalizzazione di design e layout',
      'Gestione di menu e navigazione',
      'Configurazione di contatti e moduli',
    ],
  },
  {
    slug: 'lucacorrao',
    name: 'Luca Corrao',
    summary:
      'Sito professionale con assistente AI integrato e vetrina per la pubblicazione di strutture ricettive.',
    url: 'https://lucacorrao.com',
    image: '/lucacorrao.png',
    sectors: ['turismo-e-ricettivita', 'property-management'],
    description:
      'Sito professionale con un assistente AI integrato che risponde ai visitatori in tempo reale, unito a una vetrina in cui le strutture ricettive possono candidarsi per essere pubblicate, con un flusso di approvazione gestito da pannello.',
    highlights: [
      {
        title: 'Assistente AI per i visitatori',
        body:
          'Risponde alle domande e accompagna il visitatore attraverso i servizi, 24 ore su 24.',
      },
      {
        title: 'Vetrina con approvazione',
        body:
          'Le strutture si propongono dal sito e vengono pubblicate dopo l’approvazione: un processo di raccolta e selezione senza scambi di email.',
      },
    ],
    features: [
      'Assistente AI per il supporto',
      'Portfolio e progetti',
      'Sistema di contatto integrato',
      'Pannello di amministrazione',
      'Gallerie e gestione media',
      'Design responsive',
    ],
  },
  {
    slug: 'trattoria-da-piero',
    name: 'Trattoria da Piero',
    summary:
      'Sito su misura per una trattoria storica di Mondello, con una sezione dedicata agli ospiti illustri.',
    url: 'https://trattoriadapieromondello.site',
    location: 'Mondello, Palermo',
    sectors: ['ristorazione'],
    description:
      'Sito realizzato esattamente come richiesto dal cliente per una trattoria tipica di Mondello, a Palermo, che nel tempo ha ospitato personaggi noti italiani e internazionali. Il progetto mostra la capacità di personalizzare ogni aspetto invece di adattare un modello preconfezionato.',
    highlights: [
      {
        title: 'Sezione dedicata agli ospiti illustri',
        body:
          'Una pagina racconta i personaggi che hanno visitato la trattoria: è la storia del locale, ed è ciò che lo distingue da qualunque concorrente.',
      },
    ],
    features: [
      'Struttura e design su misura',
      'Sezione storica dedicata',
      'Presentazione del menu',
      'Contatti e indicazioni',
    ],
  },
]

export function findProject(slug: string): Project | undefined {
  return PROJECTS.find((project) => project.slug === slug)
}

export function projectsForSector(sector: string): Project[] {
  return PROJECTS.filter((project) => project.sectors.includes(sector))
}
