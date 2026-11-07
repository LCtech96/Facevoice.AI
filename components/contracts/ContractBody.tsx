'use client'

import { DELIVERY_DAYS, NO_DATE, NO_DAYS, termText, type TermKind } from '@/lib/saas/parties-shared'

// Testo del contratto in HTML dallo stesso documento del PDF (lib/saas/contracts.ts viewDoc):
// pezzi di testo e campi. In cima «Le parti»: i dati di chi prepara il contratto e, per chi lo
// riceve, nome e cognome, codice fiscale, residenza… Un campo che chi guarda puo' scrivere e' una
// casella (con la tastiera giusta: email, telefono); uno compilato mostra il valore; gli altri
// "Etichetta: ________" come nel PDF (senza etichetta se e' gia' scritta subito prima: bare).
// La riga vuota non esce mai dal riquadro (anche a 375 px).
// Subito dopo «Le parti», «Termini della collaborazione»: per chi prepara il contratto data e ora
// (selettore di data e ora, oppure «Nessuna data stabilita») e termine di consegna (7, 14, 30 giorni
// o «Nessun termine»); per chi lo riceve gli stessi in sola lettura, scritti in parole.

export type Part = string | { f: string; bare?: boolean }
export type ViewParties = { heading: string; creator: { label: string; value?: string; f?: string }[]; recipient: { label: string; f: string }[] }
export type ViewTerms = { heading: string; rows: { label: string; f: string; kind: TermKind }[] }
export type ViewDoc = {
  title: string
  subtitle?: Part[]
  meta: Part[][]
  parties?: ViewParties
  terms?: ViewTerms
  sections: { heading?: string; paragraphs: Part[][]; bullets: Part[][] }[]
  /** Riquadri delle firme (etichetta e nome sotto la riga), come nel PDF. */
  signatures?: { label: Part[]; name?: Part[] }[]
}
export type ViewField = {
  id: string
  label: string
  party: 'creatore' | 'destinatario' | 'entrambi'
  /** Come si stampa (per i campi di entrambi: un valore per parte). */
  value?: string
  /** Il valore di chi guarda (per la casella). */
  own?: string
  /** Campi di entrambi: il valore dell'altra parte. */
  other?: string
  editable?: boolean
  required?: boolean
  requiredUnless?: string
  input?: 'text' | 'email' | 'tel'
  autoComplete?: string
  kind?: string
}

const BLANK = '_'.repeat(28)
const BLANK_LONG = '_'.repeat(40)

export default function ContractBody({
  doc,
  fields,
  editable,
  values = {},
  onValue,
  dark = false,
  warnings = {},
  waitingFor,
  otherName,
}: {
  doc: ViewDoc
  fields: ViewField[]
  /** Campi che chi guarda puo' scrivere. */
  editable?: Set<string>
  values?: Record<string, string>
  onValue?: (id: string, value: string) => void
  /** Colori dell'area clienti (tema scuro) invece del foglio bianco. */
  dark?: boolean
  /** Avvisi gentili sotto le caselle (es. codice fiscale scritto male): non bloccano. */
  warnings?: Record<string, string>
  /** Pagina del titolare: chi riceve non ha ancora scritto i suoi dati ("In attesa dei dati di …"). */
  waitingFor?: string
  /** Nome dell'altra parte (accanto al suo valore nei campi di entrambi). */
  otherName?: string
}) {
  const byId = new Map(fields.map((f) => [f.id, f]))
  const muted = dark ? 'text-[var(--text-secondary)]' : 'text-[#5b6170]'
  const canWrite = (id: string) => Boolean(editable?.has(id) && onValue)

  const blank = (alone: boolean) => (
    <>
      <span aria-hidden="true" className={`inline-block max-w-full overflow-hidden whitespace-nowrap align-bottom ${alone ? 'w-[min(20rem,100%)]' : 'w-[min(12rem,100%)]'} ${muted}`}>
        {alone ? BLANK_LONG : BLANK}
      </span>
      <span className="sr-only">da compilare</span>
    </>
  )

  /** Casella di un campo: tastiera e completamento automatico giusti (nome, indirizzo, email, telefono). */
  const box = (f: ViewField, block: boolean, label = f.label) => (
    <input
      type={f.input === 'email' ? 'email' : f.input === 'tel' ? 'tel' : 'text'}
      inputMode={f.input === 'email' ? 'email' : f.input === 'tel' ? 'tel' : 'text'}
      name={f.autoComplete || f.id}
      autoComplete={f.autoComplete || 'off'}
      autoCapitalize={f.kind === 'cf' ? 'characters' : f.input === 'email' ? 'none' : undefined}
      autoCorrect={f.kind === 'cf' || f.input === 'email' || f.input === 'tel' ? 'off' : undefined}
      spellCheck={f.kind === 'cf' || f.input === 'email' ? false : undefined}
      value={values[f.id] ?? f.own ?? ''}
      onChange={(e) => onValue?.(f.id, e.target.value.slice(0, 300))}
      maxLength={300}
      aria-label={label}
      aria-required={f.required || undefined}
      placeholder="scrivi qui"
      className={
        block
          ? `mt-1 w-full rounded-xl border px-3 py-2.5 text-[16px] outline-none ${dark ? 'border-[var(--border-color)] bg-[var(--background)] text-[var(--text-primary)] focus:border-[var(--accent-blue)]' : 'border-[#d6d9e0] bg-white text-[#111] focus:border-[#1b2559]'}`
          : `mx-0.5 inline-block w-[min(14rem,70vw)] border-0 border-b-2 bg-transparent px-1 py-0 text-[16px] outline-none ${dark ? 'border-[var(--accent-blue)] text-[var(--text-primary)]' : 'border-[#3b5bdb] text-[#111]'}`
      }
    />
  )

  const warning = (id: string) => (warnings[id] ? <span className={`mt-1 block text-xs ${dark ? 'text-[#FF9F0A]' : 'text-[#a05a00]'}`}>{warnings[id]}</span> : null)

  const render = (parts: Part[], key: string) => {
    const alone = parts.length === 1 && typeof parts[0] !== 'string'
    return parts.map((p, k) => {
      if (typeof p === 'string') return <span key={`${key}-${k}`}>{p}</span>
      const field = byId.get(p.f)
      const label = field?.label || 'Dato'
      if (field && canWrite(p.f)) {
        return (
          <label key={`${key}-${k}`} className="inline">
            {!p.bare && <span className={`text-sm ${muted}`}>{label}: </span>}
            {box(field, false)}
            {field.party === 'entrambi' && field.other ? <span className={`text-sm ${muted}`}> · {field.other}{otherName ? ` (${otherName})` : ''}</span> : null}
            {warning(p.f)}
          </label>
        )
      }
      if (field?.value) return <strong key={`${key}-${k}`} className="font-semibold">{field.value}</strong>
      // Riga vuota larga al massimo quanto il riquadro: va a capo con l'etichetta, mai fuori dallo schermo.
      return (
        <span key={`${key}-${k}`}>
          {p.bare ? null : `${label}: `}
          {blank(alone)}
        </span>
      )
    })
  }

  /** Riga di «Le parti»: il dato noto, la casella (chi la puo' scrivere) oppure il valore o la riga vuota. */
  const partyRow = (label: string, id: string | undefined, known: string | undefined, key: string) => {
    const f = id ? byId.get(id) : undefined
    if (f && id && canWrite(id)) {
      return (
        <label key={key} className="block">
          <span className="text-sm font-medium">
            {label}
            {f.required || f.requiredUnless ? <span aria-hidden="true"> *</span> : null}
          </span>
          {box(f, true, label)}
          {warning(id)}
        </label>
      )
    }
    const shown = known ?? f?.value
    return (
      <p key={key} className="text-[15px]">
        {label ? <span className={muted}>{label}: </span> : null}
        {shown ? (
          <strong translate="no" className="font-semibold">
            {shown}
          </strong>
        ) : (
          blank(false)
        )}
      </p>
    )
  }

  /** Riga dei termini della collaborazione: selettori per chi prepara il contratto, testo in parole per gli altri. */
  const termRow = (row: ViewTerms['rows'][number], key: string) => {
    const f = byId.get(row.f)
    const pill = (active: boolean) =>
      `min-h-[40px] rounded-full border px-3.5 py-2 text-sm ${
        active ? (dark ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)] font-semibold text-white' : 'border-[#1b2559] bg-[#1b2559] font-semibold text-white') : dark ? 'border-[var(--border-color)] bg-[var(--background-secondary)]' : 'border-[#d6d9e0] bg-white'
      }`
    if (f && canWrite(row.f)) {
      const value = values[row.f] ?? f.own ?? ''
      const shown = termText(row.kind, value)
      return (
        <div key={key} className="block">
          <p className="text-sm font-medium">
            {row.label}
            <span aria-hidden="true"> *</span>
          </p>
          {row.kind === 'collab_at' ? (
            <>
              <input
                type="datetime-local"
                value={value === NO_DATE ? '' : value}
                disabled={value === NO_DATE}
                onChange={(e) => onValue?.(row.f, e.target.value)}
                aria-label={row.label}
                aria-required
                className={`mt-1 w-full rounded-xl border px-3 py-2.5 text-[16px] outline-none disabled:opacity-50 ${dark ? 'border-[var(--border-color)] bg-[var(--background)] text-[var(--text-primary)] [color-scheme:dark] focus:border-[var(--accent-blue)]' : 'border-[#d6d9e0] bg-white text-[#111] focus:border-[#1b2559]'}`}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" aria-pressed={value === NO_DATE} onClick={() => onValue?.(row.f, value === NO_DATE ? '' : NO_DATE)} className={pill(value === NO_DATE)}>
                  Nessuna data stabilita
                </button>
              </div>
            </>
          ) : (
            <div className="mt-1 flex flex-wrap gap-2" role="group" aria-label={row.label}>
              {DELIVERY_DAYS.map((d) => (
                <button key={d} type="button" aria-pressed={value === d} onClick={() => onValue?.(row.f, d)} className={pill(value === d)}>
                  {d} giorni
                </button>
              ))}
              <button type="button" aria-pressed={value === NO_DAYS} onClick={() => onValue?.(row.f, NO_DAYS)} className={pill(value === NO_DAYS)}>
                Nessun termine
              </button>
            </div>
          )}
          <p className={`mt-1 text-xs ${shown ? muted : dark ? 'text-[#FF9F0A]' : 'text-[#a05a00]'}`}>
            {shown || 'Da scegliere'}
            {row.kind === 'collab_at' && value !== NO_DATE ? ' · ora italiana' : ''}
          </p>
        </div>
      )
    }
    return (
      <p key={key} className="text-[15px]">
        <span className={muted}>{row.label}: </span>
        {f?.value ? (
          <strong className="font-semibold">{f.value}</strong>
        ) : (
          <span className={dark ? 'text-[#FF9F0A]' : 'text-[#a05a00]'}>da scegliere</span>
        )}
      </p>
    )
  }

  const parties = doc.parties
  const terms = doc.terms
  const writingRequired = parties ? parties.recipient.some((l) => canWrite(l.f) && (byId.get(l.f)?.required || byId.get(l.f)?.requiredUnless)) : false
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
      {parties && (
        <section id="le-parti" className={`mt-4 rounded-xl border p-3 ${dark ? 'border-[var(--border-color)] bg-[var(--background)]' : 'border-[#e3e5ea] bg-[#fafbfc]'}`}>
          <h3 className="text-[16px] font-bold">{parties.heading}</h3>
          <p className={`mt-2 text-sm font-semibold uppercase tracking-wide ${muted}`}>Tra</p>
          <div className="mt-1 space-y-1.5">{parties.creator.map((l, k) => partyRow(l.label, l.f, l.value, `c${k}`))}</div>
          <p className={`mt-3 text-sm font-semibold uppercase tracking-wide ${muted}`}>e</p>
          {waitingFor && <p className={`mt-1 rounded-lg px-3 py-2 text-sm ${dark ? 'bg-[#FF9500]/10 text-[#FF9F0A]' : 'bg-[#fff4e0] text-[#7a4500]'}`}>In attesa dei dati di {waitingFor}</p>}
          <div className="mt-1 space-y-2.5">{parties.recipient.map((l, k) => partyRow(l.label, l.f, undefined, `r${k}`))}</div>
          {writingRequired && <p className={`mt-2 text-xs ${muted}`}>* obbligatorio. Il codice fiscale non serve se scrivi ragione sociale e P.IVA dell’azienda.</p>}
        </section>
      )}
      {terms && terms.rows.length > 0 && (
        <section id="termini" className={`mt-3 rounded-xl border p-3 ${dark ? 'border-[var(--border-color)] bg-[var(--background)]' : 'border-[#e3e5ea] bg-[#fafbfc]'}`}>
          <h3 className="text-[16px] font-bold">{terms.heading}</h3>
          <div className="mt-2 space-y-3">{terms.rows.map((row, k) => termRow(row, `t${k}`))}</div>
        </section>
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
      {doc.signatures && doc.signatures.length > 0 && (
        <section className="mt-5">
          <h3 className="text-[16px] font-bold">Firme</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {doc.signatures.map((g, k) => (
              <div key={k} className={`rounded-xl border p-3 text-[15px] ${dark ? 'border-[var(--border-color)]' : 'border-[#e3e5ea]'}`}>
                <p className="font-semibold">{render(g.label, `g${k}l`)}</p>
                {g.name && g.name.length > 0 ? <p className="mt-1">{render(g.name, `g${k}n`)}</p> : null}
              </div>
            ))}
          </div>
        </section>
      )}
    </article>
  )
}
