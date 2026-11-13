'use client'

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { translations, Language } from './translations'

interface LanguageContextType {
  language: Language
  setLanguage: (lang: Language) => void
  t: (key: string) => string
  /**
   * Come t(), ma restituisce il valore grezzo (array, oggetto, stringa)
   * invece di forzarlo a stringa. Serve per le traduzioni che non sono
   * semplice testo — es. l'elenco dei servizi dell'Hero, con
   * titolo/descrizione per lingua. t() su una di queste chiavi
   * tornerebbe solo la chiave stessa, perché scarta tutto ciò che non è
   * una stringa.
   */
  tData: <T = unknown>(key: string) => T | undefined
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined)

/** Lingua decisa in automatico alla prima visita (non scelta dalla persona). */
const AUTO_KEY = 'language_auto'

/** Paesi in cui il sito si apre in italiano; altrove in inglese. */
const ITALIAN_COUNTRIES = new Set(['IT', 'SM', 'VA'])

function languageForCountry(country: string | null): 'it' | 'en' {
  if (country) return ITALIAN_COUNTRIES.has(country.toUpperCase()) ? 'it' : 'en'
  const browser = typeof navigator !== 'undefined' ? navigator.language || '' : ''
  return browser.toLowerCase().startsWith('it') ? 'it' : 'en'
}

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Archivio del browser non disponibile (es. navigazione privata): pazienza.
  }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('it')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // Lingua scelta dal selettore (salvata): vince sempre.
    const savedLang = safeGet('language') as Language | null
    if (savedLang && translations[savedLang]) {
      setLanguageState(savedLang)
      setMounted(true)
      return
    }
    // Prima visita: lingua dal paese (Italia -> italiano, altrove -> inglese),
    // ricordata per le visite dopo; senza paese, dalla lingua del browser.
    const autoLang = safeGet(AUTO_KEY)
    if (autoLang === 'it' || autoLang === 'en') setLanguageState(autoLang)
    setMounted(true)
    if (autoLang === 'it' || autoLang === 'en') return
    let cancelled = false
    fetch('/api/geo', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
      .then((data: { country?: string | null } | null) => {
        if (cancelled || safeGet('language')) return
        const lang = languageForCountry(data?.country ?? null)
        safeSet(AUTO_KEY, lang)
        setLanguageState(lang)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Lingua della pagina per browser, lettori di schermo e motori di ricerca.
  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  const setLanguage = (lang: Language) => {
    setLanguageState(lang)
    safeSet('language', lang)
    // Trigger re-render di tutti i componenti che usano il context
    window.dispatchEvent(new Event('languagechange'))
  }

  const t = (key: string): string => {
    if (!mounted) return key
    
    const keys = key.split('.')
    let value: any = translations[language]
    
    for (const k of keys) {
      value = value?.[k]
      if (value === undefined) {
        // Fallback all'italiano se la chiave non esiste
        value = translations.it
        for (const k2 of keys) {
          value = value?.[k2]
        }
        break
      }
    }
    
    return typeof value === 'string' ? value : key
  }

  const tData = <T = unknown,>(key: string): T | undefined => {
    if (!mounted) return undefined

    const resolve = (lang: Language) => {
      const keys = key.split('.')
      let value: any = translations[lang]
      for (const k of keys) {
        value = value?.[k]
        if (value === undefined) return undefined
      }
      return value as T
    }

    // Fallback all'italiano se la lingua corrente non ha questa chiave.
    return resolve(language) ?? resolve('it')
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, tData }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useTranslation() {
  const context = useContext(LanguageContext)
  if (context === undefined) {
    throw new Error('useTranslation must be used within a LanguageProvider')
  }
  return context
}
