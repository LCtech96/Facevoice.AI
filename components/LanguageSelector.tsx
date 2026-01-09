'use client'

import { useState, useRef, useEffect } from 'react'
import { Globe, ChevronDown } from 'lucide-react'
import { useRouter, usePathname } from 'next/navigation'

const languages = [
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
  const [selectedLang, setSelectedLang] = useState(languages[0])
  const dropdownRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    // Carica la lingua salvata dal localStorage
    const savedLang = localStorage.getItem('language')
    if (savedLang) {
      const lang = languages.find(l => l.code === savedLang)
      if (lang) {
        setSelectedLang(lang)
      }
    }
  }, [])

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

  const handleLanguageSelect = (lang: typeof languages[0]) => {
    setSelectedLang(lang)
    localStorage.setItem('language', lang.code)
    setIsOpen(false)
    // Qui puoi aggiungere la logica di traduzione quando implementi i18n
    // Per ora salva solo la preferenza
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

