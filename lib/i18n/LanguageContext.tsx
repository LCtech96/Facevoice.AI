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

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('it')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // Carica la lingua salvata dal localStorage solo lato client
    const savedLang = localStorage.getItem('language') as Language
    if (savedLang && translations[savedLang]) {
      setLanguageState(savedLang)
    }
    setMounted(true)
  }, [])

  const setLanguage = (lang: Language) => {
    setLanguageState(lang)
    localStorage.setItem('language', lang)
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
