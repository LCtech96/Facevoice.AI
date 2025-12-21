'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  Brain, 
  Link as LinkIcon, 
  Code, 
  MessageSquare, 
  Settings, 
  Bot,
  X,
  Plus,
  ChevronDown
} from 'lucide-react'

// Settori di business
const businessSectors = [
  'Restaurant',
  'Insurance',
  'Sales',
  'Recruiter',
  'Healthcare',
  'E-commerce',
  'Real Estate',
  'Education',
  'Finance',
  'Legal',
  'Manufacturing',
  'Hospitality',
  'Retail',
  'Transportation',
  'Marketing',
]

// Esempi pratici per ogni combinazione servizio + settore
const getSectorExamples = (serviceId: number, sector: string): string[] => {
  const examples: Record<string, Record<string, string[]>> = {
    '1': { // AI Integration & Solutions
      'Restaurant': [
        'Sistema AI che suggerisce menu personalizzati in base alle preferenze dei clienti',
        'Analisi predittiva per ottimizzare gli ordini e ridurre gli sprechi alimentari',
        'Chatbot per prenotazioni e risposte rapide alle domande dei clienti',
      ],
      'Insurance': [
        'AI per valutare automaticamente i rischi e calcolare premi personalizzati',
        'Sistema di riconoscimento documenti per velocizzare le pratiche',
        'Analisi predittiva per prevenire frodi e ottimizzare i processi',
      ],
      'Sales': [
        'AI che analizza i dati dei clienti per suggerire prodotti migliori',
        'Sistema di previsione vendite basato su dati storici e tendenze',
        'Assistente AI che aiuta i venditori con risposte immediate ai clienti',
      ],
      'Recruiter': [
        'AI che analizza CV e trova i candidati più adatti alle posizioni',
        'Sistema di matching automatico tra candidati e offerte di lavoro',
        'Chatbot per rispondere alle domande dei candidati 24/7',
      ],
      'Healthcare': [
        'AI per analisi immagini mediche (raggi X, risonanze) con accuratezza del 95%+',
        'Sistema predittivo per identificare pazienti a rischio di complicazioni post-operatorie',
        'Chatbot medico per triage iniziale e prenotazione visite, riducendo attese del 40%',
      ],
      'E-commerce': [
        'Raccomandazioni prodotti personalizzate che aumentano le vendite del 30%',
        'AI per pricing dinamico basato su domanda, concorrenza e stagionalità',
        'Sistema anti-frode che analizza pattern di acquisto e previene transazioni sospette',
      ],
      'Real Estate': [
        'AI per valutazione automatica immobiliare basata su dati di mercato e caratteristiche',
        'Sistema di matching intelligente tra richieste clienti e proprietà disponibili',
        'Analisi predittiva per identificare aree con potenziale di crescita valore immobiliare',
      ],
      'Education': [
        'AI per personalizzazione percorsi formativi basata su stile apprendimento',
        'Sistema di valutazione automatica compiti e feedback istantaneo agli studenti',
        'Tutor virtuale che adatta difficoltà esercizi in base alle performance dello studente',
      ],
      'Finance': [
        'AI per analisi rischio creditizio che riduce default del 25%',
        'Sistema di trading algoritmico che esegue operazioni in millisecondi',
        'Rilevamento anomalie transazioni per prevenire frodi finanziarie in tempo reale',
      ],
      'Legal': [
        'AI per ricerca documenti legali che riduce tempi ricerca del 70%',
        'Sistema di analisi contratti che identifica clausole a rischio automaticamente',
        'Assistente virtuale per risposte a domande legali comuni 24/7',
      ],
      'Manufacturing': [
        'AI per manutenzione predittiva che riduce downtime del 35%',
        'Sistema di controllo qualità automatico con riconoscimento difetti in produzione',
        'Ottimizzazione produzione in tempo reale basata su domanda e risorse disponibili',
      ],
      'Hospitality': [
        'AI per pricing dinamico camere d\'hotel basato su occupazione e eventi locali',
        'Sistema di personalizzazione esperienza ospiti basato su preferenze storiche',
        'Chatbot per gestione prenotazioni e richieste ospiti, riducendo costi supporto del 50%',
      ],
      'Retail': [
        'AI per previsione domanda che riduce stock-out del 20% e sprechi del 15%',
        'Sistema di analisi comportamento clienti in-store per ottimizzare layout',
        'Raccomandazioni prodotti cross-sell che aumentano valore ordine medio del 25%',
      ],
      'Transportation': [
        'AI per ottimizzazione rotte che riduce consumi carburante del 15%',
        'Sistema predittivo manutenzione flotte che previene guasti e riduce costi',
        'Analisi traffico in tempo reale per routing dinamico e riduzione tempi consegna',
      ],
      'Marketing': [
        'AI per segmentazione clienti avanzata che migliora conversioni del 40%',
        'Sistema di ottimizzazione campagne pubblicitarie con A/B testing automatico',
        'Analisi sentiment social media per monitorare brand reputation in tempo reale',
      ],
    },
    '2': { // Blockchain Development
      'Restaurant': [
        'Tracciabilità completa della filiera alimentare dal produttore al piatto',
        'Sistema di pagamenti sicuri e trasparenti per clienti e fornitori',
        'Certificazioni digitali per ingredienti biologici e di qualità',
      ],
      'Insurance': [
        'Smart contract per polizze automatiche e pagamenti istantanei',
        'Registro immutabile di tutte le pratiche e sinistri',
        'Sistema di verifica identità per prevenire frodi',
      ],
      'Sales': [
        'Contratti intelligenti per automatizzare le vendite',
        'Sistema di loyalty program basato su blockchain',
        'Tracciabilità prodotti per garantire autenticità',
      ],
      'Recruiter': [
        'Verifica certificati e qualifiche su blockchain',
        'Sistema di pagamento automatico per consulenti',
        'Portfolio digitale verificato per i candidati',
      ],
      'Healthcare': [
        'Cartella clinica immutabile su blockchain per sicurezza e privacy dati pazienti',
        'Tracciabilità farmaci dalla produzione alla somministrazione per prevenire contraffazioni',
        'Smart contract per gestione consensi informati e autorizzazioni mediche',
      ],
      'E-commerce': [
        'Sistema di autenticazione prodotti di lusso con certificazione blockchain',
        'Smart contract per vendite automatiche con pagamento condizionale alla consegna',
        'Programma fedeltà basato su token blockchain con ricompense verificabili',
      ],
      'Real Estate': [
        'Registro immobiliare su blockchain per transazioni trasparenti e verificabili',
        'Smart contract per compravendite automatiche con pagamenti escrow',
        'Certificazione digitale proprietà e documenti catastali immutabili',
      ],
      'Education': [
        'Certificati accademici verificabili su blockchain per prevenire falsificazioni',
        'Sistema di crediti formativi trasferibili tra istituzioni educative',
        'Portfolio digitale verificato competenze e progetti studenti',
      ],
      'Finance': [
        'Sistema di pagamenti cross-border istantanei con costi ridotti del 80%',
        'Smart contract per prestiti automatici con condizioni trasparenti',
        'Registro immutabile transazioni per audit e conformità normativa',
      ],
      'Legal': [
        'Registro notarile digitale su blockchain per documenti legalmente validi',
        'Smart contract per accordi automatici con esecuzione garantita',
        'Sistema di timestamping documenti per prova data certa in tribunale',
      ],
      'Manufacturing': [
        'Tracciabilità completa supply chain dal fornitore al cliente finale',
        'Certificazione qualità prodotti con dati immutabili su blockchain',
        'Smart contract per pagamenti automatici fornitori basati su consegne verificate',
      ],
      'Hospitality': [
        'Sistema di verifica identità ospiti con privacy garantita',
        'Programma fedeltà con token blockchain trasferibili tra hotel',
        'Smart contract per prenotazioni con pagamenti automatici e cancellazioni',
      ],
      'Retail': [
        'Tracciabilità prodotti alimentari per garantire origine e qualità',
        'Sistema anti-contraffazione con certificazione blockchain per prodotti premium',
        'Programma fedeltà con ricompense verificabili e trasferibili',
      ],
      'Transportation': [
        'Registro immutabile manutenzioni veicoli per sicurezza e valore rivendita',
        'Smart contract per noleggi automatici con pagamenti basati su utilizzo',
        'Tracciabilità spedizioni con proof-of-delivery verificabile',
      ],
      'Marketing': [
        'Sistema di verifica autenticità influencer e engagement reale',
        'Smart contract per campagne pubblicitarie con pagamenti basati su risultati',
        'Registro trasparente spese marketing per accountability e ROI verificabile',
      ],
    },
    '3': { // Full-Stack Development
      'Restaurant': [
        'App mobile per ordinare e pagare direttamente dal tavolo',
        'Sistema di gestione completo: ordini, inventario, personale',
        'Piattaforma per delivery integrata con mappe e tracciamento',
      ],
      'Insurance': [
        'Portale clienti per gestire polizze e sinistri online',
        'App mobile per richiedere assistenza e caricare documenti',
        'Dashboard per agenti con statistiche e analisi in tempo reale',
      ],
      'Sales': [
        'CRM personalizzato per gestire clienti e opportunità',
        'App mobile per venditori con catalogo prodotti e ordini',
        'E-commerce completo con gestione inventario e pagamenti',
      ],
      'Recruiter': [
        'Piattaforma per candidati e aziende con matching intelligente',
        'Dashboard per recruiter con pipeline e statistiche',
        'App mobile per candidati per cercare e candidarsi a posizioni',
      ],
      'Healthcare': [
        'Piattaforma telemedicina con video-consulti, prescrizioni digitali e cartella clinica',
        'App mobile pazienti per prenotazioni, risultati esami e reminder farmaci',
        'Sistema gestionale cliniche con agenda, fatturazione e reportistica integrata',
      ],
      'E-commerce': [
        'Marketplace multi-vendor con gestione venditori, prodotti e commissioni automatiche',
        'App mobile shopping con AR per provare prodotti virtualmente prima dell\'acquisto',
        'Dashboard venditori con analytics vendite, inventario e gestione ordini in tempo reale',
      ],
      'Real Estate': [
        'Portale immobiliare con virtual tour 360°, calcolo mutuo e documenti digitali',
        'App mobile per agenti con CRM integrato, geolocalizzazione proprietà e contatti clienti',
        'Piattaforma gestione contratti con firma digitale, pagamenti e notifiche automatiche',
      ],
      'Education': [
        'LMS completo con video-lezioni, quiz interattivi, forum e valutazioni automatiche',
        'App mobile studenti per accesso corsi, compiti e comunicazioni con docenti',
        'Dashboard insegnanti per creare contenuti, monitorare progressi e generare report',
      ],
      'Finance': [
        'Piattaforma banking online con investimenti, prestiti e gestione portafoglio',
        'App mobile per pagamenti, bonifici istantanei e notifiche transazioni in tempo reale',
        'Dashboard advisor finanziari con analisi clienti, raccomandazioni e report personalizzati',
      ],
      'Legal': [
        'Portale clienti per gestione pratiche, documenti e comunicazioni con avvocati',
        'Sistema gestionale studi legali con fatturazione, scadenze e archiviazione documenti',
        'App mobile per consulenze legali rapide, ricerca precedenti e calcolo onorari',
      ],
      'Manufacturing': [
        'Sistema MES (Manufacturing Execution System) per controllo produzione in tempo reale',
        'App mobile operatori per segnalazione guasti, manutenzioni e accesso documentazione',
        'Dashboard manager con KPI produzione, qualità e efficienza macchinari',
      ],
      'Hospitality': [
        'Sistema PMS (Property Management System) integrato con booking engine e channel manager',
        'App mobile ospiti per check-in digitale, servizi hotel e richieste concierge',
        'Dashboard manager con occupazione, revenue management e analisi soddisfazione clienti',
      ],
      'Retail': [
        'Piattaforma e-commerce B2B con gestione ordini, catalogo e fatturazione automatica',
        'App mobile venditori con inventario, prezzi e ordini in tempo reale',
        'Dashboard manager con vendite, margini, rotazione stock e previsioni domanda',
      ],
      'Transportation': [
        'Sistema TMS (Transportation Management System) per ottimizzazione logistica e routing',
        'App mobile autisti con navigazione, tracciamento consegne e comunicazione clienti',
        'Dashboard operazioni con monitoraggio flotta, consumi e manutenzioni programmate',
      ],
      'Marketing': [
        'Piattaforma marketing automation con email, SMS, social e analytics integrati',
        'App mobile per gestione campagne, approvazioni contenuti e monitoraggio performance',
        'Dashboard CMO con ROI campagne, lead generation e analisi customer journey',
      ],
    },
    '4': { // Technical Consulting
      'Restaurant': [
        'Consulenza per scegliere il sistema POS migliore per il tuo ristorante',
        'Strategia digitale per aumentare la presenza online e le prenotazioni',
        'Ottimizzazione dei processi per ridurre costi e aumentare efficienza',
      ],
      'Insurance': [
        'Analisi dei sistemi esistenti e raccomandazioni per miglioramenti',
        'Strategia per digitalizzare i processi e migliorare l\'esperienza clienti',
        'Consulenza su sicurezza dati e conformità normativa',
      ],
      'Sales': [
        'Strategia per integrare CRM e sistemi di vendita esistenti',
        'Consulenza su automazione processi di vendita',
        'Analisi dati per identificare opportunità di crescita',
      ],
      'Recruiter': [
        'Strategia per digitalizzare il processo di recruiting',
        'Consulenza su ATS (Applicant Tracking System) e strumenti HR',
        'Ottimizzazione del processo di selezione e onboarding',
      ],
      'Healthcare': [
        'Audit sistemi informativi sanitari e roadmap per conformità GDPR e normativa',
        'Consulenza migrazione cloud per ridurre costi infrastruttura del 40%',
        'Strategia integrazione sistemi legacy con nuove piattaforme digitali',
      ],
      'E-commerce': [
        'Analisi performance sito e ottimizzazione conversioni con aumento vendite del 35%',
        'Consulenza scelta piattaforma e-commerce (Shopify, WooCommerce, custom)',
        'Strategia migrazione dati e integrazione sistemi esistenti senza interruzioni',
      ],
      'Real Estate': [
        'Audit processi digitali e identificazione inefficienze con risparmio costi del 30%',
        'Consulenza implementazione CRM immobiliare e integrazione portali',
        'Strategia digitalizzazione documenti e automazione pratiche notarili',
      ],
      'Education': [
        'Analisi infrastruttura IT scuole e roadmap per didattica digitale',
        'Consulenza scelta LMS (Learning Management System) e strumenti collaborativi',
        'Strategia sicurezza dati studenti e conformità privacy (GDPR)',
      ],
      'Finance': [
        'Audit sicurezza sistemi bancari e conformità normativa (MIFID, PSD2)',
        'Consulenza architettura cloud per resilienza e disaster recovery',
        'Strategia open banking e integrazione API per servizi innovativi',
      ],
      'Legal': [
        'Analisi workflow studi legali e automazione processi ripetitivi',
        'Consulenza sistemi document management e archiviazione digitale',
        'Strategia sicurezza dati clienti e conformità normativa professionale',
      ],
      'Manufacturing': [
        'Audit sistemi produzione e roadmap Industry 4.0 e IoT',
        'Consulenza integrazione ERP con sistemi produzione e magazzino',
        'Strategia manutenzione predittiva e riduzione downtime del 40%',
      ],
      'Hospitality': [
        'Analisi sistemi prenotazioni e ottimizzazione revenue management',
        'Consulenza integrazione PMS con OTA (Booking, Expedia) e channel manager',
        'Strategia personalizzazione esperienza ospiti e customer loyalty',
      ],
      'Retail': [
        'Audit sistemi punto vendita e strategia omnicanale integrata',
        'Consulenza integrazione e-commerce con sistemi magazzino e logistica',
        'Strategia dati clienti per personalizzazione e aumento vendite del 25%',
      ],
      'Transportation': [
        'Analisi sistemi logistica e ottimizzazione costi operativi',
        'Consulenza implementazione TMS e integrazione con partner',
        'Strategia tracking real-time e miglioramento customer experience',
      ],
      'Marketing': [
        'Audit stack tecnologico marketing e identificazione gap strumenti',
        'Consulenza integrazione CRM, marketing automation e analytics',
        'Strategia data-driven marketing con aumento ROI campagne del 50%',
      ],
    },
    '5': { // Automation Systems
      'Restaurant': [
        'Automazione ordini dalla cucina al servizio al tavolo',
        'Sistema automatico per gestire inventario e ordinazioni fornitori',
        'Automazione prenotazioni e notifiche ai clienti',
      ],
      'Insurance': [
        'Automazione processi di underwriting e valutazione rischi',
        'Sistema automatico per gestire sinistri e comunicazioni',
        'Automazione fatturazione e pagamenti ricorrenti',
      ],
      'Sales': [
        'Automazione follow-up clienti e lead nurturing',
        'Sistema automatico per generare preventivi e contratti',
        'Automazione reporting e analisi vendite',
      ],
      'Recruiter': [
        'Automazione screening CV e invio email ai candidati',
        'Sistema automatico per programmare colloqui e inviare reminder',
        'Automazione onboarding nuovi dipendenti',
      ],
      'Healthcare': [
        'Automazione prenotazioni visite con invio reminder SMS e email',
        'Sistema automatico per gestione prescrizioni e rinnovi farmaci',
        'Automazione fatturazione e invio documenti a pazienti e assicurazioni',
      ],
      'E-commerce': [
        'Automazione gestione inventario con riordini automatici quando stock basso',
        'Sistema automatico per aggiornamento prezzi basato su concorrenza e margini',
        'Automazione email marketing con campagne personalizzate basate su comportamento acquisti',
      ],
      'Real Estate': [
        'Automazione aggiornamento annunci immobiliari su tutti i portali simultaneamente',
        'Sistema automatico per invio documenti e reminder scadenze contratti',
        'Automazione lead nurturing con email personalizzate basate su preferenze ricerca',
      ],
      'Education': [
        'Automazione correzione compiti e quiz con feedback automatico agli studenti',
        'Sistema automatico per invio materiali didattici e reminder scadenze',
        'Automazione generazione report progressi studenti e comunicazione genitori',
      ],
      'Finance': [
        'Automazione approvazione prestiti per importi sotto soglia con analisi rischio AI',
        'Sistema automatico per riconciliazione conti e rilevamento anomalie transazioni',
        'Automazione reportistica regolamentare e invio documenti a autorità competenti',
      ],
      'Legal': [
        'Automazione ricerca precedenti giurisprudenziali e documenti rilevanti',
        'Sistema automatico per calcolo scadenze processuali e invio alert',
        'Automazione generazione contratti standard e documenti legali da template',
      ],
      'Manufacturing': [
        'Automazione controllo qualità con ispezione automatica prodotti e scarto difetti',
        'Sistema automatico per gestione ordini produzione basata su domanda prevista',
        'Automazione manutenzione preventiva con allarmi basati su sensori IoT',
      ],
      'Hospitality': [
        'Automazione pricing camere basato su occupazione, eventi e domanda prevista',
        'Sistema automatico per check-in/out digitale e invio chiavi virtuali',
        'Automazione gestione prenotazioni con sincronizzazione OTA e channel manager',
      ],
      'Retail': [
        'Automazione riordini prodotti con previsione domanda e ottimizzazione stock',
        'Sistema automatico per gestione promozioni e sconti basati su stagionalità',
        'Automazione sincronizzazione inventario tra negozi fisici e e-commerce',
      ],
      'Transportation': [
        'Automazione ottimizzazione rotte consegne basata su traffico e priorità',
        'Sistema automatico per tracciamento spedizioni e notifiche clienti',
        'Automazione manutenzione veicoli con scheduling basato su chilometraggio e utilizzo',
      ],
      'Marketing': [
        'Automazione lead scoring e qualificazione con invio a vendite quando pronto',
        'Sistema automatico per A/B testing campagne e ottimizzazione budget in tempo reale',
        'Automazione generazione report performance e dashboard executive automatici',
      ],
    },
    '6': { // AI Agents Development
      'Restaurant': [
        'Assistente AI per rispondere a domande su menu e allergeni',
        'Agente AI per gestire prenotazioni e modifiche',
        'Chatbot per suggerimenti piatti e promozioni personalizzate',
      ],
      'Insurance': [
        'Agente AI per guidare clienti nella scelta della polizza',
        'Assistente virtuale per gestire richieste di preventivo',
        'AI agent per supporto clienti 24/7 su sinistri e pratiche',
      ],
      'Sales': [
        'Agente AI per qualificare lead e prenotare appuntamenti',
        'Assistente virtuale per rispondere a domande prodotti',
        'AI agent per follow-up automatico e nurturing clienti',
      ],
      'Recruiter': [
        'Agente AI per rispondere a domande dei candidati',
        'Assistente virtuale per pre-screening candidati',
        'AI agent per programmare colloqui e inviare feedback',
      ],
      'Healthcare': [
        'Assistente AI per triage pazienti che valuta urgenza e indirizza a specialista corretto',
        'Agente virtuale per rispondere a domande comuni su sintomi e farmaci 24/7',
        'AI agent per monitoraggio pazienti cronici con alert automatici a medici',
      ],
      'E-commerce': [
        'Assistente shopping AI che suggerisce prodotti e risponde a domande in tempo reale',
        'Agente virtuale per gestione resi e rimborsi con approvazione automatica quando possibile',
        'AI agent per supporto clienti che risolve il 70% delle richieste senza intervento umano',
      ],
      'Real Estate': [
        'Assistente immobiliare AI che risponde a domande su proprietà e quartieri',
        'Agente virtuale per pre-qualificazione clienti e matching con budget disponibile',
        'AI agent per programmare visite e follow-up automatico con potenziali acquirenti',
      ],
      'Education': [
        'Tutor AI personalizzato che adatta spiegazioni allo stile apprendimento studente',
        'Assistente virtuale per rispondere a domande studenti su corsi e compiti 24/7',
        'AI agent per creazione automatica quiz e esercizi basati su contenuti lezione',
      ],
      'Finance': [
        'Consulente finanziario AI che fornisce consigli investimenti basati su profilo rischio',
        'Assistente virtuale per gestione portafoglio con analisi performance e suggerimenti',
        'AI agent per monitoraggio mercati e alert automatici su opportunità investimento',
      ],
      'Legal': [
        'Assistente legale AI per risposte a domande comuni su contratti e normative',
        'Agente virtuale per ricerca precedenti giurisprudenziali e documenti rilevanti',
        'AI agent per analisi contratti con identificazione clausole a rischio e suggerimenti',
      ],
      'Manufacturing': [
        'Assistente produzione AI che monitora macchinari e suggerisce ottimizzazioni',
        'Agente virtuale per troubleshooting guasti con diagnosi automatica e soluzioni',
        'AI agent per analisi dati produzione e raccomandazioni miglioramento efficienza',
      ],
      'Hospitality': [
        'Concierge virtuale AI per rispondere a richieste ospiti e suggerire attività locali',
        'Assistente prenotazioni AI che gestisce modifiche e cancellazioni automaticamente',
        'AI agent per personalizzazione esperienza ospiti basata su preferenze e storia',
      ],
      'Retail': [
        'Assistente vendite AI che aiuta clienti a trovare prodotti e risponde a domande',
        'Agente virtuale per gestione reclami con risoluzione automatica quando possibile',
        'AI agent per analisi comportamento clienti e suggerimenti prodotti personalizzati',
      ],
      'Transportation': [
        'Assistente logistica AI per ottimizzazione rotte e gestione emergenze',
        'Agente virtuale per supporto clienti su tracciamento spedizioni e ritardi',
        'AI agent per monitoraggio flotta con alert manutenzioni e ottimizzazione consumi',
      ],
      'Marketing': [
        'Assistente marketing AI che suggerisce strategie campagne basate su dati storici',
        'Agente virtuale per creazione automatica contenuti social e post ottimizzati',
        'AI agent per analisi competitor e identificazione opportunità di mercato',
      ],
    },
  }

  // Esempi generici se il settore non ha esempi specifici
  const genericExamples: Record<string, string[]> = {
    '1': [
      'Integrazione AI personalizzata per le tue esigenze specifiche',
      'Analisi dati intelligente per ottimizzare i processi aziendali',
      'Sistema di raccomandazioni basato su machine learning',
    ],
    '2': [
      'Sistema blockchain sicuro e trasparente per la tua azienda',
      'Smart contract personalizzati per automatizzare processi',
      'Registro immutabile per tracciabilità e verifica',
    ],
    '3': [
      'Sviluppo completo di applicazioni web e mobile',
      'Sistema integrato per gestire tutti gli aspetti del business',
      'Piattaforma personalizzata su misura per le tue esigenze',
    ],
    '4': [
      'Consulenza strategica per ottimizzare i processi tecnologici',
      'Analisi e raccomandazioni per migliorare l\'efficienza',
      'Supporto nella scelta delle migliori soluzioni tecnologiche',
    ],
    '5': [
      'Automazione completa dei processi ripetitivi',
      'Sistema intelligente per ridurre errori e aumentare velocità',
      'Integrazione automatica tra diversi sistemi aziendali',
    ],
    '6': [
      'Assistente AI personalizzato per il tuo business',
      'Agente virtuale che impara e migliora nel tempo',
      'Sistema di supporto intelligente 24/7',
    ],
  }

  return examples[serviceId.toString()]?.[sector] || genericExamples[serviceId.toString()] || []
}

const services = [
  {
    id: 1,
    title: 'AI Integration & Solutions',
    icon: Brain,
    description: 'Seamless integration of AI technologies into your existing infrastructure',
    detailedDescription: 'Ti aiutiamo a integrare l\'intelligenza artificiale nella tua azienda in modo semplice e naturale. Non serve essere esperti: trasformiamo le tue idee in soluzioni AI concrete che migliorano il tuo lavoro quotidiano. Pensiamo a tutto noi, tu vedi solo i risultati.',
  },
  {
    id: 2,
    title: 'Blockchain Development',
    icon: LinkIcon,
    description: 'Building secure and scalable blockchain solutions for your business',
    detailedDescription: 'Creiamo sistemi blockchain sicuri e trasparenti per la tua azienda. Immagina di avere un registro digitale impossibile da falsificare, dove ogni transazione è verificabile. Perfetto per contratti, tracciabilità prodotti o sistemi di pagamento innovativi. Ti spieghiamo tutto in modo chiaro, senza tecnicismi.',
  },
  {
    id: 3,
    title: 'Full-Stack Development',
    icon: Code,
    description: 'End-to-end web and mobile application development',
    detailedDescription: 'Sviluppiamo app e siti web completi, dalla parte che vedi tu a quella che funziona dietro le quinte. Come costruire una casa: pensiamo a tutto, dalle fondamenta al tetto. Tu ci dici cosa vuoi, noi lo realizziamo. Semplice, veloce, fatto bene.',
  },
  {
    id: 4,
    title: 'Technical Consulting',
    icon: MessageSquare,
    description: 'Expert guidance on technology strategy and implementation',
    detailedDescription: 'Hai bisogno di consigli tecnologici? Siamo qui per aiutarti. Ti guidiamo nelle scelte giuste per la tua azienda, senza venderti soluzioni che non ti servono. Come un consulente di fiducia che ti aiuta a capire cosa è meglio per te, spiegandoti tutto in modo chiaro e onesto.',
  },
  {
    id: 5,
    title: 'Automation Systems',
    icon: Settings,
    description: 'Streamline your operations with intelligent automation',
    detailedDescription: 'Automatizziamo i processi noiosi e ripetitivi della tua azienda. Immagina di non dover più fare manualmente quelle attività che ti rubano tempo: le facciamo fare al computer. Tu ti concentri su quello che conta davvero, mentre il sistema lavora per te 24/7. Risparmi tempo e denaro.',
  },
  {
    id: 6,
    title: 'AI Agents Development',
    icon: Bot,
    description: 'Custom AI agents tailored to your specific business needs',
    detailedDescription: 'Creiamo assistenti AI personalizzati per la tua azienda. Come avere un dipendente virtuale che risponde alle domande dei clienti, gestisce appuntamenti o aiuta il tuo team. Impara dalle tue esigenze e migliora nel tempo. Un aiuto concreto che funziona davvero.',
  },
]

export default function Services() {
  const [selectedService, setSelectedService] = useState<typeof services[0] | null>(null)
  const [selectedSector, setSelectedSector] = useState<string | null>(null)
  const [showMoreSectors, setShowMoreSectors] = useState(false)
  
  // Settori principali visibili (primi 4)
  const mainSectors = businessSectors.slice(0, 4)
  // Settori aggiuntivi (dal 5° in poi)
  const additionalSectors = businessSectors.slice(4)

  return (
    <section id="services" className="min-h-screen py-24 px-6 bg-[var(--background)]">
      <motion.div
        initial={{ opacity: 0, y: 50 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8 }}
        className="container mx-auto max-w-6xl"
      >
        <h2 className="text-4xl md:text-5xl font-bold text-center mb-4 text-[var(--text-primary)]">
          Our Services
        </h2>
        <p className="text-lg text-[var(--text-secondary)] text-center mb-16 max-w-2xl mx-auto">
          Comprehensive solutions to drive your business forward
        </p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {services.map((service, index) => {
            const Icon = service.icon
            return (
              <motion.div
                key={service.id}
                initial={{ opacity: 0, y: 50 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: index * 0.1 }}
                whileHover={{ scale: 1.02, y: -5 }}
                onClick={() => setSelectedService(service)}
                className="bg-[var(--card-background)] border border-[var(--border-color)] p-4 rounded-xl cursor-pointer hover:shadow-lg transition-all"
              >
                <div className="mb-3">
                  <div className="w-10 h-10 bg-[var(--accent-blue)]/10 rounded-lg flex items-center justify-center mb-3">
                    <Icon className="w-5 h-5 text-[var(--accent-blue)]" />
                  </div>
                  <h3 className="text-base font-semibold text-[var(--text-primary)] mb-2">
                    {service.title}
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    {service.description}
                  </p>
                </div>
              </motion.div>
            )
          })}
        </div>
      </motion.div>

      {/* Modal per spiegazione dettagliata */}
      <AnimatePresence>
        {selectedService && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => {
              setSelectedService(null)
              setSelectedSector(null)
              setShowMoreSectors(false)
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-[var(--card-background)] rounded-2xl border border-[var(--border-color)] max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl"
            >
              <div className="sticky top-0 bg-[var(--card-background)] z-10 p-6 border-b border-[var(--border-color)]">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-[var(--accent-blue)]/10 rounded-xl flex items-center justify-center">
                      {selectedService.icon && (
                        <selectedService.icon className="w-6 h-6 text-[var(--accent-blue)]" />
                      )}
                    </div>
                    <h3 className="text-2xl font-bold text-[var(--text-primary)]">
                      {selectedService.title}
                    </h3>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedService(null)
                      setSelectedSector(null)
                      setShowMoreSectors(false)
                    }}
                    className="p-2 hover:bg-[var(--background-secondary)] rounded-lg transition-colors"
                  >
                    <X className="w-5 h-5 text-[var(--text-secondary)]" />
                  </button>
                </div>
                <p className="text-base text-[var(--text-secondary)] leading-relaxed mb-6">
                  {selectedService.detailedDescription}
                </p>

                {/* Selezione settore */}
                {!selectedSector ? (
                  <div>
                    <p className="text-sm font-semibold text-[var(--text-primary)] mb-3">
                      Seleziona il tuo settore di business:
                    </p>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {mainSectors.map((sector) => (
                        <button
                          key={sector}
                          onClick={() => setSelectedSector(sector)}
                          className="px-4 py-2 bg-[var(--accent-blue)]/10 hover:bg-[var(--accent-blue)]/20 border border-[var(--accent-blue)]/30 rounded-lg text-sm text-[var(--text-primary)] transition-colors"
                        >
                          {sector}
                        </button>
                      ))}
                      <button
                        onClick={() => setShowMoreSectors(!showMoreSectors)}
                        className="px-4 py-2 bg-[var(--background-secondary)] hover:bg-[var(--background-hover)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] transition-colors flex items-center gap-2"
                      >
                        <Plus className="w-4 h-4" />
                        Altri settori
                      </button>
                    </div>
                    {showMoreSectors && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex flex-wrap gap-2"
                      >
                        {additionalSectors.map((sector) => (
                          <button
                            key={sector}
                            onClick={() => {
                              setSelectedSector(sector)
                              setShowMoreSectors(false)
                            }}
                            className="px-4 py-2 bg-[var(--accent-blue)]/10 hover:bg-[var(--accent-blue)]/20 border border-[var(--accent-blue)]/30 rounded-lg text-sm text-[var(--text-primary)] transition-colors"
                          >
                            {sector}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-sm font-semibold text-[var(--text-primary)]">
                        Esempi pratici per <span className="text-[var(--accent-blue)]">{selectedSector}</span>:
                      </p>
                      <button
                        onClick={() => setSelectedSector(null)}
                        className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                      >
                        Cambia settore
                      </button>
                    </div>
                    <div className="space-y-3">
                      {getSectorExamples(selectedService.id, selectedSector).map((example, idx) => (
                        <motion.div
                          key={idx}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: idx * 0.1 }}
                          className="p-4 bg-[var(--background-secondary)] rounded-lg border border-[var(--border-color)]"
                        >
                          <p className="text-sm text-[var(--text-primary)] leading-relaxed">
                            {example}
                          </p>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
