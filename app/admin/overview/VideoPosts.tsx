'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Clapperboard, Facebook, Instagram, Loader2, Pencil, Send, Sparkles, Trash2, Upload, X, CalendarX } from 'lucide-react'

// Video per Instagram (Reel) e Facebook: caricamento diretto nello spazio di archiviazione,
// didascalia (a mano o con l'AI), "Pubblica ora" o "Programma". La pubblicazione la fa il
// server (anche con la pagina chiusa) e alla fine arriva una notifica con l'esito.

type AuthFetch = (url: string, init?: RequestInit) => Promise<Response>
type Platform = 'instagram' | 'facebook'

export type VideoPost = {
  id: string
  videoUrl: string
  fileName: string
  size: number
  caption: string
  platforms: Platform[]
  scheduledAt: string | null
  status: 'draft' | 'scheduled' | 'publishing' | 'published' | 'error'
  instagram?: { containerId?: string; id?: string; error?: string }
  facebook?: { id?: string; error?: string }
  publishedAt?: string
  createdAt: string
}

const MAX_MB = 200
const ACCEPT = 'video/mp4,video/quicktime,.mp4,.mov'
const STATUS_LABEL: Record<VideoPost['status'], string> = {
  draft: 'Bozza',
  scheduled: 'Programmato',
  publishing: 'In pubblicazione',
  published: 'Pubblicato',
  error: 'Non pubblicato',
}
const PLATFORM_LABEL: Record<Platform, string> = { instagram: 'Instagram Reel', facebook: 'Facebook' }

const input =
  'w-full px-3 py-2 bg-[var(--background-secondary)] border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-blue)]'
const primary = 'flex items-center gap-1.5 px-4 py-2 bg-[var(--accent-blue)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50'
const secondary =
  'flex items-center gap-1.5 px-4 py-2 border border-[var(--border-color)] rounded-lg text-sm text-[var(--text-primary)] hover:bg-[var(--background-secondary)] transition-colors disabled:opacity-50'

/** Data ISO → valore per <input type="datetime-local"> (ora locale). */
const toLocalInput = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : null)
const when = (iso: string) => new Date(iso).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' })

async function readError(res: Response, fallback: string) {
  const data = await res.json().catch(() => ({}))
  return (data?.error as string) || fallback
}

// ---------------------------------------------------------------------
// Didascalia con "Scrivi con AI" / "Modifica con AI"
// ---------------------------------------------------------------------

function CaptionEditor({ value, onChange, authFetch }: { value: string; onChange: (v: string) => void; authFetch: AuthFetch }) {
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const empty = !value.trim()
  const hashtags = (value.match(/(^|\s)#[\p{L}\p{N}_]+/gu) || []).length

  const runAI = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await authFetch('/api/admin/posts/videos/caption', { method: 'POST', body: JSON.stringify({ caption: value, instruction }) })
      if (!res.ok) throw new Error(await readError(res, 'L’AI non ha risposto, riprova'))
      const data = await res.json()
      onChange(data.caption || value)
      setInstruction('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'L’AI non ha risposto, riprova')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={5} maxLength={2200} placeholder="Didascalia del video..." className={`${input} resize-y`} />
      <p className={`text-xs ${hashtags > 5 ? 'text-red-500' : 'text-[var(--text-secondary)]'}`}>
        {value.length}/2200 caratteri · {hashtags} hashtag {hashtags > 5 ? '(Instagram ne accetta al massimo 5: quelli in più vengono tolti)' : '(massimo 5)'}
      </p>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy && (instruction.trim() || !empty)) {
              e.preventDefault()
              runAI()
            }
          }}
          placeholder={empty ? 'Di cosa parla il video? (es. dietro le quinte del nuovo sito per un ristorante)' : 'Cosa cambiare? (es. più corta, aggiungi hashtag, più ironica)'}
          className={input}
        />
        <button type="button" onClick={runAI} disabled={busy || (empty && !instruction.trim())} className={`${secondary} shrink-0 justify-center`}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {empty ? 'Scrivi con AI' : 'Modifica con AI'}
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}

function PlatformPicker({ value, onChange }: { value: Platform[]; onChange: (v: Platform[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {(['instagram', 'facebook'] as const).map((p) => {
        const Icon = p === 'instagram' ? Instagram : Facebook
        const on = value.includes(p)
        return (
          <button
            key={p}
            type="button"
            onClick={() => onChange(on ? value.filter((x) => x !== p) : [...value, p])}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
              on ? 'bg-[var(--accent-blue)] text-white border-[var(--accent-blue)]' : 'border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--background-secondary)]'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {PLATFORM_LABEL[p]}
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------
// Nuovo video: caricamento, didascalia, canali, quando
// ---------------------------------------------------------------------

type Uploaded = { path: string; fileName: string; preview: string }

function VideoComposer({ authFetch, onCreated, onClose }: { authFetch: AuthFetch; onCreated: (v: VideoPost) => void; onClose: () => void }) {
  const [uploaded, setUploaded] = useState<Uploaded | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [caption, setCaption] = useState('')
  const [platforms, setPlatforms] = useState<Platform[]>(['instagram', 'facebook'])
  const [scheduledAt, setScheduledAt] = useState('')
  const [saving, setSaving] = useState<'now' | 'schedule' | 'draft' | null>(null)
  const xhrRef = useRef<XMLHttpRequest | null>(null)

  useEffect(() => () => xhrRef.current?.abort(), [])

  /** Avviso (non blocca): Instagram preferisce video verticali 9:16, da 3 secondi a 15 minuti. */
  const checkShape = (url: string) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => {
      const notes: string[] = []
      if (v.videoWidth && v.videoHeight && Math.abs(v.videoWidth / v.videoHeight - 9 / 16) > 0.05) notes.push('non è verticale 9:16: su Instagram potrebbe comparire con bande o tagliato')
      if (v.duration && v.duration < 3) notes.push('dura meno di 3 secondi: Instagram non lo accetta')
      if (v.duration && v.duration > 15 * 60) notes.push('dura più di 15 minuti: Instagram non lo accetta come Reel')
      setWarning(notes.length ? `Il video ${notes.join('; ')}.` : null)
    }
    v.src = url
  }

  const pick = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    setWarning(null)
    const ext = file.name.toLowerCase().split('.').pop()
    if (!['video/mp4', 'video/quicktime'].includes(file.type) && !['mp4', 'mov'].includes(ext || '')) return setError('Formato non supportato: carica un video MP4 o MOV.')
    if (file.size > MAX_MB * 1024 * 1024) return setError(`Il video pesa ${Math.round(file.size / 1024 / 1024)} MB: il massimo è ${MAX_MB} MB.`)
    const preview = URL.createObjectURL(file)
    checkShape(preview)
    setProgress(0)
    try {
      const res = await authFetch('/api/admin/posts/videos/upload', { method: 'POST', body: JSON.stringify({ fileName: file.name, type: file.type, size: file.size }) })
      if (!res.ok) throw new Error(await readError(res, 'Caricamento non disponibile'))
      const { signedUrl, path, contentType } = await res.json()
      // Stesso formato del caricamento di Supabase, con la percentuale.
      const body = new FormData()
      body.append('cacheControl', '3600')
      body.append('', new File([file], file.name, { type: contentType }))
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhrRef.current = xhr
        xhr.open('PUT', signedUrl)
        xhr.setRequestHeader('x-upsert', 'false')
        xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100))
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) return resolve()
          const tooBig = xhr.status === 413 || /size|large/i.test(xhr.responseText)
          reject(new Error(tooBig ? 'Il video supera il limite di caricamento dello spazio di archiviazione.' : `Caricamento non riuscito (${xhr.status}): riprova.`))
        }
        xhr.onerror = () => reject(new Error('Caricamento interrotto: controlla la connessione e riprova.'))
        xhr.onabort = () => reject(new Error('Caricamento annullato.'))
        xhr.send(body)
      })
      setUploaded({ path, fileName: file.name, preview })
    } catch (e) {
      URL.revokeObjectURL(preview)
      setError(e instanceof Error ? e.message : 'Caricamento non riuscito.')
    } finally {
      setProgress(null)
      xhrRef.current = null
    }
  }

  const save = async (mode: 'now' | 'schedule' | 'draft') => {
    if (!uploaded) return
    if (mode === 'schedule' && !scheduledAt) return setError('Scegli data e ora.')
    setSaving(mode)
    setError(null)
    try {
      const res = await authFetch('/api/admin/posts/videos', {
        method: 'POST',
        body: JSON.stringify({
          path: uploaded.path,
          fileName: uploaded.fileName,
          caption,
          platforms,
          publishNow: mode === 'now',
          scheduledAt: mode === 'schedule' ? fromLocalInput(scheduledAt) : null,
        }),
      })
      if (!res.ok) throw new Error(await readError(res, 'Video non salvato'))
      const data = await res.json()
      onCreated(data.video)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Video non salvato')
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="mb-4 p-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-background)] space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-[var(--text-primary)]">Nuovo video</p>
        <button type="button" onClick={onClose} title="Chiudi" className="p-1.5 hover:bg-[var(--background-secondary)] rounded-lg">
          <X className="w-4 h-4 text-[var(--text-secondary)]" />
        </button>
      </div>

      {!uploaded ? (
        <label className={`flex flex-col items-center justify-center gap-2 p-6 rounded-lg border border-dashed border-[var(--border-color)] text-center ${progress === null ? 'cursor-pointer hover:bg-[var(--background-secondary)]' : ''}`}>
          {progress === null ? (
            <>
              <Upload className="w-6 h-6 text-[var(--text-secondary)]" />
              <span className="text-sm text-[var(--text-primary)]">Scegli un video MP4 o MOV</span>
              <span className="text-xs text-[var(--text-secondary)]">Massimo {MAX_MB} MB. Consigliato verticale 9:16, da 3 secondi a 15 minuti.</span>
              <input type="file" accept={ACCEPT} className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
            </>
          ) : (
            <>
              <Loader2 className="w-6 h-6 animate-spin text-[var(--accent-blue)]" />
              <span className="text-sm text-[var(--text-primary)]">Caricamento… {progress}%</span>
              <div className="w-full max-w-xs h-1.5 rounded-full bg-[var(--background-secondary)] overflow-hidden">
                <div className="h-full bg-[var(--accent-blue)]" style={{ width: `${progress}%` }} />
              </div>
              <button type="button" onClick={() => xhrRef.current?.abort()} className="text-xs text-[var(--text-secondary)] underline">
                Annulla
              </button>
            </>
          )}
        </label>
      ) : (
        <div className="flex gap-3 items-start">
          <video src={uploaded.preview} controls playsInline className="w-32 aspect-[9/16] rounded-lg bg-black object-contain shrink-0" />
          <div className="min-w-0 text-xs text-[var(--text-secondary)] space-y-1">
            <p className="text-sm text-[var(--text-primary)] break-all">{uploaded.fileName}</p>
            <p>Caricato.</p>
            <button
              type="button"
              onClick={() => {
                URL.revokeObjectURL(uploaded.preview)
                setUploaded(null)
                setWarning(null)
              }}
              className="underline"
            >
              Cambia video
            </button>
          </div>
        </div>
      )}
      {warning && <p className="text-xs text-amber-500">{warning}</p>}

      <CaptionEditor value={caption} onChange={setCaption} authFetch={authFetch} />
      <PlatformPicker value={platforms} onChange={setPlatforms} />
      <div>
        <label className="block text-xs text-[var(--text-secondary)] mb-1">Data e ora (per «Programma»)</label>
        <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className={input} />
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => save('now')} disabled={!uploaded || !platforms.length || !!saving} className={primary}>
          {saving === 'now' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Pubblica ora
        </button>
        <button type="button" onClick={() => save('schedule')} disabled={!uploaded || !platforms.length || !scheduledAt || !!saving} className={secondary}>
          {saving === 'schedule' && <Loader2 className="w-4 h-4 animate-spin" />} Programma
        </button>
        <button type="button" onClick={() => save('draft')} disabled={!uploaded || !platforms.length || !!saving} className={secondary}>
          {saving === 'draft' && <Loader2 className="w-4 h-4 animate-spin" />} Salva in bozza
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------
// Video nell'elenco dei post programmati
// ---------------------------------------------------------------------

function VideoCard({ video, authFetch, onChange, onRemoved }: { video: VideoPost; authFetch: AuthFetch; onChange: (v: VideoPost) => void; onRemoved: (id: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [caption, setCaption] = useState(video.caption)
  const [platforms, setPlatforms] = useState<Platform[]>(video.platforms)
  const [scheduledAt, setScheduledAt] = useState(toLocalInput(video.scheduledAt))
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const locked = video.status === 'publishing' || video.status === 'published'

  const patch = async (body: Record<string, unknown>, label: string) => {
    setBusy(label)
    setError(null)
    try {
      const res = await authFetch(`/api/admin/posts/videos/${video.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      if (!res.ok) throw new Error(await readError(res, 'Modifica non riuscita'))
      const data = await res.json()
      onChange(data.video)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Modifica non riuscita')
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    if (!confirm('Eliminare questo video?')) return
    setBusy('delete')
    setError(null)
    const res = await authFetch(`/api/admin/posts/videos/${video.id}`, { method: 'DELETE' })
    setBusy(null)
    if (res.ok) onRemoved(video.id)
    else setError(await readError(res, 'Eliminazione non riuscita'))
  }

  const startEdit = () => {
    setCaption(video.caption)
    setPlatforms(video.platforms)
    setScheduledAt(toLocalInput(video.scheduledAt))
    setEditing(true)
  }

  const errors = video.platforms.map((p) => video[p]?.error).filter(Boolean) as string[]
  const done = video.platforms.filter((p) => video[p]?.id)

  return (
    <div className="p-4 rounded-xl border border-[var(--border-color)] bg-[var(--card-background)]">
      <div className="flex gap-3 items-start">
        <video src={video.videoUrl} controls playsInline preload="metadata" className="w-24 sm:w-28 aspect-[9/16] rounded-lg bg-black object-contain shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border border-[var(--border-color)] text-[var(--text-secondary)]">
              <Clapperboard className="w-3 h-3" /> Video
            </span>
            {video.platforms.map((p) => {
              const Icon = p === 'instagram' ? Instagram : Facebook
              return (
                <span key={p} className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-full border border-[var(--border-color)] text-[var(--text-secondary)]">
                  <Icon className="w-3 h-3" /> {PLATFORM_LABEL[p]}
                </span>
              )
            })}
            <span
              className={`px-2 py-0.5 text-xs rounded-full ${
                video.status === 'published'
                  ? 'bg-green-500/10 text-green-500'
                  : video.status === 'error'
                    ? 'bg-red-500/10 text-red-500'
                    : video.status === 'draft'
                      ? 'bg-[var(--background-secondary)] text-[var(--text-secondary)]'
                      : 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]'
              }`}
            >
              {STATUS_LABEL[video.status]}
            </span>
          </div>

          {editing ? (
            <div className="space-y-3">
              <CaptionEditor value={caption} onChange={setCaption} authFetch={authFetch} />
              <PlatformPicker value={platforms} onChange={setPlatforms} />
              <div>
                <label className="block text-xs text-[var(--text-secondary)] mb-1">Data e ora (vuoto = resta in bozza)</label>
                <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className={input} />
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={!!busy || !platforms.length} onClick={() => patch({ caption, platforms, scheduledAt: fromLocalInput(scheduledAt) }, 'save')} className={primary}>
                  {busy === 'save' && <Loader2 className="w-4 h-4 animate-spin" />} Salva
                </button>
                <button type="button" onClick={() => setEditing(false)} className={secondary}>
                  Annulla
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap break-words">{video.caption || <span className="text-[var(--text-secondary)]">(nessuna didascalia)</span>}</p>
              <p className="text-xs text-[var(--text-secondary)] mt-1.5">
                {video.status === 'published' && video.publishedAt
                  ? `Pubblicato il ${when(video.publishedAt)}${done.length < video.platforms.length ? ` su ${done.map((p) => PLATFORM_LABEL[p]).join(' e ')}` : ''}`
                  : video.status === 'publishing'
                    ? `In pubblicazione${video.instagram?.containerId && !video.instagram.id && !video.instagram.error ? ': Instagram sta elaborando il Reel (di solito pochi minuti). Arriva una notifica con l’esito.' : '…'}`
                    : video.scheduledAt
                      ? `Esce il ${when(video.scheduledAt)}`
                      : `Bozza · caricato il ${when(video.createdAt)}`}
              </p>
              {errors.map((e) => (
                <p key={e} className="text-xs text-red-500 mt-1">
                  {e}
                </p>
              ))}
            </>
          )}
          {error && <p className="text-xs text-red-500 mt-1">{error}</p>}

          {!editing && (
            <div className="flex flex-wrap items-center gap-1 mt-2">
              {!locked && (
                <>
                  <button type="button" disabled={!!busy} onClick={() => confirm('Pubblicare adesso questo video?') && patch({ publishNow: true }, 'now')} className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-[var(--border-color)] text-[var(--text-primary)] hover:bg-[var(--background-secondary)] disabled:opacity-50">
                    {busy === 'now' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} {video.status === 'error' ? 'Riprova ora' : 'Pubblica ora'}
                  </button>
                  <button type="button" disabled={!!busy} onClick={startEdit} title="Modifica" className="p-1.5 hover:bg-[var(--background-secondary)] rounded-lg">
                    <Pencil className="w-4 h-4 text-[var(--text-secondary)]" />
                  </button>
                </>
              )}
              {video.status === 'scheduled' && (
                <button type="button" disabled={!!busy} onClick={() => patch({ scheduledAt: null }, 'unschedule')} title="Annulla programmazione (resta in bozza)" className="p-1.5 hover:bg-[var(--background-secondary)] rounded-lg">
                  <CalendarX className="w-4 h-4 text-[var(--text-secondary)]" />
                </button>
              )}
              {video.status !== 'publishing' && (
                <button type="button" disabled={!!busy} onClick={remove} title="Elimina" className="p-1.5 hover:bg-[var(--background-secondary)] rounded-lg">
                  <Trash2 className="w-4 h-4 text-[var(--text-secondary)]" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Pulsante "Nuovo video", modulo e video nell'elenco dei post programmati. */
export default function VideoPosts({ authFetch }: { authFetch: AuthFetch }) {
  const [videos, setVideos] = useState<VideoPost[]>([])
  const [showForm, setShowForm] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await authFetch('/api/admin/posts/videos')
      if (!res.ok) throw new Error(await readError(res, 'Video non disponibili'))
      setVideos((await res.json()).videos || [])
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Video non disponibili')
    }
  }, [authFetch])

  useEffect(() => {
    load()
  }, [load])

  // Mentre un video e' in pubblicazione (Reel in elaborazione) si aggiorna da solo.
  const publishing = videos.some((v) => v.status === 'publishing')
  useEffect(() => {
    if (!publishing) return
    const timer = setInterval(load, 20_000)
    return () => clearInterval(timer)
  }, [publishing, load])

  // Prima i programmati (dal piu' vicino), poi gli altri dal piu' recente.
  const sorted = [...videos].sort((a, b) => {
    const rank = (v: VideoPost) => (v.status === 'publishing' ? 0 : v.status === 'scheduled' ? 1 : v.status === 'draft' ? 2 : 3)
    if (rank(a) !== rank(b)) return rank(a) - rank(b)
    if (rank(a) === 1) return Date.parse(a.scheduledAt || '') - Date.parse(b.scheduledAt || '')
    return Date.parse(b.publishedAt || b.createdAt) - Date.parse(a.publishedAt || a.createdAt)
  })
  const replace = (v: VideoPost) => setVideos((list) => (list.some((x) => x.id === v.id) ? list.map((x) => (x.id === v.id ? v : x)) : [v, ...list]))

  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <button type="button" onClick={() => setShowForm(!showForm)} className={primary}>
          <Clapperboard className="w-4 h-4" /> Nuovo video
        </button>
        <span className="text-xs text-[var(--text-secondary)]">Reel su Instagram e video su Facebook: partono da soli all’ora scelta.</span>
      </div>
      {showForm && (
        <VideoComposer
          authFetch={authFetch}
          onClose={() => setShowForm(false)}
          onCreated={(v) => {
            replace(v)
            setShowForm(false)
          }}
        />
      )}
      {loadError && <p className="text-xs text-red-500 mb-2">{loadError}</p>}
      <div className="space-y-2">
        {sorted.map((v) => (
          <VideoCard key={`${v.id}-${v.status}-${v.scheduledAt}`} video={v} authFetch={authFetch} onChange={replace} onRemoved={(id) => setVideos((list) => list.filter((x) => x.id !== id))} />
        ))}
      </div>
    </div>
  )
}
