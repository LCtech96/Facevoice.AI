import { fieldParts, unplacedFields, type DocField, type DocSignature, type StructuredDoc } from '@/lib/pdf-doc'

// Il contratto in HTML leggibile, dallo stesso documento strutturato del PDF (stesso
// testo, stessi spazi da compilare "Etichetta: ____", stesse firme disegnate). Senza
// stato: va bene sia nella pagina del link sia nella pagina interna di Facevoice AI.

const romeStamp = (iso: string) =>
  new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function Text({ text, fields, highlight }: { text: string; fields?: DocField[]; highlight?: string | null }) {
  return (
    <>
      {fieldParts(text, fields).map((part, i) =>
        part.field && !part.field.filled ? (
          <span key={i} className={`rounded px-0.5 text-[#6b6b73] ${highlight && part.field.id === highlight ? 'bg-[#fff3c4]' : 'bg-[#f1f1f4]'}`} data-field={part.field.id}>
            {part.text}
          </span>
        ) : part.field ? (
          <span key={i} className="font-medium" data-field={part.field.id}>
            {part.text}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </>
  )
}

/** Firma disegnata: gli stessi tratti del PDF in un riquadro largo 3 volte l'altezza. */
export function StrokesSvg({ strokes, className }: { strokes: number[][]; className?: string }) {
  return (
    <svg viewBox="0 0 1000 333" preserveAspectRatio="xMinYMid meet" className={className} aria-hidden="true">
      {strokes.map((s, i) => {
        const y = (v: number) => Math.round((v / 1000) * 3330) / 10
        const pts: string[] = []
        for (let k = 0; k + 1 < s.length; k += 2) pts.push(`${s[k]},${y(s[k + 1])}`)
        if (pts.length === 1) pts.push(`${s[0] + 1},${y(s[1])}`)
        return <polyline key={i} points={pts.join(' ')} fill="none" stroke="#1a2a73" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" />
      })}
    </svg>
  )
}

function SignatureBox({ sig, fields }: { sig: DocSignature; fields?: DocField[] }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="text-sm font-semibold">
        <Text text={sig.label} fields={fields} />
      </p>
      <div className="mt-1 flex h-16 items-end border-b border-[#3d3d44]">{sig.signed?.strokes?.length ? <StrokesSvg strokes={sig.signed.strokes} className="h-14 w-full" /> : null}</div>
      {(sig.signed?.name || sig.name) && (
        <p className="mt-1 text-xs text-[#6b6b73]">
          <Text text={sig.signed?.name || sig.name || ''} fields={fields} />
        </p>
      )}
      {sig.signed && <p className="text-xs text-[#6b6b73]">Firmato il {romeStamp(sig.signed.at)}</p>}
    </div>
  )
}

export default function ContractView({ doc, highlightSection, highlightField }: { doc: StructuredDoc; highlightSection?: string | null; highlightField?: string | null }) {
  const fields = doc.fields
  const loose = unplacedFields(doc)
  const sections = [...doc.sections, ...(loose.length ? [{ heading: 'Dati delle parti', paragraphs: loose.map((f) => `{{${f.id}}}`) }] : [])]
  return (
    <article className="text-[15px] leading-relaxed text-[#1d1d1f]" translate="no">
      <h1 className="text-center text-xl font-bold leading-snug">
        <Text text={doc.title} fields={fields} />
      </h1>
      {doc.subtitle && (
        <p className="mt-1 text-center text-sm text-[#6b6b73]">
          <Text text={doc.subtitle} fields={fields} />
        </p>
      )}
      {(doc.meta || []).length > 0 && (
        <div className="mt-4 space-y-0.5 text-sm">
          {(doc.meta || []).map((m, i) => (
            <p key={i} className="break-words">
              <Text text={m} fields={fields} highlight={highlightField} />
            </p>
          ))}
        </div>
      )}
      <hr className="my-4 border-[#e2e2e6]" />
      {sections.map((s, i) => {
        const focused = Boolean(highlightSection && s.heading && s.heading.includes(highlightSection))
        return (
          <section key={i} className={`mt-4 scroll-mt-24 rounded-lg ${focused ? 'bg-[#fff8db] p-2 -mx-2' : ''}`} id={`sezione-${i + 1}`}>
            {s.heading && (
              <h2 className="text-base font-semibold">
                <Text text={s.heading} fields={fields} />
              </h2>
            )}
            {(s.paragraphs || []).map((p, k) => (
              <p key={k} className="mt-1.5 whitespace-pre-line break-words">
                <Text text={p} fields={fields} highlight={highlightField} />
              </p>
            ))}
            {(s.bullets || []).length > 0 && (
              <ul className="mt-1.5 list-disc space-y-1 pl-5">
                {(s.bullets || []).map((b, k) => (
                  <li key={k} className="break-words">
                    <Text text={b} fields={fields} highlight={highlightField} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
      {(doc.signatures || []).length > 0 && (
        <div className="mt-8 flex flex-col gap-6 sm:flex-row">
          {(doc.signatures || []).map((sig, i) => (
            <SignatureBox key={i} sig={sig} fields={fields} />
          ))}
        </div>
      )}
      {(doc.appendix || []).length > 0 && (
        <div className="mt-10 border-t-2 border-dashed border-[#d0d0d6] pt-4">
          {(doc.appendix || []).map((s, i) => (
            <section key={i} className="mt-3">
              {s.heading && <h2 className="text-base font-semibold">{s.heading}</h2>}
              {(s.paragraphs || []).map((p, k) => (
                <p key={k} className="mt-1 break-all text-sm sm:break-words">
                  {p}
                </p>
              ))}
              {(s.bullets || []).length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
                  {(s.bullets || []).map((b, k) => (
                    <li key={k}>{b}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </article>
  )
}
