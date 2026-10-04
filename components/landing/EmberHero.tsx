'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, BrainCircuit, Code2, LayoutDashboard, MapPin, Megaphone } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/LanguageContext'
import { brands } from '@/components/BrandBanner'
import ContactModal from './ContactModal'
import styles from './EmberHero.module.css'

// Hero pubblico in stile "ember". I contenuti sono quelli reali del sito:
// stesse aree di servizio e stesso testo di presentazione (dalle traduzioni),
// clienti presi dall'elenco di BrandBanner. Nessun numero inventato.

const serviceIcons = [Megaphone, Code2, BrainCircuit, LayoutDashboard]

// Colori dei pallini con le iniziali dei clienti.
const tints = [
  ['#ff7a3d', '#ffb27a'],
  ['#c2410c', '#fb923c'],
  ['#9a3412', '#fdba74'],
  ['#7c2d12', '#f97316'],
]

const bars = [34, 52, 44, 70, 88]

type HeroTranslation = {
  subtitleParts: Array<{ text: string; bold: boolean }>
  services: Array<{ title: string; description: string }>
}

const FALLBACK_SUBTITLE = [
  { text: 'Trasformiamo le idee in soluzioni digitali. Ci occupiamo di ', bold: false },
  { text: 'gestione social, marketing e comunicazione', bold: true },
  { text: ', ', bold: false },
  { text: 'sviluppo software', bold: true },
  { text: ', ', bold: false },
  { text: 'integrazione AI', bold: true },
  { text: ' e ', bold: false },
  { text: 'gestionali', bold: true },
  { text: ' per far crescere la tua azienda.', bold: false },
]

const FALLBACK_SERVICES = [
  { title: 'Social & Marketing', description: 'Gestione social, marketing e comunicazione' },
  { title: 'Sviluppo Software', description: 'Soluzioni digitali su misura' },
  { title: 'Integrazione AI', description: 'Intelligenza artificiale per il tuo business' },
  { title: 'Gestionali', description: 'ERP, CRM e automazione aziendale' },
]

export default function EmberHero() {
  const { tData } = useTranslation()
  const hero = tData<HeroTranslation>('home.hero')
  const subtitle = hero?.subtitleParts?.length ? hero.subtitleParts : FALLBACK_SUBTITLE
  const services = hero?.services?.length ? hero.services : FALLBACK_SERVICES
  const featured = brands.slice(0, 4)
  const [contactOpen, setContactOpen] = useState(false)
  const closeContact = useCallback(() => setContactOpen(false), [])

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
              Software house siciliana
              <br />
              Palermo, tutta la Sicilia e l&apos;Italia
            </span>
          </p>

          <h1 id="hero-title" className={styles.title}>
            Tecnologia
            <br />
            per le persone,
            <br />
            non per le <em>macchine</em>
          </h1>

          <p className={styles.sub}>
            {subtitle.map((part, i) => (part.bold ? <strong key={i}>{part.text}</strong> : <span key={i}>{part.text}</span>))}
          </p>

          <div className={styles.cta}>
            <button type="button" className={styles.go} onClick={() => setContactOpen(true)}>
              Parliamo del tuo progetto
              <span className={styles.goDot} aria-hidden="true">
                <ArrowRight />
              </span>
            </button>
            <Link className={styles.ghostBtn} href="/services">
              Scopri i servizi
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
                <strong>{brands.length} attività ci hanno scelto</strong>
                Ti ricontattiamo in tempi brevi
              </span>
            </div>
          </div>

          <ul className={styles.areas}>
            {services.map((service, i) => {
              const Icon = serviceIcons[i] || Megaphone
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
              <strong>H24</strong>Assistenti AI
              <br />
              sempre attivi
            </p>
          </div>
          <p className={styles.ghostTitle}>Automatizza ciò che ti ruba tempo</p>
          <p className={styles.ghostCopy}>
            Messaggi, prenotazioni, gestionali e social: costruiamo strumenti su misura che lavorano per te, misurando
            ogni risultato.
          </p>
        </aside>
      </div>

      <div className={styles.foot}>
        <span className={styles.watermark} aria-hidden="true">
          FV
        </span>
        <div className={styles.clients}>
          <span className={styles.clientsLabel}>Hanno scelto di collaborare con noi</span>
          <ul>
            {brands.slice(0, 6).map((brand) => (
              <li key={brand.name}>{brand.name}</li>
            ))}
          </ul>
        </div>
      </div>
      <ContactModal open={contactOpen} onClose={closeContact} />
    </section>
  )
}
