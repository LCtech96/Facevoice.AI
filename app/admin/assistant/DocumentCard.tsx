'use client'

import { useEffect, useState, type MouseEvent } from 'react'
import { ChevronDown, Download, ExternalLink, FileText, History, Loader2, TriangleAlert } from 'lucide-react'
import { authFetch, type DocumentAction } from '@/components/useAssistantChat'
import { pdfFilename } from '@/lib/pdf-doc'
import { docAccessFresh, ensureDocAccess, DOC_ACCESS_API } from '@/lib/doc-access-client'
import { shortDate } from './format'

// Documento scritto dalla super chat (contratto, preventivo, lettera…): "Apri PDF" lo
// apre in una scheda nuova (su iPhone si vede con il visore di Safari, con condividi,
// stampa e salva), "Scarica" lo salva. Il PDF non ha un link pubblico: la route lo crea
// al momento solo per l'amministratore, riconosciuto da un cookie firmato che la scheda
// chiede qui e rinnova al clic quando e' vecchio (dura un'ora; nell'app installata, che
// non lo condivide, si scarica con il token).

const API = '/api/admin/assistant/documents'
export const DOC_DISCLAIMER = 'Non sono un avvocato: fai controllare il documento da un professionista prima di firmarlo o inviarlo.'
const PLATFORM: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', whatsapp: 'WhatsApp', email: 'Email', web: 'Chat del sito' }
const KIND: Record<string, string> = { contratto: 'Contratto', preventivo: 'Preventivo', accordo: 'Accordo', lettera: 'Lettera', altro: 'Documento' }

// Cookie per i PDF (con il token dell'amministratore).
const requestAccess = () => authFetch(DOC_ACCESS_API, { method: 'POST', body: '{}' })

/** App installata sulla schermata Home: le schede nuove non hanno i cookie dell'app. */
const standalone = () =>
  typeof window !== 'undefined' && (window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true)

const pdfUrl = (docId: string, v: number, download = false) => `${API}/${encodeURIComponent(docId)}?v=${v}${download ? '&download=1' : ''}`

type VersionInfo = { v: number; at: string; title: string; pages: number }

/**
 * Apertura con il token (app installata o cookie non disponibile): condividi/salva o scarica.
 * win: scheda gia' aperta dal clic, dove mostrare il PDF.
 */
async function openWithToken(url: string, filename: string, download: boolean, win?: Window | null): Promise<string | null> {
  const res = await authFetch(url).catch(() => null)
  if (!res?.ok) {
    win?.close()
    return 'Non riesco ad aprire il PDF, riprova.'
  }
  const blob = await res.blob()
  if (win && !download) {
    const objectUrl = URL.createObjectURL(blob)
    win.location.href = objectUrl
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
    return null
  }
  win?.close()
  const file = new File([blob], filename, { type: 'application/pdf' })
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename })
      return null
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return null
    }
  }
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  if (download) a.download = filename
  else a.target = '_blank'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
  return null
}

function PdfButtons({ docId, version, title, ready, viaToken, small }: { docId: string; version: number; title: string; ready: boolean; viaToken: boolean; small?: boolean }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const filename = pdfFilename(title)
  const base = small
    ? 'inline-flex min-h-[36px] items-center gap-1 rounded-full border border-[var(--border-color)] px-3 py-1.5 text-xs'
    : 'inline-flex min-h-[40px] items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold'
  const primary = small ? base : `${base} bg-[var(--accent-blue)] text-white`
  const secondary = small ? base : `${base} border border-[var(--border-color)] font-normal text-[var(--text-primary)]`
  const viaFetch = async (download: boolean, win?: Window | null) => {
    if (busy) return win?.close()
    setBusy(true)
    setError(await openWithToken(pdfUrl(docId, version, download), filename, download, win))
    setBusy(false)
  }
  /**
   * Link con il cookie: se e' stato chiesto da poco si apre da solo; altrimenti (pagina
   * aperta da piu' di mezz'ora) si rinnova prima di aprire, e senza cookie si usa il token.
   */
  const viaCookie = async (event: MouseEvent<HTMLAnchorElement>, download: boolean) => {
    if (docAccessFresh()) return
    event.preventDefault()
    if (busy) return
    // La scheda si apre subito, dentro il clic (cosi' il browser non la blocca); l'indirizzo dopo.
    const win = download ? null : window.open('', '_blank')
    if (win) win.opener = null
    const ok = await ensureDocAccess(requestAccess, { force: true })
    if (!ok) return viaFetch(download, win)
    const url = pdfUrl(docId, version, download)
    if (win) {
      win.location.href = url
      return
    }
    const a = document.createElement('a')
    a.href = url
    if (download) a.download = filename
    else {
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
    }
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
  if (!ready) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Preparo il PDF…
      </span>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {viaToken ? (
        <>
          <button type="button" onClick={() => viaFetch(false)} disabled={busy} className={`${primary} disabled:opacity-50`}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />} Apri PDF
          </button>
          <button type="button" onClick={() => viaFetch(true)} disabled={busy} className={`${secondary} disabled:opacity-50`}>
            <Download className="h-4 w-4" /> Scarica
          </button>
        </>
      ) : (
        <>
          <a href={pdfUrl(docId, version)} target="_blank" rel="noopener noreferrer" onClick={(e) => viaCookie(e, false)} className={primary}>
            <ExternalLink className="h-4 w-4" /> Apri PDF
          </a>
          <a href={pdfUrl(docId, version, true)} download={filename} onClick={(e) => viaCookie(e, true)} className={secondary}>
            <Download className="h-4 w-4" /> Scarica
          </a>
        </>
      )}
      {error && <span className="text-xs text-[#FF3B30]">{error}</span>}
    </div>
  )
}

export default function DocumentCard({ action, canOpen, latest }: { action: DocumentAction; canOpen: boolean; latest: boolean }) {
  const [ready, setReady] = useState(false)
  const [viaToken, setViaToken] = useState(false)
  const [showMissing, setShowMissing] = useState(false)
  const [versions, setVersions] = useState<VersionInfo[] | null>(null)
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [showVersions, setShowVersions] = useState(false)

  useEffect(() => {
    if (!canOpen) return
    let alive = true
    if (standalone()) {
      setViaToken(true)
      setReady(true)
      return
    }
    ensureDocAccess(requestAccess).then((ok) => {
      if (!alive) return
      // Senza cookie si apre lo stesso, con il token.
      setViaToken(!ok)
      setReady(true)
    })
    return () => {
      alive = false
    }
  }, [canOpen])

  const toggleVersions = async () => {
    const next = !showVersions
    setShowVersions(next)
    if (!next || versions || loadingVersions) return
    setLoadingVersions(true)
    const res = await authFetch(`${API}/${encodeURIComponent(action.docId)}?meta=1`).catch(() => null)
    const data = res?.ok ? await res.json().catch(() => null) : null
    setVersions(Array.isArray(data?.versions) ? data.versions : [])
    setLoadingVersions(false)
  }

  const older = (versions || []).filter((v) => v.v !== action.version).sort((a, b) => b.v - a.v)
  const source = action.basedOn ? `Dalla chat con ${action.basedOn.name} · ${PLATFORM[action.basedOn.platform] || action.basedOn.platform}` : 'Senza conversazione collegata'

  return (
    <div className={`mt-3 w-full max-w-xl rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-3 ${latest ? '' : 'opacity-80'}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex min-w-0 items-start gap-2">
          <FileText className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent-blue)]" />
          <span className="min-w-0">
            <span className="block break-words text-sm font-semibold">{action.title}</span>
            <span className="block break-words text-xs text-[var(--text-secondary)]">{source}</span>
          </span>
        </span>
        <span className="shrink-0 rounded-full bg-[var(--background)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">{KIND[action.docKind] || 'Documento'}</span>
      </div>

      <p className="mt-2 text-xs text-[var(--text-secondary)]">
        {action.pages} {action.pages === 1 ? 'pagina' : 'pagine'} · versione {action.version}
        {latest ? '' : ' (non è l’ultima)'} · {shortDate(action.createdAt)}
      </p>

      {action.placeholders.length > 0 && (
        <div className="mt-2">
          <button type="button" onClick={() => setShowMissing(!showMissing)} className="inline-flex min-h-[32px] items-center gap-1 text-xs font-medium text-[#FF9500]">
            Da completare: {action.placeholders.length} <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showMissing ? 'rotate-180' : ''}`} />
          </button>
          {showMissing && (
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-[var(--text-secondary)]">
              {action.placeholders.map((p, i) => (
                <li key={i} className="break-words">
                  {p}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="mt-2 flex items-start gap-1.5 text-xs text-[var(--text-secondary)]">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#FF9500]" /> {DOC_DISCLAIMER}
      </p>

      <div className="mt-3">
        {canOpen ? (
          <PdfButtons docId={action.docId} version={action.version} title={action.version > 1 ? `${action.title} v${action.version}` : action.title} ready={ready} viaToken={viaToken} />
        ) : (
          <p className="text-xs text-[var(--text-secondary)]">Solo l’amministratore può aprire il documento.</p>
        )}
      </div>

      {canOpen && latest && action.version > 1 && (
        <div className="mt-3 border-t border-[var(--border-color)] pt-2">
          <button type="button" onClick={toggleVersions} className="inline-flex min-h-[32px] items-center gap-1.5 text-xs text-[var(--text-secondary)]">
            <History className="h-3.5 w-3.5" /> Versioni precedenti <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showVersions ? 'rotate-180' : ''}`} />
          </button>
          {showVersions && (
            <div className="mt-2 space-y-2">
              {loadingVersions ? (
                <Loader2 className="h-4 w-4 animate-spin text-[var(--text-secondary)]" />
              ) : older.length ? (
                older.map((v) => (
                  <div key={v.v} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-[var(--text-secondary)]">
                      Versione {v.v} · {v.pages} {v.pages === 1 ? 'pagina' : 'pagine'} · {shortDate(v.at)}
                    </span>
                    <PdfButtons docId={action.docId} version={v.v} title={`${v.title} v${v.v}`} ready={ready} viaToken={viaToken} small />
                  </div>
                ))
              ) : (
                <p className="text-xs text-[var(--text-secondary)]">Nessuna versione precedente salvata.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
