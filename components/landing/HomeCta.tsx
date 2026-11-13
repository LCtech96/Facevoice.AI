'use client'

import { useCallback, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/LanguageContext'
import ContactModal from './ContactModal'
import styles from './EmberHero.module.css'

// Chiusura della home: una frase e lo stesso pulsante di contatto della hero.

const COPY = {
  it: {
    title: 'Hai un’idea o un processo da semplificare?',
    text: 'Raccontaci cosa ti serve: ti proponiamo il software o l’integrazione AI più adatta alla tua azienda.',
    button: 'Parliamo del tuo progetto',
  },
  en: {
    title: 'Got an idea or a process to simplify?',
    text: 'Tell us what you need and we’ll suggest the software or AI integration that best fits your business.',
    button: 'Let’s talk about your project',
  },
}

export default function HomeCta() {
  const { language } = useTranslation()
  const copy = COPY[language === 'it' ? 'it' : 'en']
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])

  return (
    <section className="container mx-auto max-w-4xl px-4 pb-16 pt-4" aria-labelledby="home-cta-title">
      <div className="rounded-3xl border border-[var(--ember-hair)] bg-[var(--ember-glass)] px-6 py-10 text-center md:px-12">
        <h2 id="home-cta-title" className="text-2xl font-semibold tracking-tight text-[var(--text-primary)] md:text-3xl">
          {copy.title}
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-[var(--ember-ink-soft)]">{copy.text}</p>
        <button type="button" className={`${styles.go} mt-6`} onClick={() => setOpen(true)}>
          {copy.button}
          <span className={styles.goDot} aria-hidden="true">
            <ArrowRight />
          </span>
        </button>
      </div>
      <ContactModal open={open} onClose={close} />
    </section>
  )
}
