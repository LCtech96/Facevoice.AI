'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ExternalLink, FileText, Loader2, Megaphone, RefreshCw, Upload } from 'lucide-react'
import { uploadToSignedUrl } from '@/lib/client-image'
import { createClient } from '@/lib/supabase-client'
import { getAccessToken } from '@/lib/session-token'
import { isAdminEmail } from '@/lib/admin-auth'
import {
  CAMPAIGN_STATUS_LABEL,
  CONSENT_LABEL,
  RECIPIENT_STATUS_LABEL,
  SKIP_LABEL,
  formatEur,
  hasMarketingConsent,
  renderPreview,
  contactLanguage,
  languageBase,
  visibleTags,
  LANGUAGE_LABEL,
  type VariableMapping,
  type WaContact,
  type WaSettings,
  type WaTemplate,
} from '@/lib/wa-shared'
import { WA_MEDIA_LIMITS, mediaKindOfHeader, mediaLinkProblem, validateWaMedia, type WaMediaKind } from '@/lib/wa-media-shared'
import type { CostOverview, TemplatesState } from '@/lib/wa-store'
import type { CampaignWithCounts } from '@/lib/wa-campaigns'

// Pagina "Campagne WhatsApp" (solo admin). Cinque schede: campagne, contattabili,
// modelli, costi, impostazioni. Tutto passa da /api/admin/whatsapp.

type Data = {
  ready: boolean
  setupMessage?: string
  settings: WaSettings
  templates: TemplatesState
  number: string
  managerUrl: string
  pricesNote: string
  tokenConfigured: boolean
  contacts?: WaContact[]
  campaigns?: CampaignWithCounts[]
  costs?: CostOverview
}

type Tab = 'campagne' | 'contatti' | 'modelli' | 'costi' | 'impostazioni'
const TABS: { id: Tab; label: string }[] = [
  { id: 'campagne', label: 'Campagne' },
  { id: 'contatti', label: 'Contattabili' },
  { id: 'modelli', label: 'Modelli' },
  { id: 'costi', label: 'Costi WhatsApp' },
  { id: 'impostazioni', label: 'Impostazioni' },
]

const API = '/api/admin/whatsapp'
const romeDateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

async function call(action: string, payload: Record<string, unknown> = {}) {
  const token = await getAccessToken()
  if (!token) throw new Error('Sessione scaduta: accedi di nuovo.')
  const res = await fetch(API, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...payload }) })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(json?.error || 'Operazione non riuscita.')
  return json
}

/** Ora italiana tra n minuti, per <input type="datetime-local">. */
function romeLocalIn(minutes: number) {
  const d = new Date(Date.now() + minutes * 60_000)
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d)
  const g = (t: string) => p.find((x) => x.type === t)?.value
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`
}

const input = 'w-full rounded-xl border border-[var(--border-color)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--text-primary)]'
const btn = 'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium disabled:opacity-50'
const btnPrimary = `${btn} bg-[var(--accent-blue)] text-white`
const btnGhost = `${btn} border border-[var(--border-color)] text-[var(--text-primary)]`

function Card({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-[var(--border-color)] bg-[var(--card-background)] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-[var(--text-primary)]">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  )
}

export default function WhatsAppClient() {
  const router = useRouter()
  const [allowed, setAllowed] = useState(false)
  const [data, setData] = useState<Data | null>(null)
  const [tab, setTab] = useState<Tab>('campagne')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let alive = true
    createClient()
      .auth.getUser()
      .then(({ data: { user } }) => {
        if (!alive) return
        if (!user) router.replace('/auth')
        else if (!isAdminEmail(user.email)) router.replace('/home')
        else setAllowed(true)
      })
    return () => {
      alive = false
    }
  }, [router])

  const load = useCallback(async (real = false) => {
    setLoading(true)
    setError('')
    try {
      const token = await getAccessToken()
      if (!token) throw new Error('Sessione scaduta: accedi di nuovo.')
      const res = await fetch(`${API}${real ? '?real=1' : ''}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || 'Impossibile caricare.')
      setData(json)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossibile caricare.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (allowed) load()
  }, [allowed, load])

  /** Esegue un'azione, mostra l'esito e ricarica. */
  const run = useCallback(
    async (action: string, payload: Record<string, unknown>, ok?: (res: any) => string) => {
      setError('')
      setNotice('')
      try {
        const res = await call(action, payload)
        if (ok) setNotice(ok(res))
        await load()
        return res
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Operazione non riuscita.')
        return null
      }
    },
    [load]
  )

  if (!allowed) return null

  return (
    <div className="mx-auto max-w-6xl px-4 pt-20 md:pt-24 pb-28 md:pb-16">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-[var(--text-primary)]">
            <Megaphone className="h-6 w-6" /> Campagne WhatsApp
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Numero {data?.number || '…'} · solo a chi ha dato il consenso · chi scrive STOP non riceve più niente
          </p>
        </div>
        <button className={btnGhost} onClick={() => load()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Aggiorna
        </button>
      </div>

      {data && !data.ready && (
        <div className="mb-4 flex gap-2 rounded-2xl border border-[#FF9500]/40 bg-[#FF9500]/10 p-4 text-sm text-[var(--text-primary)]">
          <AlertTriangle className="h-5 w-5 shrink-0 text-[#FF9500]" />
          <div>
            <p className="font-semibold">Esegui prima lo SQL delle campagne WhatsApp</p>
            <p>File: supabase/migrations/2026-11-08_wa_campaigns.sql (editor SQL di Supabase). Intanto puoi leggere i modelli e cambiare le impostazioni.</p>
          </div>
        </div>
      )}
      {data && !data.tokenConfigured && <p className="mb-4 rounded-xl bg-[#FF3B30]/10 px-3 py-2 text-sm">Manca il token WhatsApp (WHATSAPP_ACCESS_TOKEN): niente può partire.</p>}
      {error && <p className="mb-3 rounded-xl bg-[#FF3B30]/10 px-3 py-2 text-sm text-[var(--text-primary)]">{error}</p>}
      {notice && <p className="mb-3 rounded-xl bg-[#34C759]/10 px-3 py-2 text-sm text-[var(--text-primary)]">{notice}</p>}

      <div className="mb-4 flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`shrink-0 rounded-xl px-3 py-2 text-sm font-medium ${tab === t.id ? 'bg-[var(--accent-blue)] text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--card-background)]'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!data ? (
        <p className="text-sm text-[var(--text-secondary)]">{loading ? 'Carico…' : ''}</p>
      ) : tab === 'campagne' ? (
        <CampaignsTab data={data} run={run} />
      ) : tab === 'contatti' ? (
        <ContactsTab data={data} run={run} />
      ) : tab === 'modelli' ? (
        <TemplatesTab data={data} run={run} />
      ) : tab === 'costi' ? (
        <CostsTab data={data} reload={() => load(true)} loading={loading} />
      ) : (
        <SettingsTab data={data} run={run} />
      )}
    </div>
  )
}

type Run = (action: string, payload: Record<string, unknown>, ok?: (res: any) => string) => Promise<any>

// ---------------------------------------------------------------------
// Campagne
// ---------------------------------------------------------------------

const ACCEPT: Record<WaMediaKind, string> = { image: 'image/jpeg,image/png,.jpg,.jpeg,.png', video: 'video/mp4,.mp4', document: 'application/pdf,.pdf' }

/** Anteprima del file dell'intestazione (immagine, video o PDF). */
function MediaPreview({ kind, url, small }: { kind: WaMediaKind; url: string; small?: boolean }) {
  if (!url) return <div className={`flex items-center justify-center bg-black/10 text-xs text-black/60 ${small ? 'h-14' : 'h-40'}`}>{WA_MEDIA_LIMITS[kind].label} da scegliere</div>
  if (kind === 'image') return <img src={url} alt="" className={`w-full object-cover ${small ? 'h-14' : 'max-h-64'}`} />
  if (kind === 'video') return <video src={url} controls={!small} muted playsInline preload="metadata" className={`w-full bg-black ${small ? 'h-14 object-cover' : 'max-h-64'}`} />
  return (
    <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-2 bg-white/60 p-3 text-xs text-black underline">
      <FileText className="h-5 w-5 shrink-0" /> {decodeURIComponent(url.split('/').pop() || 'documento.pdf')}
    </a>
  )
}

type MediaItem = { name: string; url: string; kind: WaMediaKind; size: number | null; createdAt: string | null }

/**
 * File dell'intestazione: caricamento diretto nello spazio (indirizzo firmato) oppure
 * uno gia' caricato. Tipo e peso controllati prima secondo i limiti di WhatsApp.
 */
function MediaPicker({ kind, value, onChange }: { kind: WaMediaKind; value: string; onChange: (url: string) => void }) {
  const [items, setItems] = useState<MediaItem[]>([])
  const [progress, setProgress] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const [manual, setManual] = useState(false)
  const limits = WA_MEDIA_LIMITS[kind]

  const refresh = useCallback(() => {
    call('media_list')
      .then((r) => setItems(((r?.media || []) as MediaItem[]).filter((m) => m.kind === kind)))
      .catch(() => setItems([]))
  }, [kind])
  useEffect(refresh, [refresh])

  const upload = async (file: File | undefined) => {
    if (!file) return
    setErr('')
    const check = validateWaMedia({ fileName: file.name, type: file.type, size: file.size }, [kind])
    if (!check.ok) return setErr(check.error)
    setProgress(0)
    try {
      const ticket = await call('media_upload', { kind, fileName: file.name, type: check.contentType, size: file.size })
      await uploadToSignedUrl(ticket.signedUrl, new Blob([file], { type: ticket.contentType }), file.name, setProgress)
      onChange(ticket.publicUrl)
      refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Caricamento non riuscito.')
    } finally {
      setProgress(null)
    }
  }

  return (
    <div className="grid gap-2 rounded-xl border border-[var(--border-color)] p-3 text-sm">
      <p className="font-medium text-[var(--text-primary)]">
        File dell&apos;intestazione: {limits.label} <span className="font-normal text-[var(--text-secondary)]">({limits.hint})</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className={`${btnGhost} cursor-pointer`}>
          {progress !== null ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {progress !== null ? `Carico… ${progress}%` : `Carica ${limits.label}`}
          <input type="file" accept={ACCEPT[kind]} className="hidden" disabled={progress !== null} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = '' }} />
        </label>
        {items.length > 0 && (
          <select className={`${input} w-auto max-w-full flex-1`} value={items.some((m) => m.url === value) ? value : ''} onChange={(e) => e.target.value && onChange(e.target.value)}>
            <option value="">…oppure scegli uno già caricato</option>
            {items.map((m) => (
              <option key={m.url} value={m.url}>
                {m.name.replace(/^\d{14}-[a-f0-9]{8}-/, '')}
                {m.size ? ` · ${Math.round((m.size / 1024 / 1024) * 10) / 10} MB` : ''}
              </option>
            ))}
          </select>
        )}
        <button type="button" className="text-xs text-[var(--accent-blue)] underline" onClick={() => setManual((v) => !v)}>
          {manual ? 'Nascondi link' : 'Ho già un link'}
        </button>
      </div>
      {manual && <input className={input} placeholder="https://… (link pubblico, raggiungibile da Meta)" value={value} onChange={(e) => onChange(e.target.value.trim())} />}
      {value && <p className="truncate text-xs text-[var(--text-secondary)]">Scelto: {decodeURIComponent(value.split('/').pop() || value)}</p>}
      {err && <p className="text-xs text-[#FF3B30]">{err}</p>}
    </div>
  )
}

/** Come creare su WhatsApp Manager un modello con immagine o video in alto. */
function MediaTemplateHelp({ managerUrl }: { managerUrl: string }) {
  return (
    <details className="rounded-2xl border border-[var(--border-color)] bg-[var(--card-background)] p-4 text-sm text-[var(--text-primary)]">
      <summary className="cursor-pointer font-semibold">Come creare un modello con immagine o video</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-[var(--text-secondary)]">
        <li>
          Apri{' '}
          <a className="text-[var(--accent-blue)]" href={managerUrl} target="_blank" rel="noreferrer">
            WhatsApp Manager → Modelli di messaggio
          </a>{' '}
          e premi «Crea modello» (categoria Marketing per le promozioni).
        </li>
        <li>In «Intestazione» scegli «Contenuti multimediali», poi «Immagine» o «Video» (o «Documento» per un PDF).</li>
        <li>Carica un esempio: serve solo a Meta per approvare il modello. Il file vero lo scegli qui in ogni campagna.</li>
        <li>Scrivi il testo (puoi usare {'{{1}}'} per il nome), aggiungi il piè di pagina «Scrivi STOP per non ricevere più messaggi» e invia in revisione.</li>
        <li>Per i clienti stranieri aggiungi allo stesso modello la lingua «Inglese (US)» con il testo tradotto: ognuno riceverà la sua lingua.</li>
        <li>Quando è approvato, qui premi «Aggiorna modelli da Meta» nella scheda Modelli.</li>
      </ol>
      <p className="mt-2 text-xs text-[var(--text-secondary)]">
        Limiti di WhatsApp: immagine {WA_MEDIA_LIMITS.image.hint}; video {WA_MEDIA_LIMITS.video.hint}; documento {WA_MEDIA_LIMITS.document.hint}.
      </p>
    </details>
  )
}

function CampaignsTab({ data, run }: { data: Data; run: Run }) {
  const usable = data.templates.items.filter((t) => t.status === 'APPROVED' && !t.unsupported && (t.category === 'MARKETING' || t.category === 'UTILITY'))
  // Un modello puo' avere piu' lingue su Meta (es. it e en_US): si sceglie il nome, poi la lingua predefinita.
  const names = [...new Set(usable.map((t) => t.name))]
  const [key, setKey] = useState('')
  const [lang, setLang] = useState('')
  const langs = usable.filter((t) => t.name === key)
  const template = langs.find((t) => t.language === lang) || null
  const [vars, setVars] = useState<Record<string, VariableMapping>>({})
  const [name, setName] = useState('')
  const [sector, setSector] = useState('')
  const [tags, setTags] = useState('')
  const [when, setWhen] = useState(romeLocalIn(15))
  const [ack, setAck] = useState(false)
  const [preview, setPreview] = useState<{ eligible: number; matched: number; skipped: Record<string, number>; languages?: Record<string, number>; excludedLanguages?: { language: string; reason: string }[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [recipients, setRecipients] = useState<any[]>([])

  useEffect(() => {
    // Lingua predefinita: italiano se c'e', altrimenti la prima approvata.
    const versions = usable.filter((t) => t.name === key)
    setLang((versions.find((t) => languageBase(t.language) === 'it') || versions[0])?.language || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  useEffect(() => {
    const next: Record<string, VariableMapping> = {}
    for (const v of template?.variables || []) next[v.key] = v.key === 'header:media' ? { type: 'fisso', value: vars['header:media']?.value || '' } : v.name === '1' ? { type: 'nome', value: 'ciao' } : { type: 'fisso', value: '' }
    setVars(next)
    setPreview(null)
    setAck(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, lang])
  const mediaKind = mediaKindOfHeader(template?.headerFormat)
  const mediaProblem = template ? mediaLinkProblem(template.headerFormat, vars['header:media']?.value) : null

  const audience = { sector: sector.trim() || undefined, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) }
  const costByCampaign = new Map((data.costs?.campaigns || []).map((c) => [c.id, c]))

  const calc = async () => {
    if (!template) return
    setBusy(true)
    const res = await run('preview_audience', { templateName: template.name, templateLanguage: template.language, audience, variables: vars })
    if (res) setPreview(res)
    setBusy(false)
  }
  const create = async () => {
    if (!template) return
    if (mediaProblem) return window.alert(mediaProblem.charAt(0).toUpperCase() + mediaProblem.slice(1) + '.')
    if (!window.confirm(`Creare la campagna con il modello «${template.name}»? Parte da sola all'ora scelta.`)) return
    setBusy(true)
    const res = await run(
      'create_campaign',
      { name, templateName: template.name, templateLanguage: template.language, variables: vars, audience, scheduledAt: when, nonPromotionalAck: ack },
      (r) => `Campagna creata: ${r.campaign.total} destinatari.`
    )
    if (res) {
      setKey('')
      setName('')
      setPreview(null)
    }
    setBusy(false)
  }
  const showRecipients = async (id: string) => {
    if (open === id) return setOpen(null)
    setOpen(id)
    setRecipients([])
    const res = await call('campaign_recipients', { id }).catch(() => null)
    setRecipients(res?.recipients || [])
  }

  return (
    <div className="grid gap-4">
      <Card title="Nuova campagna">
        {!data.ready ? (
          <p className="text-sm text-[var(--text-secondary)]">Disponibile dopo lo SQL delle campagne.</p>
        ) : !usable.length ? (
          <p className="text-sm text-[var(--text-secondary)]">
            Nessun modello approvato. Apri la scheda Modelli e premi «Aggiorna modelli da Meta», oppure creane uno su{' '}
            <a className="text-[var(--accent-blue)]" href={data.managerUrl} target="_blank" rel="noreferrer">
              WhatsApp Manager
            </a>
            .
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-3">
              <label className="text-sm">
                Modello approvato
                <select className={input} value={key} onChange={(e) => setKey(e.target.value)}>
                  <option value="">Scegli…</option>
                  {names.map((n) => {
                    const t = usable.find((x) => x.name === n)!
                    const ls = usable.filter((x) => x.name === n).map((x) => x.language)
                    return (
                      <option key={n} value={n}>
                        {n} ({ls.join(', ')}) · {t.category === 'MARKETING' ? 'promozionale' : 'servizio'}
                        {mediaKindOfHeader(t.headerFormat) ? ` · con ${WA_MEDIA_LIMITS[mediaKindOfHeader(t.headerFormat)!].label}` : ''}
                      </option>
                    )
                  })}
                </select>
              </label>
              {langs.length > 0 && (
                <div className="text-sm">
                  <label>
                    Lingua predefinita
                    <select className={input} value={lang} onChange={(e) => setLang(e.target.value)}>
                      {langs.map((t) => (
                        <option key={t.language} value={t.language}>
                          {t.language}
                          {LANGUAGE_LABEL[languageBase(t.language)] ? ` · ${LANGUAGE_LABEL[languageBase(t.language)]}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    {langs.length > 1
                      ? `Lingue approvate: ${langs.map((t) => t.language).join(', ')}. Ogni contatto riceve la versione nella sua lingua (riconosciuta dai suoi messaggi o scelta in Contattabili); chi non ha una lingua o ha una lingua che il modello non ha riceve quella predefinita. I testi fissi delle variabili valgono per tutte le lingue.`
                      : 'Il modello ha una sola lingua approvata: la ricevono tutti. Per mandarlo anche in inglese, aggiungi la lingua allo stesso modello su WhatsApp Manager e poi «Aggiorna modelli da Meta».'}
                  </p>
                </div>
              )}
              {template && (
                <>
                  {mediaKind && <MediaPicker kind={mediaKind} value={vars['header:media']?.value || ''} onChange={(url) => setVars({ ...vars, 'header:media': { type: 'fisso', value: url } })} />}
                  {template.variables.filter((v) => v.key !== 'header:media').map((v) => (
                    <div key={v.key} className="grid grid-cols-[110px_1fr] items-center gap-2 text-sm">
                      <span className="text-[var(--text-secondary)]">{v.key === 'header:media' ? 'File intestazione' : `{{${v.name}}}${v.where === 'header' ? ' titolo' : ''}`}</span>
                      <div className="flex gap-2">
                        {v.key !== 'header:media' && (
                          <select className={`${input} w-36`} value={vars[v.key]?.type || 'fisso'} onChange={(e) => setVars({ ...vars, [v.key]: { type: e.target.value as 'nome' | 'fisso', value: vars[v.key]?.value || '' } })}>
                            <option value="nome">Nome contatto</option>
                            <option value="fisso">Testo fisso</option>
                          </select>
                        )}
                        <input
                          className={input}
                          placeholder={v.key === 'header:media' ? 'https://… (link pubblico)' : vars[v.key]?.type === 'nome' ? 'se manca il nome (es. ciao)' : 'testo'}
                          value={vars[v.key]?.value || ''}
                          onChange={(e) => setVars({ ...vars, [v.key]: { type: vars[v.key]?.type || 'fisso', value: e.target.value } })}
                        />
                      </div>
                    </div>
                  ))}
                  <label className="text-sm">
                    Settore (facoltativo)
                    <input className={input} value={sector} onChange={(e) => setSector(e.target.value)} placeholder="es. ristorazione" />
                  </label>
                  <label className="text-sm">
                    Tag (facoltativi, separati da virgola)
                    <input className={input} value={tags} onChange={(e) => setTags(e.target.value)} placeholder="es. catania, clienti" />
                  </label>
                  <label className="text-sm">
                    Quando (ora italiana)
                    <input type="datetime-local" className={input} value={when} onChange={(e) => setWhen(e.target.value)} />
                  </label>
                  <label className="text-sm">
                    Nome della campagna (facoltativo)
                    <input className={input} value={name} onChange={(e) => setName(e.target.value)} />
                  </label>
                  {template.category === 'UTILITY' && (
                    <label className="flex items-start gap-2 text-sm">
                      <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1" />
                      Confermo che questo messaggio non è promozionale (avvisi, aggiornamenti su un servizio già richiesto).
                    </label>
                  )}
                </>
              )}
            </div>
            {template && (
              <div className="grid content-start gap-3">
                <div className="overflow-hidden rounded-2xl bg-[#DCF8C6] text-sm text-black">
                  {mediaKind && <MediaPreview kind={mediaKind} url={mediaProblem ? '' : vars['header:media']?.value || ''} />}
                  <div className="whitespace-pre-wrap p-3">{renderPreview(template, vars, { name: 'Mario Rossi' })}</div>
                </div>
                <p className="text-xs text-[var(--text-secondary)]">
                  {template.category === 'MARKETING'
                    ? 'Promozionale: solo contatti attivi con consenso esplicito (non basta che ci abbiano scritto).'
                    : 'Di servizio: solo contatti attivi che ci hanno scritto o hanno dato il consenso.'}{' '}
                  Parte a lotti dal limite giornaliero di {data.settings.dailyCap} messaggi.
                </p>
                {preview && (
                  <div className="rounded-xl bg-[var(--background)] p-3 text-sm">
                    <p className="font-semibold">{preview.eligible} la riceveranno</p>
                    {Object.entries(preview.skipped).map(([k, n]) => (
                      <p key={k} className="text-[var(--text-secondary)]">
                        {n} esclusi: {SKIP_LABEL[k] || k}
                      </p>
                    ))}
                    {preview.languages && Object.keys(preview.languages).length > 0 && (
                      <p className="text-[var(--text-secondary)]">
                        Per lingua: {Object.entries(preview.languages).map(([l, n]) => `${l} ${n}`).join(' · ')}
                      </p>
                    )}
                    {preview.excludedLanguages?.map((x) => (
                      <p key={x.language} className="text-[#FF9500]">
                        Versione {x.language} non usata: {x.reason}
                      </p>
                    ))}
                    {template.category === 'MARKETING' && <p className="text-[var(--text-secondary)]">Costo stimato se tutti consegnati: {formatEur(preview.eligible * data.settings.prices.marketing)}</p>}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <button className={btnGhost} onClick={calc} disabled={busy}>
                    Calcola destinatari
                  </button>
                  <button className={btnPrimary} onClick={create} disabled={busy || (template.category === 'UTILITY' && !ack) || Boolean(mediaProblem)}>
                    {busy && <Loader2 className="h-4 w-4 animate-spin" />} Crea campagna
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      <MediaTemplateHelp managerUrl={data.managerUrl} />

      <Card title="Campagne">
        {!data.campaigns?.length ? (
          <p className="text-sm text-[var(--text-secondary)]">Nessuna campagna.</p>
        ) : (
          <div className="grid gap-3">
            {data.campaigns.map((c) => {
              const sent = (c.counts.sent || 0) + (c.counts.delivered || 0) + (c.counts.read || 0)
              const cost = costByCampaign.get(c.id)
              return (
                <div key={c.id} className="rounded-xl border border-[var(--border-color)] p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-[var(--text-primary)]">{c.name}</p>
                      <p className="text-[var(--text-secondary)]">
                        {CAMPAIGN_STATUS_LABEL[c.status]}
                        {c.paused_reason === 'budget' ? ' (budget mensile raggiunto)' : ''} · {c.template_name} ({[c.template_language, ...(c.template_snapshot?.versions || []).map((v) => v.language)].join(', ')}) · {romeDateTime(c.scheduled_at)}
                      </p>
                    </div>
                    {mediaKindOfHeader(c.template_snapshot?.headerFormat) && c.variables?.['header:media']?.value && (
                      <div className="w-24 overflow-hidden rounded-lg border border-[var(--border-color)]">
                        <MediaPreview kind={mediaKindOfHeader(c.template_snapshot.headerFormat)!} url={c.variables['header:media'].value} small />
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {(c.status === 'scheduled' || c.status === 'sending') && (
                        <button className={btnGhost} onClick={() => run('campaign_action', { id: c.id, op: 'pause' }, () => 'Campagna in pausa.')}>
                          Pausa
                        </button>
                      )}
                      {c.status === 'paused' && (
                        <button className={btnGhost} onClick={() => run('campaign_action', { id: c.id, op: 'resume' }, () => 'Campagna ripresa.')}>
                          Riprendi
                        </button>
                      )}
                      {['scheduled', 'sending', 'paused'].includes(c.status) && (
                        <button
                          className={btnGhost}
                          onClick={() => window.confirm('Annullare la campagna? I messaggi non ancora partiti non partono più.') && run('campaign_action', { id: c.id, op: 'cancel' }, () => 'Campagna annullata.')}
                        >
                          Annulla
                        </button>
                      )}
                      <button className={btnGhost} onClick={() => showRecipients(c.id)}>
                        {open === c.id ? 'Chiudi' : 'Destinatari'}
                      </button>
                    </div>
                  </div>
                  <p className="mt-2 text-[var(--text-secondary)]">
                    {c.total} destinatari · in coda {c.counts.queued || 0} · inviati {sent} · consegnati {(c.counts.delivered || 0) + (c.counts.read || 0)} · letti {c.counts.read || 0} · non riusciti {c.counts.failed || 0} · saltati {c.counts.skipped || 0} · risposte {c.replies}
                    {cost ? ` · costo stimato ${formatEur(cost.estimated)}` : ''}
                  </p>
                  {open === c.id && (
                    <div className="mt-2 max-h-80 overflow-auto">
                      <table className="w-full text-xs">
                        <tbody>
                          {recipients.map((r) => (
                            <tr key={r.id} className="border-t border-[var(--border-color)]">
                              <td className="py-1 pr-2">{r.name || '—'}</td>
                              <td className="pr-2">{r.phone}</td>
                              <td className="pr-2">{RECIPIENT_STATUS_LABEL[r.status as keyof typeof RECIPIENT_STATUS_LABEL] || r.status}</td>
                              <td className="pr-2 text-[var(--text-secondary)]">
                                {r.skip_reason ? SKIP_LABEL[r.skip_reason] || r.skip_reason : r.error_message ? `${r.error_code ? `${r.error_code}: ` : ''}${r.error_message}` : romeDateTime(r.read_at || r.delivered_at || r.sent_at)}
                              </td>
                              <td>{r.replied_at ? 'ha risposto' : ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------
// Contattabili
// ---------------------------------------------------------------------

/** Lingua del contatto per le campagne: automatica (dai suoi messaggi) o scelta a mano. */
function LanguageSelect({ contact, run }: { contact: WaContact; run: Run }) {
  const { lang, manual } = contactLanguage(contact)
  const value = manual ? lang || 'altro' : 'auto'
  return (
    <label className="mt-1 flex items-center gap-1">
      Lingua
      <select
        className="rounded-lg border border-[var(--border-color)] bg-[var(--background)] px-1 py-0.5 text-xs text-[var(--text-primary)]"
        value={value}
        onChange={(e) => run('update_contact', { id: contact.id, patch: { language: e.target.value } }, () => 'Lingua aggiornata.')}
      >
        <option value="auto">Automatica{!manual && lang ? ` (${LANGUAGE_LABEL[lang] || lang})` : ' (non ancora riconosciuta)'}</option>
        {Object.entries(LANGUAGE_LABEL).map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </select>
    </label>
  )
}

function ContactsTab({ data, run }: { data: Data; run: Run }) {
  const contacts = data.contacts || []
  const [filter, setFilter] = useState('')
  const [form, setForm] = useState({ phone: '', name: '', company: '', sector: '', tags: '', note: '', consent: false })
  const [csv, setCsv] = useState({ text: '', file: '', note: '', tags: '', consent: false })
  const [leadQ, setLeadQ] = useState('')
  const [leads, setLeads] = useState<{ id: string; name: string; phone: string; sector: string | null; valid: boolean }[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [leadNote, setLeadNote] = useState('')
  const [leadConsent, setLeadConsent] = useState(false)

  if (!data.ready) return <Card title="Contattabili">{<p className="text-sm text-[var(--text-secondary)]">Disponibile dopo lo SQL delle campagne.</p>}</Card>

  const shown = contacts.filter((c) => !filter.trim() || `${c.name || ''} ${c.phone} ${c.sector || ''} ${(c.tags || []).join(' ')} ${c.company || ''}`.toLowerCase().includes(filter.trim().toLowerCase()))
  const counts = {
    marketing: contacts.filter(hasMarketingConsent).length,
    service: contacts.filter((c) => c.status === 'attivo' && c.consent_source === 'ha_scritto').length,
    out: contacts.filter((c) => c.status === 'disiscritto').length,
  }

  return (
    <div className="grid gap-4">
      <Card title={`Contattabili WhatsApp (${contacts.length})`}>
        <p className="mb-3 text-sm text-[var(--text-secondary)]">
          {counts.marketing} con consenso ai messaggi promozionali · {counts.service} ci hanno solo scritto (risposte di servizio; per le campagne chiedi il consenso) · {counts.out} disiscritti
        </p>
        <input className={`${input} mb-3`} placeholder="Cerca nome, numero, settore, tag" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="max-h-[480px] overflow-auto">
          <table className="w-full text-sm">
            <tbody>
              {shown.slice(0, 500).map((c) => (
                <tr key={c.id} className="border-t border-[var(--border-color)] align-top">
                  <td className="py-2 pr-2">
                    <p className="font-medium text-[var(--text-primary)]">{c.name || '—'}</p>
                    <p className="text-xs text-[var(--text-secondary)]">{c.phone}</p>
                  </td>
                  <td className="py-2 pr-2 text-xs text-[var(--text-secondary)]">
                    {[c.company, c.sector].filter(Boolean).join(' · ')}
                    {visibleTags(c.tags).length ? <p>{visibleTags(c.tags).map((t) => `#${t}`).join(' ')}</p> : null}
                    <LanguageSelect contact={c} run={run} />
                  </td>
                  <td className="py-2 pr-2 text-xs">
                    <p>{CONSENT_LABEL[c.consent_source]}</p>
                    <p className="text-[var(--text-secondary)]">
                      {romeDateTime(c.consent_at)}
                      {c.consent_note ? ` · ${c.consent_note}` : ''}
                    </p>
                    {c.consent_requested_at && c.consent_source === 'ha_scritto' && <p className="text-[var(--text-secondary)]">Richiesta inviata {romeDateTime(c.consent_requested_at)}{c.consent_declined_at ? ' · ha detto no' : ''}</p>}
                  </td>
                  <td className="py-2 pr-2 text-xs">{c.status === 'attivo' ? 'Attivo' : <span className="text-[#FF3B30]">Disiscritto {romeDateTime(c.unsubscribed_at)}</span>}</td>
                  <td className="py-2 text-right">
                    <div className="flex flex-wrap justify-end gap-1">
                      {c.status === 'attivo' && c.consent_source === 'ha_scritto' && (
                        <button className={`${btnGhost} px-2 py-1 text-xs`} onClick={() => window.confirm(`Mandare a ${c.name || c.phone} la domanda di consenso (bottoni Sì / No)?`) && run('request_consent', { id: c.id }, () => 'Richiesta di consenso inviata.')}>
                          Chiedi consenso
                        </button>
                      )}
                      {c.status === 'attivo' ? (
                        <button className={`${btnGhost} px-2 py-1 text-xs`} onClick={() => window.confirm('Disiscrivere? Non riceverà più campagne.') && run('unsubscribe_contact', { id: c.id }, () => 'Disiscritto.')}>
                          Disiscrivi
                        </button>
                      ) : (
                        <button
                          className={`${btnGhost} px-2 py-1 text-xs`}
                          onClick={() => {
                            const note = window.prompt('Ti ha dato di nuovo il consenso? Scrivi come e quando (obbligatorio).')
                            if (note?.trim()) run('resubscribe_contact', { id: c.id, consent: true, note }, () => 'Riattivato.')
                          }}
                        >
                          Riattiva
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Aggiungi a mano">
          <div className="grid gap-2">
            <input className={input} placeholder="Numero con prefisso (+39 333 …)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <input className={input} placeholder="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className={input} placeholder="Azienda" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
            <input className={input} placeholder="Settore (es. ristorazione)" value={form.sector} onChange={(e) => setForm({ ...form, sector: e.target.value })} />
            <input className={input} placeholder="Tag separati da virgola" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
            <input className={input} placeholder="Come hai avuto il consenso (obbligatorio)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} />
              Ho il consenso di questa persona a ricevere messaggi promozionali su WhatsApp
            </label>
            <button
              className={btnPrimary}
              disabled={!form.consent || !form.phone.trim() || !form.note.trim()}
              onClick={async () => {
                const res = await run('add_contact', { contact: form }, (r) => (r.created ? 'Contatto aggiunto.' : `Contatto aggiornato${r.note ? ` (${r.note})` : ''}.`))
                if (res) setForm({ phone: '', name: '', company: '', sector: '', tags: '', note: '', consent: false })
              }}
            >
              Aggiungi
            </button>
          </div>
        </Card>

        <Card title="Importa CSV">
          <div className="grid gap-2 text-sm">
            <p className="text-[var(--text-secondary)]">
              Colonne: <b>telefono</b> e <b>consenso</b> (sì/no) obbligatorie; nome, azienda, settore, tag, nota facoltative. Si importano solo le righe con «sì».
            </p>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (f) setCsv({ ...csv, file: f.name, text: await f.text() })
              }}
            />
            <input className={input} placeholder="Come hai raccolto i consensi (es. modulo evento 10/2026)" value={csv.note} onChange={(e) => setCsv({ ...csv, note: e.target.value })} />
            <input className={input} placeholder="Tag da aggiungere a tutti (facoltativo)" value={csv.tags} onChange={(e) => setCsv({ ...csv, tags: e.target.value })} />
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={csv.consent} onChange={(e) => setCsv({ ...csv, consent: e.target.checked })} />
              Confermo che le persone con «sì» nella colonna consenso hanno dato il consenso
            </label>
            <button
              className={btnPrimary}
              disabled={!csv.text || !csv.consent}
              onClick={async () => {
                const res = await run('import_csv', { csv: csv.text, note: csv.note, tags: csv.tags, consent: true }, (r) =>
                  `Importati: ${r.added} nuovi, ${r.updated} aggiornati · ${r.skippedNoConsent} senza consenso (saltati) · ${r.invalid} numeri non validi${r.errors?.length ? ` · ${r.errors.join('; ')}` : ''}`
                )
                if (res) setCsv({ text: '', file: '', note: '', tags: '', consent: false })
              }}
            >
              Importa {csv.file}
            </button>
          </div>
        </Card>
      </div>

      <Card title="Dal Motore clienti">
        <div className="grid gap-2 text-sm">
          <div className="flex gap-2">
            <input className={input} placeholder="Cerca per nome" value={leadQ} onChange={(e) => setLeadQ(e.target.value)} />
            <button className={btnGhost} onClick={async () => setLeads((await call('leads_search', { q: leadQ }).catch(() => ({ leads: [] }))).leads || [])}>
              Cerca
            </button>
          </div>
          <div className="max-h-60 overflow-auto">
            {leads.map((l) => (
              <label key={l.id} className="flex items-center gap-2 border-t border-[var(--border-color)] py-1">
                <input type="checkbox" disabled={!l.valid} checked={picked.includes(l.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, l.id] : picked.filter((x) => x !== l.id))} />
                <span>{l.name}</span>
                <span className="text-[var(--text-secondary)]">
                  {l.phone}
                  {l.valid ? '' : ' (numero non valido)'}
                </span>
              </label>
            ))}
          </div>
          {picked.length > 0 && (
            <>
              <input className={input} placeholder="Come hai avuto il consenso (obbligatorio)" value={leadNote} onChange={(e) => setLeadNote(e.target.value)} />
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-1" checked={leadConsent} onChange={(e) => setLeadConsent(e.target.checked)} />
                Ho il consenso di queste {picked.length} persone (averle trovate su Maps non basta)
              </label>
              <button
                className={btnPrimary}
                disabled={!leadConsent || !leadNote.trim()}
                onClick={async () => {
                  const res = await run('add_leads', { leadIds: picked, note: leadNote, consent: true }, (r) => `Aggiunti ${r.added}, aggiornati ${r.updated}${r.noPhone.length ? `, senza numero valido: ${r.noPhone.join(', ')}` : ''}.`)
                  if (res) {
                    setPicked([])
                    setLeadNote('')
                    setLeadConsent(false)
                  }
                }}
              >
                Aggiungi ai contattabili
              </button>
            </>
          )}
        </div>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------
// Modelli
// ---------------------------------------------------------------------

function TemplatesTab({ data, run }: { data: Data; run: Run }) {
  const [busy, setBusy] = useState(false)
  const items: WaTemplate[] = data.templates.items
  return (
    <Card
      title="Modelli (template)"
      right={
        <div className="flex flex-wrap gap-2">
          <a className={btnGhost} href={data.managerUrl} target="_blank" rel="noreferrer">
            Crea su WhatsApp Manager <ExternalLink className="h-4 w-4" />
          </a>
          <button
            className={btnPrimary}
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await run('sync_templates', {}, (r) => `Modelli aggiornati: ${r.templates.items.length}.`)
              setBusy(false)
            }}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Aggiorna modelli da Meta
          </button>
        </div>
      }
    >
      <p className="mb-3 text-sm text-[var(--text-secondary)]">
        Ultimo aggiornamento: {romeDateTime(data.templates.syncedAt)}
        {data.templates.error ? ` · errore: ${data.templates.error}` : ''}. Nelle campagne si usano solo i modelli approvati (APPROVED).
      </p>
      {!items.length ? (
        <p className="text-sm text-[var(--text-secondary)]">Nessun modello letto.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((t) => (
            <div key={`${t.name}|${t.language}`} className="rounded-xl border border-[var(--border-color)] p-3 text-sm">
              <p className="font-semibold text-[var(--text-primary)]">
                {t.name} <span className="font-normal text-[var(--text-secondary)]">({t.language})</span>
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                {t.category} · <span className={t.status === 'APPROVED' ? 'text-[#34C759]' : 'text-[#FF9500]'}>{t.status}</span>
                {t.variables.length ? ` · variabili: ${t.variables.map((v) => (v.key === 'header:media' ? 'file' : `{{${v.name}}}`)).join(', ')}` : ''}
              </p>
              {t.unsupported && <p className="text-xs text-[#FF9500]">Non usabile da qui: {t.unsupported}</p>}
              <p className="mt-2 whitespace-pre-wrap text-[var(--text-primary)]">{[t.headerText, t.body, t.footer].filter(Boolean).join('\n\n')}</p>
              {t.buttons.length > 0 && <p className="mt-1 text-xs text-[var(--text-secondary)]">Bottoni: {t.buttons.map((b) => b.text).join(' · ')}</p>}
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------
// Costi
// ---------------------------------------------------------------------

function CostsTab({ data, reload, loading }: { data: Data; reload: () => void; loading: boolean }) {
  const c = data.costs
  const max = useMemo(() => Math.max(0.0001, ...(c?.days || []).map((d) => Math.max(d.estimated, d.real || 0))), [c])
  if (!data.ready || !c) return <Card title="Costi WhatsApp">{<p className="text-sm text-[var(--text-secondary)]">Disponibile dopo lo SQL delle campagne.</p>}</Card>
  const realShown = c.realMonth !== null
  const money = (n: number) => (c.currency === 'EUR' ? formatEur(n) : `${n.toFixed(2)} ${c.currency}`)
  return (
    <div className="grid gap-4">
      <Card
        title="Costi WhatsApp"
        right={
          <button className={btnGhost} onClick={reload} disabled={loading}>
            Rileggi costi reali da Meta
          </button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-[var(--background)] p-3">
            <p className="text-xs text-[var(--text-secondary)]">Questo mese · stimato</p>
            <p className="text-2xl font-bold text-[var(--text-primary)]">{formatEur(c.estimatedMonth)}</p>
            <p className="text-xs text-[var(--text-secondary)]">consegnati × prezzo ({data.pricesNote})</p>
          </div>
          <div className="rounded-xl bg-[var(--background)] p-3">
            <p className="text-xs text-[var(--text-secondary)]">Questo mese · reale da Meta</p>
            <p className="text-2xl font-bold text-[var(--text-primary)]">{realShown ? money(c.realMonth as number) : '—'}</p>
            <p className="text-xs text-[var(--text-secondary)]">{realShown ? `letto ${romeDateTime(c.realFetchedAt)}` : c.realError ? `non disponibile: ${c.realError.slice(0, 120)}` : 'non disponibile'}</p>
          </div>
          <div className="rounded-xl bg-[var(--background)] p-3">
            <p className="text-xs text-[var(--text-secondary)]">Budget mensile</p>
            <p className="text-2xl font-bold text-[var(--text-primary)]">{c.budget ? formatEur(c.budget) : 'Nessun limite'}</p>
            {c.budgetUsedPct !== null && (
              <>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--border-color)]">
                  <div className="h-full rounded-full bg-[var(--accent-blue)]" style={{ width: `${Math.min(100, c.budgetUsedPct)}%` }} />
                </div>
                <p className="text-xs text-[var(--text-secondary)]">usato {c.budgetUsedPct}% · al 100% le campagne vanno in pausa (con notifica)</p>
              </>
            )}
          </div>
        </div>

        <h3 className="mb-1 mt-5 text-sm font-semibold text-[var(--text-primary)]">Ultimi 30 giorni</h3>
        <div className="mb-2 flex gap-4 text-xs text-[var(--text-secondary)]">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[var(--accent-blue)]" /> Stimato
          </span>
          {realShown && (
            <span className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[var(--text-secondary)]" /> Reale (Meta)
            </span>
          )}
        </div>
        <div className="flex h-40 items-end gap-[2px] border-b border-[var(--border-color)]" role="img" aria-label="Costo giornaliero degli ultimi 30 giorni">
          {c.days.map((d) => (
            <div key={d.date} className="group relative flex h-full flex-1 items-end gap-[2px]" title={`${d.date}: stimato ${formatEur(d.estimated)}${d.real !== null ? `, reale ${money(d.real)}` : ''}`}>
              <div className="flex-1 rounded-t bg-[var(--accent-blue)]" style={{ height: `${(d.estimated / max) * 100}%`, minHeight: d.estimated ? 2 : 0 }} />
              {realShown && <div className="flex-1 rounded-t bg-[var(--text-secondary)]" style={{ height: `${((d.real || 0) / max) * 100}%`, minHeight: d.real ? 2 : 0 }} />}
            </div>
          ))}
        </div>
        <div className="flex justify-between text-[10px] text-[var(--text-secondary)]">
          <span>{c.days[0]?.date.slice(5)}</span>
          <span>oggi</span>
        </div>
      </Card>

      <Card title="Per campagna">
        {!c.campaigns.length ? (
          <p className="text-sm text-[var(--text-secondary)]">Ancora nessun messaggio inviato.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-[var(--text-secondary)]">
                <tr>
                  <th className="py-1 pr-2">Campagna</th>
                  <th className="pr-2">Inviati</th>
                  <th className="pr-2">Consegnati</th>
                  <th className="pr-2">Letti</th>
                  <th className="pr-2">Risposte</th>
                  <th className="pr-2">Costo stimato</th>
                </tr>
              </thead>
              <tbody>
                {c.campaigns.map((x) => (
                  <tr key={x.id} className="border-t border-[var(--border-color)]">
                    <td className="py-1 pr-2">{x.name}</td>
                    <td className="pr-2">{x.sent}</td>
                    <td className="pr-2">{x.delivered}</td>
                    <td className="pr-2">{x.read}</td>
                    <td className="pr-2">{x.replies}</td>
                    <td className="pr-2">{formatEur(x.estimated)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------
// Impostazioni
// ---------------------------------------------------------------------

function SettingsTab({ data, run }: { data: Data; run: Run }) {
  const s = data.settings
  const [f, setF] = useState({
    dailyCap: String(s.dailyCap),
    monthlyBudget: String(s.monthlyBudget || ''),
    marketing: String(s.prices.marketing),
    utility: String(s.prices.utility),
    authentication: String(s.prices.authentication),
    service: String(s.prices.service),
    consentText: s.consentText,
  })
  const save = () =>
    run(
      'save_settings',
      {
        settings: {
          dailyCap: f.dailyCap,
          monthlyBudget: f.monthlyBudget || 0,
          prices: { marketing: f.marketing, utility: f.utility, authentication: f.authentication, service: f.service },
          consentText: f.consentText,
        },
      },
      () => 'Impostazioni salvate.'
    )
  const field = (k: keyof typeof f, label: string, hint?: string) => (
    <label className="text-sm">
      {label}
      <input className={input} inputMode="decimal" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
      {hint && <span className="text-xs text-[var(--text-secondary)]">{hint}</span>}
    </label>
  )
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="Invio e budget">
        <div className="grid gap-3">
          {field('dailyCap', 'Messaggi al giorno (24 ore)', 'Meta parte da 250 contatti al giorno per i numeri nuovi: alzalo solo quando Meta alza il tuo livello.')}
          {field('monthlyBudget', 'Budget mensile in euro (vuoto = nessun limite)', 'Raggiunto il budget, le campagne vanno in pausa e arriva una notifica.')}
          <label className="text-sm">
            Testo della richiesta di consenso ({'{nome}'} = nome)
            <textarea className={input} rows={3} value={f.consentText} onChange={(e) => setF({ ...f, consentText: e.target.value })} />
          </label>
          <p className="text-xs text-[var(--text-secondary)]">
            Numero: id {s.phoneNumberId} · Account WhatsApp Business: {s.wabaId} (si cambiano con WHATSAPP_PHONE_NUMBER_ID e WHATSAPP_BUSINESS_ACCOUNT_ID su Vercel).
          </p>
        </div>
      </Card>
      <Card title="Prezzi per messaggio consegnato (Italia)">
        <p className="mb-3 rounded-xl bg-[#FF9500]/10 px-3 py-2 text-xs text-[var(--text-primary)]">
          Valori di partenza: {data.pricesNote}. Meta addebita ogni modello consegnato in base alla categoria.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {field('marketing', 'Marketing (€)')}
          {field('utility', 'Utility (€)')}
          {field('authentication', 'Autenticazione (€)')}
          {field('service', 'Servizio (€)')}
        </div>
      </Card>
      <div className="md:col-span-2">
        <button className={btnPrimary} onClick={save}>
          Salva impostazioni
        </button>
      </div>
    </div>
  )
}
