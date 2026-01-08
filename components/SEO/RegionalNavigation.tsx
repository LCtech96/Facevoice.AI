'use client'

import Link from 'next/link'
import { MapPin, ArrowRight } from 'lucide-react'

interface RegionalNavigationProps {
  settore: 'ristorazione' | 'ottica' | 'abbigliamento'
  currentCitta: 'palermo' | 'catania' | 'trapani'
}

const cittaNames = {
  palermo: 'Palermo',
  catania: 'Catania',
  trapani: 'Trapani'
}

const settoreNames = {
  ristorazione: 'Ristorazione',
  ottica: 'Ottica',
  abbigliamento: 'Abbigliamento'
}

export default function RegionalNavigation({ settore, currentCitta }: RegionalNavigationProps) {
  const cittaList: Array<'palermo' | 'catania' | 'trapani'> = ['palermo', 'catania', 'trapani']
  const otherCitta = cittaList.filter(c => c !== currentCitta)

  return (
    <section className="container mx-auto px-4 py-12 max-w-6xl">
      <div className="bg-[var(--card-background)] border border-[var(--border-color)] rounded-xl p-6 md:p-8">
        <div className="flex items-center gap-2 mb-6">
          <MapPin className="w-5 h-5 text-[var(--accent-blue)]" />
          <h2 className="text-2xl md:text-3xl font-bold text-[var(--text-primary)]">
            Servizi {settoreNames[settore]} in altre città siciliane
          </h2>
        </div>
        <p className="text-sm text-[var(--text-secondary)] mb-6">
          Scopri le nostre soluzioni software e AI per {settoreNames[settore].toLowerCase()} anche in altre città della Sicilia:
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {otherCitta.map((citta) => (
            <Link
              key={citta}
              href={`/settori/${settore}/${citta}`}
              className="group flex items-center justify-between p-4 bg-[var(--background-secondary)] hover:bg-[var(--background)] rounded-lg transition-all border border-transparent hover:border-[var(--border-color)]"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-[var(--accent-blue)]/10 rounded-lg flex items-center justify-center">
                  <MapPin className="w-5 h-5 text-[var(--accent-blue)]" />
                </div>
                <div>
                  <span className="text-base font-semibold text-[var(--text-primary)] group-hover:text-[var(--accent-blue)] transition-colors block">
                    {settoreNames[settore]} a {cittaNames[citta]}
                  </span>
                  <span className="text-xs text-[var(--text-secondary)]">
                    Soluzioni software e AI per {settoreNames[settore].toLowerCase()} a {cittaNames[citta]}
                  </span>
                </div>
              </div>
              <ArrowRight className="w-5 h-5 text-[var(--accent-blue)] group-hover:translate-x-1 transition-transform flex-shrink-0" />
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}

