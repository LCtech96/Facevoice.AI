'use client'

import { useState } from 'react'
import { Loader2, PenLine } from 'lucide-react'
import SignaturePad from './SignaturePad'

// Firma: tre conferme separate e tutte obbligatorie, nome e cognome scritti, dati da
// compilare (se ce ne sono) e firma col dito. Uguale per chi riceve e per chi crea.
// fixedName: chi riceve firma col nome e cognome che ha scritto nei suoi dati (niente secondo campo).

export type SignPayload = { accepted: boolean[]; name: string; strokes: number[][]; values: Record<string, string> }

export default function SignForm({
  statements,
  fields,
  defaultName = '',
  onSubmit,
  submitLabel = 'Firmo il contratto',
  fixedName,
}: {
  statements: string[]
  fields: { id: string; label: string }[]
  defaultName?: string
  /** Restituisce un messaggio di errore, oppure null se e' andata. */
  onSubmit: (payload: SignPayload) => Promise<string | null>
  submitLabel?: string
  fixedName?: string
}) {
  const [accepted, setAccepted] = useState<boolean[]>(statements.map(() => false))
  const [name, setName] = useState(defaultName)
  const [strokes, setStrokes] = useState<number[][]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const points = strokes.reduce((n, s) => n + s.length / 2, 0)
  const signer = fixedName?.trim() ? fixedName.trim() : name.trim()
  const ready = accepted.length === 3 && accepted.every(Boolean) && signer.length >= 3 && points >= 2

  const submit = async () => {
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    const message = await onSubmit({ accepted, name: signer, strokes, values })
    setBusy(false)
    if (message) setError(message)
  }

  return (
    <div className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Conferma uno per uno</legend>
        {statements.map((s, i) => (
          <label key={i} className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl border border-[#e2e2e6] bg-white p-3 text-sm">
            <input
              type="checkbox"
              checked={accepted[i] || false}
              onChange={(e) => setAccepted((a) => a.map((v, k) => (k === i ? e.target.checked : v)))}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[#1a2a73]"
            />
            <span className="break-words">
              <span className="font-semibold">{i + 1}.</span> {s}
            </span>
          </label>
        ))}
      </fieldset>

      {fields.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold">I tuoi dati da inserire nel contratto</p>
          {fields.map((f) => (
            <label key={f.id} className="block text-sm">
              <span className="text-[#6b6b73]">{f.label}</span>
              <input
                value={values[f.id] || ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value.slice(0, 300) }))}
                className="mt-1 w-full rounded-xl border border-[#d0d0d6] bg-white px-3 py-2.5 text-base text-[#1d1d1f]"
                autoComplete="off"
              />
            </label>
          ))}
          <p className="text-xs text-[#6b6b73]">Puoi lasciare vuoto un dato: nel contratto resta lo spazio da compilare a mano.</p>
        </div>
      )}

      {fixedName?.trim() ? (
        <p className="text-sm">
          <span className="text-[#6b6b73]">Firmi come </span>
          <span className="font-semibold break-words">{fixedName.trim()}</span>
        </p>
      ) : (
        <label className="block text-sm">
          <span className="font-semibold">Nome e cognome</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 120))}
            autoComplete="name"
            className="mt-1 w-full rounded-xl border border-[#d0d0d6] bg-white px-3 py-2.5 text-base text-[#1d1d1f]"
          />
        </label>
      )}

      <div>
        <p className="mb-1 text-sm font-semibold">La tua firma</p>
        <SignaturePad onChange={setStrokes} disabled={busy} />
      </div>

      {error && <p className="text-sm text-[#c4271b]">{error}</p>}

      <button
        type="button"
        onClick={submit}
        disabled={!ready || busy}
        className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full bg-[#1a2a73] px-5 py-3 text-base font-semibold text-white disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <PenLine className="h-5 w-5" />} {submitLabel}
      </button>
      {!ready && <p className="text-center text-xs text-[#6b6b73]">Servono le tre conferme, il nome e la firma.</p>}
    </div>
  )
}
