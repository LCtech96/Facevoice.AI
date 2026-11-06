'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, Facebook, GraduationCap, Instagram, Loader2, Mail, Megaphone, SlidersHorizontal, Trash2 } from 'lucide-react'
import { useWorkspace } from '@/components/app/WorkspaceContext'
import BrandSettings from '@/components/app/BrandSettings'

// Istruzioni per l'AI: una base comune a tutti i canali e una parte per ogni
// canale (tono, cosa dire e cosa no). L'AI usa solo quello che c'e' scritto qui.
// In fondo le "Correzioni imparate" dall'Omnichat (Correggi → Sempre) e dalle
// bozze modificate: si modificano e si cancellano qui (titolare e amministratori).
// Con una Campagna accesa (Omnichat) un avviso in alto: nei canali scelti l'AI usa
// la campagna, non queste istruzioni.

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
  const [campaign, setCampaign] = useState<{ active: boolean; name: string } | null>(null)
  const canEdit = workspace?.role !== 'member'

  useEffect(() => {
    appFetch('/api/app/campaign')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setCampaign(data?.campaign ? { active: data.campaign.active === true, name: String(data.campaign.name || '') } : null))
      .catch(() => null)
  }, [appFetch])

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
      {campaign?.active && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-[#AF52DE]/60 bg-[#AF52DE]/10 p-4 text-sm">
          <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-[#BF5AF2]" />
          <p className="min-w-0">
            <span className="font-semibold">
              Campagna attiva{campaign.name ? ': ' : ''}
              {campaign.name ? <span translate="no">{campaign.name}</span> : null}
            </span>{' '}
            — nei canali scelti l’AI usa le informazioni della campagna, non queste.{' '}
            <Link href="/app/omnichat#campagna" className="whitespace-nowrap font-semibold text-[var(--accent-blue)]">
              Apri la campagna
            </Link>
          </p>
        </div>
      )}
      <h1 className="text-3xl font-extrabold">Istruzioni</h1>
      <p className="mt-2 text-[var(--text-secondary)]">
        L’AI risponde solo con quello che scrivi qui: se un’informazione manca, dice che verifica e la conversazione resta a te. Più sei preciso, migliori
        sono le risposte.
      </p>
      {error && <p className="mt-4 text-sm text-[#ff6b6b]">{error}</p>}
      <div className="mt-8">
        <BrandSettings canEdit={canEdit} />
      </div>
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
      <LearnedRules canEdit={canEdit} />
    </div>
  )
}

type Rule = {
  id: string
  rule: string
  example: { incoming: string; corrected: string }
  platform: string | null
  learnedOn?: string | null
  createdAt: string
  updatedAt: string
  source: 'manual' | 'edited_draft'
  /** false = scritta da un membro del team: vale meno delle Istruzioni finche' non la riscrive un amministratore. */
  byAdmin?: boolean
}

const RULE_CHANNELS: { id: string; label: string }[] = [
  { id: '', label: 'Tutti i canali' },
  { id: 'email', label: 'Email' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'web', label: 'Chat del sito' },
]
const channelLabel = (id: string | null | undefined) => RULE_CHANNELS.find((c) => c.id === (id || ''))?.label || id || ''
const day = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })

/** Regole nate dalle correzioni: testo e canale modificabili, eliminabili. */
function LearnedRules({ canEdit }: { canEdit: boolean }) {
  const { appFetch } = useWorkspace()
  const [rules, setRules] = useState<Rule[] | null>(null)
  const [edits, setEdits] = useState<Record<string, { rule: string; platform: string }>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await appFetch('/api/app/reply-rules').catch(() => null)
    const data = res?.ok ? await res.json().catch(() => null) : null
    if (!data) return setError('Correzioni non disponibili, ricarica la pagina.')
    setRules(data.rules || [])
  }, [appFetch])

  useEffect(() => {
    load()
  }, [load])

  const valueOf = (r: Rule) => edits[r.id] || { rule: r.rule, platform: r.platform || '' }

  const save = async (r: Rule) => {
    const v = valueOf(r)
    if (!v.rule.trim()) return setError('Scrivi la regola, oppure eliminala.')
    setBusy(r.id)
    setError(null)
    const res = await appFetch('/api/app/reply-rules', { method: 'PATCH', body: JSON.stringify({ id: r.id, rule: v.rule, platform: v.platform || null }) }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setBusy(null)
    if (!res?.ok) return setError(data.error || 'Non salvata, riprova.')
    setRules((list) => (list || []).map((x) => (x.id === r.id ? data.rule : x)))
    setEdits((all) => {
      const next = { ...all }
      delete next[r.id]
      return next
    })
    setDone(r.id)
    setTimeout(() => setDone((d) => (d === r.id ? null : d)), 2500)
  }

  const remove = async (r: Rule) => {
    if (!confirm('Eliminare questa correzione? L’AI non la seguirà più.')) return
    setBusy(r.id)
    setError(null)
    const res = await appFetch('/api/app/reply-rules', { method: 'DELETE', body: JSON.stringify({ id: r.id }) }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setBusy(null)
    if (!res?.ok) return setError(data.error || 'Non eliminata, riprova.')
    setRules((list) => (list || []).filter((x) => x.id !== r.id))
  }

  return (
    <section className="mt-10">
      <h2 className="flex items-center gap-2 text-lg font-bold">
        <GraduationCap className="h-5 w-5 text-[var(--accent-blue)]" /> Correzioni imparate
      </h2>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">
        Nate quando correggi una risposta nell’Omnichat (con «Sempre, per messaggi così») o modifichi una bozza dell’AI prima di inviarla. L’AI le segue nei
        messaggi simili, prima delle regole generali.
      </p>
      {error && <p className="mt-3 text-sm text-[#ff6b6b]">{error}</p>}
      {!rules ? (
        !error && <Loader2 className="mt-4 h-5 w-5 animate-spin text-[var(--text-secondary)]" />
      ) : !rules.length ? (
        <p className="mt-4 rounded-2xl border border-dashed border-[var(--border-color)] p-4 text-sm text-[var(--text-secondary)]">
          Nessuna correzione per ora. Nell’Omnichat tocca «Correggi» sotto una risposta dell’AI e scegli «Sempre, per messaggi così».
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rules.map((r) => {
            const v = valueOf(r)
            const changed = v.rule !== r.rule || v.platform !== (r.platform || '')
            return (
              <li key={r.id} className="rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-4">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                  <span>{day(r.createdAt)}</span>
                  {r.learnedOn && <span>· da {channelLabel(r.learnedOn)}</span>}
                  {r.source === 'edited_draft' && (
                    <span className="rounded-full border border-[var(--border-color)] px-2 py-0.5">imparata da una bozza modificata</span>
                  )}
                  {r.source === 'manual' && !r.byAdmin && (
                    <span className="rounded-full border border-[var(--border-color)] px-2 py-0.5">corretta dal team</span>
                  )}
                </div>
                <textarea
                  value={v.rule}
                  onChange={(e) => setEdits((all) => ({ ...all, [r.id]: { ...v, rule: e.target.value } }))}
                  readOnly={!canEdit}
                  maxLength={400}
                  rows={2}
                  aria-label="Regola"
                  className="mt-2 w-full rounded-xl border border-[var(--border-color)] bg-[var(--background)] p-3 text-[16px] text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)] md:text-sm"
                />
                {(r.example.incoming || r.example.corrected) && (
                  <div className="mt-2 space-y-1 text-xs text-[var(--text-secondary)]">
                    {r.example.incoming && (
                      <p>
                        Messaggio: <span translate="no" className="text-[var(--text-primary)]">«{r.example.incoming.slice(0, 200)}{r.example.incoming.length > 200 ? '…' : ''}»</span>
                      </p>
                    )}
                    {r.example.corrected && (
                      <p>
                        Risposta giusta: <span translate="no" className="text-[var(--text-primary)]">«{r.example.corrected.slice(0, 300)}{r.example.corrected.length > 300 ? '…' : ''}»</span>
                      </p>
                    )}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                    Vale per
                    <select
                      value={v.platform}
                      disabled={!canEdit || busy === r.id}
                      onChange={(e) => setEdits((all) => ({ ...all, [r.id]: { ...v, platform: e.target.value } }))}
                      className="rounded-full border border-[var(--border-color)] bg-[var(--background)] px-3 py-1 text-[16px] text-[var(--text-primary)] md:text-xs"
                    >
                      {RULE_CHANNELS.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {canEdit && (
                    <div className="ml-auto flex items-center gap-2">
                      {done === r.id && (
                        <span className="flex items-center gap-1 text-sm text-[#34C759]">
                          <Check className="h-4 w-4" /> Salvata
                        </span>
                      )}
                      <button
                        onClick={() => remove(r)}
                        disabled={busy === r.id}
                        aria-label="Elimina"
                        title="Elimina"
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-secondary)] disabled:opacity-40"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                      {changed && (
                        <button
                          onClick={() => save(r)}
                          disabled={busy === r.id}
                          className="flex items-center gap-2 rounded-full bg-[var(--accent-blue)] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
                        >
                          {busy === r.id && <Loader2 className="h-4 w-4 animate-spin" />} Salva
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {!canEdit && rules?.length ? <p className="mt-2 text-xs text-[var(--text-secondary)]">Le modificano il titolare o un amministratore.</p> : null}
    </section>
  )
}
