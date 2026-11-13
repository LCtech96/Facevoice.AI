'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, BrainCircuit, Code2, LayoutDashboard, MapPin, Workflow } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/LanguageContext'
import { brands } from '@/components/BrandBanner'
import ContactModal from './ContactModal'
import styles from './EmberHero.module.css'

// Hero pubblico in stile "ember": il payoff come titolo e, subito sotto, cosa
// facciamo (sviluppo software e integrazioni AI per le piccole e medie imprese).
// In italiano per chi e' in Italia, in inglese per gli altri (lingua del sito).
// Clienti presi dall'elenco di BrandBanner. Nessun numero inventato.

const serviceIcons = [Code2, BrainCircuit, LayoutDashboard, Workflow]

// Colori dei pallini con le iniziali dei clienti.
const tints = [
  ['#4c7dff', '#a9c1ff'],
  ['#1f4fe0', '#5b8bff'],
  ['#14306b', '#a9c1ff'],
  ['#0b1a35', '#2a65fe'],
]

const bars = [34, 52, 44, 70, 88]

type HeroCopy = {
  noteTop: string
  noteBottom: string
  kicker: string
  titleTop: string
  titleMid: string
  titleBottom: string
  titleAccent: string
  titleEnd: string
  sub: string
  primary: string
  secondary: string
  proof: (count: number) => string
  proofNote: string
  services: Array<{ title: string; description: string }>
  ghostKpi: string
  ghostTitle: string
  ghostCopy: string
  clients: string
}

const COPY: Record<'it' | 'en', HeroCopy> = {
  it: {
    noteTop: 'Sede a Terrasini (Palermo)',
    noteBottom: 'Clienti in tutta la Sicilia e in Italia',
    kicker: 'Sviluppo software e integrazioni AI per piccole e medie imprese',
    titleTop: 'La tua azienda',
    titleMid: 'ha un volto,',
    titleBottom: 'noi le diamo una ',
    titleAccent: 'voce',
    titleEnd: '.',
    sub: 'Sviluppiamo software su misura e portiamo l’intelligenza artificiale dentro la tua azienda: gestionali, app e automazioni che ti fanno risparmiare tempo e lavorano per te.',
    primary: 'Parliamo del tuo progetto',
    secondary: 'Scopri i servizi',
    proof: (n) => `${n} aziende ci hanno scelto`,
    proofNote: 'Ti ricontattiamo in tempi brevi',
    services: [
      { title: 'Software su misura', description: 'App e piattaforme web costruite sui tuoi processi' },
      { title: 'Integrazioni AI', description: 'Assistenti AI e analisi dei dati negli strumenti che usi già' },
      { title: 'Gestionali', description: 'ERP e CRM per avere tutto sotto controllo' },
      { title: 'Automazioni', description: 'Messaggi, prenotazioni e attività ripetitive che vanno da sole' },
    ],
    ghostKpi: 'Assistenti AI\nsempre attivi',
    ghostTitle: 'Automatizza ciò che ti ruba tempo',
    ghostCopy: 'Messaggi, prenotazioni e gestionali: costruiamo strumenti su misura che lavorano per te, misurando ogni risultato.',
    clients: 'Hanno scelto di collaborare con noi',
  },
  en: {
    noteTop: 'Based in Terrasini (Palermo, Italy)',
    noteBottom: 'Working with businesses across Italy and beyond',
    kicker: 'Custom software and AI integrations for small and medium-sized businesses',
    titleTop: 'Your business',
    titleMid: 'has a face,',
    titleBottom: 'we give it a ',
    titleAccent: 'voice',
    titleEnd: '.',
    sub: 'We build custom software and bring artificial intelligence into your business: management systems, apps and automations that save you time and work for you.',
    primary: 'Let’s talk about your project',
    secondary: 'Explore our services',
    proof: (n) => `${n} businesses chose us`,
    proofNote: 'We’ll get back to you quickly',
    services: [
      { title: 'Custom software', description: 'Apps and web platforms built around your processes' },
      { title: 'AI integrations', description: 'AI assistants and data analysis inside the tools you already use' },
      { title: 'Management systems', description: 'ERP and CRM to keep everything under control' },
      { title: 'Automation', description: 'Messages, bookings and repetitive tasks that run on their own' },
    ],
    ghostKpi: 'AI assistants\nalways on',
    ghostTitle: 'Automate what eats up your time',
    ghostCopy: 'Messages, bookings and management systems: we build tailor-made tools that work for you and measure every result.',
    clients: 'They chose to work with us',
  },
}

/** Testi della hero: italiano per chi ha il sito in italiano, inglese per tutti gli altri. */
export function useHeroCopy(): HeroCopy {
  const { language } = useTranslation()
  return COPY[language === 'it' ? 'it' : 'en']
}

export default function EmberHero() {
  const copy = useHeroCopy()
  const featured = brands.slice(0, 4)
  const [contactOpen, setContactOpen] = useState(false)
  const closeContact = useCallback(() => setContactOpen(false), [])
  const [kpiTop, kpiBottom] = copy.ghostKpi.split('\n')

  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <div className={styles.media} aria-hidden="true">
        <span className={`${styles.glow} ${styles.glowA}`} />
        <span className={`${styles.glow} ${styles.glowB}`} />
        <span className={`${styles.glow} ${styles.glowC}`} />
        <div className={styles.scrim} />
        <div className={styles.rules}>
          <span />
          <span />
          <span />
        </div>
      </div>

      <div className={styles.inner}>
        <div className={styles.lead}>
          <p className={styles.note}>
            <MapPin className={styles.noteIcon} aria-hidden="true" />
            <span>
              {copy.noteTop}
              <br />
              {copy.noteBottom}
            </span>
          </p>

          <h1 id="hero-title" className={styles.title}>
            {/* Cosa facciamo, in parole che le persone (e le AI) cercano davvero; poi il payoff. */}
            <span className={styles.titleKicker}>{copy.kicker}</span>
            {copy.titleTop}
            <br />
            {copy.titleMid}
            <br />
            {copy.titleBottom}
            <em>{copy.titleAccent}</em>
            {copy.titleEnd}
          </h1>

          <p className={styles.sub}>{copy.sub}</p>

          <div className={styles.cta}>
            <button type="button" className={styles.go} onClick={() => setContactOpen(true)}>
              {copy.primary}
              <span className={styles.goDot} aria-hidden="true">
                <ArrowRight />
              </span>
            </button>
            <Link className={styles.ghostBtn} href="/services">
              {copy.secondary}
            </Link>

            <div className={styles.proof}>
              <div className={styles.faces} aria-hidden="true">
                {featured.map((brand, i) => (
                  <i
                    key={brand.name}
                    style={{ '--a': tints[i][0], '--b': tints[i][1] } as React.CSSProperties}
                  >
                    {brand.name.charAt(0)}
                  </i>
                ))}
              </div>
              <span className={styles.proofText}>
                <strong>{copy.proof(brands.length)}</strong>
                {copy.proofNote}
              </span>
            </div>
          </div>

          <ul className={styles.areas}>
            {copy.services.map((service, i) => {
              const Icon = serviceIcons[i] || Code2
              return (
                <li key={service.title} className={styles.area}>
                  <span className={styles.areaMark} aria-hidden="true">
                    *
                  </span>
                  <span className={styles.areaIcon} aria-hidden="true">
                    <Icon />
                  </span>
                  <span>
                    <span className={styles.areaTitle}>{service.title}</span>
                    <span className={styles.areaDesc} style={{ display: 'block' }}>
                      {service.description}
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
        </div>

        <aside className={styles.ghost} aria-hidden="true">
          <div className={styles.ghostRow}>
            <div className={styles.ghostBars}>
              {bars.map((h, i) => (
                <span key={i} style={{ height: `${h}%` }} />
              ))}
            </div>
            <p className={styles.ghostKpi}>
              <strong>H24</strong>
              {kpiTop}
              <br />
              {kpiBottom}
            </p>
          </div>
          <p className={styles.ghostTitle}>{copy.ghostTitle}</p>
          <p className={styles.ghostCopy}>{copy.ghostCopy}</p>
        </aside>
      </div>

      <div className={styles.foot}>
        <span className={styles.watermark} aria-hidden="true">
          FV
        </span>
        <div className={styles.clients}>
          <span className={styles.clientsLabel}>{copy.clients}</span>
          <ul>
            {brands.map((brand) => (
              <li key={brand.name}>{brand.name}</li>
            ))}
          </ul>
        </div>
      </div>
      <ContactModal open={contactOpen} onClose={closeContact} />
    </section>
  )
}
