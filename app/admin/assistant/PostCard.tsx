'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, ExternalLink, Facebook, History, Instagram, Loader2, Send, Sparkles, Trash2, Undo2, X } from 'lucide-react'
import { authFetch, type SocialAction } from '@/components/useAssistantChat'
import { useSyncedText } from './useSyncedText'
import { shortDate } from './format'

// Anteprima di un carosello della super chat, come la scheda del post nella beta:
// si toccano una o piu' slide e si corregge SOLO quella (testo a mano o con l'AI),
// si sposta, si toglie, si annulla l'ultima modifica; poi "Pubblica ora".
// Le slide non toccate restano gli stessi file. Ogni modifica parte dalle slide che
// si vedono (base): se il carosello era cambiato altrove il server risponde 409 con
// la versione attuale e la scheda si rimette in pari.

export type PostPreview = Extract<SocialAction, { kind: 'post_preview' }>

type SlideKind = 'cover' | 'content' | 'closing'
type FieldKey = 'hook' | 'label' | 'subtitle' | 'title' | 'text' | 'button'
type SlideOutline = { n: number; kind: SlideKind; url: string; image: boolean; mine?: boolean } & Partial<Record<FieldKey, string>>
type DraftView = {
  id: string
  title: string
  urls: string[]
  status: 'draft' | 'publishing' | 'published' | 'error'
  results?: { instagram?: string; facebook?: string; errors?: string[] }
  editable: boolean
}
type Limits = { hook: number; label: number; subtitle: number; title: number; text: number; ctaTitle: number; ctaText: number; button: number }
type Version = { at: string; slides: number; cover: string; urls?: string[] }
type CarouselState = { draft: DraftView; outline: SlideOutline[] | null; versions: Version[]; limits?: Limits }
type Reply = Partial<CarouselState> & { ok?: boolean; error?: string; done?: string[]; changed?: boolean }

const API = '/api/admin/social-post'
const LIMITS: Limits = { hook: 60, label: 40, subtitle: 120, title: 70, text: 230, ctaTitle: 70, ctaText: 180, button: 30 }
const sameUrls = (a: string[], b: string[]) => a.length === b.length && a.every((u, i) => u === b[i])
const publishedOn = (results?: DraftView['results']) => [results?.instagram && 'Instagram', results?.facebook && 'Facebook'].filter(Boolean) as string[]
const hasState = (data: Reply): data is Reply & CarouselState => Boolean(data.draft && Array.isArray(data.draft.urls))
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
type Platform = 'instagram' | 'facebook'
const PLATFORMS: Platform[] = ['instagram', 'facebook']
const platformName = (p: Platform) => (p === 'instagram' ? 'Instagram' : 'Facebook')

async function request(method: 'GET' | 'PATCH' | 'POST', draftId: string, body?: Record<string, unknown>): Promise<{ status: number; data: Reply } | null> {
  const res = await authFetch(
    method === 'GET' ? `${API}?id=${encodeURIComponent(draftId)}` : API,
    method === 'GET' ? {} : { method, body: JSON.stringify({ draftId, ...body }) }
  ).catch(() => null)
  if (!res) return null
  return { status: res.status, data: await res.json().catch(() => ({})) }
}

/** required: campo che non puo' restare vuoto (il testo e' l'avviso da mostrare). */
type FieldDef = { key: FieldKey; label: string; max: number; rows?: number; required?: string }

/** Campi di testo della slide, secondo il tipo (copertina, slide normale, slide finale). */
function fieldsFor(kind: SlideKind, l: Limits): FieldDef[] {
  if (kind === 'cover')
    return [
      { key: 'hook', label: 'Titolo grande', max: l.hook, required: 'Il titolo grande non può restare vuoto.' },
      { key: 'label', label: 'Etichetta sopra il titolo', max: l.label },
      { key: 'subtitle', label: 'Riga sotto il titolo', max: l.subtitle, rows: 2 },
    ]
  if (kind === 'content')
    return [
      { key: 'title', label: 'Titolo', max: l.title, required: 'Il titolo non può restare vuoto.' },
      { key: 'text', label: 'Testo', max: l.text, rows: 3 },
    ]
  return [
    { key: 'title', label: 'Titolo', max: l.ctaTitle, required: 'Il titolo non può restare vuoto.' },
    { key: 'text', label: 'Testo', max: l.ctaText, rows: 3 },
    { key: 'button', label: 'Pulsante', max: l.button, required: 'Il pulsante non può restare vuoto.' },
  ]
}

const listNumbers = (ns: number[]) => (ns.length === 1 ? `${ns[0]}` : `${ns.slice(0, -1).join(', ')} e ${ns[ns.length - 1]}`)

export function PostCard({
  action,
  canEdit,
  viewOnly,
  chatBusy,
  restoredAt,
  onChange,
  onAsk,
}: {
  action: PostPreview
  /** Amministratore: puo' modificare e pubblicare. */
  canEdit: boolean
  /** Permessi letti e non e' l'amministratore. */
  viewOnly: boolean
  chatBusy: boolean
  /** Momento in cui una versione di prima e' stata ripresa da una scheda piu' sopra. */
  restoredAt?: number
  onChange: (patch: Partial<PostPreview>) => unknown
  /** Manda una richiesta alla chat (es. rifare un carosello di prima). */
  onAsk?: (text: string) => void
}) {
  const [remote, setRemote] = useState<CarouselState | null>(null)
  const actionRef = useRef(action)
  actionRef.current = action
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  // Scheda chiusa (cambio di chat, versione di prima): le risposte in ritardo non la toccano piu'.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // Testi cambiati da Luca: edited, cosi' una scheda nuova dello stesso carosello li riprende.
  const [caption, setCaption, flushCaption] = useSyncedText(action.caption, (caption) => onChangeRef.current({ caption, edited: true }))
  const [facebook, setFacebook, flushFacebook] = useSyncedText(action.facebook, (facebook) => onChangeRef.current({ facebook, edited: true }))

  const urls = remote?.draft.urls ?? action.urls
  const mediaKey = urls.join('|')
  const outline = remote?.outline && remote.outline.length === urls.length ? remote.outline : null
  const limits = remote?.limits ?? LIMITS
  const versions = remote?.versions ?? []
  const status = remote?.draft.status
  const results = remote?.draft.results
  /** Social dove e' gia' uscito: li' non si ripubblica. */
  const outOn = publishedOn(results)
  const notYet = PLATFORMS.filter((p) => !results?.[p])
  // Uscito solo su un social (es. Facebook si', Instagram no): si puo' ancora pubblicare dove manca.
  const sent = action.state === 'sent' || (status === 'published' && !notYet.length)
  const publishing = action.state === 'sending' || status === 'publishing'
  // Slide e testi arrivati dal server: si possono cambiare.
  const ready = Boolean(remote?.draft.editable && outline)
  // Le slide si toccano subito, anche prima che arrivino i testi dal server.
  const selectable = canEdit && !sent && !publishing && (remote ? ready : action.editable !== false)
  const platforms = action.platforms?.length ? action.platforms : PLATFORMS
  const toSend = platforms.filter((p) => !results?.[p])

  /** Stato arrivato dal server: la scheda e la chat si mettono in pari (mai le didascalie). */
  const sync = useCallback((next: CarouselState) => {
    if (!mounted.current) return
    setRemote(next)
    const current = actionRef.current
    const d = next.draft
    const patch: Partial<PostPreview> = {}
    if (!sameUrls(d.urls, current.urls)) patch.urls = d.urls
    if (d.editable !== current.editable) patch.editable = d.editable
    const everywhere = PLATFORMS.every((p) => d.results?.[p])
    if (d.status === 'published' && everywhere && current.state !== 'sent') Object.assign(patch, { state: 'sent', published: publishedOn(d.results), error: undefined })
    if (Object.keys(patch).length) onChangeRef.current(patch)
  }, [])

  // Stato vero del carosello (slide attuali, testi, versioni): all'apertura e quando le slide cambiano.
  // Se non arriva si riprova dopo 5 secondi e tornando sulla pagina; dopo 3 volte decide Luca (Riprova).
  const actionKey = action.urls.join('|')
  const remoteKey = remote ? remote.draft.urls.join('|') : null
  const [loadFails, setLoadFails] = useState(0)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    if (!canEdit || !action.draftId || remoteKey === actionKey) return
    let alive = true
    request('GET', action.draftId).then((r) => {
      if (!alive) return
      if (r?.status === 200 && hasState(r.data)) {
        setLoadFails(0)
        sync(r.data)
      } else setLoadFails((n) => (r?.status === 404 ? 3 : n + 1))
    })
    return () => {
      alive = false
    }
  }, [canEdit, action.draftId, actionKey, remoteKey, sync, reload])
  useEffect(() => {
    if (!loadFails) return
    const retry = () => setReload((n) => n + 1)
    const timer = loadFails < 3 ? setTimeout(retry, 5000) : null
    const onVisible = () => document.visibilityState === 'visible' && retry()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [loadFails])
  const loadFailed = canEdit && loadFails >= 3 && remoteKey !== actionKey
  const retryLoad = () => {
    setLoadFails(0)
    setReload((n) => n + 1)
  }

  // Slide scelte (indici in urls) e nuovo ordine non ancora salvato (quelle tolte mancano).
  const [selected, setSelected] = useState<number[]>([])
  const [order, setOrder] = useState<number[] | null>(null)
  const keepSelected = useRef<number[] | null>(null)
  const thumbs = useRef(new Map<number, HTMLButtonElement>())
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [fields, setFields] = useState<Partial<Record<FieldKey, string>>>({})
  const [showVersions, setShowVersions] = useState(false)

  // Slide rifatte: si riparte da quelle; dopo una correzione restano scelte le stesse slide.
  useEffect(() => {
    setOrder(null)
    setSelected(keepSelected.current ?? [])
    keepSelected.current = null
  }, [mediaKey])
  useEffect(() => {
    if (selectable) return
    setSelected([])
    setOrder(null)
  }, [selectable])
  // Versione ripresa da una scheda piu' sopra: si dice qui, dove si vede (non a una scheda nata dopo).
  const createdAt = useRef(Date.now())
  useEffect(() => {
    if (restoredAt && restoredAt >= createdAt.current) setNotice('Versione ripresa: queste sono le slide di adesso.')
  }, [restoredAt])

  const kindOf = (i: number): SlideKind => outline?.[i]?.kind ?? 'content'
  const sequence = order ?? urls.map((_, i) => i)
  const changed = order !== null
  const positions = selected
    .map((i) => sequence.indexOf(i))
    .filter((p) => p >= 0)
    .sort((a, b) => a - b)
  const single = selected.length === 1 ? selected[0] : null
  const pos = single === null ? -1 : sequence.indexOf(single)
  const singleKind = single === null ? null : kindOf(single)
  // Spostare e togliere seguono il tipo delle slide: servono le slide arrivate dal server.
  const canMoveLeft = outline !== null && singleKind === 'content' && pos > 0 && kindOf(sequence[pos - 1]) === 'content'
  const canMoveRight = outline !== null && singleKind === 'content' && pos >= 0 && pos < sequence.length - 1 && kindOf(sequence[pos + 1]) === 'content'
  const canRemove = outline !== null && selected.length > 0 && !selected.some((i) => kindOf(i) === 'cover') && sequence.length - selected.length >= 2
  const allSelected = sequence.length > 1 && positions.length === sequence.length
  const numbers = positions.map((p) => p + 1)
  const which = allSelected ? 'tutte le slide' : numbers.length === 1 ? `la slide ${numbers[0]}` : `le slide ${listNumbers(numbers)}`
  const whichIn = allSelected ? 'in tutte le slide' : numbers.length === 1 ? `nella slide ${numbers[0]}` : `nelle slide ${listNumbers(numbers)}`
  const working = busy !== null || chatBusy

  // Testi della slide scelta (si scrivono a mano): si riparte da quelli salvati quando cambiano.
  const defs = singleKind ? fieldsFor(singleKind, limits) : []
  const saved = single !== null && outline ? outline[single] : null
  const savedKey = saved ? `${single}|${JSON.stringify(saved)}` : ''
  useEffect(() => setFields({}), [savedKey])
  const valueOf = (key: FieldKey) => fields[key] ?? saved?.[key] ?? ''
  const edits = Object.fromEntries(defs.filter((d) => fields[d.key] !== undefined && fields[d.key] !== (saved?.[d.key] ?? '')).map((d) => [d.key, fields[d.key]!]))
  const dirty = Object.keys(edits).length > 0
  /** Primo campo obbligatorio rimasto vuoto. */
  const empty = defs.find((d) => d.required && !valueOf(d.key).trim())

  const toggleSlide = (i: number) => {
    if (!selectable || working) return
    setNotice(null)
    setSelected((list) => (list.includes(i) ? list.filter((x) => x !== i) : [...list, i]))
  }
  const rearrange = (next: number[]) => setOrder(next.length === urls.length && next.every((k, j) => k === j) ? null : next)
  const move = (step: -1 | 1) => {
    if (single === null) return
    const next = [...sequence]
    ;[next[pos], next[pos + step]] = [next[pos + step], next[pos]]
    rearrange(next)
    requestAnimationFrame(() => thumbs.current.get(single)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' }))
  }
  const remove = () => {
    rearrange(sequence.filter((k) => !selected.includes(k)))
    setSelected([])
  }

  /** Connessione caduta o tempo scaduto: il server puo' aver finito lo stesso, si ricontrolla. */
  const recheck = async (before: string[], keep: number[] | null): Promise<CarouselState | null> => {
    setBusy('recheck')
    for (let k = 0; k < 24 && mounted.current; k++) {
      await wait(5000)
      if (!mounted.current) break
      const r = await request('GET', action.draftId)
      if (mounted.current && r?.status === 200 && hasState(r.data) && !sameUrls(r.data.draft.urls, before)) {
        setBusy(null)
        keepSelected.current = keep
        sync(r.data)
        return r.data
      }
    }
    if (mounted.current) setBusy(null)
    return null
  }

  /** Modifica sul server (PATCH). keep: slide da tenere scelte dopo (posizioni nel nuovo carosello). */
  const act = async (name: string, extra: Record<string, unknown> = {}, base: string[] = urls, keep: number[] | null = null): Promise<Reply | null> => {
    setBusy(name)
    setError(null)
    setNotice(null)
    const r = await request('PATCH', action.draftId, { action: name, base, ...extra })
    setBusy(null)
    const ok = Boolean(r?.status === 200 && r.data.ok)
    keepSelected.current = ok && r?.data.changed ? keep : null
    if (r && hasState(r.data)) sync(r.data)
    if (ok) return r!.data
    if (!r || (!r.data.error && r.status >= 500)) {
      const fresh = await recheck(base, keep)
      if (fresh) return { ...fresh, ok: true, changed: true, done: [] }
      setError('Connessione interrotta: la modifica non è arrivata, riprova.')
      return null
    }
    setError(r.data.error || `Modifica non riuscita (errore ${r.status}), riprova.`)
    return null
  }

  /** Salva il nuovo ordine (si rifanno le slide con i numeri giusti): torna le slide nuove. */
  const saveOrder = async (): Promise<string[] | null> => {
    if (!order) return urls
    const r = await act('arrange', { slides: order.map((k) => k + 1) }, urls, positions)
    if (!r?.draft) return null
    if (!r.changed) setOrder(null)
    else if (r.done?.length) setNotice(`Fatto: ${r.done.join(' · ')}.`)
    return r.draft.urls
  }

  /** Testi scritti a mano per la slide scelta: si rifa' solo quella. */
  const saveText = async () => {
    if (single === null || !dirty || empty) return
    const n = pos + 1
    const changes = edits
    const base = changed ? await saveOrder() : urls
    if (!base) return
    const r = await act('edit_text', { edits: [{ n, ...changes }] }, base, [pos])
    if (!r) return
    setFields({})
    setNotice(r.changed ? `Fatto: ${(r.done?.length ? r.done : [`slide ${n}: testo cambiato`]).join(' · ')}. Le altre slide non sono cambiate.` : 'Il testo era già questo: niente da cambiare.')
  }

  /** Correzione con l'AI delle SOLE slide scelte (le altre restano identiche). */
  const editAI = async () => {
    const chosen = positions
    const instruction = prompt.trim()
    if (!chosen.length || !instruction) return
    const base = changed ? await saveOrder() : urls
    if (!base) return
    const r = await act('edit_slides', { slides: chosen.map((p) => p + 1), instruction }, base, chosen)
    if (!r) return
    setPrompt('')
    if (r.changed) setNotice(`Fatto: ${(r.done?.length ? r.done : [`ho corretto solo ${which}`]).join(' · ')}. Le altre slide non sono cambiate.`)
    else setError(r.done?.length ? r.done.join(' · ') : 'Non ho cambiato niente: scrivi in modo più preciso cosa cambiare.')
  }

  const undo = async () => {
    if (!window.confirm('Annullare l’ultima modifica alle slide?')) return
    const r = await act('undo')
    if (r?.changed) setNotice('Ultima modifica annullata.')
  }

  /** Torna a una versione salvata (quella di adesso resta tra le versioni). */
  const restore = async (at: string) => {
    if (!window.confirm('Riprendere questa versione? Le slide di adesso restano tra le versioni.')) return
    const r = await act('restore', { at })
    if (!r?.changed) return
    setShowVersions(false)
    setNotice('Versione ripresa.')
  }

  /** Carosello di prima (senza i dati per rifare una slide sola): lo rifa' la chat, uguale. */
  const remake = () => {
    if (!onAsk || !window.confirm('Rifare questo carosello con gli stessi testi? Le slide nuove si potranno toccare una per una.')) return
    onAsk(`Rifai il carosello «${action.title || 'Carosello'}» con gli stessi testi e ${urls.length} slide, così posso modificare le slide una per una (draftId ${action.draftId}).`)
  }

  const togglePlatform = (p: Platform) => {
    const next = platforms.includes(p) ? platforms.filter((x) => x !== p) : [...platforms, p]
    onChange({ platforms: next, edited: true })
  }

  /** Pubblica esattamente le slide che si vedono (se intanto sono cambiate: 409, niente pubblicazione). */
  const publish = async () => {
    if (!window.confirm(`Pubblicare adesso su ${toSend.map(platformName).join(' e ')}?`)) return
    flushCaption()
    flushFacebook()
    setError(null)
    setNotice(null)
    onChange({ state: 'sending', error: undefined })
    const r = await request('POST', action.draftId, { caption, facebook, platforms: toSend, base: urls })
    const fresh = r && hasState(r.data) ? r.data : null
    if (fresh && mounted.current) setRemote(fresh)
    const slides = fresh ? { urls: fresh.draft.urls, editable: fresh.draft.editable } : {}
    const out = r?.data.draft?.results
    const done = publishedOn(out)
    // Uscito solo su uno dei social scelti: resta da pubblicare sull'altro (Pubblica riprova solo li').
    const left = toSend.filter((p) => !out?.[p])
    if (r?.status === 200 && r.data.ok && !left.length) onChangeRef.current({ state: 'sent', published: done, error: undefined, ...slides })
    else
      onChangeRef.current({
        state: 'error',
        error:
          r?.status === 200 && r.data.ok
            ? out?.errors?.join(' · ') || `Non uscito su ${left.map(platformName).join(' e ')}.`
            : r?.data.error || (r ? 'Pubblicazione non riuscita' : 'Connessione interrotta: controlla tra poco se è uscito.'),
        published: done,
        ...slides,
      })
  }

  const pill = sent
    ? ['Pubblicato', 'bg-[#34C759]/15 text-[#34C759]']
    : publishing
      ? ['In pubblicazione…', 'bg-[var(--accent-blue)]/15 text-[var(--accent-blue)]']
      : outOn.length
        ? [`Uscito su ${outOn.join(' e ')}`, 'bg-[#FF9500]/15 text-[#FF9500]']
        : action.state === 'error' || status === 'error'
          ? ['Non pubblicato', 'bg-[#FF3B30]/15 text-[#FF3B30]']
          : ['Bozza', 'bg-[var(--background)] text-[var(--text-secondary)]']
  const published = action.published?.length ? action.published : outOn
  const publishError = action.state === 'error' ? action.error : null
  const textClass = 'mt-1 w-full rounded-lg border border-[var(--border-color)] bg-[var(--background)] px-3 py-2 text-base text-[var(--text-primary)] disabled:opacity-60 md:text-sm'
  const undoButton = (
    <button type="button" onClick={undo} disabled={working} className="inline-flex items-center gap-1 text-xs text-[var(--text-secondary)] disabled:opacity-40">
      {busy === 'undo' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />} Annulla ultima modifica
    </button>
  )
  const idle = !selected.length && !changed

  return (
    <div data-live-post={action.draftId} className="mt-3 max-w-xl scroll-mt-20 rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-3">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="truncate font-semibold">{action.title || 'Carosello'}</span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${pill[1]}`}>{pill[0]}</span>
      </div>
      <div className="-mx-1 mt-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 pt-1">
        {sequence.map((i, n) => {
          const url = urls[i]
          const on = selected.includes(i)
          const dim = busy === 'arrange' || busy === 'undo' || busy === 'restore' || busy === 'recheck' || ((busy === 'edit_slides' || busy === 'edit_text') && on)
          const image = (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={`Slide ${n + 1}`}
              loading="lazy"
              className={`h-52 w-[166px] rounded-lg object-cover ${on ? 'ring-4 ring-[var(--accent-blue)]' : 'border border-[var(--border-color)]'} ${dim ? 'opacity-50' : ''}`}
            />
          )
          const badge = (
            <span className={`absolute left-1.5 top-1.5 rounded-full px-1.5 text-[11px] font-semibold ${on ? 'bg-[var(--accent-blue)] text-white' : 'bg-black/55 text-white'}`}>{n + 1}</span>
          )
          // Mentre si lavora le slide non si scelgono, ma si aprono grandi come sempre.
          return selectable && !working ? (
            <button
              key={`${url}#${i}`}
              ref={(el) => {
                if (el) thumbs.current.set(i, el)
                else thumbs.current.delete(i)
              }}
              type="button"
              onClick={() => toggleSlide(i)}
              aria-label={`Slide ${n + 1}${on ? ' (selezionata)' : ''}`}
              aria-pressed={on}
              className="relative shrink-0 snap-start"
            >
              {image}
              {badge}
              {on && <Check className="absolute right-1.5 top-1.5 h-5 w-5 rounded-full bg-[var(--accent-blue)] p-0.5 text-white" />}
            </button>
          ) : (
            <a key={`${url}#${i}`} href={url} target="_blank" rel="noopener noreferrer" className="relative shrink-0 snap-start">
              {image}
              {badge}
            </a>
          )
        })}
      </div>

      {viewOnly && <p className="mt-1 text-xs text-[var(--text-secondary)]">Solo l’amministratore può modificare e pubblicare i caroselli.</p>}
      {canEdit && remote && !remote.draft.editable && !sent && !publishing ? (
        outOn.length ? (
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            Le slide non si cambiano più: il carosello è già uscito su {outOn.join(' e ')}. Puoi pubblicarlo dove manca.
          </p>
        ) : !remote.outline ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-xs text-[var(--text-secondary)]">Questo carosello è di prima: le slide non si toccano una per una.</p>
            {onAsk && (
              <button
                type="button"
                onClick={remake}
                disabled={chatBusy}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-blue)] disabled:opacity-40"
              >
                <Sparkles className="h-3.5 w-3.5" /> Rifallo modificabile
              </button>
            )}
          </div>
        ) : null
      ) : null}
      {loadFailed && !sent && !publishing && (
        <p className="mt-1 flex items-center gap-3 text-xs">
          <span className="text-[#FF9500]">Slide non caricate.</span>
          <button type="button" onClick={retryLoad} className="font-semibold text-[var(--accent-blue)]">
            Riprova
          </button>
        </p>
      )}
      {changed && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-[var(--accent-blue)]/10 px-3 py-2 text-xs">
          <span className="min-w-[12rem] flex-1 text-[var(--text-secondary)]">
            {busy === 'arrange' ? 'Rifaccio le slide con i numeri giusti…' : `Nuovo ordine, ${sequence.length} slide: salva per aggiornare i numeri sulle slide.`}
          </span>
          <button type="button" onClick={() => setOrder(null)} disabled={working} className="px-2 py-1.5 text-[var(--text-secondary)] disabled:opacity-40">
            Annulla
          </button>
          <button
            type="button"
            onClick={saveOrder}
            disabled={working}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-blue)] px-3 py-1.5 font-semibold text-white disabled:opacity-50"
          >
            {busy === 'arrange' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Salva
          </button>
        </div>
      )}
      {selectable && idle && (
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="text-xs text-[var(--text-secondary)]">
            {remote || loadFailed ? 'Tocca una o più slide per correggere solo quelle, spostarle o toglierle.' : 'Tocca una o più slide per correggerle. Carico le slide…'}
          </p>
          {ready && versions.length > 0 && (
            <span className="inline-flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowVersions((v) => !v)}
                aria-expanded={showVersions}
                className="inline-flex items-center gap-1 text-xs text-[var(--text-secondary)]"
              >
                <History className="h-3.5 w-3.5" /> Versioni ({versions.length})
              </button>
              {undoButton}
            </span>
          )}
        </div>
      )}
      {selectable && idle && ready && showVersions && versions.length > 0 && (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {versions.map((v) => (
            <div key={v.at} className="flex shrink-0 items-center gap-2 rounded-xl border border-[var(--border-color)] p-1.5 pr-2.5 text-[11px] text-[var(--text-secondary)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={v.cover} alt="Copertina" loading="lazy" className="h-14 w-11 rounded-md object-cover" />
              <span className="flex flex-col items-start gap-0.5">
                <span>{shortDate(v.at)}</span>
                <span>{v.slides} slide</span>
                <button type="button" onClick={() => restore(v.at)} disabled={working} className="font-semibold text-[var(--accent-blue)] disabled:opacity-40">
                  {busy === 'restore' ? 'Riprendo…' : 'Riprendi'}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
      {busy === 'recheck' && (
        <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Connessione interrotta: controllo se il server ha finito…
        </p>
      )}
      {notice && (
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-xs text-[#34C759]">{notice}</p>
          {/* Dopo una correzione le slide restano scelte: l'annulla resta a portata di mano. */}
          {ready && !idle && !changed && versions.length > 0 && undoButton}
        </div>
      )}
      {error && <p className="mt-1 text-xs text-[#FF3B30]">{error}</p>}

      {selected.length > 0 && selectable && (
        <div className="mt-2 rounded-xl border border-[var(--accent-blue)] bg-[var(--background)] p-2">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            {outline && singleKind === 'cover' ? (
              <span className="text-[var(--text-secondary)]">La copertina resta la prima.</span>
            ) : outline && singleKind === 'closing' ? (
              <span className="text-[var(--text-secondary)]">La slide finale resta in fondo.</span>
            ) : (
              <span className={`inline-flex items-center rounded-full border border-[var(--border-color)] ${single === null ? 'opacity-40' : ''}`}>
                <button type="button" onClick={() => move(-1)} disabled={!canMoveLeft || working} aria-label="Sposta prima" className="p-1.5 disabled:opacity-30">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="px-1 text-[var(--text-secondary)]">Sposta</span>
                <button type="button" onClick={() => move(1)} disabled={!canMoveRight || working} aria-label="Sposta dopo" className="p-1.5 disabled:opacity-30">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </span>
            )}
            <button
              type="button"
              onClick={remove}
              disabled={!canRemove || working}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] px-2.5 py-1.5 text-[#FF3B30] disabled:opacity-30"
            >
              <Trash2 className="h-3.5 w-3.5" /> Togli
            </button>
            {single !== null && (
              <a
                href={urls[single]}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] px-2.5 py-1.5 text-[var(--text-secondary)]"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Apri
              </a>
            )}
            {sequence.length > 1 && (
              <button
                type="button"
                onClick={() => setSelected(allSelected ? [] : [...sequence])}
                disabled={working}
                className="rounded-full border border-[var(--border-color)] px-2.5 py-1.5 text-[var(--text-secondary)] disabled:opacity-30"
              >
                {allSelected ? 'Nessuna' : 'Tutte'}
              </button>
            )}
            <button type="button" onClick={() => setSelected([])} aria-label="Chiudi" className="ml-auto p-1 text-[var(--text-secondary)]">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {!outline && !loadFailed && (
            <p className="mb-2 inline-flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)]">
              <Loader2 className="h-3 w-3 animate-spin" /> Carico le slide…
            </p>
          )}

          {single !== null && saved && (
            <div className="mb-3 space-y-1.5">
              {defs.map((d) => {
                const props = {
                  value: valueOf(d.key),
                  maxLength: d.max,
                  disabled: working,
                  onChange: (e: { target: { value: string } }) => setFields((f) => ({ ...f, [d.key]: e.target.value })),
                  className:
                    'mt-0.5 block w-full resize-none rounded-lg border border-[var(--border-color)] bg-[var(--background-secondary)] px-2 py-1.5 text-base text-[var(--text-primary)] disabled:opacity-60 md:text-sm',
                }
                return (
                  <label key={d.key} className="block text-[11px] text-[var(--text-secondary)]">
                    {d.label}
                    {d.rows ? <textarea rows={d.rows} {...props} /> : <input {...props} />}
                  </label>
                )
              })}
              {dirty && (
                <div className="flex items-center gap-2 pt-0.5">
                  <button
                    type="button"
                    onClick={saveText}
                    disabled={working || Boolean(empty)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-blue)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {busy === 'edit_text' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Salva testo
                  </button>
                  <button type="button" onClick={() => setFields({})} disabled={working} className="text-xs text-[var(--text-secondary)]">
                    Annulla
                  </button>
                  {empty && <span className="text-[11px] text-[#FF9500]">{empty.required}</span>}
                </div>
              )}
              {busy === 'edit_text' && <p className="text-[11px] text-[var(--text-secondary)]">Rifaccio solo {which}…</p>}
            </div>
          )}

          <p className="mb-1 text-xs text-[var(--text-secondary)]">
            {single !== null ? 'Oppure scrivi all’AI cosa cambiare' : 'Cosa vuoi cambiare'} <b className="text-[var(--text-primary)]">{whichIn}</b>? Testo o immagine.{' '}
            {allSelected ? '' : 'Le altre slide restano identiche.'}
          </p>
          <div className="flex items-end gap-2">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={2}
              placeholder="Es. «titolo più corto»"
              className="min-w-0 flex-1 resize-none rounded-lg border border-[var(--border-color)] bg-[var(--background-secondary)] px-2 py-1.5 text-base text-[var(--text-primary)] md:text-sm"
            />
            <button
              type="button"
              onClick={editAI}
              disabled={working || !prompt.trim() || !positions.length}
              aria-label="Correggi le slide scelte"
              className="rounded-full bg-[var(--accent-blue)] p-2 text-white disabled:opacity-40"
            >
              {busy === 'edit_slides' || busy === 'arrange' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            </button>
          </div>
          {busy === 'edit_slides' && (
            <p className="mt-1 text-[11px] text-[var(--text-secondary)]">Correggo solo {which}… (con un’immagine nuova serve fino a un paio di minuti)</p>
          )}
          {changed && busy !== 'edit_slides' && <p className="mt-1 text-[11px] text-[var(--text-secondary)]">Se salvi una correzione, prima salvo il nuovo ordine.</p>}
        </div>
      )}

      <label className="mt-2 block text-xs text-[var(--text-secondary)]">
        Didascalia Instagram
        <textarea value={caption} onChange={(e) => setCaption(e.target.value)} disabled={!canEdit || sent || publishing} rows={5} className={textClass} />
      </label>
      <label className="mt-2 block text-xs text-[var(--text-secondary)]">
        Testo Facebook
        <textarea value={facebook} onChange={(e) => setFacebook(e.target.value)} disabled={!canEdit || sent || publishing} rows={4} className={textClass} />
      </label>
      {!publishing && !publishError && results?.errors?.length ? <p className="mt-1 text-xs text-[#FF3B30]">{results.errors.join(' · ')}</p> : null}
      {publishError && <p className="mt-1 text-xs text-[#FF3B30]">{publishError}</p>}

      {canEdit && !sent && (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            {PLATFORMS.map((p) => {
              const Icon = p === 'instagram' ? Instagram : Facebook
              // Gia' uscito qui: resta spuntato ma non si ripubblica.
              const out = Boolean(results?.[p])
              return (
                <label key={p} className={`inline-flex items-center gap-1.5 ${out ? 'opacity-50' : ''}`} title={out ? 'Già pubblicato qui' : undefined}>
                  <input type="checkbox" checked={out || platforms.includes(p)} onChange={() => togglePlatform(p)} disabled={publishing || out} aria-label={platformName(p)} />
                  <Icon className="h-4 w-4" />
                </label>
              )
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            {changed ? (
              <span className="mr-auto text-[11px] text-[var(--text-secondary)]">Salva il nuovo ordine prima di pubblicare.</span>
            ) : dirty ? (
              <span className="mr-auto text-[11px] text-[var(--text-secondary)]">Salva il testo della slide prima di pubblicare.</span>
            ) : null}
            <button
              type="button"
              onClick={publish}
              disabled={busy !== null || publishing || changed || dirty || !toSend.length || !caption.trim()}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-blue)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Pubblica ora
            </button>
          </div>
        </>
      )}
      {sent && (
        <p className="mt-2 inline-flex items-center gap-1 text-xs text-[#34C759]">
          <Check className="h-3.5 w-3.5" /> Pubblicato{published.length ? ` su ${published.join(' e ')}` : ''}
        </p>
      )}
    </div>
  )
}

/** Versione precedente dello stesso carosello (com'era in quel punto della chat): si guarda o si riprende. */
export function SnapshotCard({
  action,
  liveUrls,
  canEdit,
  chatBusy,
  onRestored,
}: {
  action: PostPreview
  liveUrls: string[]
  canEdit: boolean
  chatBusy: boolean
  /** ok: versione ripresa davvero (altrimenti solo le slide di adesso, per rimettersi in pari). */
  onRestored: (urls: string[], ok: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (sameUrls(action.urls, liveUrls)) {
    return (
      <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-[var(--border-color)] px-3 py-1 text-xs text-[var(--text-secondary)]">
        <History className="h-3.5 w-3.5" /> {action.title || 'Carosello'}: uguale a quello attuale (più sotto).
      </p>
    )
  }

  const restore = async () => {
    if (!window.confirm('Riprendere questa versione? Le slide di adesso restano salvate: ci torni con «Annulla ultima modifica».')) return
    setBusy(true)
    setError(null)
    const state = await request('GET', action.draftId)
    if (!state || state.status !== 200 || !hasState(state.data)) {
      setBusy(false)
      return setError(state?.data.error || 'Carosello non trovato.')
    }
    const version = state.data.versions.find((v) => v.urls && sameUrls(v.urls, action.urls))
    if (!version) {
      setBusy(false)
      return setError('Questa versione non è più salvata.')
    }
    const r = await request('PATCH', action.draftId, { action: 'restore', at: version.at, base: state.data.draft.urls })
    setBusy(false)
    const ok = Boolean(r?.status === 200 && r.data.ok)
    if (r && hasState(r.data)) onRestored(r.data.draft.urls, ok)
    if (!ok) setError(r?.data.error || 'Ripristino non riuscito, riprova.')
  }

  return (
    <div className="mt-3 max-w-xl rounded-2xl border border-dashed border-[var(--border-color)] p-3">
      <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <History className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">Versione precedente · {action.title || 'Carosello'}</span>
        </span>
        <span className="shrink-0">{action.urls.length} slide</span>
      </div>
      <div className="mt-2 flex snap-x gap-2 overflow-x-auto pb-1">
        {action.urls.map((url, n) => (
          <a key={`${url}#${n}`} href={url} target="_blank" rel="noopener noreferrer" className="relative shrink-0 snap-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`Slide ${n + 1}`} loading="lazy" className="h-40 w-32 rounded-lg border border-[var(--border-color)] object-cover" />
            <span className="absolute left-1.5 top-1.5 rounded-full bg-black/55 px-1.5 text-[11px] font-semibold text-white">{n + 1}</span>
          </a>
        ))}
      </div>
      <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-[var(--text-secondary)]">{action.caption}</p>
      {action.state === 'sent' && (
        <p className="mt-1 inline-flex items-center gap-1 text-xs text-[#34C759]">
          <Check className="h-3.5 w-3.5" /> Pubblicato{action.published?.length ? ` su ${action.published.join(' e ')}` : ''}
        </p>
      )}
      {error && <p className="mt-1 text-xs text-[#FF3B30]">{error}</p>}
      {canEdit && action.state !== 'sent' && (
        <button
          type="button"
          onClick={restore}
          disabled={busy || chatBusy}
          className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-[var(--border-color)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <History className="h-3.5 w-3.5" />} {busy ? 'Ripristino la versione…' : 'Riprendi questa versione'}
        </button>
      )}
    </div>
  )
}
