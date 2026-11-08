'use client'

import { splitLinks } from '@/lib/todo-shared'

/** Testo con i link cliccabili (si aprono in una scheda nuova). */
export default function LinkText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className}>
      {splitLinks(text).map((p, i) =>
        p.href ? (
          <a key={i} href={p.href} target="_blank" rel="noopener noreferrer nofollow" onClick={(e) => e.stopPropagation()} className="break-all text-[var(--accent-blue)] underline">
            {p.text}
          </a>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </span>
  )
}
