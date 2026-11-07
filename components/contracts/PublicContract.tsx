'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, Download, KeyRound, Loader2, MessageSquareText, PenLine, RefreshCw } from 'lucide-react'
import { identityWarning, missingRequired } from '@/lib/saas/parties-shared'
import ContractBody, { type ViewDoc, type ViewField } from './ContractBody'
import SignaturePad, { type SignatureValue } from './SignaturePad'

// Pagina del contratto per chi lo riceve (/c/<token>): prima il PIN (mai nell'indirizzo, mai
// salvato nella pagina: il campo si svuota subito), poi "Contratto tra … e …", il testo, il PDF,
// «Richiedi modifica» e «Firma il contratto» (tre accettazioni separate, nome e firma col dito).
// In «Le parti» chi riceve scrive i suoi dati veri (nome e cognome, codice fiscale, residenza…):
// si salvano mentre scrive e si possono cambiare fino alla sua firma, anche se l'altra parte ha
// gia' firmato. Senza i dati obbligatori «Firma il contratto» resta spento (con l'elenco di cosa manca).
// Il cookie del PIN giusto lo mette il server (httpOnly): la pagina non lo vede.

type Change = { id: string; at: string; text: string; section?: string; status: 'aperta' | 'accettata' | 'modificata' | 'rifiutata'; note?: string }
type View = {
  title: string
  creatorName: string
  recipientName: string
  status: 'bozza' | 'inviato' | 'modifica_richiesta' | 'in_firma' | 'firmato' | 'annullato'
  statusLabel: string
  version: { id: string; n: number; at: string }
  updated: boolean
  doc: ViewDoc
  fields: ViewField[]
  /** Puo' scrivere i suoi dati (fino alla sua firma). */
  canFill: boolean
  /** Dati obbligatori ancora vuoti (sul server). */
  missing: string[]
  /** Impronta dei dati di chi ha preparato il contratto mostrati qui (va con la firma). */
  othersRev: string
  headings: string[]
  statements: [string, string, string]
  signatures: { creatore?: { name: string; at: string }; destinatario?: { name: string; at: string } }
  changes: Change[]
  canSign: boolean
  canRequest: boolean
  signed: boolean
}

const CHANGE_LABELS: Record<Change['status'], string> = { aperta: 'In attesa di risposta', accettata: 'Accettata', modificata: 'Accettata con modifiche', rifiutata: 'Non accettata' }
const when = (iso: string) => new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function PublicContract({ token }: { token: string }) {
  const api = `/api/c/${encodeURIComponent(token)}`
  const [state, setState] = useState<'loading' | 'pin' | 'invalid' | 'ready' | 'error'>('loading')
  const [view, setView] = useState<View | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(api, { cache: 'no-store', credentials: 'same-origin' }).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    if (!res) return setState('error')
    if (res.status === 404) return setState('invalid')
    if (!res.ok) return setState('error')
    if (data?.pin) return setState('pin')
    setView(data.contract)
    setState('ready')
  }, [api])

  useEffect(() => {
    load()
  }, [load])

  return (
    <main className="min-h-[100dvh] bg-[#f3f4f7] px-4 pb-16 pt-6 text-[#16181d] [color-scheme:light]">
      <div className="mx-auto w-full max-w-2xl">
        {state === 'loading' && (
          <div className="flex justify-center py-24">
            <Loader2 className="h-6 w-6 animate-spin text-[#8a90a0]" />
          </div>
        )}
        {state === 'invalid' && <Message title="Link non valido" text="Il link non funziona più o non è scritto bene. Chiedi un nuovo link a chi te l’ha mandato." />}
        {state === 'error' && <Message title="Pagina non disponibile" text="Connessione non riuscita. Riprova tra poco." action={<button onClick={load} className="mt-4 rounded-full bg-[#1b2559] px-5 py-2.5 font-semibold text-white">Riprova</button>} />}
        {state === 'pin' && (
          <PinForm
            api={api}
            onOpen={(v) => {
              setView(v)
              setState('ready')
            }}
            onInvalid={() => setState('invalid')}
          />
        )}
        {state === 'ready' && view && (
          <Contract
            api={api}
            view={view}
            notice={notice}
            onView={(v, message) => {
              setView(v)
              setNotice(message ?? null)
            }}
            onFresh={setView}
            onPin={() => setState('pin')}
            reload={load}
          />
        )}
      </div>
    </main>
  )
}

function Message({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="mt-16 rounded-2xl bg-white p-6 text-center shadow-sm">
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="mt-2 text-[#5b6170]">{text}</p>
      {action}
    </div>
  )
}

/** PIN: campo mascherato, tastiera numerica (con le lettere se serve); dopo l'invio il campo si svuota. */
function PinForm({ api, onOpen, onInvalid }: { api: string; onOpen: (v: View) => void; onInvalid: () => void }) {
  const [pin, setPin] = useState('')
  const [letters, setLetters] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy || !pin) return
    setBusy(true)
    setError(null)
    const typed = pin
    setPin('')
    const res = await fetch(api, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'pin', pin: typed }) }).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    setBusy(false)
    if (!res) return setError('Connessione non riuscita, riprova.')
    if (res.status === 404) return onInvalid()
    if (!res.ok) return setError(data?.error || 'PIN non valido.')
    onOpen(data.contract)
  }

  return (
    <form onSubmit={submit} className="mt-10 rounded-2xl bg-white p-6 shadow-sm" autoComplete="off">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#eef1fb]">
        <KeyRound className="h-5 w-5 text-[#1b2559]" />
      </span>
      <h1 className="mt-4 text-2xl font-bold">Contratto protetto</h1>
      <p className="mt-1 text-[#5b6170]">Scrivi il PIN che ti ha mandato chi ti ha inviato il contratto.</p>
      <label className="mt-5 block text-sm font-medium" htmlFor="pin">
        PIN
      </label>
      <input
        id="pin"
        type="password"
        inputMode={letters ? 'text' : 'numeric'}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        maxLength={12}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 12))}
        className="mt-1 w-full rounded-xl border border-[#d6d9e0] bg-white px-4 py-3 text-center text-2xl tracking-[0.4em] outline-none focus:border-[#1b2559]"
        autoFocus
      />
      <button type="button" onClick={() => setLetters((l) => !l)} className="mt-2 text-sm text-[#3b5bdb]">
        {letters ? 'Il PIN ha solo numeri' : 'Il PIN ha anche lettere'}
      </button>
      {error && <p className="mt-3 text-sm text-[#c92a2a]">{error}</p>}
      <button type="submit" disabled={busy || pin.length < 4} className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-[#1b2559] px-6 py-3 font-semibold text-white disabled:opacity-50">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} Apri il contratto
      </button>
    </form>
  )
}

function Contract({
  api,
  view,
  notice,
  onView,
  onFresh,
  onPin,
  reload,
}: {
  api: string
  view: View
  notice: string | null
  onView: (v: View, message?: string) => void
  /** Contratto aggiornato senza cambiare l'avviso (bozza dei dati salvata). */
  onFresh: (v: View) => void
  onPin: () => void
  reload: () => Promise<void>
}) {
  // Dati scritti in questa pagina (le caselle partono dai valori gia' salvati).
  const [values, setValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const pending = useRef<Record<string, string>>({})
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [tick, setTick] = useState(0)
  /** Firma rifiutata perche' il contratto o i dati dell'altra parte sono cambiati: la pagina si e' ricaricata. */
  const [stale, setStale] = useState<string | null>(null)
  const editable = useMemo(() => new Set(view.canFill ? view.fields.filter((f) => f.editable).map((f) => f.id) : []), [view])
  const mineFields = useMemo(() => view.fields.filter((f) => editable.has(f.id)), [view, editable])
  const valueOf = useCallback((id: string) => values[id] ?? view.fields.find((f) => f.id === id)?.own ?? '', [values, view])
  const missing = useMemo(() => missingRequired(mineFields, valueOf), [mineFields, valueOf])
  const warnings = useMemo(() => {
    const out: Record<string, string> = {}
    for (const f of mineFields) {
      const w = identityWarning(f.kind, valueOf(f.id))
      if (w) out[f.id] = w
    }
    return out
  }, [mineFields, valueOf])
  const [panel, setPanel] = useState<'none' | 'change' | 'sign'>('none')

  const post = useCallback(
    async (body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: { error?: string; code?: string; contract?: View; completed?: boolean } | null }> => {
      const res = await fetch(api, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
      const data = res ? await res.json().catch(() => null) : null
      if (res?.status === 401 && data?.code === 'pin') onPin()
      return { ok: Boolean(res?.ok), status: res?.status ?? 0, data: data || (res ? null : { error: 'Connessione non riuscita, riprova.' }) }
    },
    [api, onPin]
  )

  const onValue = (id: string, value: string) => {
    setValues((old) => ({ ...old, [id]: value }))
    pending.current = { ...pending.current, [id]: value }
    setSaving('idle')
    setTick((t) => t + 1)
  }

  // Bozza dei dati: si salva da sola dopo una breve pausa (mai il PIN, mai nei log).
  const latest = useRef({ post, onFresh, reload })
  latest.current = { post, onFresh, reload }
  useEffect(
    () => () => {
      if (retry.current) clearTimeout(retry.current)
    },
    []
  )
  useEffect(() => {
    if (!Object.keys(pending.current).length) return
    const timer = setTimeout(async () => {
      const batch = pending.current
      pending.current = {}
      setSaving('saving')
      const { ok, status, data } = await latest.current.post({ op: 'fields', values: batch })
      if (ok && data?.contract) {
        setSaving('saved')
        setSaveError(null)
        latest.current.onFresh(data.contract)
        return
      }
      setSaving('error')
      setSaveError(data?.error || 'Dati non salvati: riprova.')
      if (status === 0 || status >= 500) {
        // Connessione caduta o server occupato: si riprova tra poco con gli stessi dati.
        pending.current = { ...batch, ...pending.current }
        if (retry.current) clearTimeout(retry.current)
        retry.current = setTimeout(() => setTick((t) => t + 1), 4000)
      } else if (status === 404 || data?.code === 'signed' || data?.code === 'closed') {
        // Link non piu' valido (revocato, contratto annullato) o gia' firmato: la pagina lo mostra.
        await latest.current.reload()
      }
    }, 800)
    return () => clearTimeout(timer)
  }, [tick])

  const status = view.status
  const chip = status === 'firmato' ? 'bg-[#e6f6ec] text-[#1e7b3c]' : status === 'modifica_richiesta' ? 'bg-[#fff4e0] text-[#a05a00]' : 'bg-[#eef1fb] text-[#1b2559]'
  const canOpenSign = view.canSign && missing.length === 0
  const nameField = view.fields.find((f) => f.kind === 'nome' && f.party === 'destinatario')
  return (
    <>
      <header>
        <p translate="no" className="text-sm font-semibold tracking-wide text-[#1b2559]">
          {view.creatorName}
        </p>
        <h1 className="mt-1 text-2xl font-bold leading-tight">
          Contratto tra <span translate="no">{view.creatorName}</span> e <span translate="no">{view.recipientName}</span>
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span className={`rounded-full px-2.5 py-1 font-medium ${chip}`}>{view.statusLabel}</span>
          <span className="text-[#5b6170]">Versione {view.version.n} · {when(view.version.at)}</span>
        </div>
      </header>

      {view.updated && (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-[#fff4e0] px-4 py-3 text-sm text-[#7a4500]">
          <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" /> Contratto aggiornato: rileggilo prima di firmare.
        </p>
      )}
      {notice && <p className="mt-4 rounded-xl bg-[#e6f6ec] px-4 py-3 text-sm text-[#1e5b30]">{notice}</p>}
      {stale && (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-[#fff4e0] px-4 py-3 text-sm text-[#7a4500]">
          <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" /> {stale}
        </p>
      )}

      {view.canFill && editable.size > 0 && (
        <p className="mt-4 rounded-xl bg-white px-4 py-3 text-sm text-[#3d4352] shadow-sm">
          Scrivi i tuoi dati veri in <a href="#le-parti" className="font-semibold text-[#3b5bdb]">«Le parti»</a>: si salvano mentre scrivi e puoi cambiarli fino alla firma.
          <span className="mt-1 block text-xs text-[#5b6170]" aria-live="polite">
            {saving === 'saving' ? 'Salvataggio…' : saving === 'saved' ? 'Dati salvati.' : saving === 'error' ? saveError : ''}
          </span>
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <a href={`${api}?pdf=1`} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[#d6d9e0] bg-white px-4 py-2 text-sm font-medium">
          <Download className="h-4 w-4" /> Scarica PDF
        </a>
        {view.canRequest && (
          <button onClick={() => setPanel(panel === 'change' ? 'none' : 'change')} className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[#d6d9e0] bg-white px-4 py-2 text-sm font-medium">
            <MessageSquareText className="h-4 w-4" /> Richiedi modifica
          </button>
        )}
        {view.canSign && (
          <button onClick={() => canOpenSign && setPanel('sign')} disabled={!canOpenSign} className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-[#1b2559] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            <PenLine className="h-4 w-4" /> Firma il contratto
          </button>
        )}
      </div>
      {view.canSign && missing.length > 0 && (
        <p className="mt-2 flex items-start gap-2 rounded-xl bg-[#fff4e0] px-3 py-2 text-sm text-[#7a4500]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Per firmare scrivi in <a href="#le-parti" className="font-semibold underline">«Le parti»</a>: {missing.join(', ')}.
          </span>
        </p>
      )}

      {panel === 'change' && view.canRequest && <ChangeForm view={view} post={post} onDone={(v) => { onView(v, 'Richiesta inviata: riceverai la risposta su questa pagina.'); setPanel('none') }} />}

      <Signatures view={view} />

      {view.changes.length > 0 && (
        <section className="mt-5 rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="font-semibold">Le tue richieste di modifica</h2>
          <ul className="mt-2 space-y-3">
            {view.changes.map((c) => (
              <li key={c.id} className="text-sm">
                <p className="text-[#5b6170]">
                  {when(c.at)}
                  {c.section ? ` · ${c.section}` : ''} · <span className="font-medium text-[#16181d]">{CHANGE_LABELS[c.status]}</span>
                </p>
                <p className="mt-0.5 whitespace-pre-line">{c.text}</p>
                {c.note && <p className="mt-1 rounded-lg bg-[#f3f4f7] px-3 py-2 text-[#3d4352]">Risposta: {c.note}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-5 rounded-2xl bg-white p-5 shadow-sm">
        <ContractBody doc={view.doc} fields={view.fields} editable={editable} values={values} onValue={onValue} warnings={warnings} otherName={view.creatorName} />
      </div>

      {panel === 'sign' && view.canSign && (
        <SignForm
          view={view}
          values={Object.fromEntries(mineFields.map((f) => [f.id, valueOf(f.id)]))}
          initialName={nameField ? valueOf(nameField.id) : ''}
          missing={missing}
          empty={mineFields.filter((f) => !valueOf(f.id).trim()).length}
          post={post}
          onDone={(v, completed) => {
            onView(v, completed ? 'Contratto firmato da entrambi: puoi scaricare il PDF firmato.' : `Hai firmato. Quando firma anche ${v.creatorName} il contratto è completo.`)
            setStale(null)
            setPanel('none')
            pending.current = {}
            setValues({})
            window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
          onStale={async (message) => {
            await reload()
            setStale(message)
            setPanel('none')
          }}
        />
      )}
    </>
  )
}

function Signatures({ view }: { view: View }) {
  const rows: [string, { name: string; at: string } | undefined][] = [
    [view.creatorName, view.signatures.creatore],
    [view.recipientName, view.signatures.destinatario],
  ]
  return (
    <section className="mt-5 grid gap-2 sm:grid-cols-2">
      {rows.map(([who, s]) => (
        <div key={who} className="rounded-2xl bg-white p-4 text-sm shadow-sm">
          <p translate="no" className="font-semibold">{who}</p>
          {s ? (
            <p className="mt-1 flex items-center gap-1.5 text-[#1e7b3c]">
              <Check className="h-4 w-4" /> Firmato da {s.name} il {when(s.at)}
            </p>
          ) : (
            <p className="mt-1 text-[#5b6170]">Firma mancante</p>
          )}
        </div>
      ))}
    </section>
  )
}

function ChangeForm({ view, post, onDone }: { view: View; post: (b: Record<string, unknown>) => Promise<{ ok: boolean; data: { error?: string; contract?: View } | null }>; onDone: (v: View) => void }) {
  const [text, setText] = useState('')
  const [section, setSection] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const send = async () => {
    if (busy || text.trim().length < 5) return
    setBusy(true)
    setError(null)
    const { ok, data } = await post({ op: 'change', text, section, versionId: view.version.id })
    setBusy(false)
    if (!ok || !data?.contract) return setError(data?.error || 'Non riuscito, riprova.')
    setText('')
    onDone(data.contract)
  }
  return (
    <section className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
      <h2 className="font-semibold">Richiedi una modifica</h2>
      <p className="mt-0.5 text-sm text-[#5b6170]">Scrivi cosa vorresti cambiare: {view.creatorName} riceve la richiesta e ti risponde qui.</p>
      {view.headings.length > 0 && (
        <select value={section} onChange={(e) => setSection(e.target.value)} className="mt-3 w-full rounded-xl border border-[#d6d9e0] bg-white px-3 py-2.5 text-[16px]">
          <option value="">Tutto il contratto</option>
          {view.headings.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
      )}
      <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 2000))} rows={4} placeholder="Es. vorrei la consegna entro il 15 dicembre" className="mt-2 w-full rounded-xl border border-[#d6d9e0] px-3 py-2.5 text-[16px] outline-none focus:border-[#1b2559]" />
      {error && <p className="mt-1 text-sm text-[#c92a2a]">{error}</p>}
      <button onClick={send} disabled={busy || text.trim().length < 5} className="mt-2 inline-flex min-h-[44px] items-center gap-2 rounded-full bg-[#1b2559] px-5 py-2 font-semibold text-white disabled:opacity-50">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />} Invia la richiesta
      </button>
    </section>
  )
}

/** Firma: tre accettazioni separate (tutte), nome e cognome, firma col dito; solo la versione mostrata (con i dati scritti). */
function SignForm({
  view,
  values,
  initialName,
  missing,
  empty,
  post,
  onDone,
  onStale,
}: {
  view: View
  values: Record<string, string>
  initialName: string
  missing: string[]
  /** Caselle facoltative ancora vuote. */
  empty: number
  post: (b: Record<string, unknown>) => Promise<{ ok: boolean; data: { error?: string; code?: string; contract?: View; completed?: boolean } | null }>
  onDone: (v: View, completed: boolean) => void
  /** Contratto o dati dell'altra parte cambiati: si ricarica la pagina e si dice perche'. */
  onStale: (message: string) => Promise<void>
}) {
  const [accept, setAccept] = useState<[boolean, boolean, boolean]>([false, false, false])
  const [name, setName] = useState(initialName)
  const [signature, setSignature] = useState<SignatureValue | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = accept.every(Boolean) && name.trim().length >= 3 && signature !== null && missing.length === 0

  const sign = async () => {
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    // Tutti i propri dati (anche cancellati): la firma li copre come sono adesso.
    const fields = values
    // othersRev: si firma solo con i dati dell'altra parte come sono mostrati qui.
    const { ok, data } = await post({ op: 'sign', versionId: view.version.id, othersRev: view.othersRev, name, accept, strokes: signature?.strokes, ratio: signature?.ratio, fields })
    setBusy(false)
    if (!ok || !data?.contract) {
      if (data?.code === 'version_changed') {
        await onStale(`Il contratto o i dati di ${view.creatorName} sono cambiati mentre leggevi: qui sotto c’è la versione aggiornata. Controllala e firma di nuovo.`)
        return
      }
      return setError(data?.error || 'Firma non riuscita, riprova.')
    }
    onDone(data.contract, Boolean(data.completed))
  }

  return (
    <section className="mt-5 rounded-2xl border-2 border-[#1b2559] bg-white p-4 shadow-sm">
      <h2 className="text-lg font-bold">Firma il contratto</h2>
      <p className="mt-0.5 text-sm text-[#5b6170]">Versione {view.version.n}. Firmi il testo e i tuoi dati come sono scritti qui sopra.</p>
      {missing.length > 0 && (
        <p className="mt-2 flex items-start gap-2 rounded-xl bg-[#fff4e0] px-3 py-2 text-sm text-[#7a4500]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Per firmare scrivi: {missing.join(', ')}.
        </p>
      )}
      {missing.length === 0 && empty > 0 && (
        <p className="mt-2 flex items-start gap-2 rounded-xl bg-[#f3f4f7] px-3 py-2 text-sm text-[#3d4352]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {empty === 1 ? 'C’è 1 casella facoltativa vuota' : `Ci sono ${empty} caselle facoltative vuote`}: puoi firmare lo stesso, restano righe da compilare a mano.
        </p>
      )}
      <div className="mt-3 space-y-2.5">
        {view.statements.map((s, k) => (
          <label key={k} className="flex items-start gap-3 rounded-xl border border-[#e3e5ea] p-3 text-[15px]">
            <input
              type="checkbox"
              checked={accept[k]}
              onChange={(e) => setAccept((a) => a.map((v, i) => (i === k ? e.target.checked : v)) as [boolean, boolean, boolean])}
              className="mt-0.5 h-5 w-5 shrink-0 accent-[#1b2559]"
            />
            <span>{s}</span>
          </label>
        ))}
      </div>
      <label className="mt-4 block text-sm font-medium" htmlFor="firma-nome">
        Nome e cognome
      </label>
      <input id="firma-nome" value={name} onChange={(e) => setName(e.target.value.slice(0, 120))} autoComplete="name" className="mt-1 w-full rounded-xl border border-[#d6d9e0] px-3 py-2.5 text-[16px] outline-none focus:border-[#1b2559]" />
      <p className="mt-4 text-sm font-medium">La tua firma</p>
      <div className="mt-1">
        <SignaturePad onChange={setSignature} disabled={busy} />
      </div>
      {error && <p className="mt-2 text-sm text-[#c92a2a]">{error}</p>}
      <button onClick={sign} disabled={!ready || busy} className="mt-3 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full bg-[#1b2559] px-6 py-3 font-semibold text-white disabled:opacity-50">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />} Firma
      </button>
      <p className="mt-2 text-xs text-[#5b6170]">Con la firma si salvano data, ora, indirizzo IP e dispositivo, come prova della firma.</p>
    </section>
  )
}
