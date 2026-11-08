'use client'

import type { ReactNode } from 'react'
import { ArrowLeft, FolderOpen } from 'lucide-react'

// Testata dentro un progetto: «← Tutti i progetti», nome del progetto e, a destra,
// eventuali azioni (solo l'admin).

export default function ProjectHeader({ name, onBack, color, actions }: { name: string; onBack: () => void; color?: string; actions?: ReactNode }) {
  return (
    <div className="mx-auto mb-3 max-w-6xl px-4">
      <button type="button" onClick={onBack} className="inline-flex min-h-[36px] items-center gap-1 rounded-full border border-[var(--border-color)] px-3 text-xs font-semibold text-[var(--text-primary)] hover:border-[var(--accent-blue)]">
        <ArrowLeft className="h-3.5 w-3.5" /> Tutti i progetti
      </button>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex min-w-0 items-center gap-2 text-xl font-bold text-[var(--text-primary)]">
          <FolderOpen className="h-6 w-6 shrink-0" style={{ color: color || 'var(--accent-blue)' }} />
          <span className="break-words">{name}</span>
        </h1>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}
