'use client'

import { useEffect, useRef, useState } from 'react'
import { CalendarClock, CircleCheck, Download, ExternalLink, Loader2, MessageSquarePlus, PenLine, RefreshCw, UserRound } from 'lucide-react'
import ContractView from '@/components/contracts/ContractView'
import SignForm, { type SignPayload } from '@/components/contracts/SignForm'
import { TAX_CODE_HINT, missingData, taxCodeLooksWrong } from '@/lib/contract-parties'
import { TERMS_DATE_LABEL, TERMS_DAYS_LABEL, TERMS_HEADING } from '@/lib/contract-terms'
import type { PublicView } from '@/lib/contracts'

// Il contratto per chi ha ricevuto il link (dopo il PIN): testo completo, PDF, "I tuoi
// dati" (nome e cognome, codice fiscale, indirizzo... salvati mentre scrive e mostrati
// subito nel testo, in "Le parti"), i «Termini della collaborazione» scelti da chi crea
// (solo da leggere), "Richiedi modifica" e "Firma il contratto" (si accende quando ci sono
// i dati obbligatori; tre conferme e firma col dito). Pensata per il telefono. Nessun
// avviso interno di Facevoice AI: solo il contratto.

type Datum = PublicView['myData'][number]

const KEYBOARD: Record<string, 'text' | 'email' | 'tel'> = { email: 'email', tel: 'tel', text: 'text' }
const capitalizeFor = (d: Datum) => (d.role === 'cf' ? 'characters' : d.role === 'email' ? 'none' : d.role === 'nome' || d.role === 'indirizzo' || d.role === 'nascita' ? 'words' : 'sentences')

/** Un dato da scrivere: tastiera e completamento giusti, asterisco se obbligatorio, avviso gentile sul codice fiscale. */
function DataInput({ d, value, needed, other, onChange }: { d: Datum; value: string; needed: boolean; other: string; onChange: (v: string) => void }) {
  const warn = d.role === 'cf' && value.replace(/\s+/g, '').length >= 11 && taxCodeLooksWrong(value)
  return (
    <label className="block text-sm">
      <span className="text-[#3d3d44]">
        {d.label}
        {needed && <span className="text-[#c4271b]"> *</span>}
      </span>
      {d.shared && <span className="block text-xs text-[#6b6b73]">Scrivi il tuo: {other} scrive il suo.</span>}
      <input
        type={d.input}
        inputMode={KEYBOARD[d.input] || 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, 300))}
        autoComplete={d.autoComplete}
        autoCapitalize={capitalizeFor(d)}
        spellCheck={false}
        enterKeyHint="next"
        aria-required={needed}
        className="mt-1 w-full rounded-xl border border-[#d0d0d6] bg-white px-3 py-2.5 text-base text-[#1d1d1f]"
      />
      {warn && <span className="mt-1 block text-xs text-[#9a5a00]">{TAX_CODE_HINT}</span>}
    </label>
  )
}

const romeStamp = (iso: string) =>
  new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

const REQUEST_STATUS: Record<string, string> = {
  aperta: 'In attesa di risposta',
  accettata: 'Accolta: il contratto è stato aggiornato',
  modificata: 'Accolta con qualche cambiamento: il contratto è stato aggiornato',
  rifiutata: 'Non accolta: il testo resta com’è',
}

const STATUS_STYLE: Record<string, string> = {
  firmato: 'bg-[#e3f6e8] text-[#1e7a3a]',
  in_firma: 'bg-[#e6ecff] text-[#1a2a73]',
  modifica_richiesta: 'bg-[#fff1dc] text-[#9a5a00]',
}

export default function ContractPublic({ token, initial }: { token: string; initial: PublicView }) {
  const [view, setView] = useState(initial)
  const [panel, setPanel] = useState<'none' | 'request' | 'sign'>('none')
  const [text, setText] = useState('')
  const [section, setSection] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(initial.myData.map((d) => [d.id, d.value])))
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const latest = useRef(values)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seq = useRef(0)
  const base = `/c/${encodeURIComponent(token)}`
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

  const post = async (body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> => {
    const res = await fetch(`${base}/azione`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    // Cookie scaduto (2 ore) o contratto cambiato: si ricarica la pagina.
    if (res?.status === 401 && data?.pin) window.location.reload()
    return { ok: Boolean(res?.ok), status: res?.status || 0, data }
  }

  // I dati si salvano poco dopo che smetti di scrivere: il testo del contratto si aggiorna.
  const saveData = async () => {
    const n = ++seq.current
    setSaving('saving')
    const { ok, data } = await post({ action: 'dati', values: latest.current })
    if (n !== seq.current) return
    if (!ok) {
      setSaving('error')
      return setError(String(data?.error || 'Non sono riuscito a salvare i tuoi dati: riprova.'))
    }
    setError(null)
    setView(data.view as PublicView)
    setSaving('saved')
  }
  const change = (id: string, value: string) => {
    latest.current = { ...latest.current, [id]: value }
    setValues(latest.current)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      saveData()
    }, 700)
  }
  const valueOf = (id: string) => values[id] || ''
  const missing = view.canAct && !view.signed ? missingData(view.myData, valueOf) : []
  // Termini della collaborazione non ancora scelti da chi crea: non si firma (lo controlla anche il server).
  const termsWaiting = Boolean(view.canAct && !view.signed && view.terms && !view.terms.ready)
  const company = view.myData.find((d) => d.role === 'azienda')
  const isCompany = Boolean(company && valueOf(company.id).trim())
  const nameId = view.myData.find((d) => d.role === 'nome')?.id
  const signerName = (nameId ? valueOf(nameId) : '') || view.signerName

  const sendRequest = async () => {
    if (busy || text.trim().length < 3) return
    setBusy(true)
    setError(null)
    const { ok, data } = await post({ action: 'richiesta', text: text.trim(), ...(section ? { section } : {}) })
    setBusy(false)
    if (!ok) return setError(String(data?.error || 'Non sono riuscito a inviare la richiesta: riprova.'))
    setView(data.view as PublicView)
    setText('')
    setSection('')
    setPanel('none')
    setDone(`Richiesta inviata a ${view.creatorName}: ti risponderà presto.`)
  }

  const sign = async (payload: SignPayload): Promise<string | null> => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    // Un salvataggio dei dati ancora in viaggio non deve riportare la pagina a prima della firma.
    seq.current++
    // I dati scritti partono con la firma: quelli di quel momento finiscono nel registro delle firme.
    const { ok, status, data } = await post({ action: 'firma', versionId: view.versionId, ...payload, values: latest.current })
    if (status === 409 && /cambiato/.test(String(data?.error || ''))) {
      window.location.reload()
      return String(data.error)
    }
    if (!ok) return String(data?.error || 'Firma non riuscita: riprova.')
    setView(data.view as PublicView)
    setPanel('none')
    setDone(data.completed ? 'Contratto firmato da tutti e due. Puoi scaricare il PDF firmato.' : `Hai firmato. Ora manca la firma di ${view.creatorName}.`)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    return null
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h1 className="min-w-0 break-words text-xl font-bold leading-snug">{view.heading}</h1>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[view.status] || 'bg-[#ececf0] text-[#3d3d44]'}`}>{view.statusLabel}</span>
      </div>

      <div className="mt-3 space-y-2">
        {done && (
          <p className="flex items-start gap-2 rounded-xl bg-[#e3f6e8] p-3 text-sm text-[#1e7a3a]" role="status">
            <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" /> {done}
          </p>
        )}
        {view.updated && (
          <p className="flex items-start gap-2 rounded-xl bg-[#fff1dc] p-3 text-sm text-[#7a4700]">
            <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" /> Contratto aggiornato (versione {view.versionN}): rileggilo prima di firmare.
          </p>
        )}
        {view.complete && <p className="rounded-xl bg-[#e3f6e8] p-3 text-sm text-[#1e7a3a]">Firmato da tutti e due: questa è la versione finale.</p>}
        {!view.complete && view.signed && (
          <p className="rounded-xl bg-[#e6ecff] p-3 text-sm text-[#1a2a73]">
            Hai firmato il {romeStamp(view.signed.at)}. Manca la firma di {view.creatorName}.
          </p>
        )}
        {!view.complete && !view.signed && view.otherSigned && <p className="rounded-xl bg-[#e6ecff] p-3 text-sm text-[#1a2a73]">{view.creatorName} ha già firmato: manca la tua firma.</p>}
        {view.canAct && !view.signed && missing.length > 0 && (
          <a href="#i-tuoi-dati" className="flex items-start gap-2 rounded-xl bg-white p-3 text-sm text-[#1a2a73] shadow-sm">
            <UserRound className="mt-0.5 h-4 w-4 shrink-0" /> Prima di firmare scrivi i tuoi dati veri (nome e cognome, codice fiscale, indirizzo): vanno nel contratto.
          </a>
        )}
      </div>

      {view.terms && (
        <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm" aria-label={TERMS_HEADING}>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <CalendarClock className="h-4 w-4" /> {TERMS_HEADING}
          </h2>
          <dl className="mt-2 space-y-2 text-sm">
            <div>
              <dt className="text-xs text-[#6b6b73]">{TERMS_DATE_LABEL}</dt>
              <dd className="break-words font-medium">{view.terms.date || 'Da definire'}</dd>
            </div>
            <div>
              <dt className="text-xs text-[#6b6b73]">{TERMS_DAYS_LABEL}</dt>
              <dd className="break-words font-medium">{view.terms.days || 'Da definire'}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-[#6b6b73]">
            {view.terms.ready ? `Li ha scelti ${view.creatorName}. Se vuoi cambiarli, usa «Richiedi modifica».` : `${view.creatorName} deve ancora sceglierli: potrai firmare dopo.`}
          </p>
        </section>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <a href={`${base}/pdf`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[#d0d0d6] bg-white px-4 py-2 text-sm font-medium">
          <ExternalLink className="h-4 w-4" /> Apri PDF
        </a>
        <a href={`${base}/pdf?download=1`} className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[#d0d0d6] bg-white px-4 py-2 text-sm font-medium">
          <Download className="h-4 w-4" /> Scarica PDF
        </a>
      </div>
      {!view.complete && <p className="mt-1 text-xs text-[#6b6b73]">Finché non firmate tutti e due, il PDF ha la scritta «BOZZA – non firmato».</p>}

      <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm sm:p-8">
        <ContractView doc={view.doc} />
      </div>

      {view.canAct && !view.signed && view.myData.length > 0 && (
        <section id="i-tuoi-dati" className="mt-5 scroll-mt-4 rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <UserRound className="h-4 w-4" /> I tuoi dati
            </h2>
            <span className="text-xs text-[#6b6b73]" aria-live="polite">
              {saving === 'saving' ? 'Salvo…' : saving === 'saved' ? 'Salvato' : saving === 'error' ? 'Non salvato' : ''}
            </span>
          </div>
          <p className="mt-1 text-xs text-[#6b6b73]">Vanno nel contratto, in «Le parti». Si salvano mentre scrivi e puoi cambiarli fino a quando firmi.</p>
          <div className="mt-3 space-y-3">
            {view.myData.map((d) => (
              <DataInput key={d.id} d={d} value={valueOf(d.id)} needed={d.role === 'cf' ? !isCompany : d.required} other={view.creatorName} onChange={(v) => change(d.id, v)} />
            ))}
          </div>
          {saving === 'error' && error && <p className="mt-3 text-sm text-[#c4271b]">{error}</p>}
          <p className="mt-3 text-xs text-[#6b6b73]">
            <span className="text-[#c4271b]">*</span> obbligatorio (per un’azienda basta ragione sociale e P.IVA al posto del codice fiscale). I dati vuoti restano una linea da compilare a mano.
          </p>
        </section>
      )}

      {view.requests.length > 0 && (
        <div className="mt-5 rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold">Le tue richieste di modifica</h2>
          <ul className="mt-2 space-y-3">
            {view.requests.map((r) => (
              <li key={r.id} className="text-sm">
                <p className="text-xs text-[#6b6b73]">
                  {romeStamp(r.at)}
                  {r.section ? ` · ${r.section}` : ''}
                </p>
                <p className="whitespace-pre-line break-words">{r.text}</p>
                <p className={`mt-0.5 text-xs font-medium ${r.status === 'rifiutata' ? 'text-[#9a5a00]' : r.status === 'aperta' ? 'text-[#6b6b73]' : 'text-[#1e7a3a]'}`}>{REQUEST_STATUS[r.status] || r.status}</p>
                {r.note && <p className="mt-0.5 rounded-lg bg-[#f4f4f6] p-2 text-xs">Nota di {view.creatorName}: {r.note}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {view.canAct && !view.signed && (
        <div className="sticky bottom-0 -mx-4 mt-5 border-t border-[#e2e2e6] bg-[#f4f4f6]/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
          {panel === 'none' && (
            <>
              <div className="flex gap-2">
                <button type="button" onClick={() => setPanel('request')} className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-full border border-[#1a2a73] bg-white px-4 py-3 text-sm font-semibold text-[#1a2a73]">
                  <MessageSquarePlus className="h-5 w-5" /> Richiedi modifica
                </button>
                <button type="button" onClick={() => setPanel('sign')} disabled={missing.length > 0 || termsWaiting} className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-full bg-[#1a2a73] px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">
                  <PenLine className="h-5 w-5" /> Firma il contratto
                </button>
              </div>
              {termsWaiting && (
                <p className="mt-2 text-center text-xs text-[#3d3d44]" role="status">
                  {view.creatorName} deve ancora scegliere data e termine di consegna: potrai firmare dopo.
                </p>
              )}
              {missing.length > 0 && (
                <p className="mt-2 text-center text-xs text-[#3d3d44]" role="status">
                  Per firmare mancano: {missing.map((m) => m.label).join(', ')}.{' '}
                  <a href="#i-tuoi-dati" className="font-semibold text-[#1a2a73] underline">
                    Scrivi i tuoi dati
                  </a>
                </p>
              )}
            </>
          )}

          {panel === 'request' && (
            <div className="max-h-[75dvh] overflow-y-auto rounded-2xl bg-white p-4 shadow-sm">
              <h2 className="text-base font-semibold">Richiedi una modifica</h2>
              {view.sections.length > 0 && (
                <label className="mt-3 block text-sm">
                  <span className="text-[#6b6b73]">Parte del contratto (facoltativo)</span>
                  <select value={section} onChange={(e) => setSection(e.target.value)} className="mt-1 w-full rounded-xl border border-[#d0d0d6] bg-white px-3 py-2.5 text-base">
                    <option value="">Tutto il contratto</option>
                    {view.sections.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="mt-3 block text-sm">
                <span className="text-[#6b6b73]">Cosa vorresti cambiare?</span>
                <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 2000))} rows={5} className="mt-1 w-full rounded-xl border border-[#d0d0d6] bg-white px-3 py-2.5 text-base" />
              </label>
              {error && <p className="mt-2 text-sm text-[#c4271b]">{error}</p>}
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => setPanel('none')} disabled={busy} className="min-h-[44px] flex-1 rounded-full border border-[#d0d0d6] px-4 py-2 text-sm">
                  Annulla
                </button>
                <button type="button" onClick={sendRequest} disabled={busy || text.trim().length < 3} className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-full bg-[#1a2a73] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />} Invia richiesta
                </button>
              </div>
            </div>
          )}

          {panel === 'sign' && (
            <div className="max-h-[80dvh] overflow-y-auto rounded-2xl bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">Firma il contratto</h2>
                <button type="button" onClick={() => setPanel('none')} className="min-h-[40px] px-2 text-sm text-[#1a2a73]">
                  Chiudi
                </button>
              </div>
              <p className="mt-1 text-xs text-[#6b6b73]">Firmi la versione {view.versionN} che hai qui sopra.</p>
              <div className="mt-3">
                <SignForm statements={view.statements} fields={[]} fixedName={signerName} onSubmit={sign} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
