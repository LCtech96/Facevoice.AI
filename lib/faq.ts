import { ORG } from '@/lib/seo/site'
import { SECTORS } from '@/lib/seo/sectors'
import { PROJECTS } from '@/lib/seo/projects'

// Domande frequenti della pagina /faq (e dei dati strutturati FAQPage).
// Solo informazioni vere: niente prezzi o risultati finche' non li fornisce Luca.

export type FaqItem = {
  question: string
  answer: string
  links?: { label: string; href: string }[]
}

export const FAQ: FaqItem[] = [
  {
    question: 'Cosa fa Facevoice AI?',
    answer:
      'Facevoice AI è un’agenzia digitale e software house a Palermo. Ci prendiamo cura di tutto il lato digitale di un’attività: creazione di contenuti e gestione dei profili social, siti web ed e-commerce, software e gestionali su misura, integrazione dell’intelligenza artificiale nei processi aziendali.',
    links: [{ label: 'I servizi', href: '/services' }],
  },
  {
    question: 'Dove lavorate?',
    answer: `La sede è a ${ORG.city}, in provincia di ${ORG.province}. Seguiamo aziende a Palermo, in tutta la Sicilia e nel resto d’Italia.`,
  },
  {
    question: 'Con che tipo di attività lavorate?',
    answer: `Lavoriamo con piccole e medie imprese e attività locali, tra cui: ristorazione, ottica, abbigliamento, ${SECTORS.map((s) => s.name.toLowerCase()).join(', ')}.`,
    links: [{ label: 'I settori', href: '/settori' }],
  },
  {
    question: 'Quanto costa un sito, la gestione dei social o un software su misura?',
    answer:
      'Dipende da cosa serve davvero alla tua attività: un sito vetrina, un e-commerce, la gestione completa dei social o un gestionale hanno costi molto diversi. Per questo prima ci sentiamo per una breve chiamata, capiamo l’obiettivo e poi ti mandiamo un preventivo chiaro.',
  },
  {
    question: 'Vi occupate anche della gestione dei social dopo il lancio?',
    answer:
      'Sì. Oltre a realizzare siti e software, creiamo i contenuti e gestiamo i profili social nel tempo, così l’attività ha un unico referente per tutto il digitale.',
  },
  {
    question: 'Cosa vuol dire integrare l’intelligenza artificiale nella mia azienda?',
    answer:
      'Significa usare l’AI per lavori ripetitivi che oggi rubano tempo. Per esempio: una chat sul sito che risponde ai clienti a qualsiasi ora e passa la conversazione a una persona quando serve, risposte automatiche a email e messaggi di Instagram e Facebook, automazioni collegate al gestionale.',
  },
  {
    question: 'Avete esempi di lavori realizzati?',
    answer: `Sì, alcuni progetti sono raccontati nella pagina dei casi studio, tra cui ${PROJECTS.map((p) => p.name).join(', ')}.`,
    links: [{ label: 'Casi studio', href: '/case-studies' }],
  },
  {
    question: 'Come posso contattarvi?',
    answer: `Puoi compilare il modulo “Parliamo del tuo progetto” in home, scriverci su WhatsApp al ${ORG.whatsapp}, chiamarci al ${ORG.phone}, scrivere a ${ORG.email} oppure usare la chat del sito. Ti ricontattiamo in tempi brevi.`,
    links: [{ label: 'WhatsApp', href: `https://wa.me/${ORG.whatsapp.replace(/[^\d]/g, '')}` }],
  },
]
