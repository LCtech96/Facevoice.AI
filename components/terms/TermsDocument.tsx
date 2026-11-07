import type { ReactNode } from 'react'
import Link from 'next/link'
import { TERMS_PATH, TERMS_VERSION, termsBlocks, versionDateLabel, type PublishedTerms } from '@/lib/terms'

// Testo dei termini come pagina leggibile: titolo, intestazioni, elenchi e link.
// Il testo e' quello esatto della versione (nessuna traduzione automatica: translate="no").

const linkClass = 'text-[var(--accent-blue)] hover:underline break-words'

/** Indirizzi web ed email cliccabili, il resto testo semplice. */
function linkify(text: string): ReactNode[] {
  return text.split(/(https:\/\/[^\s)]+|[\w.+-]+@[\w-]+\.[\w.]+\w)/g).map((part, i) => {
    if (part.startsWith('https://')) {
      return (
        <a key={i} href={part} className={linkClass} target="_blank" rel="noopener noreferrer">
          {part}
        </a>
      )
    }
    if (/^[\w.+-]+@[\w-]+\.[\w.]+\w$/.test(part)) {
      return (
        <a key={i} href={`mailto:${part}`} className={linkClass}>
          {part}
        </a>
      )
    }
    return part
  })
}

export default function TermsDocument({ terms }: { terms: PublishedTerms }) {
  const blocks = termsBlocks(terms.text)
  const current = terms.version === TERMS_VERSION
  return (
    <article translate="no" className="text-[var(--text-secondary)] leading-relaxed">
      {!current && (
        <p className="mb-6 rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)] px-4 py-3 text-sm">
          Questa è la versione del {versionDateLabel(terms.version)}, conservata senza modifiche. La versione in vigore è alla pagina{' '}
          <Link href={TERMS_PATH} className={linkClass}>
            Termini e condizioni
          </Link>
          .
        </p>
      )}
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'title':
            return (
              <h1 key={i} className="text-3xl md:text-4xl font-bold text-[var(--text-primary)] leading-tight">
                {block.text}
              </h1>
            )
          case 'meta':
            return (
              <p key={i} className="mt-3 text-sm">
                {block.text}
              </p>
            )
          case 'heading':
            return (
              <h2 key={i} className="mt-8 text-xl font-semibold text-[var(--text-primary)]">
                {block.text}
              </h2>
            )
          case 'list':
            return (
              <ul key={i} className="mt-3 list-disc space-y-1 pl-6">
                {block.items.map((item, j) => (
                  <li key={j}>{linkify(item)}</li>
                ))}
              </ul>
            )
          default:
            return (
              <p key={i} className="mt-3">
                {linkify(block.text)}
              </p>
            )
        }
      })}
    </article>
  )
}
