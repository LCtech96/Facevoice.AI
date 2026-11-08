'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, CalendarClock, Check, Facebook, ImagePlus, Images, Instagram, Loader2, Play, Save, Trash2, X } from 'lucide-react'
import { prepareUploadPhoto, uploadToSignedUrl, type UploadPhoto } from '@/lib/client-image'

// Libreria foto di Facevoice: Luca carica tante foto insieme (ridotte nel browser e mandate
// direttamente nello spazio di archiviazione), l'autopilota ne sceglie alcune nei giorni e alle
// ore scelti e pubblica un carosello da solo (oppure lo lascia da approvare). Qui si vedono
// anche i caroselli programmati (dalla super chat o dall'autopilota) e quelli da approvare.

type AuthFetch = (url: string, init?: RequestInit) => Promise<Response>
type Platform = 'instagram' | 'facebook'

type Photo = { id: string; url: string; fileName: string; note: string; description?: string; uses: number; lastUsedAt?: string | null; createdAt: string }
type Settings = { enabled: boolean; days: number[]; times: string[]; minPhotos: number; maxPhotos: number; topic: string; platforms: Platform[]; confirm: boolean }
type Run = { key: string; status: 'running' | 'published' | 'awaiting' | 'skipped' | 'error'; startedAt: string; note?: string; title?: string }
type Carousel = { id: string; title: string; status: string; scheduledAt: string | null; platforms: Platform[]; needsApproval: boolean; origin: string; urls: string[]; caption: string }

const MAX_SELECT = 300
const BATCH = 20
const PARALLEL = 4
const PAGE = 48
const DAYS = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab']
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
const FIELDS = ['enabled', 'days', 'times', 'minPhotos', 'maxPhotos', 'topic', 'platforms', 'confirm'] as const
const RUN_LABEL: Record<Run['status'], string> = { running: 'In preparazione', published: 'Pubblicato', awaiting: 'Da approvare', skipped: 'Saltato', error: 'Errore' }

const input =
  'w-full px-3 py-2 bg-[var(--background-secondary)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]'
const primary = 'flex items-center gap-1.5 px-4 py-2 bg-[var(--accent-blue)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50'
const secondary =
  'flex items-center gap-1.5 px-3 py-1.5 border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] hover:bg-[var(--background-secondary)] transition-colors disabled:opacity-50'
const chip = (on: boolean) =>
  `px-3 py-1.5 rounded-lg text-sm border transition-colors ${on ? 'bg-[var(--accent-blue)] text-white border-[var(--accent-blue)]' : 'border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--background-secondary)]'}`
const when = (iso: string) => new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

async function readError(res: Response, fallback: string) {
  const data = await res.json().catch(() => ({}))
  return (data?.error as string) || fallback
}

/** Esegue i lavori con al massimo `limit` in parallelo. */
async function pool<T>(items: T[], limit: number, work: (item: T, index: number) => Promise<void>) {
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        await work(items[i], i)
      }
    })
  )
}

export default function PhotoLibrary({ authFetch }: { authFetch: AuthFetch }) {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [max, setMax] = useState(300)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [runs, setRuns] = useState<Run[]>([])
  const [carousels, setCarousels] = useState<Carousel[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number; failed: number } | null>(null)
  const [uploadErrors, setUploadErrors] = useState<string[]>([])
  const [filter, setFilter] = useState<'all' | 'unused' | 'used'>('all')
  const [shown, setShown] = useState(PAGE)
  const [selected, setSelected] = useState<Photo | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/admin/photo-library')
      if (!res.ok) throw new Error(await readError(res, 'Libreria non disponibile'))
      const data = await res.json()
      setPhotos(data.photos || [])
      setMax(data.max || 300)
      setSettings(data.settings)
      setRuns(data.runs || [])
      setCarousels(data.carousels || [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Libreria non disponibile')
    } finally {
      setLoaded(true)
    }
  }, [authFetch])

  useEffect(() => {
    load()
  }, [load])

  // Un carosello in preparazione o in pubblicazione: si ricarica ogni 20 secondi.
  const busyRemote = runs.some((r) => r.status === 'running') || carousels.some((c) => c.status === 'publishing')
  useEffect(() => {
    if (!busyRemote) return
    const timer = setInterval(load, 20_000)
    return () => clearInterval(timer)
  }, [busyRemote, load])

  const upload = async (files: File[]) => {
    const room = max - photos.length
    if (room <= 0) return setUploadErrors([`La libreria è piena (${max} foto): elimina quelle che non servono più.`])
    const list = files.slice(0, Math.min(room, MAX_SELECT))
    const errors: string[] = files.length > list.length ? [`Caricate solo le prime ${list.length} foto (massimo ${max} nella libreria).`] : []
    setUploadErrors([])
    const state = { done: 0, total: list.length, failed: 0 }
    setProgress({ ...state })
    const bump = (ok: boolean, message?: string) => {
      if (ok) state.done++
      else {
        state.failed++
        if (message) errors.push(message)
      }
      setProgress({ ...state })
    }
    for (let start = 0; start < list.length; start += BATCH) {
      const group = list.slice(start, start + BATCH)
      // Ridotte nel browser (lato lungo 2048 px, JPEG): poche alla volta per non riempire la memoria del telefono.
      const ready: UploadPhoto[] = []
      for (const file of group) {
        try {
          ready.push(await prepareUploadPhoto(file))
        } catch (e) {
          bump(false, e instanceof Error ? e.message : `${file.name}: non leggibile`)
        }
      }
      if (!ready.length) continue
      try {
        const res = await authFetch('/api/admin/photo-library/upload', {
          method: 'POST',
          body: JSON.stringify({ files: ready.map((p) => ({ fileName: p.name, type: 'image/jpeg', size: p.blob.size })) }),
        })
        if (!res.ok) throw new Error(await readError(res, 'Caricamento non disponibile'))
        const { uploads } = (await res.json()) as { uploads: { path: string; signedUrl: string }[] }
        const sent: { path: string; fileName: string; width: number; height: number }[] = []
        await pool(ready, PARALLEL, async (photo, i) => {
          try {
            await uploadToSignedUrl(uploads[i].signedUrl, photo.blob, photo.name)
            sent.push({ path: uploads[i].path, fileName: photo.name, width: photo.width, height: photo.height })
          } catch {
            bump(false, `${photo.name}: caricamento non riuscito`)
          }
        })
        if (!sent.length) continue
        const saved = await authFetch('/api/admin/photo-library', { method: 'POST', body: JSON.stringify({ items: sent }) })
        if (!saved.ok) throw new Error(await readError(saved, 'Foto non salvate'))
        const data = (await saved.json()) as { photos: Photo[]; errors: string[] }
        setPhotos((current) => [...data.photos, ...current])
        data.photos.forEach(() => bump(true))
        data.errors.forEach((message) => bump(false, message))
      } catch (e) {
        ready.forEach(() => bump(false))
        errors.push(e instanceof Error ? e.message : 'Caricamento non riuscito')
        if (/piena/i.test(String(e))) break
      }
    }
    setUploadErrors(errors.slice(0, 8))
    setProgress(null)
  }

  const removePhoto = async (photo: Photo) => {
    if (!confirm('Eliminare questa foto dalla libreria?')) return
    const res = await authFetch('/api/admin/photo-library', { method: 'DELETE', body: JSON.stringify({ ids: [photo.id] }) })
    if (!res.ok) return alert(await readError(res, 'Foto non eliminata'))
    setPhotos((current) => current.filter((p) => p.id !== photo.id))
    setSelected(null)
  }

  const saveNote = async (photo: Photo, note: string) => {
    const res = await authFetch('/api/admin/photo-library', { method: 'PATCH', body: JSON.stringify({ id: photo.id, note }) })
    if (!res.ok) return alert(await readError(res, 'Nota non salvata'))
    const data = await res.json()
    setPhotos((current) => current.map((p) => (p.id === photo.id ? data.photo : p)))
    setSelected(data.photo)
  }

  const carouselAction = async (c: Carousel, action: 'approve' | 'unschedule' | 'dismiss') => {
    const ask = { approve: 'Pubblicare questo carosello adesso?', unschedule: 'Annullare la programmazione? Il carosello resta tra le bozze.', dismiss: 'Non pubblicare questo carosello?' }[action]
    if (!confirm(ask)) return
    const res = await authFetch('/api/admin/photo-library/carousel', { method: 'POST', body: JSON.stringify({ id: c.id, action, base: c.urls }) })
    if (!res.ok) return alert(await readError(res, 'Operazione non riuscita'))
    load()
  }

  const unused = photos.filter((p) => !p.uses).length
  const visible = photos.filter((p) => (filter === 'unused' ? !p.uses : filter === 'used' ? p.uses > 0 : true))

  if (!loaded) return <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-[var(--text-secondary)]" /></div>
  if (error) return <p className="text-sm text-red-500">{error}</p>

  return (
    <div className="space-y-6">
      {carousels.length > 0 && (
        <div>
          <h3 className="flex items-center gap-2 mb-2 text-sm font-semibold text-[var(--text-primary)]">
            <CalendarClock className="w-4 h-4" /> Caroselli programmati e da approvare
          </h3>
          <div className="space-y-2">
            {carousels.map((c) => (
              <div key={c.id} className="flex gap-3 p-3 rounded-xl border border-[var(--border-color)] bg-[var(--card-background)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {c.urls[0] && <img src={c.urls[0]} alt="" loading="lazy" className="w-16 h-20 rounded-lg object-cover shrink-0" />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-[var(--text-primary)] truncate">{c.title}</p>
                  <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                    {c.needsApproval && c.status === 'draft'
                      ? 'Da approvare'
                      : c.status === 'publishing'
                        ? 'In pubblicazione…'
                        : c.scheduledAt
                          ? `Esce ${when(c.scheduledAt)}`
                          : ''}
                    {' · '}
                    {c.platforms.map((p) => (p === 'instagram' ? 'Instagram' : 'Facebook')).join(' e ')} · {c.urls.length} slide{c.origin === 'autopilot' ? ' · autopilota' : ''}
                  </p>
                  <p className="text-xs text-[var(--text-secondary)] mt-1 line-clamp-2">{c.caption}</p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {c.needsApproval && c.status === 'draft' && (
                      <>
                        <button type="button" onClick={() => carouselAction(c, 'approve')} className={secondary}>
                          <Check className="w-4 h-4" /> Approva e pubblica
                        </button>
                        <button type="button" onClick={() => carouselAction(c, 'dismiss')} className={secondary}>
                          <X className="w-4 h-4" /> Non pubblicare
                        </button>
                      </>
                    )}
                    {c.status === 'scheduled' && (
                      <button type="button" onClick={() => carouselAction(c, 'unschedule')} className={secondary}>
                        <X className="w-4 h-4" /> Annulla programmazione
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {settings && <AutopilotSettings settings={settings} runs={runs} photoCount={photos.length} authFetch={authFetch} onSaved={setSettings} onStarted={load} />}

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <p className="text-sm text-[var(--text-secondary)]">
            {photos.length}/{max} foto · {unused} mai usate
          </p>
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*,.heic,.heif"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files || [])
                e.target.value = ''
                if (files.length) upload(files)
              }}
            />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={!!progress || photos.length >= max} className={primary}>
              {progress ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />} Carica foto
            </button>
          </div>
        </div>

        {progress && (
          <div className="mb-3">
            <div className="h-2 rounded-full bg-[var(--background-secondary)] overflow-hidden">
              <div className="h-full bg-[var(--accent-blue)] transition-all" style={{ width: `${Math.round(((progress.done + progress.failed) / Math.max(1, progress.total)) * 100)}%` }} />
            </div>
            <p className="text-xs text-[var(--text-secondary)] mt-1">
              Carico {progress.done + progress.failed}/{progress.total}…{progress.failed ? ` (${progress.failed} non riuscite)` : ''} Non chiudere la pagina.
            </p>
          </div>
        )}
        {uploadErrors.length > 0 && (
          <ul className="mb-3 text-xs text-red-500 space-y-0.5">
            {uploadErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}

        {photos.length > 0 && (
          <div className="flex gap-2 mb-3">
            {(
              [
                ['all', `Tutte (${photos.length})`],
                ['unused', `Mai usate (${unused})`],
                ['used', `Usate (${photos.length - unused})`],
              ] as const
            ).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setFilter(key)} className={chip(filter === key)}>
                {label}
              </button>
            ))}
          </div>
        )}

        {photos.length === 0 ? (
          <p className="text-sm text-[var(--text-secondary)] py-6 text-center">
            Nessuna foto ancora. Caricane tante (anche 50 o 100 insieme): l’autopilota ne sceglierà alcune ogni giorno per creare i caroselli.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
              {visible.slice(0, shown).map((p) => (
                <button key={p.id} type="button" onClick={() => setSelected(p)} className={`relative aspect-square rounded-lg overflow-hidden ${selected?.id === p.id ? 'ring-2 ring-[var(--accent-blue)]' : ''}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.note || p.fileName} loading="lazy" className="w-full h-full object-cover" />
                  <span className={`absolute bottom-1 left-1 px-1.5 py-0.5 rounded text-[10px] ${p.uses ? 'bg-black/60 text-white' : 'bg-green-600 text-white'}`}>{p.uses ? `usata ${p.uses}×` : 'nuova'}</span>
                </button>
              ))}
            </div>
            {visible.length > shown && (
              <button type="button" onClick={() => setShown((n) => n + PAGE)} className={`${secondary} mt-3`}>
                Mostra altre ({visible.length - shown})
              </button>
            )}
          </>
        )}

        {selected && <PhotoDetail key={selected.id} photo={selected} onClose={() => setSelected(null)} onSave={saveNote} onDelete={removePhoto} />}
      </div>
    </div>
  )
}

function PhotoDetail({ photo, onClose, onSave, onDelete }: { photo: Photo; onClose: () => void; onSave: (p: Photo, note: string) => Promise<unknown>; onDelete: (p: Photo) => Promise<unknown> }) {
  const [note, setNote] = useState(photo.note || '')
  const [busy, setBusy] = useState(false)
  return (
    <div className="mt-3 p-3 rounded-xl border border-[var(--border-color)] bg-[var(--card-background)] flex flex-col sm:flex-row gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={photo.url} alt="" className="w-full sm:w-48 max-h-64 rounded-lg object-contain bg-black/5" />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs text-[var(--text-secondary)]">
            {photo.uses ? `Usata ${photo.uses} ${photo.uses === 1 ? 'volta' : 'volte'}${photo.lastUsedAt ? `, l’ultima ${when(photo.lastUsedAt)}` : ''}` : 'Mai usata'} · caricata {when(photo.createdAt)}
          </p>
          <button type="button" onClick={onClose} aria-label="Chiudi" className="p-1 text-[var(--text-secondary)]">
            <X className="w-4 h-4" />
          </button>
        </div>
        {photo.description && <p className="text-xs text-[var(--text-secondary)]">L’AI ci vede: {photo.description}</p>}
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} placeholder="Nota per l’AI (facoltativa): es. «sito per il ristorante Da Mario, consegnato a ottobre»" className={`${input} resize-y`} />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || note === (photo.note || '')}
            onClick={async () => {
              setBusy(true)
              await onSave(photo, note)
              setBusy(false)
            }}
            className={secondary}
          >
            <Save className="w-4 h-4" /> Salva nota
          </button>
          <button type="button" onClick={() => onDelete(photo)} className={secondary}>
            <Trash2 className="w-4 h-4" /> Elimina
          </button>
        </div>
      </div>
    </div>
  )
}

function AutopilotSettings({
  settings,
  runs,
  photoCount,
  authFetch,
  onSaved,
  onStarted,
}: {
  settings: Settings
  runs: Run[]
  photoCount: number
  authFetch: AuthFetch
  onSaved: (s: Settings) => void
  onStarted: () => void
}) {
  const [draft, setDraft] = useState<Settings>(settings)
  const [saving, setSaving] = useState(false)
  const [starting, setStarting] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => setDraft(settings), [settings])
  const changed = FIELDS.some((k) => JSON.stringify(draft[k]) !== JSON.stringify(settings[k]))
  const set = (patch: Partial<Settings>) => setDraft((d) => ({ ...d, ...patch }))

  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const res = await authFetch('/api/admin/photo-library/autopilot', {
        method: 'PUT',
        body: JSON.stringify({ enabled: draft.enabled, days: draft.days, times: draft.times, minPhotos: draft.minPhotos, maxPhotos: draft.maxPhotos, topic: draft.topic, platforms: draft.platforms, confirm: draft.confirm }),
      })
      if (!res.ok) throw new Error(await readError(res, 'Impostazioni non salvate'))
      const data = await res.json()
      onSaved(data.settings)
      setMessage({ ok: true, text: 'Salvato.' })
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : 'Impostazioni non salvate' })
    } finally {
      setSaving(false)
    }
  }

  const tryNow = async () => {
    if (!confirm(draft.confirm ? 'Preparo subito un carosello con le foto della libreria: resterà da approvare. Procedo?' : 'Preparo e PUBBLICO subito un carosello con le foto della libreria. Procedo?')) return
    setStarting(true)
    setMessage(null)
    try {
      const res = await authFetch('/api/admin/photo-library/autopilot', { method: 'POST' })
      if (!res.ok) throw new Error(await readError(res, 'Avvio non riuscito'))
      setMessage({ ok: true, text: 'Avviato: tra qualche minuto arriva una notifica con l’esito.' })
      onStarted()
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : 'Avvio non riuscito' })
    } finally {
      setStarting(false)
    }
  }

  const setCount = (n: number) => {
    const times = [...draft.times]
    const defaults = ['09:30', '13:00', '18:00']
    while (times.length < n) times.push(defaults.find((t) => !times.includes(t)) || '18:00')
    set({ times: times.slice(0, n) })
  }
  const photoOptions = Array.from({ length: 8 }, (_, i) => i + 2)

  return (
    <div className="p-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-background)] space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
          <Bot className="w-4 h-4" /> Autopilota caroselli
        </h3>
        <label className="flex items-center gap-2 text-sm text-[var(--text-primary)] cursor-pointer">
          <input type="checkbox" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="w-4 h-4" />
          {draft.enabled ? 'Acceso' : 'Spento'}
        </label>
      </div>
      <p className="text-xs text-[var(--text-secondary)]">
        Nei giorni e alle ore scelti l’AI prende alcune foto della libreria (prima quelle mai usate, evitando quelle usate negli ultimi 14 giorni), scrive i testi e pubblica il carosello.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {DAY_ORDER.map((d) => (
          <button key={d} type="button" onClick={() => set({ days: draft.days.includes(d) ? draft.days.filter((x) => x !== d) : [...draft.days, d].sort() })} className={chip(draft.days.includes(d))}>
            {DAYS[d]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-[var(--text-secondary)]">
          Post al giorno
          <select value={draft.times.length} onChange={(e) => setCount(Number(e.target.value))} className={`${input} mt-1 w-24`}>
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {draft.times.map((t, i) => (
          <label key={i} className="text-xs text-[var(--text-secondary)]">
            Ora {draft.times.length > 1 ? i + 1 : ''}
            <input type="time" value={t} onChange={(e) => set({ times: draft.times.map((x, k) => (k === i ? e.target.value : x)) })} className={`${input} mt-1 w-32`} />
          </label>
        ))}
        <label className="text-xs text-[var(--text-secondary)]">
          Foto per carosello
          <span className="flex items-center gap-1 mt-1">
            <select value={draft.minPhotos} onChange={(e) => set({ minPhotos: Number(e.target.value), maxPhotos: Math.max(draft.maxPhotos, Number(e.target.value)) })} className={`${input} w-20`}>
              {photoOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            –
            <select value={draft.maxPhotos} onChange={(e) => set({ maxPhotos: Number(e.target.value), minPhotos: Math.min(draft.minPhotos, Number(e.target.value)) })} className={`${input} w-20`}>
              {photoOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </span>
        </label>
      </div>
      <p className="text-xs text-[var(--text-secondary)]">Ora italiana. Ogni carosello ha in più una slide finale con l’invito a contattarci (Instagram: massimo 10 immagini).</p>

      <textarea
        value={draft.topic}
        onChange={(e) => set({ topic: e.target.value })}
        rows={2}
        maxLength={400}
        placeholder="Argomento e tono dei testi (es. «i nostri lavori per ristoranti e hotel, tono amichevole e concreto»). Vuoto = decide l’AI guardando le foto."
        className={`${input} resize-y`}
      />

      <div className="flex flex-wrap items-center gap-2">
        {(['instagram', 'facebook'] as const).map((p) => {
          const Icon = p === 'instagram' ? Instagram : Facebook
          const on = draft.platforms.includes(p)
          return (
            <button key={p} type="button" onClick={() => set({ platforms: on ? draft.platforms.filter((x) => x !== p) : [...draft.platforms, p] })} className={`${chip(on)} flex items-center gap-1.5`}>
              <Icon className="w-3.5 h-3.5" /> {p === 'instagram' ? 'Instagram' : 'Facebook'}
            </button>
          )
        })}
        <label className="flex items-center gap-2 text-sm text-[var(--text-primary)] ml-1 cursor-pointer">
          <input type="checkbox" checked={draft.confirm} onChange={(e) => set({ confirm: e.target.checked })} className="w-4 h-4" />
          Chiedi conferma prima di pubblicare
        </label>
      </div>

      {draft.enabled && photoCount < draft.minPhotos && <p className="text-xs text-red-500">Servono almeno {draft.minPhotos} foto nella libreria: ora ce ne sono {photoCount}.</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} disabled={saving || !changed || !draft.days.length || !draft.platforms.length} className={primary}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salva
        </button>
        <button type="button" onClick={tryNow} disabled={starting || photoCount < 2} className={secondary}>
          {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} Prova ora
        </button>
        {message && <span className={`text-xs ${message.ok ? 'text-green-600' : 'text-red-500'}`}>{message.text}</span>}
      </div>

      {runs.length > 0 && (
        <div className="pt-2 border-t border-[var(--border-color)]">
          <p className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-secondary)] mb-1">
            <Images className="w-3.5 h-3.5" /> Ultimi caroselli dell’autopilota
          </p>
          <ul className="space-y-1">
            {runs.slice(0, 6).map((r) => (
              <li key={r.key} className="text-xs text-[var(--text-primary)]">
                <span className={r.status === 'error' ? 'text-red-500' : r.status === 'published' ? 'text-green-600' : 'text-[var(--text-secondary)]'}>{RUN_LABEL[r.status]}</span> · {when(r.startedAt)}
                {r.title ? ` · «${r.title}»` : ''}
                {r.note ? <span className="text-[var(--text-secondary)]"> · {r.note}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

