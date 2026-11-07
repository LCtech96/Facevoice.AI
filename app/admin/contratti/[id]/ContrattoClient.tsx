'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, Ban, Check, Copy, Download, ExternalLink, History, KeyRound, Loader2, Pencil, PenLine, Plus, Share2, Sparkles, Trash2, TriangleAlert, UserRound, X } from 'lucide-react'
import { authFetch } from '@/components/useAssistantChat'
import ContractView from '@/components/contracts/ContractView'
import SignForm, { type SignPayload } from '@/components/contracts/SignForm'
import { openContractPdf } from '@/components/contracts/adminPdf'
import { CHANNEL_LABEL, CONTRACT_NOTE_EVENT, CREATOR_DISCLAIMER, PIN_PATTERN, SHARE_CHANNELS, SIGNATURE_NOTE, defaultShareText, type ShareChannel } from '@/lib/contract-text'
import { pdfFilename, type DocSection, type StructuredDoc } from '@/lib/pdf-doc'
import type { CreatorView } from '@/lib/contracts'
import { taxCodeLooksWrong } from '@/lib/contract-parties'
import { useAdminGate } from '../useAdminGate'
import { STATUS_CHIP } from '../ContrattiClient'

// Pagina di un contratto per l'admin: anteprima, stato e cronologia, PDF, condivisione
// (link + PIN), richieste di modifica con Accetta (l'AI applica e mostra prima di
// salvare), Modifica (a mano o riscrivendo la richiesta) e Rifiuta (il testo resta),
// dati da compilare e firma di Facevoice AI (tre conferme, nome e firma col dito), dati
// scritti dalla controparte nella pagina del link (si aggiornano da soli mentre li scrive).

const when = (iso: string) => new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

const EVENT_LABEL: Record<string, string> = {
  creato: 'Contratto creato',
  link_creato: 'Link creato',
  link_rinnovato: 'Link nuovo (quello di prima non funziona più)',
  link_revocato: 'Link revocato',
  link_non_inviato: 'Invio non riuscito: link tolto',
  modifica_richiesta: 'Richiesta di modifica',
  modifica_rifiutata: 'Richiesta rifiutata',
  nuova_versione: 'Nuova versione',
  dati_compilati: 'Dati compilati',
  dati_parti: 'Aggiunti gli spazi per i dati delle parti',
  firma: 'Firma',
  completato: 'Firmato da tutti e due',
  annullato: 'Contratto annullato',
  pin_errato: 'PIN sbagliato sul link',
}

const REQUEST_LABEL: Record<string, string> = { aperta: 'Da decidere', accettata: 'Accettata', modificata: 'Accettata con modifiche', rifiutata: 'Rifiutata' }

type Proposal = { requestId?: string; mode: 'accettata' | 'modificata'; proposal: StructuredDoc; preview: StructuredDoc; missing: string[] }
type Editor = { requestId?: string; doc: StructuredDoc }

const btn = 'inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-[var(--border-color)] px-4 py-2 text-sm text-[var(--text-primary)] disabled:opacity-50'
const primary = 'inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-[var(--accent-blue)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50'
const card = 'rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-4'
const input = 'w-full rounded-lg border border-[var(--border-color)] bg-[var(--background)] px-3 py-2 text-base text-[var(--text-primary)] md:text-sm'

function ShareSheet({ c, onDone, onClose }: { c: CreatorView; onDone: (c: CreatorView, outcome: string) => void; onClose: () => void }) {
  const known = c.recipient.platform as ShareChannel | undefined
  const [channel, setChannel] = useState<ShareChannel>(c.recipient.email ? 'email' : known && ['instagram', 'facebook', 'whatsapp'].includes(known) ? known : 'link')
  const [email, setEmail] = useState(c.recipient.email || '')
  const [name, setName] = useState(c.recipient.name === 'Destinatario' ? '' : c.recipient.name)
  const [text, setText] = useState(defaultShareText(c.title, c.recipient.name, c.creator.name))
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dm = channel === 'instagram' || channel === 'facebook' || channel === 'whatsapp'
  const dmTarget = dm && known === channel ? c.recipient.contactId || '' : ''
  const pinOk = PIN_PATTERN.test(pin) && pin.toUpperCase() === pin2.toUpperCase()
  const ready = pinOk && name.trim().length > 0 && (channel !== 'email' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) && (!dm || Boolean(dmTarget)) && (channel === 'link' || text.trim().length > 0)

  const submit = async () => {
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    const res = await authFetch(`/api/admin/contracts/${encodeURIComponent(c.id)}`, {
      method: 'POST',
      body: JSON.stringify({ action: 'share', channel, to: channel === 'email' ? email.trim() : dmTarget, name: name.trim(), text, pin }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setBusy(false)
    if (!res?.ok) return setError(data?.error || 'Non riesco a condividere, riprova.')
    setPin('')
    setPin2('')
    onDone(data.contract, data.outcome)
  }

  return (
    <div className={`${card} mt-4`}>
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--text-primary)]">
          <Share2 className="h-4 w-4" /> Condividi il contratto
        </h2>
        <button type="button" onClick={onClose} aria-label="Chiudi" className="p-2 text-[var(--text-secondary)]">
          <X className="h-4 w-4" />
        </button>
      </div>
      {c.share?.active && <p className="mt-1 text-xs text-[#FF9500]">C’è già un link attivo: condividendo di nuovo cambiano link e PIN, e quello di prima non funziona più.</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {SHARE_CHANNELS.map((ch) => (
          <button key={ch} type="button" onClick={() => setChannel(ch)} className={`rounded-full px-3 py-1.5 text-xs font-medium ${channel === ch ? 'bg-[var(--accent-blue)] text-white' : 'border border-[var(--border-color)] text-[var(--text-secondary)]'}`}>
            {CHANNEL_LABEL[ch]}
          </button>
        ))}
      </div>
      <label className="mt-3 block text-sm text-[var(--text-secondary)]">
        Nome di chi lo riceve
        <input value={name} onChange={(e) => setName(e.target.value.slice(0, 120))} className={`${input} mt-1`} />
      </label>
      {channel === 'email' && (
        <label className="mt-3 block text-sm text-[var(--text-secondary)]">
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={`${input} mt-1`} autoComplete="off" />
        </label>
      )}
      {dm &&
        (dmTarget ? (
          <p className="mt-3 text-xs text-[var(--text-secondary)]">
            In privato su {CHANNEL_LABEL[channel]} alla persona della conversazione da cui nasce il contratto (solo se ti ha scritto nelle ultime 24 ore).
          </p>
        ) : (
          <p className="mt-3 text-xs text-[#FF9500]">Su {CHANNEL_LABEL[channel]} posso scrivere solo alla persona della conversazione: chiedilo nella Super chat («invialo a …») oppure usa «Solo link».</p>
        ))}
      {channel !== 'link' && (
        <label className="mt-3 block text-sm text-[var(--text-secondary)]">
          Messaggio
          <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 1500))} rows={4} className={`${input} mt-1`} />
          <span className="mt-1 block text-[11px]">In fondo aggiungo il link e la frase «il PIN te lo mando a parte».</span>
        </label>
      )}
      <div className="mt-3 rounded-lg border border-[var(--border-color)] bg-[var(--background)] p-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
          <KeyRound className="h-3.5 w-3.5" /> PIN per aprire il link
        </p>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <input type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 12))} placeholder="PIN (4-12 lettere o numeri)" aria-label="PIN" autoComplete="off" autoCapitalize="none" spellCheck={false} className={input} />
          <input type="password" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 12))} placeholder="Ripeti il PIN" aria-label="Ripeti il PIN" autoComplete="off" autoCapitalize="none" spellCheck={false} className={input} />
        </div>
        {pin2 && !pinOk && <p className="mt-1 text-xs text-[#FF3B30]">{PIN_PATTERN.test(pin) ? 'I due PIN non sono uguali.' : 'Da 4 a 12 lettere o numeri.'}</p>}
        <p className="mt-1.5 text-[11px] text-[var(--text-secondary)]">Il PIN non è nel messaggio: mandalo in un altro modo (a voce, SMS o telefonata). Non lo vedrai più: se lo perdi, condividi di nuovo.</p>
      </div>
      {error && <p className="mt-2 text-sm text-[#FF3B30]">{error}</p>}
      <div className="mt-3 flex justify-end">
        <button type="button" onClick={submit} disabled={!ready || busy} className={primary}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />} {channel === 'link' ? 'Crea il link' : 'Crea il link e invia'}
        </button>
      </div>
    </div>
  )
}

function DocEditor({ editor, onChange }: { editor: Editor; onChange: (doc: StructuredDoc) => void }) {
  const doc = editor.doc
  const setSection = (i: number, patch: Partial<DocSection>) => onChange({ ...doc, sections: doc.sections.map((s, k) => (k === i ? { ...s, ...patch } : s)) })
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--text-secondary)]">Le parti tra {'{{ }}'} sono gli spazi da compilare: lasciale come sono (o togli la parola intera). Paragrafi separati da una riga vuota, un punto elenco per riga.</p>
      <label className="block text-sm text-[var(--text-secondary)]">
        Titolo
        <input value={doc.title} onChange={(e) => onChange({ ...doc, title: e.target.value.slice(0, 140) })} className={`${input} mt-1`} />
      </label>
      {doc.sections.map((s, i) => (
        <div key={i} className="rounded-lg border border-[var(--border-color)] p-3">
          <div className="flex items-center gap-2">
            <input value={s.heading || ''} onChange={(e) => setSection(i, { heading: e.target.value.slice(0, 160) })} placeholder="Titolo della sezione" className={input} />
            <button type="button" onClick={() => onChange({ ...doc, sections: doc.sections.filter((_, k) => k !== i) })} aria-label="Togli la sezione" className="p-2 text-[#FF3B30]">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <textarea
            value={(s.paragraphs || []).join('\n\n')}
            onChange={(e) => setSection(i, { paragraphs: e.target.value.split(/\n\s*\n/) })}
            rows={Math.min(14, Math.max(3, Math.ceil((s.paragraphs || []).join(' ').length / 70)))}
            className={`${input} mt-2`}
            aria-label="Testo della sezione"
          />
          {(s.bullets?.length || 0) > 0 && (
            <textarea value={(s.bullets || []).join('\n')} onChange={(e) => setSection(i, { bullets: e.target.value.split('\n') })} rows={Math.min(8, (s.bullets || []).length + 1)} className={`${input} mt-2`} aria-label="Punti elenco" />
          )}
          <label className="mt-2 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <input type="checkbox" checked={Boolean(s.specificApproval)} onChange={(e) => setSection(i, { specificApproval: e.target.checked })} /> Da approvare in modo specifico (artt. 1341 e 1342 c.c.)
          </label>
        </div>
      ))}
      <button type="button" onClick={() => onChange({ ...doc, sections: [...doc.sections, { heading: `${doc.sections.length + 1}. `, paragraphs: [''] }] })} className={btn}>
        <Plus className="h-4 w-4" /> Aggiungi sezione
      </button>
    </div>
  )
}

export default function ContrattoClient({ id }: { id: string }) {
  const allowed = useAdminGate()
  const params = useSearchParams()
  const focusReq = params.get('req')
  const [c, setC] = useState<CreatorView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [share, setShare] = useState(params.get('condividi') === '1')
  const [link, setLink] = useState<string | null>(null)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [rewrite, setRewrite] = useState<{ requestId: string; text: string } | null>(null)
  const [reject, setReject] = useState<{ requestId: string; note: string } | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({})
  const [recipient, setRecipient] = useState<{ name: string; email: string } | null>(null)
  const [signing, setSigning] = useState(false)
  const scrolled = useRef<string | null>(null)
  const serverFields = useRef<Record<string, string>>({})

  // keepEdits: aggiornamento automatico, i dati che stai scrivendo e non hai ancora salvato restano.
  const apply = (next: CreatorView, keepEdits = false) => {
    setC(next)
    const fresh = Object.fromEntries(next.myFields.map((f) => [f.id, f.value || '']))
    setFields((cur) => (keepEdits ? Object.fromEntries(Object.entries(fresh).map(([k, v]) => [k, cur[k] !== undefined && cur[k] !== (serverFields.current[k] ?? '') ? cur[k] : v])) : fresh))
    serverFields.current = fresh
  }

  const load = useCallback(async () => {
    const res = await authFetch(`/api/admin/contracts/${encodeURIComponent(id)}?seen=1`).catch(() => null)
    const data = res ? await res.json().catch(() => null) : null
    if (!res?.ok || !data?.contract) return setError(data?.error || 'Non riesco a caricare il contratto.')
    setError(null)
    apply(data.contract)
  }, [id])

  useEffect(() => {
    if (allowed) load()
  }, [allowed, load])

  // Contratto inviato e non ancora firmato da chi lo riceve: i suoi dati si vedono mentre li scrive.
  const live = Boolean(c && !c.final && c.status !== 'annullato' && !c.signatures.destinatario && c.share?.active)
  useEffect(() => {
    if (!allowed || !live) return
    const timer = setInterval(async () => {
      if (document.visibilityState !== 'visible') return
      const res = await authFetch(`/api/admin/contracts/${encodeURIComponent(id)}`).catch(() => null)
      const data = res?.ok ? await res.json().catch(() => null) : null
      if (data?.contract) apply(data.contract as CreatorView, true)
    }, 15_000)
    return () => clearInterval(timer)
  }, [allowed, live, id])

  // Tocco sulla campanella mentre si e' gia' su questa pagina: con Next la pagina resta
  // montata (cambia solo ?req=), quindi si ricarica qui il contratto.
  useEffect(() => {
    if (!allowed) return
    const onNote = (e: Event) => (e as CustomEvent<string>).detail === id && load()
    window.addEventListener(CONTRACT_NOTE_EVENT, onNote)
    return () => window.removeEventListener(CONTRACT_NOTE_EVENT, onNote)
  }, [allowed, id, load])

  // Dalla campanella: si va alla richiesta indicata (appena e' caricata).
  useEffect(() => {
    if (!c || !focusReq || scrolled.current === focusReq || !c.requests.some((r) => r.id === focusReq)) return
    scrolled.current = focusReq
    setTimeout(() => document.getElementById(`req-${focusReq}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
  }, [c, focusReq])

  const post = async (key: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
    setBusy(key)
    setError(null)
    setNotice(null)
    const res = await authFetch(`/api/admin/contracts/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify(body) }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setBusy(null)
    if (!res?.ok) {
      setError(String(data?.error || 'Operazione non riuscita, riprova.'))
      if (res?.status === 409) load()
      return null
    }
    if (data?.contract) apply(data.contract as CreatorView)
    return data
  }

  const copyLink = async () => {
    setBusy('link')
    const res = await authFetch(`/api/admin/contracts/${encodeURIComponent(id)}?link=1`).catch(() => null)
    const data = res?.ok ? await res.json().catch(() => null) : null
    setBusy(null)
    const value = data?.contract?.link
    if (!value) return setError('Nessun link attivo: condividi di nuovo per crearne uno.')
    setLink(value)
    try {
      await navigator.clipboard.writeText(value)
      setNotice('Link copiato. Il PIN mandalo a parte.')
    } catch {
      setNotice('Copia il link qui sotto.')
    }
  }

  const pdf = async (download: boolean) => {
    if (!c) return
    setBusy(download ? 'dl' : 'pdf')
    const message = await openContractPdf(c.id, pdfFilename(`${c.title}${c.status === 'firmato' ? ' firmato' : ''}`), download)
    setBusy(null)
    if (message) setError(message)
  }

  const preview = async (requestId: string | undefined, text: string, mode: Proposal['mode']) => {
    const data = await post(`preview:${requestId || 'x'}`, { action: 'preview', requestId, text })
    if (data?.proposal) {
      setProposal({ requestId, mode, proposal: data.proposal as StructuredDoc, preview: data.preview as StructuredDoc, missing: (data.missing as string[]) || [] })
      setRewrite(null)
      setTimeout(() => document.getElementById('proposta')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
    }
  }

  const saveVersion = async (doc: StructuredDoc, requestId: string | undefined, mode: Proposal['mode']) => {
    const data = await post('apply', { action: 'apply', doc, requestId, mode })
    if (data) {
      setProposal(null)
      setEditor(null)
      setNotice(`Salvata la versione ${(data.contract as CreatorView).version.n}. Le firme di prima (se c’erano) sono state tolte: chi ha il link vede «contratto aggiornato».`)
    }
  }

  const sign = async (payload: SignPayload): Promise<string | null> => {
    if (!c) return 'Contratto non caricato.'
    const res = await authFetch(`/api/admin/contracts/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ action: 'sign', versionId: c.version.id, ...payload }) }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    if (!res?.ok) {
      if (res?.status === 409) load()
      return String(data?.error || 'Firma non riuscita, riprova.')
    }
    apply(data.contract)
    setSigning(false)
    setNotice(data.completed ? 'Contratto firmato da tutti e due. Le versioni di prima sono state cancellate: resta solo quella firmata.' : 'Hai firmato. Ora manca la firma dell’altra parte.')
    return null
  }

  if (!allowed || (!c && !error)) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[var(--accent-blue)]/30 border-t-[var(--accent-blue)]" />
      </div>
    )
  }

  if (!c) {
    return (
      <div className="mx-auto max-w-3xl px-4 pt-24">
        <p className="text-sm text-[#FF3B30]">{error}</p>
        <Link href="/admin/contratti" className={`${btn} mt-4`}>
          <ArrowLeft className="h-4 w-4" /> Contratti
        </Link>
      </div>
    )
  }

  const open = c.requests.filter((r) => r.status === 'aperta')
  const closed = c.requests.filter((r) => r.status !== 'aperta')
  const editable = c.status !== 'annullato' && !c.final
  const myFields = c.myFields
  // Come sul server: i dati nel testo finche' nessuno firma, la propria parte dei dati "entrambi" fino alla propria firma.
  const signFields = myFields.filter((f) => !f.value?.trim()).map((f) => ({ id: f.id, label: f.label }))
  const emptyBody = myFields.filter((f) => f.kind === 'body' && !f.value?.trim())
  const partyName = (by: string) => (by === 'creatore' ? c.creator.name : by === 'destinatario' ? c.recipient.name : '')

  return (
    <div className="mx-auto max-w-3xl px-4 pb-28 pt-20 md:pb-16 md:pt-24">
      <Link href="/admin/contratti" className="inline-flex items-center gap-1 text-sm text-[var(--text-secondary)]">
        <ArrowLeft className="h-4 w-4" /> Contratti
      </Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="break-words text-xl font-bold text-[var(--text-primary)]">{c.heading}</h1>
          <p className="text-sm text-[var(--text-secondary)]">
            {c.title} · {c.kind} · versione {c.version.n}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_CHIP[c.status] || ''}`}>{c.statusLabel}</span>
      </div>

      <div className="mt-3 space-y-1">
        <p className="flex items-start gap-1.5 text-xs text-[var(--text-secondary)]">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#FF9500]" /> {CREATOR_DISCLAIMER}
        </p>
        <p className="flex items-start gap-1.5 text-xs text-[var(--text-secondary)]">
          <PenLine className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {SIGNATURE_NOTE}
        </p>
      </div>

      {error && <p className="mt-3 rounded-xl border border-[#FF3B30]/40 bg-[#FF3B30]/10 px-3 py-2 text-sm text-[var(--text-primary)]">{error}</p>}
      {notice && <p className="mt-3 rounded-xl border border-[#34C759]/40 bg-[#34C759]/10 px-3 py-2 text-sm text-[var(--text-primary)]">{notice}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => pdf(false)} disabled={busy === 'pdf'} className={primary}>
          {busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />} Apri PDF
        </button>
        <button type="button" onClick={() => pdf(true)} disabled={busy === 'dl'} className={btn}>
          <Download className="h-4 w-4" /> Scarica
        </button>
        {c.status !== 'annullato' && (
          <button type="button" onClick={() => setShare(!share)} className={btn}>
            <Share2 className="h-4 w-4" /> {c.share?.active ? 'Condividi di nuovo' : 'Condividi'}
          </button>
        )}
        {c.share?.active && (
          <>
            <button type="button" onClick={copyLink} disabled={busy === 'link'} className={btn}>
              <Copy className="h-4 w-4" /> Copia link
            </button>
            <button type="button" onClick={() => window.confirm('Revocare il link? Chi lo ha non potrà più aprire il contratto.') && post('revoke', { action: 'revoke' })} className={btn}>
              <Ban className="h-4 w-4" /> Revoca link
            </button>
          </>
        )}
        {editable && (
          <button type="button" onClick={() => setEditor({ doc: structuredClone(c.source) })} className={btn}>
            <Pencil className="h-4 w-4" /> Modifica il testo
          </button>
        )}
      </div>
      {link && <p className="mt-2 break-all rounded-lg bg-[var(--background-secondary)] p-2 text-xs text-[var(--text-secondary)]">{link}</p>}
      {c.share && (
        <p className="mt-2 text-xs text-[var(--text-secondary)]">
          {c.share.active ? `Link attivo dal ${when(c.share.createdAt)} · ${CHANNEL_LABEL[c.share.channel as ShareChannel] || c.share.channel}${c.share.to ? ` · ${c.share.to}` : ''}` : `Link revocato il ${when(c.share.revokedAt || c.share.createdAt)}`}
        </p>
      )}

      {share && c.status !== 'annullato' && (
        <ShareSheet
          c={c}
          onClose={() => setShare(false)}
          onDone={(next, outcome) => {
            apply(next)
            setShare(false)
            setLink(next.link || null)
            setNotice(`Fatto: ${outcome}.`)
          }}
        />
      )}

      {/* Richieste di modifica */}
      {open.length > 0 && (
        <div className="mt-5 space-y-3">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Richieste di modifica da decidere</h2>
          {open.map((r) => (
            <div key={r.id} id={`req-${r.id}`} className={`${card} ${focusReq === r.id ? 'ring-2 ring-[#FF9500]' : ''}`}>
              <p className="text-xs text-[var(--text-secondary)]">
                {c.recipient.name} · {when(r.at)} · versione {r.versionN}
                {r.section ? ` · ${r.section}` : ''}
              </p>
              <p className="mt-1 whitespace-pre-line break-words text-sm text-[var(--text-primary)]">{r.text}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => preview(r.id, r.text, 'accettata')} disabled={Boolean(busy)} className={primary}>
                  {busy === `preview:${r.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Accetta
                </button>
                <button type="button" onClick={() => setRewrite({ requestId: r.id, text: r.text })} disabled={Boolean(busy)} className={btn}>
                  <Pencil className="h-4 w-4" /> Modifica
                </button>
                <button type="button" onClick={() => setReject({ requestId: r.id, note: '' })} disabled={Boolean(busy)} className={btn}>
                  <X className="h-4 w-4" /> Rifiuta
                </button>
              </div>
              {busy === `preview:${r.id}` && <p className="mt-2 text-xs text-[var(--text-secondary)]">L’AI sta applicando la richiesta: ti mostro il risultato prima di salvare…</p>}

              {rewrite?.requestId === r.id && (
                <div className="mt-3 rounded-lg border border-[var(--border-color)] bg-[var(--background)] p-3">
                  <p className="text-xs text-[var(--text-secondary)]">Riscrivi la modifica come la vuoi tu (l’AI la applica e ti mostra il risultato), oppure cambia il testo a mano.</p>
                  <textarea value={rewrite.text} onChange={(e) => setRewrite({ ...rewrite, text: e.target.value.slice(0, 2000) })} rows={3} className={`${input} mt-2`} />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" onClick={() => preview(r.id, rewrite.text, 'modificata')} disabled={Boolean(busy) || rewrite.text.trim().length < 3} className={primary}>
                      <Sparkles className="h-4 w-4" /> Anteprima con l’AI
                    </button>
                    <button type="button" onClick={() => { setEditor({ requestId: r.id, doc: structuredClone(c.source) }); setRewrite(null) }} className={btn}>
                      <Pencil className="h-4 w-4" /> Modifica il testo a mano
                    </button>
                    <button type="button" onClick={() => setRewrite(null)} className={btn}>
                      Annulla
                    </button>
                  </div>
                </div>
              )}

              {reject?.requestId === r.id && (
                <div className="mt-3 rounded-lg border border-[var(--border-color)] bg-[var(--background)] p-3">
                  <p className="text-xs text-[var(--text-secondary)]">Il testo resta com’è. Se vuoi, scrivi una nota: la vede chi ha chiesto la modifica.</p>
                  <textarea value={reject.note} onChange={(e) => setReject({ ...reject, note: e.target.value.slice(0, 500) })} rows={2} className={`${input} mt-2`} placeholder="Nota (facoltativa)" />
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        if (await post(`reject:${r.id}`, { action: 'reject', requestId: r.id, note: reject.note })) {
                          setReject(null)
                          setNotice('Richiesta rifiutata: il testo resta com’è.')
                        }
                      }}
                      disabled={Boolean(busy)}
                      className={primary}
                    >
                      Conferma rifiuto
                    </button>
                    <button type="button" onClick={() => setReject(null)} className={btn}>
                      Annulla
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {proposal && (
        <div id="proposta" className={`${card} mt-5 scroll-mt-24`}>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Anteprima della nuova versione</h2>
          <p className="text-xs text-[var(--text-secondary)]">Non è ancora salvata. Salvando, le firme già date si cancellano e chi ha il link vede «contratto aggiornato».</p>
          {proposal.missing.length > 0 && <p className="mt-1 text-xs text-[var(--text-secondary)]">Spazi vuoti: {proposal.missing.join('; ')}</p>}
          <div className="mt-3 max-h-[60vh] overflow-y-auto rounded-xl bg-white p-4">
            <ContractView doc={proposal.preview} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => saveVersion(proposal.proposal, proposal.requestId, proposal.mode)} disabled={busy === 'apply'} className={primary}>
              {busy === 'apply' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Salva come nuova versione
            </button>
            <button type="button" onClick={() => setEditor({ requestId: proposal.requestId, doc: structuredClone(proposal.proposal) })} className={btn}>
              <Pencil className="h-4 w-4" /> Ritocca a mano
            </button>
            <button type="button" onClick={() => setProposal(null)} className={btn}>
              Scarta
            </button>
          </div>
        </div>
      )}

      {editor && (
        <div className={`${card} mt-5`}>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Modifica il testo{editor.requestId ? ' (per la richiesta)' : ''}</h2>
          <div className="mt-3">
            <DocEditor editor={editor} onChange={(doc) => setEditor({ ...editor, doc })} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => saveVersion(editor.doc, editor.requestId, 'modificata')} disabled={busy === 'apply'} className={primary}>
              {busy === 'apply' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Salva come nuova versione
            </button>
            <button type="button" onClick={() => setEditor(null)} className={btn}>
              Annulla
            </button>
          </div>
        </div>
      )}

      {/* Firme */}
      <div className={`${card} mt-5`}>
        <h2 className="text-base font-semibold text-[var(--text-primary)]">Firme</h2>
        <ul className="mt-2 space-y-1 text-sm text-[var(--text-primary)]">
          <li>
            {c.creator.name}: {c.signatures.creatore ? `firmato da ${c.signatures.creatore.name} il ${when(c.signatures.creatore.at)}` : 'non ancora firmato'}
          </li>
          <li>
            {c.recipient.name}: {c.signatures.destinatario ? `firmato da ${c.signatures.destinatario.name} il ${when(c.signatures.destinatario.at)} (${c.signatures.destinatario.device})` : 'non ancora firmato'}
          </li>
        </ul>
        {c.final && <p className="mt-2 break-all text-xs text-[var(--text-secondary)]">Impronta del contratto firmato (SHA-256): {c.final.contentHash}</p>}
        {editable && !c.signatures.creatore && (
          <div className="mt-3">
            {signing ? (
              <div className="rounded-xl bg-white p-4 text-[#1d1d1f]">
                <p className="mb-3 text-xs text-[#6b6b73]">Firmi la versione {c.version.n} che vedi qui sotto.</p>
                <SignForm statements={c.statements} fields={signFields} defaultName={c.creator.person} onSubmit={sign} submitLabel={`Firmo per ${c.creator.name}`} />
                <button type="button" onClick={() => setSigning(false)} className="mt-3 w-full text-center text-sm text-[#1a2a73]">
                  Chiudi
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => setSigning(true)} className={primary}>
                <PenLine className="h-4 w-4" /> Firma per {c.creator.name}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Dati di Facevoice AI: nel testo finche' nessuno firma, la propria parte dei dati "entrambi" fino alla propria firma */}
      {myFields.length > 0 && c.canEditOwn && (
        <div className={`${card} mt-5`}>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">I dati di {c.creator.name}</h2>
          <p className="text-xs text-[var(--text-secondary)]">Vuoti restano una linea da compilare a mano.</p>
          {emptyBody.length > 0 && !c.signatures.destinatario && <p className="mt-1 text-xs text-[#FF9500]">Compilali prima di inviare: dopo la prima firma i dati nel testo non si cambiano più.</p>}
          <div className="mt-2 space-y-2">
            {myFields.map((f) => (
              <label key={f.id} className="block text-sm text-[var(--text-secondary)]">
                {f.label}
                {f.required ? ' *' : ''}
                {f.party === 'entrambi' ? ` (il tuo: ${c.recipientLabel} scrive il suo)` : ''}
                <input value={fields[f.id] || ''} onChange={(e) => setFields({ ...fields, [f.id]: e.target.value.slice(0, 300) })} className={`${input} mt-1`} />
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={() => post('fields', { action: 'fields', values: Object.fromEntries(myFields.map((f) => [f.id, fields[f.id] || ''])) }).then((d) => d && setNotice('Dati salvati.'))}
            disabled={busy === 'fields'}
            className={`${primary} mt-3`}
          >
            Salva i dati
          </button>
        </div>
      )}

      {/* Dati della controparte (li scrive nella pagina del link; si aggiornano da soli) */}
      {c.recipientData.length > 0 && (
        <div className={`${card} mt-5`}>
          <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--text-primary)]">
            <UserRound className="h-4 w-4" /> I dati di {c.recipientLabel}
          </h2>
          {c.recipientWaiting ? (
            <p className="mt-1 text-sm text-[var(--text-secondary)]">In attesa dei dati di {c.recipientLabel}: li scrive nella pagina del link, prima di firmare.</p>
          ) : (
            <dl className="mt-2 space-y-1.5 text-sm">
              {c.recipientData.map((d) => (
                <div key={d.id} className="min-w-0">
                  <dt className="text-xs text-[var(--text-secondary)]">
                    {d.label}
                    {d.shared ? ' (il suo)' : ''}
                  </dt>
                  <dd className="break-words text-[var(--text-primary)]">
                    {d.value.trim() ? d.value : <span className="text-[var(--text-secondary)]">{d.required && !c.signatures.destinatario ? `In attesa dei dati di ${c.recipientLabel}` : '—'}</span>}
                    {d.role === 'cf' && d.value.trim() && taxCodeLooksWrong(d.value) && <span className="ml-1 text-xs text-[#FF9500]">· da controllare</span>}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {!c.signatures.destinatario && !c.final && <p className="mt-2 text-[11px] text-[var(--text-secondary)]">Li può cambiare fino a quando firma: non cambiano il testo che hai firmato.</p>}
        </div>
      )}

      {/* Chi lo riceve */}
      <div className={`${card} mt-5`}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Chi lo riceve</h2>
          {editable && !recipient && (
            <button type="button" onClick={() => setRecipient({ name: c.recipient.name, email: c.recipient.email || '' })} className="text-sm text-[var(--accent-blue)]">
              Cambia
            </button>
          )}
        </div>
        {recipient ? (
          <div className="mt-2 space-y-2">
            <input value={recipient.name} onChange={(e) => setRecipient({ ...recipient, name: e.target.value.slice(0, 120) })} className={input} aria-label="Nome" />
            <input type="email" value={recipient.email} onChange={(e) => setRecipient({ ...recipient, email: e.target.value })} className={input} placeholder="Email (facoltativa)" aria-label="Email" />
            <div className="flex gap-2">
              <button type="button" onClick={() => post('recipient', { action: 'recipient', name: recipient.name, email: recipient.email }).then((d) => d && setRecipient(null))} className={primary}>
                Salva
              </button>
              <button type="button" onClick={() => setRecipient(null)} className={btn}>
                Annulla
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {c.recipient.name}
            {c.recipient.email ? ` · ${c.recipient.email}` : ''}
            {c.recipient.platform ? ` · conversazione su ${c.recipient.platform}` : ''}
          </p>
        )}
      </div>

      {/* Anteprima del contratto */}
      <div className="mt-5 rounded-2xl bg-white p-4 shadow-sm sm:p-8">
        <ContractView doc={c.doc} highlightSection={open.find((r) => r.id === focusReq)?.section || null} />
      </div>

      {closed.length > 0 && (
        <div className={`${card} mt-5`}>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Richieste già decise</h2>
          <ul className="mt-2 space-y-2">
            {closed.map((r) => (
              <li key={r.id} id={`req-${r.id}`} className="text-sm">
                <p className="text-xs text-[var(--text-secondary)]">
                  {when(r.at)} · {REQUEST_LABEL[r.status] || r.status}
                  {r.section ? ` · ${r.section}` : ''}
                </p>
                <p className="whitespace-pre-line break-words text-[var(--text-primary)]">{r.text}</p>
                {r.note && <p className="text-xs text-[var(--text-secondary)]">Nota: {r.note}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={`${card} mt-5`}>
        <h2 className="flex items-center gap-2 text-base font-semibold text-[var(--text-primary)]">
          <History className="h-4 w-4" /> Cronologia
        </h2>
        {c.previous.length > 0 && <p className="mt-1 text-xs text-[var(--text-secondary)]">Versioni di prima salvate: {c.previous.map((v) => v.n).join(', ')} (si cancellano quando firmate tutti e due).</p>}
        {c.final && (
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            Firmato da tutti e due il {when(c.final.at)}: cancellate {c.final.versionsDeleted} versioni di prima e {c.final.requestsDeleted} richieste di modifica.
          </p>
        )}
        <ol className="mt-2 space-y-1.5">
          {c.events.map((e, i) => (
            <li key={i} className="flex gap-2 text-sm">
              <span className="shrink-0 text-xs leading-5 text-[var(--text-secondary)]">{when(e.at)}</span>
              <span className="min-w-0 break-words text-[var(--text-primary)]">
                {EVENT_LABEL[e.kind] || e.kind}
                {partyName(e.by) ? ` · ${partyName(e.by)}` : ''}
                {e.detail ? ` · ${e.detail}` : ''}
              </span>
            </li>
          ))}
        </ol>
      </div>

      {editable && (
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={() => window.confirm('Annullare il contratto? Il link smette di funzionare.') && post('cancel', { action: 'cancel' })} className={`${btn} border-[#FF3B30]/40 text-[#FF3B30]`}>
            <Ban className="h-4 w-4" /> Annulla il contratto
          </button>
        </div>
      )}
      {(c.status === 'bozza' || c.status === 'annullato') && !c.signatures.creatore && !c.signatures.destinatario && (
        <button
          type="button"
          onClick={async () => {
            if (!window.confirm('Cancellare questo contratto? Non si può annullare.')) return
            const res = await authFetch(`/api/admin/contracts/${encodeURIComponent(c.id)}`, { method: 'DELETE' }).catch(() => null)
            if (res?.ok) window.location.href = '/admin/contratti'
            else setError('Non riesco a cancellare.')
          }}
          className={`${btn} mt-2 border-[#FF3B30]/40 text-[#FF3B30]`}
        >
          <Trash2 className="h-4 w-4" /> Elimina la bozza
        </button>
      )}
    </div>
  )
}
