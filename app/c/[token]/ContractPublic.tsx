'use client'

import { useState } from 'react'
import { CircleCheck, Download, ExternalLink, Loader2, MessageSquarePlus, PenLine, RefreshCw } from 'lucide-react'
import ContractView from '@/components/contracts/ContractView'
import SignForm, { type SignPayload } from '@/components/contracts/SignForm'
import type { PublicView } from '@/lib/contracts'

// Il contratto per chi ha ricevuto il link (dopo il PIN): testo completo, PDF, "Richiedi
// modifica" e "Firma il contratto" (tre conferme, nome e firma col dito). Pensata per
// il telefono. Nessun avviso interno di Facevoice AI: solo il contratto.

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
  const base = `/c/${encodeURIComponent(token)}`

  const post = async (body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> => {
    const res = await fetch(`${base}/azione`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    // Cookie scaduto (2 ore) o contratto cambiato: si ricarica la pagina.
    if (res?.status === 401 && data?.pin) window.location.reload()
    return { ok: Boolean(res?.ok), status: res?.status || 0, data }
  }

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
    const { ok, status, data } = await post({ action: 'firma', versionId: view.versionId, ...payload })
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
      </div>

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
            <div className="flex gap-2">
              <button type="button" onClick={() => setPanel('request')} className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-full border border-[#1a2a73] bg-white px-4 py-3 text-sm font-semibold text-[#1a2a73]">
                <MessageSquarePlus className="h-5 w-5" /> Richiedi modifica
              </button>
              <button type="button" onClick={() => setPanel('sign')} className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-full bg-[#1a2a73] px-4 py-3 text-sm font-semibold text-white">
                <PenLine className="h-5 w-5" /> Firma il contratto
              </button>
            </div>
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
                <SignForm statements={view.statements} fields={view.myFields} defaultName={view.recipientName === 'Destinatario' ? '' : view.recipientName} onSubmit={sign} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
