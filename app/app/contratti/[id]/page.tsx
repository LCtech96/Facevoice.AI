'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { AlertTriangle, Ban, Check, ChevronLeft, Copy, Download, ExternalLink, History, Link2, Loader2, MessageSquareText, Pencil, PenLine, Share2, ShieldCheck, Sparkles, X } from 'lucide-react'
import { useWorkspace } from '@/components/app/WorkspaceContext'
import ContractBody, { type ViewDoc, type ViewField } from '@/components/contracts/ContractBody'
import SignaturePad, { type SignatureValue } from '@/components/contracts/SignaturePad'
import { STATUS_CHIPS, type ContractStatus } from '@/components/contracts/labels'

// Pagina di un contratto nell'app (titolare e amministratori dello spazio): anteprima con gli
// spazi da compilare, PDF, condivisione con link e PIN (nuovo link e nuovo PIN a ogni
// condivisione), «Copia link», «Revoca link», richieste di modifica con «Accetta» (l'AI la
// applica e la proposta si vede prima di salvarla), «Modifica» (testo a mano o richiesta
// riscritta) e «Rifiuta» (nota facoltativa per il destinatario), firma del titolare (tre
// accettazioni, nome, firma col dito) e cronologia. Qui (e in chat) l'avviso "non sono un avvocato".

type Change = {
  id: string
  at: string
  text: string
  section?: string
  status: 'aperta' | 'accettata' | 'modificata' | 'rifiutata'
  note?: string
  resolvedAt?: string
  proposal: { at: string; instructions?: string; doc: ViewDoc; changed: string[] } | null
}
type Contract = {
  id: string
  title: string
  kindLabel: string
  creatorName: string
  recipient: { name: string; email?: string; platform?: string; contactId?: string }
  status: ContractStatus
  statusLabel: string
  version: { id: string; n: number; at: string; note?: string }
  versions: { id: string; n: number; at: string; note?: string }[]
  doc: ViewDoc
  content: { sections: { heading: string; paragraphs: string[]; bullets: string[] }[] }
  fields: ViewField[]
  headings: string[]
  statements: [string, string, string]
  signatures: { creatore?: { name: string; at: string; device: string }; destinatario?: { name: string; at: string; device: string } }
  changes: Change[]
  share: { channel: string; createdAt: string; revokedAt: string | null; sentTo: string | null; openedAt: string | null; locked: 'day' | 'window' | null } | null
  events: { at: string; type: string; by: string; note?: string }[]
  canSign: boolean
  canShare: boolean
  final: { at: string; contentHash: string; signaturesHash: string } | null
  disclaimer: string
  signatureNote: string
}

const EVENT_LABELS: Record<string, string> = {
  creato: 'Contratto creato',
  link_creato: 'Link condiviso',
  link_rinnovato: 'Nuovo link e nuovo PIN',
  link_revocato: 'Link revocato',
  aperto: 'Aperto dal destinatario',
  pin_errato: 'PIN sbagliato',
  modifica_richiesta: 'Modifica richiesta',
  modifica_accettata: 'Modifica accettata',
  modifica_manuale: 'Testo cambiato a mano',
  modifica_rifiutata: 'Modifica rifiutata',
  nuova_versione: 'Nuova versione',
  firmato_destinatario: 'Firmato dal destinatario',
  firmato_creatore: 'Firmato da te',
  completato: 'Firmato da entrambi',
  annullato: 'Annullato',
}
const CHANGE_LABELS: Record<Change['status'], string> = { aperta: 'Da gestire', accettata: 'Accettata', modificata: 'Modificata a mano', rifiutata: 'Rifiutata' }
const CHANNELS: { key: string; label: string }[] = [
  { key: 'link', label: 'Link da copiare' },
  { key: 'email', label: 'Email' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'whatsapp', label: 'WhatsApp (link da copiare)' },
]
const when = (iso: string) => new Date(iso).toLocaleString('it-IT', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const button = 'inline-flex min-h-[40px] items-center gap-1.5 rounded-full px-4 py-2 text-sm disabled:opacity-50'
const primary = `${button} bg-[var(--accent-blue)] font-semibold text-white`
const secondary = `${button} border border-[var(--border-color)] bg-[var(--background)]`

export default function ContractPageWrapper() {
  return (
    <Suspense fallback={<Loader2 className="h-5 w-5 animate-spin text-[var(--text-secondary)]" />}>
      <ContractPage />
    </Suspense>
  )
}

function ContractPage() {
  const { id } = useParams<{ id: string }>()
  const search = useSearchParams()
  const focus = search.get('richiesta')
  const { appFetch, workspace } = useWorkspace()
  const [contract, setContract] = useState<Contract | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [sharing, setSharing] = useState(search.get('condividi') === '1')
  // Dati del titolare scritti nel testo: si salvano con «Salva i dati» prima di ogni firma, poi con la firma.
  const [values, setValues] = useState<Record<string, string>>({})
  const canManage = workspace?.role !== 'member'

  const load = useCallback(async () => {
    const res = await appFetch(`/api/app/contracts?id=${encodeURIComponent(id)}`).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    if (!res?.ok) return setError(data?.error || 'Contratto non trovato.')
    setError(null)
    setContract(data.contract)
  }, [appFetch, id])

  useEffect(() => {
    if (canManage) load()
  }, [load, canManage, workspace?.id])

  /** Operazione sul contratto: la risposta e' sempre il contratto aggiornato. */
  const op = useCallback(
    async (name: string, body: Record<string, unknown> = {}, done?: string): Promise<{ ok: boolean; data: Record<string, unknown> | null }> => {
      setBusy(name)
      setError(null)
      setMessage(null)
      const res = await appFetch('/api/app/contracts', { method: 'POST', body: JSON.stringify({ op: name, id, ...body }) }).catch(() => null)
      const data = res ? ((await res.json().catch(() => null)) as Record<string, unknown> | null) : null
      setBusy(null)
      if (data?.contract) setContract(data.contract as Contract)
      if (!res?.ok) {
        setError((data?.error as string) || 'Non riuscito, riprova.')
        return { ok: false, data }
      }
      if (done || data?.message) setMessage((data?.message as string) || done || null)
      return { ok: true, data }
    },
    [appFetch, id]
  )

  const openPdf = async (download: boolean) => {
    if (busy) return
    const win = download ? null : window.open('', '_blank')
    setBusy(download ? 'pdf-d' : 'pdf')
    const res = await appFetch(`/api/app/contracts?id=${encodeURIComponent(id)}&pdf=1${download ? '&download=1' : ''}`).catch(() => null)
    setBusy(null)
    if (!res?.ok) {
      win?.close()
      return setError('PDF non disponibile, riprova.')
    }
    const name = (res.headers.get('content-disposition') || '').match(/filename="([^"]+)"/)?.[1] || 'contratto.pdf'
    const url = URL.createObjectURL(new Blob([await res.blob()], { type: 'application/pdf' }))
    if (win) win.location.href = url
    else {
      const a = document.createElement('a')
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      a.remove()
    }
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000)
  }

  const copyLink = async () => {
    setBusy('copy')
    const res = await appFetch(`/api/app/contracts?id=${encodeURIComponent(id)}&link=1`).catch(() => null)
    const data = res?.ok ? await res.json().catch(() => null) : null
    setBusy(null)
    if (!data?.link) return setError('Nessun link attivo: condividi di nuovo il contratto.')
    try {
      await navigator.clipboard.writeText(data.link)
      setMessage('Link copiato. Il PIN mandalo a parte.')
    } catch {
      window.prompt('Copia il link:', data.link)
    }
  }

  if (!canManage) return <p className="text-[var(--text-secondary)]">I contratti li vedono solo il titolare e gli amministratori dello spazio.</p>
  if (error && !contract) {
    return (
      <div>
        <Link href="/app/contratti" className="inline-flex items-center gap-1 text-sm text-[var(--text-secondary)]">
          <ChevronLeft className="h-4 w-4" /> Contratti
        </Link>
        <p className="mt-6 text-[var(--text-secondary)]">{error}</p>
      </div>
    )
  }
  if (!contract) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--text-secondary)]" />
      </div>
    )
  }

  const c = contract
  const chip = STATUS_CHIPS[c.status] || STATUS_CHIPS.bozza
  const linkActive = Boolean(c.share && !c.share.revokedAt && c.status !== 'annullato')
  const open = c.changes.filter((r) => r.status === 'aperta')
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/app/contratti" className="inline-flex items-center gap-1 text-sm text-[var(--text-secondary)]">
        <ChevronLeft className="h-4 w-4" /> Contratti
      </Link>
      <h1 translate="no" className="mt-2 break-words text-2xl font-extrabold leading-tight">
        {c.title}
      </h1>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">
        Contratto tra <span translate="no">{c.creatorName}</span> e <span translate="no">{c.recipient.name || '…'}</span> · versione {c.version.n}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${chip.tone}`}>{chip.label}</span>
        {c.share?.locked && (
          <span className="rounded-full bg-[#FF3B30]/10 px-2.5 py-1 text-xs text-[#FF453A]">
            {c.share.locked === 'day' ? 'Troppi PIN sbagliati: link bloccato, condividi di nuovo' : 'Troppi PIN sbagliati: link bloccato 15 minuti'}
          </span>
        )}
      </div>
      <p className="mt-3 flex items-start gap-1.5 text-xs text-[var(--text-secondary)]">
        <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-[#FF9500]" /> {c.disclaimer}
      </p>
      <p className="mt-1 flex items-start gap-1.5 text-xs text-[var(--text-secondary)]">
        <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" /> {c.signatureNote}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={() => openPdf(false)} disabled={busy !== null} className={primary}>
          {busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />} Apri PDF
        </button>
        <button onClick={() => openPdf(true)} disabled={busy !== null} className={secondary}>
          {busy === 'pdf-d' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Scarica
        </button>
        {c.canShare && (
          <button onClick={() => setSharing((s) => !s)} className={secondary}>
            <Share2 className="h-4 w-4" /> {c.share ? 'Condividi di nuovo' : 'Condividi'}
          </button>
        )}
        {linkActive && (
          <button onClick={copyLink} disabled={busy !== null} className={secondary}>
            {busy === 'copy' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />} Copia link
          </button>
        )}
        {linkActive && c.status !== 'firmato' && (
          <button onClick={() => window.confirm('Revocare il link? Chi lo ha non potrà più aprire il contratto.') && op('revoke', {}, 'Link revocato: non funziona più.')} disabled={busy !== null} className={`${button} text-[#FF453A]`}>
            <Ban className="h-4 w-4" /> Revoca link
          </button>
        )}
      </div>
      {message && <p className="mt-3 rounded-xl bg-[#34C759]/10 px-3 py-2 text-sm text-[#34C759]">{message}</p>}
      {error && <p className="mt-3 text-sm text-[#FF453A]">{error}</p>}

      {sharing && c.canShare && <SharePanel contract={c} busy={busy} onShare={async (body) => (await op('share', body)).ok && setSharing(false)} onClose={() => setSharing(false)} />}

      {c.changes.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-bold">Richieste di modifica{open.length ? ` (${open.length} da gestire)` : ''}</h2>
          <div className="mt-2 space-y-3">
            {[...c.changes].reverse().map((r) => (
              <ChangeCard key={r.id} change={r} contract={c} focused={focus === r.id} busy={busy} op={op} />
            ))}
          </div>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-lg font-bold">Firme</h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {([
            [c.creatorName, c.signatures.creatore],
            [c.recipient.name || 'Destinatario', c.signatures.destinatario],
          ] as const).map(([who, s]) => (
            <div key={who} className="rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-3 text-sm">
              <p translate="no" className="font-semibold">{who}</p>
              {s ? (
                <p className="mt-1 flex items-center gap-1.5 text-[#34C759]">
                  <Check className="h-4 w-4" /> {s.name}, {when(s.at)}
                </p>
              ) : (
                <p className="mt-1 text-[var(--text-secondary)]">Non ancora firmato</p>
              )}
            </div>
          ))}
        </div>
        {c.final && <p className="mt-2 text-xs text-[var(--text-secondary)]">Firmato da entrambi il {when(c.final.at)}. Restano solo la versione firmata e il registro delle firme (nell’ultima pagina del PDF).</p>}
      </section>

      <Preview contract={c} busy={busy} op={op} values={values} setValues={setValues} />

      {c.canSign && <SignPanel contract={c} busy={busy} op={op} values={values} onSigned={() => setValues({})} />}

      <section className="mt-6">
        <h2 className="flex items-center gap-1.5 text-lg font-bold">
          <History className="h-4 w-4" /> Cronologia
        </h2>
        <ol className="mt-2 space-y-1.5 border-l border-[var(--border-color)] pl-4 text-sm">
          {[...c.events].reverse().map((e, k) => (
            <li key={k}>
              <span className="font-medium">{EVENT_LABELS[e.type] || e.type}</span>
              <span className="text-[var(--text-secondary)]">
                {' '}
                · {when(e.at)}
                {e.note ? ` · ${e.note}` : ''}
              </span>
            </li>
          ))}
        </ol>
        {c.versions.length > 0 && <p className="mt-2 text-xs text-[var(--text-secondary)]">Versioni di prima: {c.versions.map((v) => `v${v.n}`).join(', ')} (si cancellano quando il contratto è firmato da entrambi).</p>}
      </section>
    </div>
  )
}

type Op = (name: string, body?: Record<string, unknown>, done?: string) => Promise<{ ok: boolean; data: Record<string, unknown> | null }>

/** Condivisione: destinatario, canale, PIN scelto qui (mascherato, mai salvato: solo il suo hash). */
function SharePanel({ contract, busy, onShare, onClose }: { contract: Contract; busy: string | null; onShare: (body: Record<string, unknown>) => Promise<unknown>; onClose: () => void }) {
  // Dopo la firma del destinatario nome ed email non cambiano (lo controlla anche il server).
  const signedBy = Boolean(contract.signatures.destinatario)
  const [name, setName] = useState(contract.recipient.name)
  const [email, setEmail] = useState(contract.recipient.email || '')
  const dmChannel = contract.recipient.platform === 'instagram' || contract.recipient.platform === 'facebook' ? contract.recipient.platform : null
  const [channel, setChannel] = useState(contract.recipient.email ? 'email' : dmChannel || 'link')
  const [pin, setPin] = useState('')
  const [showPin, setShowPin] = useState(false)
  const channels = CHANNELS.filter((ch) => ch.key !== 'instagram' && ch.key !== 'facebook' ? true : ch.key === dmChannel)
  const valid = name.trim() && /^[A-Za-z0-9]{4,12}$/.test(pin) && (channel !== 'email' || /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email.trim()))
  const submit = async () => {
    if (!valid || busy) return
    const typed = pin
    setPin('')
    await onShare({ recipientName: name, email, channel, contactId: channel === dmChannel ? contract.recipient.contactId : undefined, pin: typed })
  }
  return (
    <section className="mt-4 rounded-2xl border border-[var(--accent-blue)] bg-[var(--background-secondary)] p-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 font-bold">
          <Link2 className="h-4 w-4" /> Condividi con link e PIN
        </h2>
        <button onClick={onClose} aria-label="Chiudi" className="p-1 text-[var(--text-secondary)]">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mt-1 text-xs text-[var(--text-secondary)]">{contract.share ? 'Un nuovo link e un nuovo PIN: quelli di prima non funzionano più.' : 'Chi riceve il link lo apre solo con il PIN.'}</p>
      <label className="mt-3 block text-sm">
        Nome di chi lo riceve
        <input value={name} readOnly={signedBy} onChange={(e) => setName(e.target.value.slice(0, 80))} className="mt-1 w-full rounded-xl border border-[var(--border-color)] bg-[var(--background)] px-3 py-2.5 text-[16px] read-only:opacity-70" />
      </label>
      {signedBy && <p className="mt-1 text-xs text-[var(--text-secondary)]">Ha già firmato: il destinatario resta lo stesso. Cambiano solo il link e il PIN.</p>}
      <label className="mt-3 block text-sm">
        Come lo mandi
        <select value={channel} onChange={(e) => setChannel(e.target.value)} className="mt-1 w-full rounded-xl border border-[var(--border-color)] bg-[var(--background)] px-3 py-2.5 text-[16px]">
          {channels.map((ch) => (
            <option key={ch.key} value={ch.key}>
              {ch.key === dmChannel ? `${ch.label} (nel Direct, entro 24 ore dal suo ultimo messaggio)` : ch.label}
            </option>
          ))}
        </select>
      </label>
      {channel === 'email' && (
        <label className="mt-3 block text-sm">
          Email
          <input type="email" value={email} readOnly={signedBy && Boolean(contract.recipient.email)} onChange={(e) => setEmail(e.target.value.slice(0, 254))} className="mt-1 w-full rounded-xl border border-[var(--border-color)] bg-[var(--background)] px-3 py-2.5 text-[16px] read-only:opacity-70" />
        </label>
      )}
      <label className="mt-3 block text-sm">
        PIN (da 4 a 12 numeri o lettere)
        <div className="mt-1 flex items-center gap-2">
          <input
            type={showPin ? 'text' : 'password'}
            autoComplete="off"
            inputMode="text"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 12))}
            className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--background)] px-3 py-2.5 text-[16px] tracking-widest"
          />
          <button type="button" onClick={() => setShowPin((s) => !s)} className="shrink-0 text-xs text-[var(--accent-blue)]">
            {showPin ? 'Nascondi' : 'Mostra'}
          </button>
        </div>
      </label>
      <p className="mt-2 text-xs text-[var(--text-secondary)]">Il PIN non va nel messaggio: mandalo a parte, in un altro modo (a voce, SMS, telefonata). Non lo salviamo: se lo dimentichi, condividi di nuovo.</p>
      <button onClick={submit} disabled={!valid || busy !== null} className={`${primary} mt-3`}>
        {busy === 'share' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />} {channel === 'link' || channel === 'whatsapp' ? 'Crea il link' : 'Invia il link'}
      </button>
    </section>
  )
}

/** Richiesta di modifica: «Accetta» (proposta dell'AI, poi salva), «Modifica» (a mano o richiesta riscritta), «Rifiuta» (nota). */
function ChangeCard({ change, contract, focused, busy, op }: { change: Change; contract: Contract; focused: boolean; busy: string | null; op: Op }) {
  const ref = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<'none' | 'edit' | 'reject'>('none')
  const [note, setNote] = useState('')
  const [rewrite, setRewrite] = useState('')
  const index = contract.content.sections.findIndex((s) => s.heading === change.section)
  const [sectionIndex, setSectionIndex] = useState(index >= 0 ? index : 0)
  const current = contract.content.sections[sectionIndex]
  const [text, setText] = useState(current ? current.paragraphs.join('\n\n') : '')
  useEffect(() => {
    const s = contract.content.sections[sectionIndex]
    setText(s ? s.paragraphs.join('\n\n') : '')
  }, [sectionIndex, contract.content.sections])
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focused])
  const isOpen = change.status === 'aperta'
  return (
    <div ref={ref} className={`rounded-2xl border bg-[var(--background-secondary)] p-4 ${focused ? 'border-[var(--accent-blue)] ring-2 ring-[var(--accent-blue)]/30' : isOpen ? 'border-[#FF9500]/60' : 'border-[var(--border-color)]'}`}>
      <p className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
        <MessageSquareText className="h-3.5 w-3.5" /> {when(change.at)}
        {change.section ? ` · ${change.section}` : ''} · <span className={isOpen ? 'font-semibold text-[#FF9500]' : ''}>{CHANGE_LABELS[change.status]}</span>
      </p>
      <p translate="no" className="mt-1 whitespace-pre-line text-sm">{change.text}</p>
      {change.note && <p className="mt-1 text-xs text-[var(--text-secondary)]">Tua nota: {change.note}</p>}
      {isOpen && change.proposal && (
        <div className="mt-3 rounded-xl border border-[var(--accent-blue)]/50 bg-[var(--background)] p-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-[var(--accent-blue)]" /> Proposta dell’AI (non ancora salvata)
          </p>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">Cambia: {change.proposal.changed.length ? change.proposal.changed.join(', ') : 'niente di visibile'}</p>
          <div className="mt-2 max-h-80 overflow-y-auto rounded-lg border border-[var(--border-color)] p-3">
            <ContractBody dark doc={{ ...change.proposal.doc, sections: change.proposal.doc.sections.filter((s) => !change.proposal?.changed.length || change.proposal.changed.includes(s.heading || 'Testo')) }} fields={contract.fields} />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={() => op('apply', { changeId: change.id }, 'Modifica salvata: nuova versione. Le firme date vanno rifatte.')} disabled={busy !== null} className={primary}>
              {busy === 'apply' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Salva questa versione
            </button>
            <button onClick={() => setMode('edit')} disabled={busy !== null} className={secondary}>
              <Pencil className="h-4 w-4" /> Modifica
            </button>
          </div>
        </div>
      )}
      {isOpen && (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {!change.proposal && (
              <button onClick={() => op('preview', { changeId: change.id })} disabled={busy !== null} className={primary}>
                {busy === 'preview' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Accetta
              </button>
            )}
            <button onClick={() => setMode(mode === 'edit' ? 'none' : 'edit')} disabled={busy !== null} className={secondary}>
              <Pencil className="h-4 w-4" /> Modifica
            </button>
            <button onClick={() => setMode(mode === 'reject' ? 'none' : 'reject')} disabled={busy !== null} className={`${button} text-[#FF453A]`}>
              <X className="h-4 w-4" /> Rifiuta
            </button>
          </div>
          {!change.proposal && <p className="mt-1 text-[11px] text-[var(--text-secondary)]">«Accetta»: l’AI applica la richiesta e ti mostra il risultato prima di salvarlo (conta nei consumi AI).</p>}
          {mode === 'edit' && (
            <div className="mt-3 space-y-3">
              <div>
                <p className="text-sm font-medium">Riscrivi la modifica e falla applicare all’AI</p>
                <textarea value={rewrite} onChange={(e) => setRewrite(e.target.value.slice(0, 2000))} rows={2} placeholder="Es. compenso 480 €, consegna entro il 10 dicembre" className="mt-1 w-full rounded-xl border border-[var(--border-color)] bg-[var(--background)] px-3 py-2 text-[16px]" />
                <button onClick={() => op('preview', { changeId: change.id, instructions: rewrite })} disabled={busy !== null || rewrite.trim().length < 3} className={`${secondary} mt-1`}>
                  {busy === 'preview' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Mostra la proposta
                </button>
              </div>
              <div>
                <p className="text-sm font-medium">Oppure cambia tu il testo</p>
                <select value={sectionIndex} onChange={(e) => setSectionIndex(Number(e.target.value))} className="mt-1 w-full rounded-xl border border-[var(--border-color)] bg-[var(--background)] px-3 py-2 text-[16px]">
                  {contract.content.sections.map((s, i) => (
                    <option key={i} value={i}>
                      {s.heading || `Parte ${i + 1}`}
                    </option>
                  ))}
                </select>
                <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 8000))} rows={6} className="mt-2 w-full rounded-xl border border-[var(--border-color)] bg-[var(--background)] px-3 py-2 text-[16px]" />
                <p className="text-[11px] text-[var(--text-secondary)]">Paragrafi separati da una riga vuota. Gli spazi da compilare sono scritti come [[nome]]: lasciali così.</p>
                <button
                  onClick={async () => (await op('manual', { changeId: change.id, sections: [{ index: sectionIndex, heading: current?.heading || '', text }] }, 'Testo salvato: nuova versione. Le firme date vanno rifatte.')).ok && setMode('none')}
                  disabled={busy !== null || !text.trim()}
                  className={`${primary} mt-1`}
                >
                  {busy === 'manual' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Salva il testo
                </button>
              </div>
            </div>
          )}
          {mode === 'reject' && (
            <div className="mt-3">
              <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} rows={2} placeholder="Nota per chi ha chiesto la modifica (facoltativa)" className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--background)] px-3 py-2 text-[16px]" />
              <button onClick={async () => (await op('reject', { changeId: change.id, note }, 'Richiesta rifiutata: il testo resta com’è.')).ok && setMode('none')} disabled={busy !== null} className={`${button} mt-1 bg-[#FF3B30] font-semibold text-white`}>
                {busy === 'reject' ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} Rifiuta e lascia il testo com’è
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Anteprima con gli spazi del titolare da compilare. Prima di ogni firma si salvano con «Salva i
 * dati»; dopo la firma del destinatario solo i tuoi ancora vuoti, e si salvano con la tua firma
 * (quelli di entrambi restano righe da compilare a mano: il testo firmato non cambia).
 */
function Preview({ contract, busy, op, values, setValues }: { contract: Contract; busy: string | null; op: Op; values: Record<string, string>; setValues: (fn: (old: Record<string, string>) => Record<string, string>) => void }) {
  const closed = contract.status === 'firmato' || contract.status === 'annullato' || Boolean(contract.signatures.creatore)
  const signed = Boolean(contract.signatures.destinatario)
  const editable = useMemo(
    () => new Set(closed ? [] : contract.fields.filter((f) => !f.value && (f.party === 'creatore' || (f.party === 'entrambi' && !signed))).map((f) => f.id)),
    [contract, closed, signed]
  )
  const dirty = Object.values(values).some((v) => v.trim())
  return (
    <section className="mt-6">
      <h2 className="text-lg font-bold">Testo del contratto</h2>
      {editable.size > 0 && (
        <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
          {signed ? 'Puoi scrivere i tuoi dati ancora vuoti: si salvano con la tua firma.' : 'Puoi scrivere i tuoi dati nelle caselle; quelli vuoti nel PDF restano righe da compilare a mano.'}
        </p>
      )}
      <div className="mt-2 rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-4">
        <ContractBody dark doc={contract.doc} fields={contract.fields} editable={editable} values={values} onValue={(id, v) => setValues((old) => ({ ...old, [id]: v }))} />
      </div>
      {dirty && !signed && (
        <button onClick={async () => (await op('fields', { values }, 'Dati salvati.')).ok && setValues(() => ({}))} disabled={busy !== null} className={`${primary} mt-2`}>
          {busy === 'fields' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Salva i dati
        </button>
      )}
    </section>
  )
}

/** Firma del titolare: stesse tre accettazioni, nome e firma col dito del destinatario (con i suoi dati ancora vuoti scritti nel testo). */
function SignPanel({ contract, busy, op, values, onSigned }: { contract: Contract; busy: string | null; op: Op; values: Record<string, string>; onSigned: () => void }) {
  const [accept, setAccept] = useState<[boolean, boolean, boolean]>([false, false, false])
  const [name, setName] = useState('')
  const [signature, setSignature] = useState<SignatureValue | null>(null)
  const [key, setKey] = useState(0)
  const ready = accept.every(Boolean) && name.trim().length >= 3 && signature !== null
  const sign = async () => {
    if (!ready) return
    const fields = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim()))
    const { ok, data } = await op('sign', { versionId: contract.version.id, name, accept, strokes: signature?.strokes, ratio: signature?.ratio, fields }, 'Firmato.')
    if (ok) {
      onSigned()
      setAccept([false, false, false])
      setSignature(null)
      setKey((k) => k + 1)
    }
    if (data?.completed) window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  return (
    <section className="mt-6 rounded-2xl border border-[var(--accent-blue)] bg-[var(--background-secondary)] p-4">
      <h2 className="flex items-center gap-1.5 text-lg font-bold">
        <PenLine className="h-4 w-4" /> Firma anche tu
      </h2>
      <p className="mt-0.5 text-xs text-[var(--text-secondary)]">Versione {contract.version.n}. Può firmare prima chiunque: con la seconda firma il contratto è completo.</p>
      <div className="mt-3 space-y-2">
        {contract.statements.map((s, k) => (
          <label key={k} className="flex items-start gap-3 rounded-xl border border-[var(--border-color)] bg-[var(--background)] p-3 text-sm">
            <input type="checkbox" checked={accept[k]} onChange={(e) => setAccept((a) => a.map((v, i) => (i === k ? e.target.checked : v)) as [boolean, boolean, boolean])} className="mt-0.5 h-5 w-5 shrink-0" />
            <span>{s}</span>
          </label>
        ))}
      </div>
      <label className="mt-3 block text-sm">
        Nome e cognome
        <input value={name} onChange={(e) => setName(e.target.value.slice(0, 120))} autoComplete="name" className="mt-1 w-full rounded-xl border border-[var(--border-color)] bg-[var(--background)] px-3 py-2.5 text-[16px]" />
      </label>
      <p className="mt-3 text-sm">La tua firma</p>
      <div className="mt-1">
        <SignaturePad key={key} onChange={setSignature} disabled={busy !== null} />
      </div>
      <button onClick={sign} disabled={!ready || busy !== null} className={`${primary} mt-2 w-full justify-center`}>
        {busy === 'sign' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />} Firma
      </button>
    </section>
  )
}
