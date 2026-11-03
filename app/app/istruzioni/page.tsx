'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Facebook, Instagram, Loader2, Mail, SlidersHorizontal } from 'lucide-react'
import { useWorkspace } from '@/components/app/WorkspaceContext'

// Istruzioni per l'AI: una base comune a tutti i canali e una parte per ogni
// canale (tono, cosa dire e cosa no). L'AI usa solo quello che c'e' scritto qui.

type ChannelId = 'general' | 'email' | 'instagram' | 'facebook'

const SECTIONS: { id: ChannelId; label: string; icon: typeof Mail; placeholder: string; hint: string }[] = [
  {
    id: 'general',
    label: 'Per tutti i canali',
    icon: SlidersHorizontal,
    hint: 'Chi siete, cosa offrite, prezzi, orari, indirizzo, domande frequenti, cosa non dire mai e quando passare la conversazione a una persona.',
    placeholder: `Esempio:
Siamo la Pizzeria da Mario, via Roma 10, Palermo. Aperti dal martedì alla domenica 19:00–23:30, lunedì chiuso.
Facciamo asporto e consegna (zona centro, 2 €). Prenotazioni per gruppi oltre 8 persone: solo al telefono 091 123456.
Prezzi: margherita 7 €, pizze speciali 9–12 €. Senza glutine disponibile su richiesta.
Non promettere mai sconti. Se chiedono di lavorare con noi, rispondi che ci scrivano a lavoro@pizzeriadamario.it.
Tono: cordiale, dai del tu.`,
  },
  {
    id: 'email',
    label: 'Email',
    icon: Mail,
    hint: 'Firma, tono più formale, cosa allegare o a chi girare le richieste.',
    placeholder: 'Esempio: dai del lei, firma come "Lo staff della Pizzeria da Mario". Per preventivi eventi chiedi data, numero di persone e budget.',
  },
  {
    id: 'instagram',
    label: 'Instagram',
    icon: Instagram,
    hint: 'Messaggi Direct: brevi e informali.',
    placeholder: 'Esempio: risposte brevi, al massimo un’emoji. Per le collaborazioni con creator chiedi il media kit.',
  },
  {
    id: 'facebook',
    label: 'Facebook',
    icon: Facebook,
    hint: 'Messenger della Pagina Facebook.',
    placeholder: 'Esempio: per le prenotazioni manda il link del modulo sul sito.',
  },
]

export default function InstructionsPage() {
  const { appFetch, workspace } = useWorkspace()
  const [values, setValues] = useState<Record<string, string> | null>(null)
  const [saved, setSaved] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const canEdit = workspace?.role !== 'member'

  const load = useCallback(async () => {
    const res = await appFetch('/api/app/instructions').catch(() => null)
    const data = res?.ok ? await res.json() : null
    if (!data) return setError('Istruzioni non disponibili, ricarica la pagina.')
    setValues(data.instructions)
    setSaved(data.instructions)
  }, [appFetch])

  useEffect(() => {
    load()
  }, [load])

  const save = async (channel: ChannelId) => {
    if (!values) return
    setBusy(channel)
    setError(null)
    const res = await appFetch('/api/app/instructions', { method: 'PUT', body: JSON.stringify({ channel, content: values[channel] || '' }) }).catch(() => null)
    setBusy(null)
    if (!res?.ok) return setError((res && (await res.json().catch(() => ({}))).error) || 'Non salvato, riprova.')
    setSaved((s) => ({ ...s, [channel]: values[channel] || '' }))
    setDone(channel)
    setTimeout(() => setDone((d) => (d === channel ? null : d)), 2500)
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl font-extrabold">Istruzioni</h1>
      <p className="mt-2 text-[var(--text-secondary)]">
        L’AI risponde solo con quello che scrivi qui: se un’informazione manca, dice che verifica e la conversazione resta a te. Più sei preciso, migliori
        sono le risposte.
      </p>
      {error && <p className="mt-4 text-sm text-[#ff6b6b]">{error}</p>}
      {!values ? (
        <Loader2 className="mt-8 h-5 w-5 animate-spin text-[var(--text-secondary)]" />
      ) : (
        <div className="mt-8 space-y-8">
          {SECTIONS.map(({ id, label, icon: Icon, placeholder, hint }) => {
            const changed = (values[id] || '') !== (saved[id] || '')
            return (
              <section key={id}>
                <h2 className="flex items-center gap-2 text-lg font-bold">
                  <Icon className="h-5 w-5 text-[var(--accent-blue)]" /> {label}
                </h2>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">{hint}</p>
                <textarea
                  value={values[id] || ''}
                  onChange={(e) => setValues((v) => ({ ...(v || {}), [id]: e.target.value }))}
                  readOnly={!canEdit}
                  placeholder={placeholder}
                  rows={id === 'general' ? 12 : 5}
                  maxLength={20000}
                  className="mt-3 w-full rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-4 text-[16px] leading-relaxed text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)] md:text-sm"
                />
                {canEdit && (
                  <div className="mt-2 flex items-center justify-end gap-3">
                    {done === id && (
                      <span className="flex items-center gap-1 text-sm text-[#34C759]">
                        <Check className="h-4 w-4" /> Salvato
                      </span>
                    )}
                    <button
                      onClick={() => save(id)}
                      disabled={!changed || busy === id}
                      className="flex items-center gap-2 rounded-full bg-[var(--accent-blue)] px-5 py-2 text-sm font-semibold text-white disabled:opacity-40"
                    >
                      {busy === id && <Loader2 className="h-4 w-4 animate-spin" />} Salva
                    </button>
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
