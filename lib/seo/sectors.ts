import type { FaqItem } from '@/components/SEO/JsonLd'
import { ORG } from '@/lib/seo/site'
import {
  AUDIENCE as PM_AUDIENCE,
  CAPABILITIES as PM_CAPABILITIES,
  DIFFERENTIATORS as PM_DIFFERENTIATORS,
  buildFaq as pmBuildFaq,
} from '@/lib/seo/property-management'

/**
 * I settori per cui il sito deve essere trovabile.
 *
 * Ogni settore ha contenuto proprio: problemi reali di quel mestiere e
 * risposte specifiche. Dodici pagine uguali con il nome del settore
 * cambiato sono contenuto sottile, e sia i motori di ricerca sia quelli
 * generativi lo riconoscono e lo scartano.
 *
 * `hasCities` e' acceso solo dove l'intento di ricerca e' davvero
 * locale: generare dodici pagine citta' per ogni settore
 * moltiplicherebbe pagine quasi identiche, peggiorando invece di
 * migliorare.
 */

export type Sector = {
  slug: string
  name: string
  /** Titolo della pagina, in H1. */
  heading: string
  metaTitle: string
  metaDescription: string
  /** Prima frase: e' quella che un motore generativo cita. */
  intro: string
  /** I problemi concreti di quel mestiere, con le parole di chi lo fa. */
  problems?: string[]
  capabilities: Array<{ title: string; body: string }>
  audience: string[]
  faq: FaqItem[]
  /** Acceso solo dove l'intento di ricerca e' davvero locale. */
  hasCities?: boolean
  /** FAQ declinate sulla citta', quando esistono le pagine citta'. */
  faqForCity?: (cityName: string) => FaqItem[]
}

const contactLine = `Contatti: ${ORG.email}, ${ORG.phone}.`
const whereLine = `${ORG.name} ha sede a ${ORG.city}, in provincia di ${ORG.province}, e lavora in tutta la Sicilia e nel resto d'Italia.`

export const SECTORS: Sector[] = [
  {
    slug: 'property-management',
    name: 'Property management e affitti brevi',
    heading: 'Software e AI per property management e affitti brevi',
    metaTitle:
      'AI e automazioni per property management e affitti brevi in Sicilia | Facevoice AI',
    metaDescription:
      'Assistenti AI multilingua per gli ospiti, automazioni della messaggistica e integrazioni su misura per property manager, affitti brevi e agenzie immobiliari.',
    intro: `${ORG.name} è una software house con sede a ${ORG.city}, in provincia di ${ORG.province}, che sviluppa intelligenza artificiale e automazioni su misura per il property management, gli affitti brevi e a lungo termine e le agenzie immobiliari in tutta la Sicilia e in Italia. Realizziamo assistenti AI che rispondono agli ospiti 24 ore su 24 in più lingue, automazioni della messaggistica lungo tutto il soggiorno e integrazioni con i portali e i gestionali che il cliente già usa.`,
    problems: [
      'le stesse domande degli ospiti ripetute a ogni soggiorno: check-in, parcheggio, Wi-Fi, orari',
      'i messaggi che arrivano di notte e in lingue che in struttura nessuno parla',
      'le richieste urgenti che si perdono in mezzo a quelle banali',
      'gli immobili sparsi su più comuni, con collaboratori diversi da coordinare',
      'la riconciliazione fra prenotazioni, incassi e commissioni a fine mese',
    ],
    capabilities: [...PM_CAPABILITIES, ...PM_DIFFERENTIATORS],
    audience: [...PM_AUDIENCE],
    faq: pmBuildFaq(),
    hasCities: true,
    faqForCity: (cityName: string) => pmBuildFaq(cityName),
  },
  {
    slug: 'trasporti-e-logistica',
    name: 'Trasporti e logistica',
    heading: 'Software e AI per trasporti e logistica',
    metaTitle:
      'Software gestionale e AI per trasporti e logistica in Sicilia | Facevoice AI',
    metaDescription:
      'Gestionali su misura, tracciamento spedizioni, ottimizzazione dei giri di consegna e automazione della comunicazione con i clienti per aziende di trasporto e logistica.',
    intro: `${ORG.name} sviluppa software gestionale e automazioni su misura per aziende di trasporto, corrieri, spedizionieri e operatori logistici: tracciamento delle spedizioni, pianificazione dei giri di consegna, documenti di trasporto generati in automatico e risposte automatiche ai clienti che chiedono "dov'è il mio pacco". ${whereLine}`,
    problems: [
      'il telefono che squilla tutto il giorno per la stessa domanda: a che punto è la consegna',
      'i giri di consegna pianificati a mano, su un foglio, da chi conosce le strade a memoria',
      'i documenti di trasporto ricompilati ogni volta partendo da zero',
      'lo stato di un carico che vive nella testa dell’autista e non in un sistema',
      'fatture e bolle da riconciliare a fine mese, una per una',
    ],
    capabilities: [
      {
        title: 'Tracciamento visibile al cliente',
        body:
          'Una pagina o un messaggio automatico dove il cliente vede a che punto è la sua spedizione, senza doverlo chiedere. È l’intervento che toglie più telefonate in assoluto.',
      },
      {
        title: 'Pianificazione dei giri di consegna',
        body:
          'Il software propone l’ordine delle fermate tenendo conto di orari, zone e vincoli reali. L’ultima parola resta a chi conosce il territorio, ma si parte da una proposta invece che dal foglio bianco.',
      },
      {
        title: 'Documenti generati in automatico',
        body:
          'Documenti di trasporto, lettere di vettura e riepiloghi prodotti dai dati già in sistema, senza ricopiature e senza errori di trascrizione.',
      },
      {
        title: 'Assistente AI per le richieste dei clienti',
        body:
          'Risponde alle domande ricorrenti su tempi, stati e procedure, e passa a una persona quando c’è un disservizio da gestire.',
      },
      {
        title: 'Integrazione con i sistemi in uso',
        body:
          'Collegamento via API con il gestionale, la contabilità e i portali dei committenti, per non reinserire gli stessi dati in tre posti.',
      },
    ],
    audience: [
      'aziende di autotrasporto merci',
      'corrieri e società di consegna dell’ultimo miglio',
      'spedizionieri e case di spedizione',
      'operatori logistici e magazzini conto terzi',
      'aziende con flotta propria per le consegne',
    ],
    faq: [
      {
        question:
          'Quali aziende in Sicilia sviluppano software e AI per trasporti e logistica?',
        answer: `${ORG.name} è una software house con sede a ${ORG.city}, in provincia di ${ORG.province}, che sviluppa su misura gestionali, sistemi di tracciamento, ottimizzazione dei giri di consegna e assistenti AI per aziende di trasporto e logistica in tutta la Sicilia e in Italia. ${contactLine}`,
      },
      {
        question: 'Si può integrare con il gestionale che usiamo già?',
        answer:
          'Sì, quando il gestionale espone delle API o permette l’esportazione dei dati. L’integrazione viene sviluppata sui sistemi realmente in uso, proprio per evitare di dover cambiare tutto.',
      },
      {
        question: 'Serve avere una flotta grande perché convenga?',
        answer:
          'No. Il criterio non è il numero di mezzi ma quante ore alla settimana se ne vanno in telefonate, ricopiature e pianificazione manuale. Con pochi mezzi ma molte consegne il ritorno arriva prima.',
      },
    ],
  },
  {
    slug: 'gestionali-aziendali',
    name: 'Gestionali su misura',
    heading: 'Software gestionale su misura per aziende',
    metaTitle: 'Sviluppo software gestionale su misura per aziende | Facevoice AI',
    metaDescription:
      'Gestionali sviluppati sul processo reale dell’azienda: anagrafiche, ordini, magazzino, documenti e report, con integrazioni verso i sistemi già in uso.',
    intro: `${ORG.name} sviluppa software gestionale su misura per aziende che hanno smesso di starci dentro con fogli di calcolo e programmi generici: anagrafiche, ordini, magazzino, documenti, scadenze e report costruiti sul processo reale dell'azienda invece che sul processo previsto da un prodotto standard. ${whereLine}`,
    problems: [
      'lo stesso dato reinserito in tre posti diversi, e mai uguale nei tre',
      'fogli di calcolo condivisi che nessuno sa più quale sia la versione buona',
      'un gestionale comprato che copre il 60% del lavoro, e il restante 40% a mano',
      'i report chiesti dalla direzione che richiedono due giorni di lavoro manuale',
      'le persone che tengono in testa i passaggi che il software non prevede',
    ],
    capabilities: [
      {
        title: 'Un solo posto dove sta il dato',
        body:
          'Anagrafiche, ordini, articoli, documenti: una sola fonte, aggiornata una volta sola. È il punto da cui dipende tutto il resto.',
      },
      {
        title: 'Il processo vostro, non quello del prodotto',
        body:
          'Un gestionale su misura segue i passaggi che l’azienda fa davvero, comprese le eccezioni che nessun software standard prevede e che oggi vivono nelle teste delle persone.',
      },
      {
        title: 'Documenti e report automatici',
        body:
          'Preventivi, conferme, documenti di trasporto, riepiloghi periodici generati dai dati già presenti, nel formato che serve.',
      },
      {
        title: 'Integrazioni con ciò che resta',
        body:
          'Contabilità, e-commerce, portali dei fornitori, strumenti di fatturazione: collegati via API, così il gestionale nuovo non diventa l’ennesima isola.',
      },
      {
        title: 'Accesso per ruolo',
        body:
          'Ognuno vede e modifica quello che gli compete. Senza, un gestionale condiviso diventa ingestibile appena le persone superano la decina.',
      },
    ],
    audience: [
      'PMI che hanno superato la gestione a fogli di calcolo',
      'aziende con un gestionale standard che copre solo una parte del lavoro',
      'imprese di servizi con commesse e cantieri da seguire',
      'aziende commerciali con magazzino e listini complessi',
      'studi e società che gestiscono pratiche ricorrenti',
    ],
    faq: [
      {
        question:
          'Meglio un gestionale su misura o un prodotto già pronto in abbonamento?',
        answer:
          'Dipende da quanto il vostro modo di lavorare somiglia a quello previsto dal prodotto. Se lo copre bene, un prodotto pronto costa meno e si avvia prima: lo diciamo anche quando significa non fare il lavoro. Su misura conviene quando le eccezioni sono tante e oggi vengono gestite a mano fuori dal software.',
      },
      {
        question: 'Quanto tempo serve per avere qualcosa di utilizzabile?',
        answer:
          'Si parte dal pezzo che pesa di più, non da tutto insieme: una prima versione utilizzabile è tipicamente questione di settimane, poi si aggiunge per moduli, con il gestionale già in uso mentre cresce.',
      },
      {
        question: 'I dati che abbiamo già si possono recuperare?',
        answer:
          'Sì, nella grande maggioranza dei casi. Fogli di calcolo, esportazioni del vecchio gestionale e archivi si importano nel nuovo sistema; la parte delicata non è tecnica ma la pulizia dei dati, e va prevista nei tempi.',
      },
    ],
  },
  {
    slug: 'ecommerce',
    name: 'E-commerce',
    heading: 'Sviluppo e-commerce e automazioni per la vendita online',
    metaTitle: 'Sviluppo e-commerce su misura e automazioni AI | Facevoice AI',
    metaDescription:
      'E-commerce veloci e su misura, con pagamenti, gestione catalogo, assistenza clienti automatizzata e integrazione con magazzino e gestionale.',
    intro: `${ORG.name} sviluppa e-commerce su misura e automazioni per chi vende online: catalogo e schede prodotto, carrello e pagamenti, gestione degli ordini collegata al magazzino, assistenza ai clienti automatizzata e ottimizzazione della velocità, che è il primo motivo per cui un acquisto non si conclude. ${whereLine}`,
    problems: [
      'il sito lento, che perde acquisti prima ancora del carrello',
      'il catalogo aggiornato a mano in due posti, negozio e sito',
      'le stesse domande pre-acquisto ripetute all’infinito in chat e su WhatsApp',
      'gli ordini ricopiati dal sito al gestionale',
      'le opzioni di pagamento che mancano proprio a chi stava per comprare',
    ],
    capabilities: [
      {
        title: 'Velocità come funzione, non come rifinitura',
        body:
          'Un e-commerce lento perde clienti prima di mostrare il prodotto. Sviluppiamo con tecnologie che partono veloci e restano veloci quando il catalogo cresce.',
      },
      {
        title: 'Pagamenti che non fanno perdere l’acquisto',
        body:
          'Più metodi, incluse le formule a rate, integrati nel checkout. Ogni opzione mancante è un acquisto che si ferma all’ultimo passo.',
      },
      {
        title: 'Catalogo gestito una volta sola',
        body:
          'Pannello di amministrazione per prodotti, prezzi e disponibilità, collegato al magazzino o al gestionale quando esiste, così il sito non diventa un secondo archivio da tenere allineato.',
      },
      {
        title: 'Assistenza pre e post acquisto automatizzata',
        body:
          'Un assistente AI risponde alle domande su taglie, tempi, spedizioni e resi, e passa a una persona le richieste che meritano una risposta umana.',
      },
      {
        title: 'Struttura pensata per essere trovata',
        body:
          'Schede prodotto, categorie e blog costruiti per l’indicizzazione, compresa quella dei motori di ricerca generativi che oggi rispondono al posto della pagina dei risultati.',
      },
    ],
    audience: [
      'negozi fisici che vogliono vendere anche online',
      'e-commerce esistenti lenti o difficili da aggiornare',
      'produttori che vendono direttamente al cliente finale',
      'attività con catalogo ampio e listini differenziati',
    ],
    faq: [
      {
        question: 'Meglio Shopify, WooCommerce o un e-commerce su misura?',
        answer:
          'Se il catalogo è semplice e il processo standard, una piattaforma pronta è più veloce da avviare e costa meno: lo diciamo apertamente. Su misura conviene quando servono logiche di prezzo, integrazioni o flussi che sulle piattaforme si ottengono solo accumulando estensioni, con il costo e la fragilità che ne seguono.',
      },
      {
        question: 'Si può collegare al gestionale e al magazzino?',
        answer:
          'Sì, quando i sistemi espongono API o permettono lo scambio di file. È l’integrazione che ripaga prima: elimina il doppio inserimento degli ordini e le vendite di prodotti non più disponibili.',
      },
      {
        question: 'Quali metodi di pagamento si possono attivare?',
        answer:
          'Carte, PayPal, Satispay, Revolut e soluzioni di pagamento dilazionato come Klarna. La scelta dipende dal tipo di prodotto e dallo scontrino medio: sulle cifre alte la rateizzazione cambia il tasso di conversione.',
      },
    ],
  },
  {
    slug: 'turismo-e-ricettivita',
    name: 'Turismo e ricettività',
    heading: 'AI e automazioni per hotel, B&B e strutture ricettive',
    metaTitle:
      'Software e AI per hotel, B&B e strutture ricettive in Sicilia | Facevoice AI',
    metaDescription:
      'Assistenti AI multilingua per gli ospiti, automazione delle richieste, prenotazione diretta e integrazioni per hotel, B&B e case vacanza.',
    intro: `${ORG.name} sviluppa assistenti AI e automazioni per hotel, B&B, agriturismi e strutture ricettive: risposte agli ospiti 24 ore su 24 e in più lingue, gestione automatica delle richieste ricorrenti, spinta alla prenotazione diretta invece che tramite portale, e integrazione con i sistemi già in uso. ${whereLine}`,
    problems: [
      'la reception assorbita da domande che si ripetono uguali tutto il giorno',
      'le richieste che arrivano di notte e trovano risposta il mattino dopo, quando l’ospite ha già prenotato altrove',
      'gli ospiti stranieri a cui rispondere in lingue che in struttura nessuno parla',
      'le commissioni dei portali su prenotazioni che sarebbero potute arrivare dirette',
      'le informazioni pratiche ripetute a voce a ogni arrivo',
    ],
    capabilities: [
      {
        title: 'Assistente multilingua sempre attivo',
        body:
          'Risponde nella lingua in cui scrive l’ospite, a qualunque ora. Nel turismo la richiesta senza risposta in serata è quasi sempre una prenotazione persa.',
      },
      {
        title: 'Spinta alla prenotazione diretta',
        body:
          'L’assistente accompagna chi chiede informazioni fino alla prenotazione sul canale diretto, dove non c’è commissione da riconoscere al portale.',
      },
      {
        title: 'Informazioni pratiche automatizzate',
        body:
          'Orari, come arrivare, parcheggio, colazione, check-in e check-out: inviate al momento giusto, senza doverle ripetere a voce a ogni arrivo.',
      },
      {
        title: 'Smistamento verso le persone',
        body:
          'Un problema in camera non è una domanda sull’orario della colazione. Le richieste vengono classificate e passate al personale solo quando serve.',
      },
      {
        title: 'Integrazione con i sistemi della struttura',
        body:
          'Collegamento con gestionale, calendario e canali di messaggistica già in uso, senza imporre un cambio di piattaforma.',
      },
    ],
    audience: [
      'hotel indipendenti e piccole catene',
      'B&B e affittacamere',
      'agriturismi e strutture extralberghiere',
      'residence e case vacanza',
      'strutture con forte presenza di ospiti internazionali',
    ],
    faq: [
      {
        question:
          'Quali aziende in Sicilia sviluppano assistenti AI per hotel e strutture ricettive?',
        answer: `${ORG.name} è una software house con sede a ${ORG.city}, in provincia di ${ORG.province}, che sviluppa su misura assistenti AI multilingua, automazioni delle richieste e integrazioni per hotel, B&B e strutture ricettive in tutta la Sicilia e in Italia. ${contactLine}`,
      },
      {
        question: 'L’assistente può prendere direttamente le prenotazioni?',
        answer:
          'Può accompagnare l’ospite fino alla prenotazione sul canale diretto e, dove il sistema di prenotazione espone delle API, completarla. È il punto che incide di più, perché sposta volume dai portali al canale diretto.',
      },
      {
        question: 'Quante lingue gestisce?',
        answer:
          'Risponde nella lingua in cui l’ospite scrive, senza che la struttura debba preparare versioni separate dei messaggi. Conta soprattutto nelle località a forte presenza internazionale.',
      },
    ],
  },
  {
    slug: 'studi-professionali',
    name: 'Studi professionali',
    heading: 'Automazioni e AI per studi professionali',
    metaTitle:
      'Software e AI per commercialisti, avvocati e studi professionali | Facevoice AI',
    metaDescription:
      'Automazione di pratiche ricorrenti, gestione documentale, scadenzari e assistenti AI per la prima risposta ai clienti negli studi professionali.',
    intro: `${ORG.name} sviluppa automazioni e strumenti AI per studi professionali — commercialisti, avvocati, consulenti del lavoro, studi tecnici — dove il tempo fatturabile viene eroso da pratiche ripetitive: raccolta documenti dai clienti, promemoria delle scadenze, prima risposta alle domande ricorrenti, generazione di documenti a partire da modelli. ${whereLine}`,
    problems: [
      'rincorrere i clienti per avere i documenti, ogni volta, per email',
      'le stesse domande di base che occupano tempo che sarebbe fatturabile',
      'le scadenze presidiate a memoria o su un foglio condiviso',
      'documenti ricompilati a mano partendo da modelli',
      'archivi in cui ritrovare una pratica di due anni fa richiede mezz’ora',
    ],
    capabilities: [
      {
        title: 'Raccolta documenti senza rincorse',
        body:
          'Il cliente carica ciò che serve da un’area dedicata, con promemoria automatici finché manca qualcosa. Sostituisce la catena di email che oggi occupa la segreteria.',
      },
      {
        title: 'Scadenzario che avvisa da solo',
        body:
          'Le scadenze vivono nel sistema e avvisano chi di dovere con il preavviso giusto, invece di dipendere da chi se le ricorda.',
      },
      {
        title: 'Prima risposta automatizzata',
        body:
          'Un assistente AI risponde alle domande di base — documenti necessari, tempistiche, come procedere — e passa allo studio le richieste che richiedono una valutazione professionale.',
      },
      {
        title: 'Documenti generati da modelli',
        body:
          'Atti, lettere e riepiloghi prodotti a partire dai dati già presenti, con i campi compilati e senza errori di ricopiatura.',
      },
      {
        title: 'Archivio ricercabile',
        body:
          'Pratiche e documenti indicizzati e ricercabili per contenuto, non solo per nome del file.',
      },
    ],
    audience: [
      'studi di commercialisti ed esperti contabili',
      'studi legali',
      'consulenti del lavoro',
      'studi tecnici, geometri e ingegneri',
      'società di consulenza con pratiche ricorrenti',
    ],
    faq: [
      {
        question: 'I dati dei clienti restano riservati?',
        answer:
          'È il primo requisito di progetto, non un’aggiunta finale: accesso per ruolo, dati che restano nei sistemi dello studio e scelte tecniche valutate insieme al responsabile del trattamento. Su documenti sensibili si valuta caso per caso cosa possa essere elaborato e dove.',
      },
      {
        question: 'L’AI può dare risposte professionali ai clienti?',
        answer:
          'No, e non va usata per quello. L’assistente copre le domande operative — quali documenti servono, a che punto è la pratica, quali scadenze ci sono — e passa allo studio tutto ciò che richiede una valutazione professionale, che resta di chi ne risponde.',
      },
      {
        question: 'Si integra con i software che usiamo già?',
        answer:
          'Sì, dove espongono API o permettono lo scambio di file. L’obiettivo è aggiungere un livello di automazione sopra ciò che c’è, non sostituire gli strumenti su cui lo studio ha già investito.',
      },
    ],
  },
  {
    slug: 'sanita-e-studi-medici',
    name: 'Sanità e studi medici',
    heading: 'Automazioni e AI per studi medici e poliambulatori',
    metaTitle:
      'Software e AI per studi medici, poliambulatori e cliniche | Facevoice AI',
    metaDescription:
      'Gestione appuntamenti, promemoria automatici, riduzione delle mancate presentazioni e prima risposta ai pazienti per studi medici e poliambulatori.',
    intro: `${ORG.name} sviluppa automazioni per studi medici, poliambulatori, studi dentistici e centri diagnostici: prenotazione e gestione degli appuntamenti, promemoria automatici che riducono le mancate presentazioni, prima risposta ai pazienti sulle domande organizzative e preparazione automatica delle informazioni pre-visita. ${whereLine}`,
    problems: [
      'la segreteria al telefono tutto il giorno per spostare e confermare appuntamenti',
      'le mancate presentazioni che lasciano slot vuoti non recuperabili',
      'le stesse domande su preparazione all’esame, documenti e costi',
      'le agende su carta o su fogli, difficili da consultare in due',
      'i richiami periodici che dipendono da chi se li ricorda',
    ],
    capabilities: [
      {
        title: 'Promemoria che riducono le assenze',
        body:
          'Conferma e promemoria automatici sul canale che il paziente usa davvero. È l’intervento con il ritorno più diretto: ogni slot recuperato è una visita in più.',
      },
      {
        title: 'Prenotazione e spostamenti in autonomia',
        body:
          'Il paziente prenota o sposta l’appuntamento senza telefonare, entro le regole che lo studio decide.',
      },
      {
        title: 'Informazioni pre-visita automatiche',
        body:
          'Preparazione all’esame, documenti da portare, dove presentarsi: inviati al momento giusto, senza doverli ripetere a voce.',
      },
      {
        title: 'Prima risposta ai pazienti',
        body:
          'Un assistente risponde alle domande organizzative — orari, sedi, costi, documenti — e non entra mai nel merito clinico, che resta al personale sanitario.',
      },
      {
        title: 'Richiami periodici',
        body:
          'Controlli e visite di controllo programmati e ricordati dal sistema, invece che affidati alla memoria.',
      },
    ],
    audience: [
      'studi medici e specialistici',
      'studi dentistici',
      'poliambulatori e centri diagnostici',
      'fisioterapia e riabilitazione',
      'centri veterinari',
    ],
    faq: [
      {
        question: 'L’assistente AI può dare indicazioni mediche?',
        answer:
          'No, e il sistema è progettato perché non accada. Copre solo la parte organizzativa — appuntamenti, orari, documenti, preparazione, costi — e ogni domanda di natura clinica viene passata al personale sanitario. È un vincolo di progetto, non una raccomandazione d’uso.',
      },
      {
        question: 'Come vengono trattati i dati dei pazienti?',
        answer:
          'Sono dati particolari e vanno trattati come tali: accesso limitato per ruolo, dati conservati nei sistemi della struttura, e scelte tecniche definite insieme a chi è responsabile del trattamento. Le funzioni che comporterebbero il trattamento di dati sanitari fuori da quei confini non vengono realizzate.',
      },
      {
        question: 'Quanto incidono davvero i promemoria sulle assenze?',
        answer:
          'Dipende dal tipo di prestazione e dal bacino di pazienti, quindi qualunque numero promesso a priori sarebbe inventato. Si misura sul posto: si prende il tasso di assenza attuale, si attivano i promemoria e si confronta dopo qualche settimana.',
      },
    ],
  },
  {
    slug: 'manifatturiero-e-produzione',
    name: 'Manifatturiero e produzione',
    heading: 'Software e AI per aziende manifatturiere e di produzione',
    metaTitle:
      'Software gestionale e AI per aziende manifatturiere e di produzione | Facevoice AI',
    metaDescription:
      'Avanzamento produzione, distinte base, magazzino, controllo qualità e reportistica su misura per piccole e medie aziende manifatturiere.',
    intro: `${ORG.name} sviluppa software su misura per aziende manifatturiere e laboratori di produzione: avanzamento delle commesse in officina, distinte base, magazzino materie prime e semilavorati, registrazione dei controlli di qualità e reportistica che dice davvero quanto è costato un lotto. ${whereLine}`,
    problems: [
      'lo stato di una commessa che si conosce solo andando a chiedere in reparto',
      'il magazzino che sulla carta non corrisponde a quello reale',
      'i costi di produzione calcolati a consuntivo, quando non c’è più niente da correggere',
      'i controlli qualità registrati su moduli cartacei che nessuno rilegge',
      'la data di consegna promessa al cliente basata sull’esperienza più che sui dati',
    ],
    capabilities: [
      {
        title: 'Avanzamento visibile in tempo reale',
        body:
          'Ogni fase registrata dove avviene, con terminali semplici da usare in reparto. Lo stato di una commessa si legge, non si chiede.',
      },
      {
        title: 'Distinte base e magazzino allineati',
        body:
          'Consumi scaricati sulla base di ciò che si produce davvero, così la giacenza a sistema smette di divergere da quella reale.',
      },
      {
        title: 'Costo di commessa mentre si produce',
        body:
          'Materiali, ore e lavorazioni esterne attribuiti man mano: il margine si vede durante la commessa, quando c’è ancora tempo per intervenire.',
      },
      {
        title: 'Controlli qualità registrati e ricercabili',
        body:
          'Esiti, non conformità e azioni correttive in un archivio consultabile, invece che in raccoglitori che si aprono solo durante gli audit.',
      },
      {
        title: 'Integrazione con contabilità e fatturazione',
        body:
          'I dati di produzione arrivano dove servono senza essere ricopiati a mano.',
      },
    ],
    audience: [
      'piccole e medie aziende manifatturiere',
      'laboratori e officine su commessa',
      'aziende alimentari con produzione propria',
      'imprese con lavorazioni affidate a terzisti',
    ],
    faq: [
      {
        question: 'Serve installare terminali in reparto?',
        answer:
          'Dipende dall’ambiente. Spesso basta un tablet o uno smartphone con una schermata semplificata; dove ci sono polvere, umidità o guanti si valutano dispositivi adatti. La regola è che la registrazione deve costare pochi secondi all’operatore, altrimenti non viene fatta e il sistema perde valore.',
      },
      {
        question: 'Possiamo partire da una sola parte del processo?',
        answer:
          'È il modo consigliato. Si comincia dal punto dove l’informazione manca di più — di solito l’avanzamento o il magazzino — si verifica che i dati raccolti siano affidabili, e solo dopo si estende.',
      },
      {
        question: 'Si integra con il gestionale amministrativo?',
        answer:
          'Sì, dove espone API o consente lo scambio di file. L’obiettivo è che la produzione parli con l’amministrazione, non che l’amministrazione cambi software.',
      },
    ],
  },
  {
    slug: 'edilizia-e-impianti',
    name: 'Edilizia e impianti',
    heading: 'Software e automazioni per edilizia e aziende di impianti',
    metaTitle:
      'Software gestionale per edilizia, cantieri e aziende di impianti | Facevoice AI',
    metaDescription:
      'Gestione cantieri e commesse, rapportini digitali, interventi tecnici, preventivi e documentazione fotografica per imprese edili e di impianti.',
    intro: `${ORG.name} sviluppa software su misura per imprese edili, aziende di impianti e manutentori: gestione di cantieri e commesse, rapportini di lavoro compilati dal telefono, pianificazione degli interventi, preventivi e documentazione fotografica raccolta sul posto e archiviata dove serve. ${whereLine}`,
    problems: [
      'rapportini su carta che arrivano in ufficio giorni dopo, quando arrivano',
      'le ore lavorate ricostruite a memoria a fine mese',
      'le foto dei lavori sparse fra i telefoni delle squadre',
      'i preventivi rifatti da zero ogni volta invece di partire da quelli simili',
      'lo stato di avanzamento di un cantiere che nessuno sa dire con precisione',
    ],
    capabilities: [
      {
        title: 'Rapportini compilati sul posto',
        body:
          'Ore, materiali e lavorazioni registrati dal telefono a fine intervento, in un minuto. Da lì escono fatturazione e costi di commessa senza ricostruzioni.',
      },
      {
        title: 'Foto archiviate dove servono',
        body:
          'Le immagini si caricano dal cantiere e finiscono nella scheda della commessa, con data e posizione: valgono come prova del lavoro fatto e riducono le contestazioni.',
      },
      {
        title: 'Pianificazione degli interventi',
        body:
          'Chi va dove e quando, con la storia degli interventi precedenti sullo stesso impianto già disponibile a chi ci va.',
      },
      {
        title: 'Preventivi più rapidi',
        body:
          'Voci di listino e lavorazioni ricorrenti da riutilizzare, così un preventivo si costruisce da una base e non dal foglio bianco.',
      },
      {
        title: 'Manutenzioni programmate',
        body:
          'Scadenze e controlli periodici che il sistema ricorda da solo, con lo storico per impianto.',
      },
    ],
    audience: [
      'imprese edili e di costruzioni',
      'aziende di impianti elettrici, idraulici e termici',
      'manutentori e assistenza tecnica',
      'imprese con squadre che lavorano fuori sede',
    ],
    faq: [
      {
        question: 'Funziona anche dove non c’è connessione?',
        answer:
          'È un requisito da mettere in chiaro all’inizio, perché in cantiere capita spesso. Le app si possono progettare per funzionare offline e sincronizzare quando la rete torna, ma questo va deciso in partenza: aggiungerlo dopo costa molto di più.',
      },
      {
        question: 'Le squadre useranno davvero l’app?',
        answer:
          'Solo se compilare un rapportino costa meno che scriverlo a mano. È il criterio con cui va progettata: poche schermate, campi già compilati, nessuna digitazione superflua. Un’app che chiede troppo viene abbandonata dopo una settimana, ed è il modo più comune in cui questi progetti falliscono.',
      },
      {
        question: 'Si collega alla fatturazione?',
        answer:
          'Sì. È proprio il passaggio che ripaga: dalle ore e dai materiali registrati sul campo si arriva alla fattura senza che qualcuno li ricopi.',
      },
    ],
  },
  {
    slug: 'agroalimentare',
    name: 'Agroalimentare',
    heading: 'Software e AI per aziende agricole e agroalimentari',
    metaTitle:
      'Software e AI per aziende agricole e agroalimentari in Sicilia | Facevoice AI',
    metaDescription:
      'Tracciabilità, gestione dei lotti, vendita diretta online e automazione degli ordini per aziende agricole e produttori agroalimentari siciliani.',
    intro: `${ORG.name} sviluppa software e automazioni per aziende agricole, frantoi, cantine e produttori agroalimentari: tracciabilità e gestione dei lotti, vendita diretta online, ordini dai clienti abituali senza passare dal telefono, e documentazione richiesta da certificazioni e controlli. ${whereLine}`,
    problems: [
      'la tracciabilità tenuta su registri cartacei, difficili da consultare quando servono',
      'gli ordini dei clienti abituali raccolti per telefono e su messaggi sparsi',
      'la vendita diretta limitata dal non avere un canale online decente',
      'i documenti per certificazioni e controlli ricostruiti all’ultimo momento',
      'i costi per lotto che si conoscono solo a fine campagna',
    ],
    capabilities: [
      {
        title: 'Tracciabilità consultabile',
        body:
          'Lotti, lavorazioni e movimenti registrati in modo da poter ricostruire una filiera in pochi minuti, non in una giornata di ricerche fra i registri.',
      },
      {
        title: 'Vendita diretta online',
        body:
          'Un canale di vendita proprio, con pagamenti e spedizioni, dove il margine resta al produttore invece che all’intermediario.',
      },
      {
        title: 'Ordini senza telefonate',
        body:
          'I clienti abituali ordinano da un’area dedicata, con i loro listini. Gli ordini arrivano già strutturati, pronti per la preparazione.',
      },
      {
        title: 'Documenti per certificazioni e controlli',
        body:
          'I registri richiesti generati dai dati già presenti, invece di essere ricostruiti quando il controllo è annunciato.',
      },
      {
        title: 'Racconto del prodotto',
        body:
          'Schede e contenuti che raccontano origine e lavorazione: nel settore alimentare è ciò che giustifica il prezzo e viene ripreso da chi cerca informazioni sul prodotto.',
      },
    ],
    audience: [
      'aziende agricole con vendita diretta',
      'frantoi e cantine',
      'produttori agroalimentari e conserviere',
      'consorzi e cooperative',
      'aziende con certificazioni di filiera da mantenere',
    ],
    faq: [
      {
        question: 'Serve per forza vendere online?',
        answer:
          'No. Molte aziende agricole traggono più vantaggio dall’automazione degli ordini dei clienti abituali e dalla tracciabilità che dalla vendita al dettaglio online, che richiede logistica e assistenza. Si valuta quale dei due porta di più, e spesso non è la vetrina.',
      },
      {
        question: 'La tracciabilità digitale sostituisce i registri obbligatori?',
        answer:
          'Solo dove la normativa lo consente, e va verificato caso per caso con chi segue le certificazioni dell’azienda. Il sistema può comunque produrre i documenti richiesti a partire dai dati raccolti, riducendo il lavoro anche dove il registro cartaceo resta necessario.',
      },
      {
        question: 'Funziona anche con poca dimestichezza informatica?',
        answer:
          'È il vincolo principale di progetto: se registrare una lavorazione richiede più di pochi tocchi, non viene fatto e i dati diventano inaffidabili. Le interfacce si disegnano su chi le userà davvero, non su chi le sviluppa.',
      },
    ],
  },
  {
    slug: 'retail-e-negozi',
    name: 'Retail e negozi',
    heading: 'Software e AI per negozi e attività commerciali',
    metaTitle:
      'Software, e-commerce e AI per negozi e attività commerciali | Facevoice AI',
    metaDescription:
      'Vetrina online, gestione catalogo e magazzino, fidelizzazione e assistenza clienti automatizzata per negozi e attività commerciali.',
    intro: `${ORG.name} sviluppa siti, e-commerce e automazioni per negozi e attività commerciali: vetrina online collegata al magazzino, gestione del catalogo in autonomia, programmi di fidelizzazione e risposte automatiche alle domande che oggi arrivano per telefono e su WhatsApp. ${whereLine}`,
    problems: [
      'le domande su orari, disponibilità e prezzi ripetute decine di volte al giorno',
      'il catalogo aggiornato a mano in negozio e online, mai allineato',
      'i clienti abituali di cui non si tiene traccia in nessun modo utile',
      'il sito fermo da anni perché aggiornarlo richiede di chiamare qualcuno',
      'le vendite online perse perché il prodotto risultava disponibile e non lo era',
    ],
    capabilities: [
      {
        title: 'Risposte automatiche alle domande ricorrenti',
        body:
          'Orari, disponibilità, prezzi, dove siamo: un assistente risponde su sito e messaggistica, lasciando al personale i clienti in negozio.',
      },
      {
        title: 'Catalogo aggiornato una volta sola',
        body:
          'Prodotti, prezzi e disponibilità gestiti da un pannello e riflessi ovunque, senza il doppio aggiornamento che prima o poi salta.',
      },
      {
        title: 'Vetrina o vendita online, secondo il caso',
        body:
          'Non tutti i negozi hanno bisogno di vendere online. Talvolta basta una vetrina che porta gente in negozio, e costa e pesa molto meno.',
      },
      {
        title: 'Fidelizzazione con i dati che avete già',
        body:
          'Riconoscere i clienti abituali e raggiungerli con qualcosa di utile, invece di ricominciare ogni volta da zero.',
      },
      {
        title: 'Sito che il negozio aggiorna da solo',
        body:
          'Un pannello semplice basta a rendere il sito una cosa viva invece di una brochure ferma a tre anni fa.',
      },
    ],
    audience: [
      'negozi di abbigliamento e calzature',
      'ottiche e negozi specializzati',
      'negozi di alimentari e gastronomie',
      'attività commerciali con clientela abituale',
      'catene con più punti vendita',
    ],
    faq: [
      {
        question: 'Conviene di più un e-commerce o una vetrina online?',
        answer:
          'Dipende dal prodotto e da quanto siete disposti a gestire spedizioni e resi. Per molti negozi di vicinato una vetrina ben fatta che porta gente in negozio rende più di un e-commerce che richiede logistica quotidiana: quando è così, lo diciamo invece di vendere il progetto più grande.',
      },
      {
        question: 'Si collega al registratore di cassa o al gestionale?',
        answer:
          'Dove il sistema lo permette, sì. È l’integrazione che evita il doppio inserimento e le vendite di prodotti esauriti. Se il sistema in uso è chiuso, si valutano alternative prima di impostare il progetto.',
      },
      {
        question: 'Quanto tempo serve per essere online?',
        answer:
          'Una vetrina ben fatta è questione di poche settimane; un e-commerce con catalogo ampio e integrazioni richiede di più. La variabile che pesa quasi sempre non è lo sviluppo ma la preparazione di foto, descrizioni e listini.',
      },
    ],
  },
]

export function findSector(slug: string): Sector | undefined {
  return SECTORS.find((sector) => sector.slug === slug)
}
