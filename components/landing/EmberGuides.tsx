'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import ContactModal from './ContactModal'
import styles from './EmberGuides.module.css'

// Guide in home: i testi sono quelli dei caroselli Instagram di Facevoice AI,
// riadattati allo stile "ember". Le foto arrivano da /api/guide-images
// (generate una volta sola); senza foto la scheda resta comunque completa.

type Guide = {
  id: string
  number: string
  eyebrow?: string
  title: string
  text?: string[]
  list?: string[]
  closing?: string
}

const GUIDES: Guide[] = [
  {
    id: 'voce',
    number: '01',
    eyebrow: 'Your brand has a face. We give it a voice.',
    title: 'Il tuo brand ha un volto. Noi gli diamo una voce.',
    text: ['Facevoice.ai nasce per questo: trasformare chi sei in qualcosa che le persone riconoscono, ricordano e scelgono.'],
  },
  {
    id: 'chi-siamo',
    number: '02',
    eyebrow: 'Chi siamo',
    title: 'Strategia, creatività e tecnologia in un’unica realtà.',
    text: ['Un solo team che pensa, crea e sviluppa: niente passaggi di mano tra fornitori diversi.'],
  },
  {
    id: 'cosa-facciamo',
    number: '03',
    eyebrow: 'Cosa facciamo',
    title: 'Tutto il digitale della tua attività.',
    list: ['Brand Identity', 'Social Media', 'Content Creation', 'Web & Software', 'Digital Strategy'],
  },
  {
    id: 'sistemi',
    number: '04',
    eyebrow: 'Bello il logo. E poi?',
    title: 'Non creiamo semplicemente contenuti. Creiamo sistemi di comunicazione.',
    text: ['Un brand non è solo un logo. E comunicare non significa solo pubblicare.', 'Costruiamo il modo in cui un brand comunica.'],
  },
  {
    id: 'riconoscibile',
    number: '05',
    eyebrow: 'Brand · Social · Software · Strategy',
    title: 'Riconoscibile, coerente e funzionale.',
    text: ['Noi lavoriamo su tutto ciò che rende un brand riconoscibile, coerente e funzionale: online e offline.'],
  },
  {
    id: 'identita',
    number: '06',
    eyebrow: 'Brand identity',
    title: 'Diamo forma alla tua identità.',
    list: ['Logo', 'Palette', 'Typography', 'Visual system', 'Tone of voice', 'Brand guidelines'],
    closing: 'Perché prima di comunicare, devi sapere chi sei.',
  },
]

export default function EmberGuides() {
  const [images, setImages] = useState<Record<string, string>>({})
  const [contactOpen, setContactOpen] = useState(false)
  const [active, setActive] = useState(0)
  const trackRef = useRef<HTMLDivElement>(null)
  const closeContact = useCallback(() => setContactOpen(false), [])

  useEffect(() => {
    fetch('/api/guide-images')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => data?.images && setImages(data.images))
      .catch(() => undefined)
  }, [])

  // Scheda attiva per i pallini: quella piu' vicina al bordo sinistro.
  const onScroll = () => {
    const track = trackRef.current
    if (!track) return
    const cards = Array.from(track.children) as HTMLElement[]
    let best = 0
    let bestDist = Infinity
    cards.forEach((card, i) => {
      const dist = Math.abs(card.offsetLeft - track.scrollLeft - track.offsetLeft)
      if (dist < bestDist) {
        bestDist = dist
        best = i
      }
    })
    setActive(best)
  }

  const go = (dir: 1 | -1) => {
    const track = trackRef.current
    const card = track?.children[0] as HTMLElement | undefined
    if (!track || !card) return
    track.scrollBy({ left: dir * (card.offsetWidth + 16), behavior: 'smooth' })
  }

  const total = GUIDES.length + 1

  return (
    <section className={styles.section} aria-labelledby="guides-title">
      <div className={styles.head}>
        <div>
          <p className={styles.kicker}>Guide</p>
          <h2 id="guides-title" className={styles.heading}>
            Cosa facciamo, <em>in breve</em>
          </h2>
        </div>
        <div className={styles.arrows}>
          <button type="button" onClick={() => go(-1)} aria-label="Guida precedente" disabled={active === 0}>
            <ArrowLeft />
          </button>
          <button type="button" onClick={() => go(1)} aria-label="Guida successiva" disabled={active >= total - 1}>
            <ArrowRight />
          </button>
        </div>
      </div>

      <div ref={trackRef} className={styles.track} onScroll={onScroll}>
        {GUIDES.map((guide) => {
          const image = images[guide.id]
          return (
            <article key={guide.id} className={`${styles.card} ${image ? styles.withImage : ''}`}>
              {image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className={styles.photo} src={image} alt="" loading="lazy" />
              )}
              <span className={styles.number} aria-hidden="true">
                {guide.number}
              </span>
              <div className={styles.body}>
                {guide.eyebrow && <p className={styles.eyebrow}>{guide.eyebrow}</p>}
                <h3 className={styles.title}>{guide.title}</h3>
                {guide.text?.map((line) => (
                  <p key={line} className={styles.text}>
                    {line}
                  </p>
                ))}
                {guide.list && (
                  <ul className={styles.list}>
                    {guide.list.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
                {guide.closing && <p className={styles.closing}>{guide.closing}</p>}
              </div>
            </article>
          )
        })}

        <article className={`${styles.card} ${styles.final}`}>
          <span className={styles.number} aria-hidden="true">
            07
          </span>
          <div className={styles.body}>
            <p className={styles.eyebrow}>Facevoice.ai · Turn faces into voices</p>
            <h3 className={styles.title}>Il tuo brand ha qualcosa da dire.</h3>
            <p className={styles.text}>Facciamo in modo che venga riconosciuto.</p>
            <button type="button" className={styles.cta} onClick={() => setContactOpen(true)}>
              Parliamo del tuo progetto <ArrowRight />
            </button>
          </div>
        </article>
      </div>

      <div className={styles.dots} aria-hidden="true">
        {Array.from({ length: total }).map((_, i) => (
          <span key={i} className={i === active ? styles.dotOn : ''} />
        ))}
      </div>

      <ContactModal open={contactOpen} onClose={closeContact} />
    </section>
  )
}
