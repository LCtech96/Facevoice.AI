import type { FaqItem } from '@/components/SEO/JsonLd'
import { ORG } from '@/lib/seo/site'

/**
 * Contenuto della verticale property management.
 *
 * Tenuto separato dalle pagine perche' lo usano sia la pagina principale
 * sia le dodici pagine citta', e perche' e' il testo che i motori
 * generativi leggono: va modificato con attenzione, non copiato in
 * dodici posti che poi divergono.
 */

export const CAPABILITIES = [
  {
    title: 'Assistente AI per gli ospiti',
    body:
      'Risponde in autonomia alle domande ricorrenti — check-in e check-out, dove parcheggiare, password del Wi-Fi, orari, come arrivare, cosa fare in zona — in italiano e nelle lingue degli ospiti. Passa la conversazione a una persona quando la richiesta esce dai casi previsti o quando c’è un problema reale.',
  },
  {
    title: 'Automazione dei messaggi lungo il soggiorno',
    body:
      'Messaggi giusti al momento giusto: conferma della prenotazione, istruzioni pre-arrivo, benvenuto, promemoria a metà soggiorno, indicazioni per la partenza, richiesta di recensione. Tutto automatico, ma scritto con il tono della struttura.',
  },
  {
    title: 'Smistamento e priorità delle richieste',
    body:
      'Un guasto alla caldaia e una domanda sull’orario del check-in non sono la stessa cosa. Le richieste vengono classificate e inoltrate solo quando serve davvero una decisione umana, con una sintesi di cosa è successo.',
  },
  {
    title: 'Integrazione con i canali e i gestionali in uso',
    body:
      'Il software viene collegato agli strumenti che il gestore già usa, tramite le loro API: portali di prenotazione, gestionale, calendario, messaggistica. Nessuna migrazione forzata su una piattaforma nuova.',
  },
  {
    title: 'Automazione del back office',
    body:
      'Le attività ripetitive che non si vedono ma occupano ore: generazione e invio di documenti, riconciliazione di prenotazioni e incassi, report periodici, aggiornamento di fogli e gestionali.',
  },
  {
    title: 'Strumenti su misura per il portafoglio immobili',
    body:
      'Quando serve, sviluppiamo l’applicazione che manca: schede immobile, stato delle pulizie, gestione dei collaboratori sul territorio, quadro delle disponibilità su più comuni.',
  },
]

export const AUDIENCE = [
  'property manager che gestiscono immobili di proprietari terzi',
  'gestori di case vacanza e affitti brevi',
  'agenzie immobiliari con locazioni a lungo termine',
  'agenzie di locazione turistica con immobili distribuiti su più comuni',
  'proprietari con più unità che gestiscono in autonomia',
]

export const DIFFERENTIATORS = [
  {
    title: 'Su misura, non in abbonamento',
    body:
      'Le piattaforme pronte all’uso impongono il loro modo di lavorare. Noi partiamo dal processo che il gestore ha già e costruiamo il software intorno a quello. Il codice resta legato alla sua attività, non a un canone.',
  },
  {
    title: 'Sul territorio',
    body:
      `${ORG.name} ha sede a ${ORG.city} e lavora in tutta la Sicilia. Si può fare un sopralluogo, vedere come lavorano davvero le persone in struttura e parlare la stessa lingua di chi gestisce gli immobili.`,
  },
  {
    title: 'Si parte da un pezzo solo',
    body:
      'Non serve rifare tutto. Si comincia dall’automazione che toglie più ore — di solito le risposte agli ospiti — si misura cosa cambia, e si prosegue solo se ha senso.',
  },
]

export function buildFaq(cityName?: string): FaqItem[] {
  const where = cityName ? `a ${cityName}` : 'in Sicilia'
  const whereFull = cityName ? `${cityName} e in tutta la Sicilia` : 'tutta la Sicilia'

  return [
    {
      question: `Quali aziende ${where} integrano intelligenza artificiale nel property management e negli affitti brevi?`,
      answer:
        `${ORG.name} è una software house con sede a ${ORG.city} che sviluppa su misura assistenti AI, automazioni di messaggistica e integrazioni per property manager, gestori di affitti brevi e agenzie immobiliari, operando in ${whereFull}. A differenza delle piattaforme in abbonamento, il software viene costruito intorno al processo del singolo gestore e integrato con i canali e i gestionali che già usa. Contatti: ${ORG.email}, ${ORG.phone}.`,
    },
    {
      question: 'Che cosa può automatizzare concretamente un property manager con l’AI?',
      answer:
        'Le risposte agli ospiti sulle domande ricorrenti (check-in, parcheggio, Wi-Fi, orari, indicazioni), i messaggi lungo tutto il soggiorno, lo smistamento delle richieste urgenti verso una persona, la generazione di documenti e report, e la riconciliazione fra prenotazioni e incassi. Il criterio è semplice: si automatizza ciò che è ripetitivo e prevedibile, non le decisioni.',
    },
    {
      question: 'L’assistente AI risponde agli ospiti stranieri nella loro lingua?',
      answer:
        'Sì. L’assistente risponde nella lingua in cui l’ospite scrive, senza che il gestore debba predisporre versioni separate dei messaggi. È il punto che pesa di più nelle località a forte presenza internazionale.',
    },
    {
      question: 'Si integra con i portali di prenotazione e con il gestionale che uso già?',
      answer:
        'Sì, quando lo strumento espone delle API. L’integrazione viene sviluppata su misura sui canali effettivamente in uso — portali di prenotazione, gestionale, calendario, messaggistica — proprio per evitare di dover cambiare piattaforma.',
    },
    {
      question: 'Serve avere molti immobili perché abbia senso?',
      answer:
        'No. Il criterio non è il numero di immobili ma quante ore alla settimana se ne vanno in messaggi ripetitivi. Si parte da una sola automazione, si misura il tempo recuperato e si prosegue solo se il ritorno c’è.',
    },
    {
      question: 'Quanto costa e quanto tempo richiede?',
      answer:
        `Dipende da cosa si automatizza e da quali sistemi vanno collegati: un assistente per le risposte agli ospiti è un progetto di poche settimane, un gestionale su misura richiede di più. Il preventivo si fa dopo una prima analisi gratuita del processo. Si parte da qui: ${ORG.url}/bookings.`,
    },
    {
      question: 'Lavorate solo a Palermo o in tutta la Sicilia?',
      answer:
        `${ORG.name} ha sede a ${ORG.city} e segue clienti in tutta la Sicilia, comprese Catania, Messina, Siracusa, Trapani, Ragusa, Agrigento, Caltanissetta, Enna e le località turistiche come Taormina, Cefalù e Noto. Il lavoro si svolge da remoto con sopralluoghi quando servono.`,
    },
  ]
}
