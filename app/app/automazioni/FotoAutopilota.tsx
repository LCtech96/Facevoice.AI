'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { CalendarClock, Check, ImagePlus, Loader2, PencilLine, Trash2, X } from 'lucide-react'
import { useWorkspace } from '@/components/app/WorkspaceContext'
import { WEEKDAYS } from '@/lib/automations-shared'
import { looksLikeImage, prepareJpeg } from '@/lib/client-image'
import { AUTOPILOT_MAX_TIMES, AUTOPILOT_MAX_TOPIC, CAROUSEL_MAX, CAROUSEL_MIN, LIBRARY_MAX_SIDE } from '@/lib/saas/photo-library-shared'

// Autopilota foto: la Libreria foto (fino a 200 foto, ridotte nel browser e caricate
// direttamente nell'archivio, a gruppi e in parallelo) e le impostazioni con cui l'AI, nei
// giorni e agli orari scelti, sceglie da sola alcune foto e pubblica un carosello.

type Platform = 'instagram' | 'facebook'
type Photo = { id: string; url: string; note: string; described: boolean; uses: number; lastUsedAt: string | null; addedAt: string }
type Settings = { active: boolean; days: number[]; times: string[]; minPhotos: number; maxPhotos: number; topic: string; platforms: Platform[]; confirm: boolean }
type LogEntry = {
  slot: string
  slotAt: string
  at: string
  status: 'scheduled' | 'draft' | 'failed' | 'skipped'
  postId?: string
  note?: string
  post?: { id: string; status: string; title: string | null; media: string[]; publish_at: string | null } | null
}
type Data = {
  photos: Photo[]
  max: number
  batch: number
  autopilot: { settings: Settings; nextRun: string | null; running: boolean; log: LogEntry[]; connected: Platform[] }
  canManage: boolean
}
type Notice = { text: string; tone: 'ok' | 'warn' | 'error' }

const API = '/api/app/automations/photos'
const DEFAULT_TIMES = ['18:00', '12:30', '09:00']
const PLATFORM_LABEL: Record<Platform, string> = { instagram: 'Instagram', facebook: 'Facebook' }
const chip = (on: boolean) =>
  `rounded-full border px-3 py-1.5 text-sm ${on ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)] text-white' : 'border-[var(--border-color)] text-[var(--text-primary)]'}`
const pick = (s: Settings): Settings => ({ active: s.active, days: s.days, times: s.times, minPhotos: s.minPhotos, maxPhotos: s.maxPhotos, topic: s.topic, platforms: s.platforms, confirm: s.confirm })
const whenLabel = (iso: string) => new Date(iso).toLocaleString('it-IT', { timeZone: 'Europe/Rome', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })

/** Carica un file con l'indirizzo firmato (PUT diretto nell'archivio). */
function putFile(url: string, blob: Blob, contentType: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', contentType)
    xhr.setRequestHeader('x-upsert', 'false')
    xhr.setRequestHeader('cache-control', 'max-age=31536000')
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`caricamento non riuscito (${xhr.status})`)))
    xhr.onerror = () => reject(new Error('connessione interrotta'))
    xhr.send(blob)
  })
}

/** Esegue i lavori con al massimo `limit` insieme. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items]
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) await fn(next)
  }))
}

export default function FotoAutopilota() {
  const { appFetch, assistant } = useWorkspace()
  const [data, setData] = useState<Data | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [draft, setDraft] = useState<Settings | null>(null)
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; failed: number } | null>(null)
  const [filter, setFilter] = useState<'all' | 'unused' | 'used'>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const apply = useCallback((body: Data | null, resetDraft = false) => {
    if (!body?.autopilot) return
    setData(body)
    if (resetDraft) setDraft(pick(body.autopilot.settings))
  }, [])

  const load = useCallback(async () => {
    const res = await appFetch(API).catch(() => null)
    const body = res ? await res.json().catch(() => null) : null
    if (res?.ok && body) {
      setLoadError(null)
      setData(body)
      setDraft((d) => d ?? pick(body.autopilot.settings))
    } else setLoadError(body?.error || 'Libreria foto non disponibile, riprova.')
  }, [appFetch])

  useEffect(() => {
    load()
  }, [load])

  const post = async (payload: Record<string, unknown>) => {
    const res = await appFetch(API, { method: 'POST', body: JSON.stringify(payload) }).catch(() => null)
    const body = res ? await res.json().catch(() => null) : null
    return { ok: Boolean(res?.ok), body }
  }

  // --- Caricamento: riduzione nel browser, indirizzi firmati a gruppi, 4 caricamenti insieme ---
  const upload = async (files: FileList | null) => {
    if (!files?.length || !data || progress) return
    const room = data.max - data.photos.length
    const chosen = Array.from(files).filter(looksLikeImage)
    if (!chosen.length) return
    if (room <= 0) {
      setNotice({ text: `La libreria è piena (${data.max} foto): togline qualcuna prima.`, tone: 'error' })
      return
    }
    const list = chosen.slice(0, room)
    const errors: string[] = []
    if (chosen.length > room) errors.push(`${chosen.length - room} foto non caricate: la libreria tiene al massimo ${data.max} foto`)
    setNotice(null)
    setProgress({ done: 0, total: list.length, failed: 0 })
    let added = 0
    let latest: Data | null = null
    for (let start = 0; start < list.length; start += data.batch) {
      const group = list.slice(start, start + data.batch)
      // Riduzione (lato lungo 2048 px, JPEG): le HEIC si convertono dove il browser le apre.
      const prepared: { blob: Blob }[] = []
      for (const file of group) {
        try {
          prepared.push(await prepareJpeg(file, LIBRARY_MAX_SIDE))
        } catch (e) {
          errors.push(`${(file as File).name || 'foto'}: ${e instanceof Error ? e.message : 'non leggibile'}`)
          setProgress((p) => p && { ...p, done: p.done + 1, failed: p.failed + 1 })
        }
      }
      if (!prepared.length) continue
      const urls = await post({ action: 'upload_urls', files: prepared.map((p) => ({ type: 'image/jpeg', size: p.blob.size })) })
      if (!urls.ok) {
        errors.push(urls.body?.error || 'caricamento non preparato')
        setProgress((p) => p && { ...p, done: p.done + prepared.length, failed: p.failed + prepared.length })
        break
      }
      const uploads = urls.body.uploads as { uploadUrl: string; url: string; contentType: string }[]
      const done: string[] = []
      await pool(
        prepared.map((p, k) => ({ p, u: uploads[k] })),
        4,
        async ({ p, u }) => {
          try {
            await putFile(u.uploadUrl, p.blob, u.contentType)
            done.push(u.url)
          } catch (e) {
            errors.push(e instanceof Error ? e.message : 'caricamento non riuscito')
            setProgress((x) => x && { ...x, failed: x.failed + 1 })
          }
          setProgress((x) => x && { ...x, done: x.done + 1 })
        }
      )
      if (!done.length) continue
      const saved = await post({ action: 'add', items: done.map((url) => ({ url })) })
      if (saved.ok) {
        added += saved.body.added || 0
        latest = saved.body
        for (const s of saved.body.skipped || []) if (s.reason) errors.push(s.reason)
      } else errors.push(saved.body?.error || 'foto non registrate')
    }
    if (latest) apply(latest)
    setProgress(null)
    if (fileRef.current) fileRef.current.value = ''
    const unique = [...new Set(errors)]
    setNotice({
      text: `${added} ${added === 1 ? 'foto aggiunta' : 'foto aggiunte'} alla libreria.${unique.length ? ` Problemi: ${unique.slice(0, 4).join(' · ')}${unique.length > 4 ? '…' : ''}` : ''}`,
      tone: unique.length ? (added ? 'warn' : 'error') : 'ok',
    })
  }

  const remove = async (photo: Photo) => {
    if (busy || !confirm(photo.uses ? 'Togliere questa foto dalla libreria? I caroselli già fatti restano come sono.' : 'Togliere questa foto dalla libreria?')) return
    setBusy(photo.id)
    const { ok, body } = await post({ action: 'remove', ids: [photo.id] })
    setBusy(null)
    if (ok) apply(body)
    else setNotice({ text: body?.error || 'Foto non tolta, riprova.', tone: 'error' })
  }

  const editNote = async (photo: Photo) => {
    const note = prompt('Nota per l’AI su questa foto (es. «sala interna», «piatto del giorno»):', photo.note)
    if (note === null || busy) return
    setBusy(photo.id)
    const { ok, body } = await post({ action: 'note', id: photo.id, note })
    setBusy(null)
    if (ok) apply(body)
    else setNotice({ text: body?.error || 'Nota non salvata, riprova.', tone: 'error' })
  }

  const save = async (next: Settings) => {
    setSaving(true)
    setNotice(null)
    const { ok, body } = await post({ action: 'settings', ...next })
    setSaving(false)
    if (!ok) {
      setNotice({ text: body?.error || 'Non salvato, riprova.', tone: 'error' })
      return
    }
    apply(body, true)
    const s = body.autopilot.settings as Settings
    setNotice({
      text: s.active ? `Autopilota attivo.${body.nextRun ? ` Prossimo carosello: ${whenLabel(body.nextRun)}.` : ''}` : 'Impostazioni salvate: l’autopilota è spento.',
      tone: 'ok',
    })
  }

  const decide = async (entry: LogEntry, action: 'approve' | 'discard') => {
    if (!entry.postId || busy) return
    if (action === 'discard' && !confirm('Scartare questo carosello? Non verrà pubblicato.')) return
    setBusy(entry.postId)
    const { ok, body } = await post({ action, postId: entry.postId })
    setBusy(null)
    if (!ok) {
      setNotice({ text: body?.error || 'Non riuscito, riprova.', tone: 'error' })
      return
    }
    apply(body)
    setNotice({ text: action === 'approve' ? `Carosello programmato per ${whenLabel(body.post.publish_at)}.` : 'Carosello scartato.', tone: 'ok' })
  }

  if (!data || !draft) {
    return loadError ? (
      <div className="py-10 text-center">
        <p className="text-[var(--text-secondary)]">{loadError}</p>
        <button onClick={load} className="mt-4 rounded-full bg-[var(--accent-blue)] px-5 py-2 font-semibold text-white">
          Riprova
        </button>
      </div>
    ) : (
      <Loader2 className="h-5 w-5 animate-spin text-[var(--text-secondary)]" />
    )
  }

  const { photos, canManage } = data
  const ap = data.autopilot
  const unused = photos.filter((p) => !p.uses).length
  const shown = photos.filter((p) => (filter === 'unused' ? !p.uses : filter === 'used' ? p.uses > 0 : true))
  const set = (patch: Partial<Settings>) => setDraft((d) => (d ? { ...d, ...patch } : d))
  const changed = JSON.stringify(draft) !== JSON.stringify(pick(ap.settings))
  const perDay = draft.times.length
  const setPerDay = (n: number) => set({ times: Array.from({ length: n }, (_, k) => draft.times[k] || DEFAULT_TIMES.find((t) => !draft.times.includes(t)) || DEFAULT_TIMES[k]) })

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--text-secondary)]">
        Carica le tue foto (anche 50 o 100 insieme). Nei giorni e agli orari che scegli l’AI ne sceglie alcune, scrive i testi delle slide, la didascalia e gli hashtag con
        il tono delle tue Istruzioni e pubblica il carosello da sola.
      </p>

      {notice && <p className={`text-sm ${notice.tone === 'error' ? 'text-[#FF3B30]' : notice.tone === 'warn' ? 'text-[#FF9500]' : 'text-[#34C759]'}`}>{notice.text}</p>}

      {/* --- Autopilota --- */}
      <section className="space-y-3 rounded-2xl border border-[var(--border-color)] bg-[var(--background-secondary)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold">Autopilota</h2>
            <p className="text-sm text-[var(--text-secondary)]">
              {ap.settings.active ? (ap.nextRun ? `Attivo · prossimo carosello ${whenLabel(ap.nextRun)}` : 'Attivo') : 'Spento'}
              {ap.running ? ' · sto preparando un carosello…' : ''}
            </p>
          </div>
          {canManage && (
            <label className="flex shrink-0 items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={draft.active} onChange={(e) => set({ active: e.target.checked })} className="h-5 w-5 accent-[var(--accent-blue)]" /> Attivo
            </label>
          )}
        </div>

        <fieldset disabled={!canManage || saving} className="space-y-3">
          <div>
            <p className="mb-1.5 text-sm font-semibold">Giorni</p>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((w) => {
                const on = !draft.days.length || draft.days.includes(w.day)
                return (
                  <button
                    key={w.day}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      const all = draft.days.length ? draft.days : WEEKDAYS.map((x) => x.day)
                      const next = on ? all.filter((d) => d !== w.day) : [...all, w.day]
                      if (next.length) set({ days: next.length === 7 ? [] : next })
                    }}
                    className={`${chip(on)} min-w-[2.75rem] px-2`}
                  >
                    {w.short}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block font-semibold">Post al giorno</span>
              <select value={perDay} onChange={(e) => setPerDay(Number(e.target.value))} className="rounded-lg border border-[var(--border-color)] bg-[var(--background)] px-2 py-1.5">
                {Array.from({ length: AUTOPILOT_MAX_TIMES }, (_, k) => k + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            {draft.times.map((t, k) => (
              <label key={k} className="text-sm">
                <span className="mb-1 block font-semibold">{perDay > 1 ? `Ora ${k + 1}` : 'Ora'}</span>
                <input
                  type="time"
                  value={t}
                  onChange={(e) => set({ times: draft.times.map((x, j) => (j === k ? e.target.value : x)) })}
                  className="rounded-lg border border-[var(--border-color)] bg-[var(--background)] px-2 py-1.5"
                />
              </label>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block font-semibold">Foto per carosello: da</span>
              <select value={draft.minPhotos} onChange={(e) => set({ minPhotos: Number(e.target.value), maxPhotos: Math.max(draft.maxPhotos, Number(e.target.value)) })} className="rounded-lg border border-[var(--border-color)] bg-[var(--background)] px-2 py-1.5">
                {Array.from({ length: CAROUSEL_MAX - CAROUSEL_MIN + 1 }, (_, k) => k + CAROUSEL_MIN).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-semibold">a</span>
              <select value={draft.maxPhotos} onChange={(e) => set({ maxPhotos: Number(e.target.value), minPhotos: Math.min(draft.minPhotos, Number(e.target.value)) })} className="rounded-lg border border-[var(--border-color)] bg-[var(--background)] px-2 py-1.5">
                {Array.from({ length: CAROUSEL_MAX - CAROUSEL_MIN + 1 }, (_, k) => k + CAROUSEL_MIN).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block font-semibold">Argomento e tono</span>
            <textarea
              value={draft.topic}
              maxLength={AUTOPILOT_MAX_TOPIC}
              rows={3}
              onChange={(e) => set({ topic: e.target.value })}
              placeholder="Es. «le nostre camere e la colazione, tono caldo e accogliente, invita a prenotare in Direct»"
              className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--background)] px-3 py-2"
            />
          </label>

          <div>
            <p className="mb-1.5 text-sm font-semibold">Dove pubblicare</p>
            {ap.connected.length ? (
              <div className="flex flex-wrap gap-1.5">
                {ap.connected.map((p) => {
                  const on = draft.platforms.includes(p)
                  return (
                    <button key={p} type="button" aria-pressed={on} onClick={() => set({ platforms: on ? draft.platforms.filter((x) => x !== p) : [...draft.platforms, p] })} className={chip(on)}>
                      {PLATFORM_LABEL[p]}
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm text-[var(--text-secondary)]">
                Nessun social collegato.{' '}
                <Link href="/app/canali" className="font-semibold text-[var(--accent-blue)]">
                  Collega Instagram o Facebook
                </Link>
              </p>
            )}
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={draft.confirm} onChange={(e) => set({ confirm: e.target.checked })} className="mt-0.5 h-4 w-4 accent-[var(--accent-blue)]" />
            <span>
              <b>Chiedi conferma prima di pubblicare</b>
              <span className="block text-[var(--text-secondary)]">Il carosello resta in bozza e ti avvisiamo per email: esce solo quando lo programmi tu.</span>
            </span>
          </label>

          {canManage && (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => save(draft)} disabled={!changed || saving} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-blue)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Salva
              </button>
              {changed && (
                <button onClick={() => setDraft(pick(ap.settings))} disabled={saving} className="rounded-full border border-[var(--border-color)] px-4 py-2 text-sm">
                  Annulla
                </button>
              )}
            </div>
          )}
        </fieldset>
      </section>

      {/* --- Ultimi caroselli --- */}
      {ap.log.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-bold">Ultimi caroselli</h2>
          {ap.log.map((e) => {
            const p = e.post
            const draftNow = e.status === 'draft' && p?.status === 'draft'
            const label =
              p?.status === 'published'
                ? 'Pubblicato'
                : p?.status === 'scheduled'
                ? `Programmato · ${whenLabel(p.publish_at || e.slotAt)}`
                : p?.status === 'cancelled'
                ? 'Scartato'
                : p?.status === 'failed'
                ? 'Pubblicazione non riuscita'
                : draftNow
                ? 'Da controllare'
                : e.status === 'failed'
                ? 'Non preparato'
                : e.status === 'skipped'
                ? 'Saltato'
                : 'Preparato'
            return (
              <div key={`${e.slot}-${e.at}`} className="rounded-2xl border border-[var(--border-color)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-semibold">{whenLabel(e.slotAt)}</span>
                  <span className={draftNow ? 'font-semibold text-[#FF9500]' : e.status === 'failed' || p?.status === 'failed' ? 'text-[#FF3B30]' : 'text-[var(--text-secondary)]'}>{label}</span>
                </div>
                {e.note && e.status !== 'draft' && <p className="mt-1 text-xs text-[var(--text-secondary)]">{e.note}</p>}
                {p && p.media.length > 0 && (
                  <div className="mt-2 flex gap-1.5 overflow-x-auto">
                    {p.media.map((url) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={url} src={url} alt="" loading="lazy" className="h-24 w-20 shrink-0 rounded-md object-cover" />
                    ))}
                  </div>
                )}
                {p && (
                  <div className="mt-2 flex flex-wrap gap-2 text-sm">
                    {draftNow && canManage && (
                      <>
                        <button onClick={() => decide(e, 'approve')} disabled={busy === p.id} className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-blue)] px-3 py-1.5 font-semibold text-white disabled:opacity-50">
                          <CalendarClock className="h-4 w-4" /> Programma
                        </button>
                        <button onClick={() => decide(e, 'discard')} disabled={busy === p.id} className="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] px-3 py-1.5">
                          <X className="h-4 w-4" /> Scarta
                        </button>
                      </>
                    )}
                    {assistant === true && p.status !== 'cancelled' && (
                      <Link href={`/app/assistente?post=${p.id}`} className="inline-flex items-center gap-1 rounded-full border border-[var(--border-color)] px-3 py-1.5">
                        <PencilLine className="h-4 w-4" /> {p.status === 'published' ? 'Apri' : 'Modifica nell’Assistente'}
                      </Link>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </section>
      )}

      {/* --- Libreria --- */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold">Libreria foto</h2>
            <p className="text-sm text-[var(--text-secondary)]">
              {photos.length}/{data.max} foto · {unused} mai usate
            </p>
          </div>
          {canManage && (
            <>
              <input ref={fileRef} type="file" accept="image/*,.heic,.heif" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={Boolean(progress) || photos.length >= data.max}
                className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-blue)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {progress ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />} Carica foto
              </button>
            </>
          )}
        </div>
        {progress && (
          <div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--background-secondary)]">
              <div className="h-full bg-[var(--accent-blue)] transition-all" style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
            </div>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              Caricamento {progress.done}/{progress.total}
              {progress.failed ? ` · ${progress.failed} non riuscite` : ''}… non chiudere la pagina.
            </p>
          </div>
        )}
        {photos.length > 0 && (
          <div className="inline-flex rounded-full border border-[var(--border-color)] p-1 text-sm">
            {(
              [
                ['all', 'Tutte'],
                ['unused', 'Mai usate'],
                ['used', 'Usate'],
              ] as const
            ).map(([key, label]) => (
              <button key={key} onClick={() => setFilter(key)} className={`rounded-full px-3 py-1 ${filter === key ? 'bg-[var(--accent-blue)] font-semibold text-white' : 'text-[var(--text-secondary)]'}`}>
                {label}
              </button>
            ))}
          </div>
        )}
        {!photos.length ? (
          <p className="rounded-2xl border border-dashed border-[var(--border-color)] p-4 text-sm text-[var(--text-secondary)]">
            Nessuna foto ancora. Carica le foto della tua attività: l’AI le guarda una volta e le usa a rotazione, prima quelle mai usate.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
            {shown.map((p) => (
              <figure key={p.id} className="group relative overflow-hidden rounded-lg border border-[var(--border-color)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.note || ''} loading="lazy" className={`aspect-square w-full object-cover ${busy === p.id ? 'opacity-40' : ''}`} />
                <figcaption className="absolute inset-x-0 bottom-0 bg-black/55 px-1.5 py-0.5 text-[10px] text-white">
                  {p.uses ? `Usata ${p.uses} ${p.uses === 1 ? 'volta' : 'volte'}` : 'Mai usata'}
                  {p.note ? ` · ${p.note}` : ''}
                </figcaption>
                {canManage && (
                  <div className="absolute right-1 top-1 flex gap-1">
                    <button onClick={() => editNote(p)} aria-label="Nota" className="rounded-full bg-black/55 p-1 text-white">
                      <PencilLine className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => remove(p)} aria-label="Togli dalla libreria" className="rounded-full bg-black/55 p-1 text-white">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </figure>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
