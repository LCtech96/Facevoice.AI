'use client'

import type { ReactNode } from 'react'
import { CURRENT_TERMS, PRIVACY_URL, TERMS_PATH, TERMS_VERSION } from '@/lib/terms'

// Le tre caselle dei termini (registrazione e blocco dell'area clienti), sempre vuote
// all'inizio e da spuntare una per una. Il testo e' quello esatto che si registra
// (translate="no": niente traduzione automatica). "Termini e condizioni" e "Informativa
// privacy" si aprono in una nuova scheda.

export type TermsTicks = { a: boolean; b: boolean; c: boolean }
export const NO_TICKS: TermsTicks = { a: false, b: false, c: false }
export const allTicked = (t: TermsTicks) => t.a && t.b && t.c

const link = 'text-[var(--accent-blue)] underline'

/** Testo della casella (a) con i due link al posto dei nomi dei documenti. */
function withLinks(text: string): ReactNode[] {
  return text.split(/(Termini e condizioni|Informativa privacy)/).map((part, i) =>
    part === 'Termini e condizioni' ? (
      <a key={i} href={TERMS_PATH} target="_blank" rel="noopener noreferrer" className={link}>
        {part}
      </a>
    ) : part === 'Informativa privacy' ? (
      <a key={i} href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className={link}>
        {part}
      </a>
    ) : (
      part
    )
  )
}

export default function TermsChecks({
  value,
  onChange,
  disabled,
}: {
  value: TermsTicks
  onChange: (next: TermsTicks) => void
  disabled?: boolean
}) {
  const rows: { key: keyof TermsTicks; content: ReactNode }[] = [
    { key: 'a', content: withLinks(CURRENT_TERMS.items.a) },
    { key: 'b', content: CURRENT_TERMS.items.b },
    { key: 'c', content: CURRENT_TERMS.items.c },
  ]
  return (
    <div translate="no" className="space-y-3">
      {rows.map(({ key, content }) => (
        <label key={key} className="flex items-start gap-3 text-sm leading-snug text-[var(--text-secondary)]">
          <input
            type="checkbox"
            className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--accent-blue)]"
            checked={value[key]}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, [key]: e.target.checked })}
          />
          <span>{content}</span>
        </label>
      ))}
    </div>
  )
}

// Caselle spuntate alla registrazione con Google: dopo l'accesso il blocco dell'area clienti
// le registra sul server (solo per un account appena creato, lo controlla il server).

const PENDING_KEY = 'fv_terms_pending'
const PENDING_MS = 15 * 60_000

export function savePendingTerms() {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ version: TERMS_VERSION, at: Date.now() }))
  } catch {}
}

export function clearPendingTerms() {
  try {
    localStorage.removeItem(PENDING_KEY)
  } catch {}
}

/** true se su questo dispositivo le caselle della versione in vigore sono state spuntate da poco. */
export function hasPendingTerms(): boolean {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    if (!raw) return false
    const p = JSON.parse(raw) as { version?: unknown; at?: unknown }
    return p.version === TERMS_VERSION && typeof p.at === 'number' && Date.now() - p.at >= 0 && Date.now() - p.at < PENDING_MS
  } catch {
    return false
  }
}
