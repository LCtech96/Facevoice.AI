/**
 * I progetti realizzati e la loro rassegna stampa.
 *
 * I dati vengono da components/CaseStudy.tsx, che pero' non e' montato in
 * nessuna pagina (e /case-studies e' rediretto su /home in
 * next.config.mjs): oggi questa rassegna non e' pubblicata da nessuna
 * parte. Qui serve almeno a dichiarare, in forma leggibile dalle
 * macchine, che questi lavori sono stati realizzati da Facevoice AI.
 *
 * Gli articoli di terze parti sono il segnale che pesa di piu' per un
 * motore generativo: sono fonti indipendenti che parlano dell'azienda.
 */

export type Project = {
  name: string
  url: string
  description: string
  /** Articoli e servizi giornalistici su questo progetto. */
  press?: Array<{ title: string; url: string; publisher: string }>
}

export const PROJECTS: Project[] = [
  {
    name: 'Nomadiqe',
    url: 'https://www.nomadiqe.com',
    description:
      'Piattaforma per gli affitti brevi che mette in contatto chi lavora viaggiando con host, piccoli imprenditori e attività locali. Sviluppata da Facevoice AI.',
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
    name: 'Luca Corrao',
    url: 'https://lucacorrao.com',
    description:
      'Sito con assistente AI integrato e vetrina per la pubblicazione di strutture ricettive. Sviluppato da Facevoice AI.',
  },
  {
    name: 'Barinello',
    url: 'https://barinello.com',
    description:
      'Sito con pannello di controllo amministrativo completo. Sviluppato da Facevoice AI.',
  },
  {
    name: 'Otticafocus',
    url: 'https://otticafocus.com',
    description: 'Sito per il settore ottica. Sviluppato da Facevoice AI.',
  },
  {
    name: 'Trattoria da Piero',
    url: 'https://trattoriadapieromondello.site',
    description:
      'Sito su misura per una trattoria storica di Mondello, Palermo. Sviluppato da Facevoice AI.',
  },
]
