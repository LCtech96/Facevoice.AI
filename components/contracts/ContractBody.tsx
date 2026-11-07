'use client'

// Testo del contratto in HTML dallo stesso documento del PDF (lib/saas/contracts.ts viewDoc):
// pezzi di testo e campi. Un campo compilato mostra il valore; uno vuoto che chi guarda puo'
// scrivere e' una casella; gli altri "Etichetta: ________" come nel PDF (senza etichetta se e'
// gia' scritta subito prima: bare). La riga vuota non esce mai dal riquadro (anche a 375 px).

export type Part = string | { f: string; bare?: boolean }
export type ViewDoc = { title: string; subtitle?: Part[]; meta: Part[][]; sections: { heading?: string; paragraphs: Part[][]; bullets: Part[][] }[] }
export type ViewField = { id: string; label: string; party: 'creatore' | 'destinatario' | 'entrambi'; value?: string }

const BLANK = '_'.repeat(28)
const BLANK_LONG = '_'.repeat(40)

export default function ContractBody({
  doc,
  fields,
  editable,
  values = {},
  onValue,
  dark = false,
}: {
  doc: ViewDoc
  fields: ViewField[]
  /** Campi che chi guarda puo' scrivere (vuoti). */
  editable?: Set<string>
  values?: Record<string, string>
  onValue?: (id: string, value: string) => void
  /** Colori dell'area clienti (tema scuro) invece del foglio bianco. */
  dark?: boolean
}) {
  const byId = new Map(fields.map((f) => [f.id, f]))
  const muted = dark ? 'text-[var(--text-secondary)]' : 'text-[#5b6170]'

  const render = (parts: Part[], key: string) => {
    const alone = parts.length === 1 && typeof parts[0] !== 'string'
    return parts.map((p, k) => {
      if (typeof p === 'string') return <span key={`${key}-${k}`}>{p}</span>
      const field = byId.get(p.f)
      const label = field?.label || 'Dato'
      if (field?.value) return <strong key={`${key}-${k}`} className="font-semibold">{field.value}</strong>
      if (editable?.has(p.f) && onValue) {
        return (
          <label key={`${key}-${k}`} className="inline">
            {!p.bare && <span className={`text-sm ${muted}`}>{label}: </span>}
            <input
              value={values[p.f] || ''}
              onChange={(e) => onValue(p.f, e.target.value.slice(0, 300))}
              maxLength={300}
              aria-label={label}
              placeholder="scrivi qui"
              className={`mx-0.5 inline-block w-[min(14rem,70vw)] border-0 border-b-2 bg-transparent px-1 py-0 text-[16px] outline-none ${dark ? 'border-[var(--accent-blue)] text-[var(--text-primary)]' : 'border-[#3b5bdb] text-[#111]'}`}
            />
          </label>
        )
      }
      // Riga vuota larga al massimo quanto il riquadro: va a capo con l'etichetta, mai fuori dallo schermo.
      return (
        <span key={`${key}-${k}`}>
          {p.bare ? null : `${label}: `}
          <span aria-hidden="true" className={`inline-block max-w-full overflow-hidden whitespace-nowrap align-bottom ${alone ? 'w-[min(20rem,100%)]' : 'w-[min(12rem,100%)]'} ${muted}`}>
            {alone ? BLANK_LONG : BLANK}
          </span>
          <span className="sr-only">da compilare</span>
        </span>
      )
    })
  }

  return (
    <article className={`break-words leading-relaxed ${dark ? 'text-[var(--text-primary)]' : 'text-[#16181d]'}`}>
      <h2 className="text-xl font-bold leading-snug">{doc.title}</h2>
      {doc.subtitle ? <p className={`mt-1 ${muted}`}>{render(doc.subtitle, 'sub')}</p> : null}
      {doc.meta.length > 0 && (
        <div className="mt-3 space-y-0.5 text-[15px]">
          {doc.meta.map((m, k) => (
            <p key={k}>{render(m, `m${k}`)}</p>
          ))}
        </div>
      )}
      <hr className={`my-4 ${dark ? 'border-[var(--border-color)]' : 'border-[#e3e5ea]'}`} />
      {doc.sections.map((s, i) => (
        <section key={i} id={s.heading ? `sezione-${i}` : undefined} className="mt-4 first:mt-0">
          {s.heading ? <h3 className="text-[16px] font-bold">{s.heading}</h3> : null}
          {s.paragraphs.map((p, k) => (
            <p key={k} className="mt-1.5 whitespace-pre-line text-[15px]">
              {render(p, `s${i}p${k}`)}
            </p>
          ))}
          {s.bullets.length > 0 && (
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[15px]">
              {s.bullets.map((b, k) => (
                <li key={k}>{render(b, `s${i}b${k}`)}</li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </article>
  )
}
