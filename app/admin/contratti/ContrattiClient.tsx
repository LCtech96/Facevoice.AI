'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Download, FilePenLine, FileText, Loader2, PenLine, Plus, RefreshCw, Search, Share2, Trash2 } from 'lucide-react'
import { authFetch } from '@/components/useAssistantChat'
import { openContractPdf } from '@/components/contracts/adminPdf'
import { CONTRACT_STATUSES, SIGNATURE_NOTE, STATUS_LABEL, type ContractStatus } from '@/lib/contract-text'
import { pdfFilename } from '@/lib/pdf-doc'
import { useAdminGate } from './useAdminGate'

// Pagina Contratti (solo l'admin): tutti i contratti del sito con lo stato, ricerca,
// apertura, PDF, condivisione e cancellazione delle bozze. Sotto, i documenti della
// super chat che possono diventare contratti.

type Item = { id: string; title: string; recipient: string; status: ContractStatus; statusLabel: string; at: string; createdAt: string; docId: string | null }
type Doc = { id: string; title: string; kind: string; at: string }

export const STATUS_CHIP: Record<ContractStatus, string> = {
  bozza: 'bg-[var(--background)] text-[var(--text-secondary)] border border-[var(--border-color)]',
  inviato: 'bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]',
  modifica_richiesta: 'bg-[#FF9500]/15 text-[#FF9500]',
  in_firma: 'bg-[#5856D6]/15 text-[#8e8cf0]',
  firmato: 'bg-[#34C759]/15 text-[#34C759]',
  annullato: 'bg-[#FF3B30]/10 text-[#FF3B30]',
}

const day = (iso: string) => new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function ContrattiClient() {
  const allowed = useAdminGate()
  const router = useRouter()
  const [items, setItems] = useState<Item[] | null>(null)
  const [docs, setDocs] = useState<Doc[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ContractStatus | 'tutti'>('tutti')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await authFetch('/api/admin/contracts').catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    if (!res?.ok || !data) {
      setError(data?.error || 'Non riesco a caricare i contratti.')
      setItems((list) => list ?? [])
      return
    }
    setError(null)
    setItems(data.contracts || [])
    setDocs(data.documents || [])
  }, [])

  useEffect(() => {
    if (allowed) load()
  }, [allowed, load])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (items || []).filter((i) => (filter === 'tutti' || i.status === filter) && (!q || `${i.title} ${i.recipient}`.toLowerCase().includes(q)))
  }, [items, query, filter])

  const counts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const i of items || []) out[i.status] = (out[i.status] || 0) + 1
    return out
  }, [items])

  const fromDoc = async (docId: string) => {
    setBusy(`doc:${docId}`)
    const res = await authFetch('/api/admin/contracts', { method: 'POST', body: JSON.stringify({ docId }) }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setBusy(null)
    if (res?.ok && data?.id) router.push(`/admin/contratti/${encodeURIComponent(data.id)}`)
    else setError(data?.error || 'Non riesco a creare il contratto.')
  }

  const remove = async (item: Item) => {
    if (!window.confirm(`Cancellare «${item.title}»? Non si può annullare.`)) return
    setBusy(`del:${item.id}`)
    const res = await authFetch(`/api/admin/contracts/${encodeURIComponent(item.id)}`, { method: 'DELETE' }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setBusy(null)
    if (!res?.ok) setError(data?.error || 'Non riesco a cancellare.')
    load()
  }

  const pdf = async (item: Item) => {
    setBusy(`pdf:${item.id}`)
    const message = await openContractPdf(item.id, pdfFilename(item.title), false)
    setBusy(null)
    if (message) setError(message)
  }

  if (!allowed) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[var(--accent-blue)]/30 border-t-[var(--accent-blue)]" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl px-4 pb-28 pt-20 md:pb-16 md:pt-24">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-[var(--text-primary)]">
            <FilePenLine className="h-6 w-6" /> Contratti
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Contratti di Facevoice AI: condividili con un link e un PIN, ricevi le richieste di modifica e le firme.</p>
          <p className="mt-1 flex items-start gap-1.5 text-xs text-[var(--text-secondary)]">
            <PenLine className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {SIGNATURE_NOTE}
          </p>
        </div>
        <button type="button" onClick={load} className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-[var(--accent-blue)] px-3 py-2 text-sm text-white">
          <RefreshCw className="h-4 w-4" /> Aggiorna
        </button>
      </div>

      {error && <p className="mt-4 rounded-xl border border-[#FF3B30]/40 bg-[#FF3B30]/10 px-3 py-2 text-sm text-[var(--text-primary)]">{error}</p>}

      <div className="mt-5 flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)] px-3">
        <Search className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cerca per titolo o persona" className="min-h-[44px] w-full bg-transparent text-base text-[var(--text-primary)] outline-none md:text-sm" />
      </div>

      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {(['tutti', ...CONTRACT_STATUSES] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setFilter(s)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${filter === s ? 'bg-[var(--accent-blue)] text-white' : 'border border-[var(--border-color)] text-[var(--text-secondary)]'}`}
          >
            {s === 'tutti' ? `Tutti (${items?.length || 0})` : `${STATUS_LABEL[s]}${counts[s] ? ` (${counts[s]})` : ''}`}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-2">
        {items === null ? (
          <p className="py-8 text-center text-sm text-[var(--text-secondary)]">Caricamento…</p>
        ) : shown.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--border-color)] p-6 text-center text-sm text-[var(--text-secondary)]">
            {items.length ? 'Nessun contratto con questi filtri.' : 'Ancora nessun contratto. Crea un documento nella Super chat (es. «scrivi il contratto per Giusy») e poi dì «invialo a Giusy», oppure aprilo qui sotto.'}
          </p>
        ) : (
          shown.map((item) => (
            <div key={item.id} className="rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-3">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/admin/contratti/${encodeURIComponent(item.id)}`} className="min-w-0">
                  <span className="block break-words text-sm font-semibold text-[var(--text-primary)]">{item.title}</span>
                  <span className="block text-xs text-[var(--text-secondary)]">
                    Con {item.recipient} · aggiornato il {day(item.at)}
                  </span>
                </Link>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${STATUS_CHIP[item.status] || ''}`}>{item.statusLabel}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Link href={`/admin/contratti/${encodeURIComponent(item.id)}`} className="inline-flex min-h-[36px] items-center gap-1 rounded-full bg-[var(--accent-blue)] px-3 py-1.5 text-xs font-semibold text-white">
                  Apri
                </Link>
                <button type="button" onClick={() => pdf(item)} disabled={busy === `pdf:${item.id}`} className="inline-flex min-h-[36px] items-center gap-1 rounded-full border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-primary)]">
                  {busy === `pdf:${item.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} PDF
                </button>
                {item.status !== 'annullato' && (
                  <Link href={`/admin/contratti/${encodeURIComponent(item.id)}?condividi=1`} className="inline-flex min-h-[36px] items-center gap-1 rounded-full border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-primary)]">
                    <Share2 className="h-3.5 w-3.5" /> Condividi
                  </Link>
                )}
                {(item.status === 'bozza' || item.status === 'annullato') && (
                  <button type="button" onClick={() => remove(item)} disabled={busy === `del:${item.id}`} className="inline-flex min-h-[36px] items-center gap-1 rounded-full border border-[#FF3B30]/40 px-3 py-1.5 text-xs text-[#FF3B30]">
                    {busy === `del:${item.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Elimina
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {docs.length > 0 && (
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Documenti della Super chat</h2>
          <p className="text-xs text-[var(--text-secondary)]">Aprili come contratto per condividerli e farli firmare.</p>
          <div className="mt-2 space-y-2">
            {docs.map((d) => (
              <div key={d.id} className="flex items-center justify-between gap-2 rounded-xl border border-[var(--border-color)] p-3">
                <span className="flex min-w-0 items-start gap-2">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-secondary)]" />
                  <span className="min-w-0">
                    <span className="block break-words text-sm text-[var(--text-primary)]">{d.title}</span>
                    <span className="block text-xs text-[var(--text-secondary)]">
                      {d.kind} · {day(d.at)}
                    </span>
                  </span>
                </span>
                <button type="button" onClick={() => fromDoc(d.id)} disabled={busy === `doc:${d.id}`} className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-full border border-[var(--border-color)] px-3 py-1.5 text-xs text-[var(--text-primary)]">
                  {busy === `doc:${d.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Apri come contratto
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
