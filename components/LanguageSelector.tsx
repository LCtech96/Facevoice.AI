'use client'

import { useState, useRef, useEffect } from 'react'
import { Globe, ChevronDown } from 'lucide-react'
import { useTranslation } from '@/lib/i18n/LanguageContext'
import type { Language } from '@/lib/i18n/translations'

const languages: Array<{ code: Language; name: string; flag: string }> = [
  { code: 'it', name: 'Italiano', flag: '🇮🇹' },
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'pt', name: 'Português', flag: '🇵🇹' },
  { code: 'ar', name: 'العربية', flag: '🇸🇦' },
  { code: 'zh', name: '中文', flag: '🇨🇳' },
]

export default function LanguageSelector() {
  const [isOpen, setIsOpen] = useState(false)
  const { language, setLanguage } = useTranslation()
  const dropdownRef = useRef<HTMLDivElement>(null)

  const selectedLang = languages.find(l => l.code === language) || languages[0]

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  useEffect(() => {
    const handleLanguageChange = () => {
      // Force re-render quando la lingua cambia
      setIsOpen(false)
    }
    
    window.addEventListener('languagechange', handleLanguageChange)
    return () => window.removeEventListener('languagechange', handleLanguageChange)
  }, [])

  const handleLanguageSelect = (lang: typeof languages[0]) => {
    setLanguage(lang.code)
    setIsOpen(false)
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--background-secondary)] hover:bg-[var(--background)] border border-[var(--border-color)] transition-all text-[var(--text-primary)] text-sm font-medium"
        aria-label="Seleziona lingua"
      >
        <Globe className="w-4 h-4" />
        <span className="hidden md:inline">{selectedLang.flag}</span>
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 bg-[var(--card-background)] border border-[var(--border-color)] rounded-lg shadow-lg z-50 max-h-96 overflow-y-auto">
          <div className="py-2">
            {languages.map((lang) => (
              <button
                key={lang.code}
                onClick={() => handleLanguageSelect(lang)}
                className={`w-full text-left px-4 py-2 hover:bg-[var(--background-secondary)] transition-colors flex items-center gap-3 ${
                  selectedLang.code === lang.code
                    ? 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)] font-semibold'
                    : 'text-[var(--text-primary)]'
                }`}
              >
                <span className="text-xl">{lang.flag}</span>
                <span className="text-sm">{lang.name}</span>
                {selectedLang.code === lang.code && (
                  <span className="ml-auto text-[var(--accent-blue)]">✓</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

