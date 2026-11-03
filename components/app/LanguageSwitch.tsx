'use client'

import { useTranslation } from '@/lib/i18n/LanguageContext'

// Lingua dell'area clienti: italiano o inglese. Traduce tutta l'interfaccia
// (con il traduttore automatico del sito); messaggi, nomi e istruzioni dei
// clienti restano come sono stati scritti.

const OPTIONS = [
  { id: 'it', label: 'IT', name: 'Italiano' },
  { id: 'en', label: 'EN', name: 'English' },
] as const

export default function LanguageSwitch({ className = '' }: { className?: string }) {
  const { language, setLanguage } = useTranslation()
  const current = language === 'it' ? 'it' : 'en'
  return (
    <div translate="no" className={`flex rounded-full border border-[var(--border-color)] p-0.5 text-xs ${className}`} role="radiogroup" aria-label="Lingua / Language">
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={current === o.id}
          title={o.name}
          onClick={() => setLanguage(o.id)}
          className={`rounded-full px-2.5 py-1 ${current === o.id ? 'bg-[var(--accent-blue)] text-white' : 'text-[var(--text-secondary)]'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
