'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, FilePen, Loader2, Search, Share2, ShieldCheck, Trash2 } from 'lucide-react'
import { useWorkspace } from '@/components/app/WorkspaceContext'
import { SIGNATURE_NOTE, STATUS_CHIPS, type ContractStatus } from '@/components/contracts/labels'

// Pagina Contratti: i contratti e i documenti di QUESTO spazio di lavoro (mai di un altro), con
// stato, ricerca, apri, PDF, condividi ed elimina (solo le bozze mai inviate, con conferma).
// Solo per titolare e amministratori; i dati arrivano da app/api/app/contracts (controllo dello spazio).

type Item = {
  id: string
  title: string
  status: ContractStatus
  recipient: string
  updatedAt: string
  signed: { creatore: boolean; destinatario: boolean }
  openChanges: number
  shared: boolean
  document: boolean
}

const FILTERS: { key: 'tutti' | Item['status']; label: string }[] = [
  { key: 'tutti', label: 'Tutti' },
  { key: 'bozza', label: 'Bozze' },
  { key: 'inviato', label: 'Inviati' },
  { key: 'modifica_richiesta', label: 'Modifiche' },
  { key: 'in_firma', label: 'In firma' },
  { key: 'firmato', label: 'Firmati' },
]

export default function ContractsPage() {
  const { appFetch, workspace } = useWorkspace()
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('tutti')
  const [busy, setBusy] = useState<string | null>(null)
  const canManage = workspace?.role !== 'member'

  const load = useCallback(async () => {
    setError(null)
    const res = await appFetch('/api/app/contracts').catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    if (!res?.ok) return setError(data?.error || 'Contratti non caricati, riprova.')
    setItems(data.contracts || [])
  }, [appFetch])

  useEffect(() => {
    setItems(null)
    if (canManage) load()
  }, [load, canManage, workspace?.id])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (items || []).filter((i) => (filter === 'tutti' || i.status === filter) && (!q || `${i.title} ${i.recipient}`.toLowerCase().includes(q)))
  }, [items, query, filter])

  const openPdf = async (item: Item) => {
    if (busy) return
    const win = window.open('', '_blank')
    setBusy(`pdf:${item.id}`)
    const res = await appFetch(`/api/app/contracts?id=${item.id}&pdf=1`).catch(() => null)
    setBusy(null)
    if (!res?.ok) {
      win?.close()
      return setError('PDF non disponibile, riprova.')
    }
    const url = URL.createObjectURL(new Blob([await res.blob()], { type: 'application/pdf' }))
    if (win) win.location.href = url
    else window.location.href = url
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000)
  }

  const remove = async (item: Item) => {
    if (busy || !window.confirm(`Eliminare la bozza «${item.title}»? Non si può annullare.`)) return
    setBusy(`del:${item.id}`)
    const res = await appFetch(`/api/app/contracts?id=${item.id}`, { method: 'DELETE' }).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    setBusy(null)
    if (!res?.ok) return setError(data?.error || 'Non eliminato, riprova.')
    setItems((list) => (list || []).filter((i) => i.id !== item.id))
  }

  if (!canManage) {
    return <p className="text-[var(--text-secondary)]">I contratti li vedono solo il titolare e gli amministratori dello spazio.</p>
  }

  return (
    <div>
      <h1 className="flex items-center gap-2 text-2xl font-extrabold">
        <FilePen className="h-6 w-6 text-[var(--accent-blue)]" /> Contratti
      </h1>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">I contratti e i documenti preparati con l’Assistente: condividili con un link e un PIN, ricevi le richieste di modifica e le firme.</p>
      <p className="mt-2 flex items-start gap-1.5 text-xs text-[var(--text-secondary)]">
        <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" /> {SIGNATURE_NOTE}
      </p>

      <div className="mt-5 flex items-center gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--background-secondary)] px-3">
        <Search className="h-4 w-4 text-[var(--text-secondary)]" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cerca per titolo o persona" className="w-full bg-transparent py-2.5 text-[16px] outline-none" />
      </div>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)} className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${filter === f.key ? 'bg-[var(--accent-blue)] text-white' : 'border border-[var(--border-color)] text-[var(--text-secondary)]'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {error && <p className="mt-3 text-sm text-[#FF453A]">{error}</p>}
      {items === null && !error ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--text-secondary)]" />
        </div>
      ) : shown.length === 0 ? (
        <p className="mt-8 text-center text-sm text-[var(--text-secondary)]">
          {items?.length ? 'Nessun contratto con questi filtri.' : 'Ancora nessun contratto. Chiedi all’Assistente: «Preparami il contratto per la collaborazione con Giusy».'}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {shown.map((item) => {
            const s = STATUS_CHIPS[item.status] || STATUS_CHIPS.bozza
            const draft = item.status === 'bozza' && !item.shared && !item.signed.creatore && !item.signed.destinatario
            return (
              <li key={item.id} className="rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/app/contratti/${item.id}`} className="min-w-0">
                    <p translate="no" className="break-words font-semibold">{item.title}</p>
                    <p className="mt-0.5 text-sm text-[var(--text-secondary)]">
                      {item.recipient ? <span translate="no">{item.recipient}</span> : 'Destinatario da scegliere'} · {new Date(item.updatedAt).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </Link>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${s.tone}`}>{s.label}</span>
                </div>
                {item.openChanges > 0 && <p className="mt-2 text-xs font-medium text-[#FF9500]">{item.openChanges === 1 ? '1 richiesta di modifica da gestire' : `${item.openChanges} richieste di modifica da gestire`}</p>}
                {item.status === 'in_firma' && <p className="mt-2 text-xs text-[var(--text-secondary)]">{item.signed.destinatario ? 'Ha firmato il destinatario: manca la tua firma.' : 'Hai firmato tu: manca la firma del destinatario.'}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href={`/app/contratti/${item.id}`} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-[var(--accent-blue)] px-4 py-2 text-sm font-semibold text-white">
                    <ExternalLink className="h-4 w-4" /> Apri
                  </Link>
                  <button onClick={() => openPdf(item)} disabled={busy !== null} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--background)] px-4 py-2 text-sm disabled:opacity-50">
                    {busy === `pdf:${item.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : null} PDF
                  </button>
                  {item.status !== 'firmato' && item.status !== 'annullato' && (
                    <Link href={`/app/contratti/${item.id}?condividi=1`} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-[var(--border-color)] bg-[var(--background)] px-4 py-2 text-sm">
                      <Share2 className="h-4 w-4" /> Condividi
                    </Link>
                  )}
                  {draft && (
                    <button onClick={() => remove(item)} disabled={busy !== null} className="ml-auto inline-flex min-h-[40px] items-center gap-1.5 rounded-full px-3 py-2 text-sm text-[#FF453A] disabled:opacity-50">
                      {busy === `del:${item.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Elimina
                    </button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
