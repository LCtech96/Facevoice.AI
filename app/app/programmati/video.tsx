'use client'

import { useEffect, useRef, useState } from 'react'
import { CalendarClock, Check, Facebook, Film, Instagram, Loader2, Send, Sparkles, Trash2, X } from 'lucide-react'
import { useWorkspace } from '@/components/app/WorkspaceContext'
import { looksLikeVideo, VIDEO_MAX_MB } from '@/lib/saas/video-shared'

// Post video in Contenuti programmati: "Carica video" (file dal telefono o dal computer,
// didascalia scritta a mano o con l'AI, social, pubblica ora o programma) e la scheda
// di un video gia' creato (didascalia, orario, togli programmazione, elimina).
// Il file va direttamente dal browser all'archivio con un indirizzo firmato dal server.

export type Platform = 'instagram' | 'facebook'

export type VideoPost = {
  id: string
  status: 'draft' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled'
  title: string | null
  caption: string
  media: string[]
  platforms: Platform[]
  publish_at: string | null
  error_message: string | null
  results?: { instagram?: string; facebook?: string; video?: { container?: string; since?: string } }
}

export const isVideoPost = (post: { media: string[] }) => post.media.length === 1 && looksLikeVideo(post.media[0])

/** Reel creato su Instagram ma non ancora pronto: esce da solo ai prossimi giri. */
export const isProcessing = (post: VideoPost) => post.status === 'scheduled' && Boolean(post.results?.video?.container)

type Channel = { platform: Platform; name: string; canPublish: boolean }

const MIN_SECONDS = 3
const MAX_SECONDS = 15 * 60
const HASHTAG = /(^|\s)#[\p{L}\p{N}_]+/gu

export const toLocalInput = (iso: string | null) => {
  const d = iso ? new Date(iso) : new Date(Date.now() + 60 * 60_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const hashtagCount = (text: string) => (text.match(HASHTAG) || []).length

/** Durata e forma del video letti nel browser (null se il browser non sa leggerlo, es. alcuni MOV). */
function readVideoInfo(file: File): Promise<{ seconds: number; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    const done = (value: { seconds: number; width: number; height: number } | null) => {
      URL.revokeObjectURL(url)
      resolve(value)
    }
    const timer = setTimeout(() => done(null), 8000)
    video.preload = 'metadata'
    video.onloadedmetadata = () => {
      clearTimeout(timer)
      done(Number.isFinite(video.duration) ? { seconds: video.duration, width: video.videoWidth, height: video.videoHeight } : null)
    }
    video.onerror = () => {
      clearTimeout(timer)
      done(null)
    }
    video.src = url
  })
}

/** Caricamento diretto nell'archivio con l'avanzamento (fetch non lo da'). */
function putFile(url: string, file: File, contentType: string, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', contentType)
    xhr.setRequestHeader('x-upsert', 'false')
    xhr.setRequestHeader('cache-control', 'max-age=31536000')
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100))
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(xhr.status === 413 ? `Il video è troppo grande per l’archivio: prova un file più leggero (max ${VIDEO_MAX_MB} MB).` : `Caricamento non riuscito (${xhr.status}), riprova.`))
    xhr.onerror = () => reject(new Error('Connessione interrotta durante il caricamento, riprova.'))
    xhr.send(file)
  })
}

/** Didascalia con il contatore degli hashtag e "Scrivi con AI" / "Modifica con AI". */
function CaptionEditor({ caption, onCaption, disabled }: { caption: string; onCaption: (text: string) => void; disabled?: boolean }) {
  const { appFetch } = useWorkspace()
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const empty = !caption.trim()
  const tags = hashtagCount(caption)

  const runAI = async () => {
    setBusy(true)
    setError(null)
    const res = await appFetch('/api/app/videos', { method: 'POST', body: JSON.stringify({ action: 'caption', caption, instruction: prompt }) }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setBusy(false)
    if (res?.ok && typeof data.caption === 'string') {
      onCaption(data.caption)
      setPrompt('')
    } else setError(data.error || 'L’AI non ha risposto, riprova.')
  }

  return (
    <div className="space-y-2">
      <textarea
        value={caption}
        onChange={(e) => onCaption(e.target.value)}
        disabled={disabled || busy}
        rows={5}
        maxLength={2200}
        placeholder="Scrivi la didascalia (vale per Instagram e Facebook)…"
        className="w-full rounded-xl border border-[var(--border-color)] bg-[var(--background)] p-2.5 text-sm disabled:opacity-60"
      />
      <p className={`text-xs ${tags > 5 ? 'text-[#FF9500]' : 'text-[var(--text-secondary)]'}`}>
        {caption.length}/2200 · hashtag {tags}/5{tags > 5 ? ' (Instagram ne accetta 5: quelli in più si tolgono)' : ''}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && prompt.trim() && !busy && runAI()}
          disabled={disabled || busy}
          placeholder={empty ? 'Di cosa parla il video? (es. «nuovo menù di pesce»)' : 'Cosa cambiare? (es. «più corta», «aggiungi hashtag»)'}
          className="min-w-0 flex-1 rounded-full border border-[var(--border-color)] bg-[var(--background)] px-3 py-1.5 text-sm"
        />
        <button
          type="button"
          onClick={runAI}
          disabled={disabled || busy || !prompt.trim()}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-color)] px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {empty ? 'Scrivi con AI' : 'Modifica con AI'}
        </button>
      </div>
      {error && <p className="text-xs text-[#FF3B30]">{error}</p>}
    </div>
  )
}

/** "Carica video": file, didascalia, social, Pubblica ora o Programma. */
export function VideoComposer({ onClose, onCreated }: { onClose: () => void; onCreated: (post: VideoPost, notice: string) => void }) {
  const { appFetch } = useWorkspace()
  const [channels, setChannels] = useState<Channel[] | null>(null)
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [caption, setCaption] = useState('')
  const [when, setWhen] = useState(toLocalInput(null))
  const [busy, setBusy] = useState<'now' | 'schedule' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    appFetch('/api/app/videos')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const list = ((data?.channels || []) as Channel[]).filter((c) => c.canPublish)
        setChannels(list)
        setPlatforms(list.map((c) => c.platform))
      })
      .catch(() => setChannels([]))
  }, [appFetch])

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])

  const choose = async (picked: File | undefined) => {
    if (!picked) return
    setError(null)
    setWarning(null)
    setVideoUrl(null)
    const okType = /^video\/(mp4|quicktime)$/i.test(picked.type) || (!picked.type && /\.(mp4|mov|m4v)$/i.test(picked.name))
    if (!okType) return setError('Formato non supportato: carica un video MP4 o MOV.')
    if (picked.size > VIDEO_MAX_MB * 1024 * 1024) return setError(`Il video supera ${VIDEO_MAX_MB} MB: accorcialo o esportalo in qualità più bassa.`)
    const info = await readVideoInfo(picked)
    if (info && info.seconds < MIN_SECONDS) return setError('Il video è troppo corto: Instagram vuole almeno 3 secondi.')
    if (info && info.seconds > MAX_SECONDS) return setError('Il video è troppo lungo: Instagram accetta al massimo 15 minuti.')
    if (info && info.width && info.height && info.width >= info.height) setWarning('Il video non è verticale: su Instagram i Reel rendono meglio in 9:16.')
    setFile(picked)
    setPreview(URL.createObjectURL(picked))
    setProgress(0)
    try {
      const res = await appFetch('/api/app/videos', { method: 'POST', body: JSON.stringify({ action: 'upload_url', name: picked.name, type: picked.type, size: picked.size }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Caricamento non preparato, riprova.')
      await putFile(data.uploadUrl, picked, data.contentType, setProgress)
      setVideoUrl(data.url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Caricamento non riuscito, riprova.')
      setFile(null)
    } finally {
      setProgress(null)
    }
  }

  const submit = async (mode: 'now' | 'schedule') => {
    if (!videoUrl) return
    if (mode === 'now' && !confirm('Pubblicare subito il video?')) return
    setBusy(mode)
    setError(null)
    const res = await appFetch('/api/app/videos', {
      method: 'POST',
      body: JSON.stringify({ action: 'create', mode, url: videoUrl, caption, platforms, title: file?.name.replace(/\.[^.]+$/, '') || '', publishAt: mode === 'schedule' ? new Date(when).toISOString() : undefined }),
    }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setBusy(null)
    // Anche un video non uscito resta in elenco (con l'errore), da riprogrammare o eliminare.
    if (data.post && (res?.ok || data.post.status === 'failed')) {
      onCreated(data.post, res?.ok ? data.notice || (mode === 'schedule' ? 'Video programmato.' : 'Video pubblicato.') : data.error || 'Pubblicazione non riuscita.')
      return
    }
    if (!res?.ok) setError(data.error || 'Operazione non riuscita, riprova.')
  }

  const uploading = progress !== null
  const ready = Boolean(videoUrl) && platforms.length > 0 && busy === null

  return (
    <div className="space-y-3 rounded-2xl border border-[var(--accent-blue)]/40 bg-[var(--background-secondary)] p-4">
      <div className="flex items-center justify-between">
        <p className="inline-flex items-center gap-2 font-semibold">
          <Film className="h-4 w-4" /> Nuovo video
        </p>
        <button type="button" onClick={onClose} aria-label="Chiudi" className="rounded-full p-1 text-[var(--text-secondary)]">
          <X className="h-4 w-4" />
        </button>
      </div>

      <input
        ref={input}
        type="file"
        accept="video/mp4,video/quicktime,.mp4,.mov"
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0]
          e.target.value = ''
          choose(picked)
        }}
      />
      {preview ? (
        <div className="flex flex-wrap items-start gap-3">
          <video src={preview} controls playsInline className="max-h-72 rounded-lg border border-[var(--border-color)] bg-black" />
          <div className="space-y-1 text-xs text-[var(--text-secondary)]">
            <p className="font-semibold text-[var(--text-primary)]">{file?.name}</p>
            {uploading ? (
              <p className="inline-flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Caricamento {progress}%
              </p>
            ) : videoUrl ? (
              <p className="text-[#34C759]">Video caricato.</p>
            ) : null}
            {!uploading && (
              <button type="button" onClick={() => input.current?.click()} className="underline">
                Cambia video
              </button>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex w-full flex-col items-center gap-1 rounded-xl border border-dashed border-[var(--border-color)] p-6 text-sm text-[var(--text-secondary)]"
        >
          <Film className="h-6 w-6" />
          <span className="font-semibold text-[var(--text-primary)]">Scegli un video</span>
          <span>MP4 o MOV, max {VIDEO_MAX_MB} MB, da 3 secondi a 15 minuti. Meglio in verticale (9:16).</span>
        </button>
      )}
      {warning && <p className="text-xs text-[#FF9500]">{warning}</p>}

      <CaptionEditor caption={caption} onCaption={setCaption} disabled={busy !== null} />

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-[var(--text-secondary)]">Dove:</span>
        {channels === null ? (
          <Loader2 className="h-4 w-4 animate-spin text-[var(--text-secondary)]" />
        ) : !channels.length ? (
          <span className="text-xs text-[#FF3B30]">Nessun social collegato con la pubblicazione: collega Instagram o Facebook dalla pagina Canali.</span>
        ) : (
          channels.map((c) => {
            const on = platforms.includes(c.platform)
            return (
              <button
                key={c.platform}
                type="button"
                onClick={() => setPlatforms((list) => (on ? list.filter((p) => p !== c.platform) : [...list, c.platform]))}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 ${on ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]' : 'border-[var(--border-color)] text-[var(--text-secondary)]'}`}
              >
                {c.platform === 'instagram' ? <Instagram className="h-4 w-4" /> : <Facebook className="h-4 w-4" />}
                {c.platform === 'instagram' ? 'Reel Instagram' : 'Video Facebook'}
                {on && <Check className="h-3.5 w-3.5" />}
              </button>
            )
          })
        )}
      </div>

      {error && <p className="text-xs text-[#FF3B30]">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => submit('now')}
          disabled={!ready}
          className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-blue)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy === 'now' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Pubblica ora
        </button>
        <span className="text-xs text-[var(--text-secondary)]">oppure</span>
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          className="rounded-lg border border-[var(--border-color)] bg-[var(--background)] px-2 py-1 text-sm text-[var(--text-primary)]"
        />
        <button
          type="button"
          onClick={() => submit('schedule')}
          disabled={!ready || !when}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--accent-blue)] px-3 py-1.5 text-sm font-semibold text-[var(--accent-blue)] disabled:opacity-50"
        >
          {busy === 'schedule' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />} Programma
        </button>
      </div>
      {busy === 'now' && <p className="text-xs text-[var(--text-secondary)]">Instagram elabora il video: può volerci fino a un minuto…</p>}
    </div>
  )
}

/** Parte aperta della scheda di un video: lettore, didascalia, orario e azioni. */
export function VideoPostDetails({ post, canManage, onChange, onRemoved }: { post: VideoPost; canManage: boolean; onChange: (post: VideoPost) => void; onRemoved: () => void }) {
  const { appFetch } = useWorkspace()
  const [caption, setCaption] = useState(post.caption)
  const [when, setWhen] = useState(toLocalInput(post.publish_at))
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const processing = isProcessing(post)
  const editable = canManage && !processing && ['draft', 'scheduled', 'failed'].includes(post.status)

  useEffect(() => setCaption(post.caption), [post.caption])
  useEffect(() => setWhen(toLocalInput(post.publish_at)), [post.publish_at])

  const patch = async (action: string, extra: Record<string, unknown> = {}, okText = '') => {
    setBusy(action)
    setError(null)
    setNotice(null)
    const res = await appFetch('/api/app/videos', { method: 'PATCH', body: JSON.stringify({ id: post.id, action, ...extra }) }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setBusy(null)
    if (res?.ok && action === 'delete') return onRemoved()
    if (data.post) onChange(data.post)
    if (!res?.ok) setError(data.error || 'Operazione non riuscita, riprova.')
    else setNotice(data.notice || okText)
  }

  const captionChanged = caption.trim() !== post.caption.trim()
  const withCaption = captionChanged ? { caption } : {}

  return (
    <div className="mt-3 space-y-2 border-t border-[var(--border-color)] pt-3">
      <video src={post.media[0]} controls playsInline preload="metadata" className="max-h-80 rounded-lg border border-[var(--border-color)] bg-black" />
      {processing && <p className="text-xs text-[var(--accent-blue)]">Instagram sta elaborando il video: esce da solo entro pochi minuti.</p>}
      {editable ? (
        <CaptionEditor caption={caption} onCaption={setCaption} disabled={busy !== null} />
      ) : (
        <p className="line-clamp-6 whitespace-pre-wrap text-xs text-[var(--text-secondary)]">{post.caption}</p>
      )}
      {post.error_message && post.status !== 'published' && <p className="text-xs text-[#FF3B30]">{post.error_message}</p>}
      {error && <p className="text-xs text-[#FF3B30]">{error}</p>}
      {notice && <p className="text-xs text-[#34C759]">{notice}</p>}
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          {captionChanged && (
            <button
              onClick={() => patch('save', { caption }, 'Didascalia salvata.')}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-color)] px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
            >
              {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Salva didascalia
            </button>
          )}
          <label className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
            <CalendarClock className="h-4 w-4" />
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="rounded-lg border border-[var(--border-color)] bg-[var(--background)] px-2 py-1 text-sm text-[var(--text-primary)]"
            />
          </label>
          <button
            onClick={() => patch('schedule', { publishAt: new Date(when).toISOString(), ...withCaption }, post.status === 'scheduled' ? 'Orario cambiato.' : 'Video programmato.')}
            disabled={busy !== null || !when || (post.status === 'scheduled' && when === toLocalInput(post.publish_at) && !captionChanged)}
            className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-blue)] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy === 'schedule' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {post.status === 'scheduled' ? 'Salva orario' : post.status === 'failed' ? 'Riprogramma' : 'Programma'}
          </button>
          <button
            onClick={() => confirm('Pubblicare subito il video?') && patch('publish', withCaption)}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-color)] px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {busy === 'publish' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Pubblica ora
          </button>
          {post.status !== 'draft' && (
            <button
              onClick={() => confirm('Togliere la programmazione? Il video non esce e resta qui come bozza.') && patch('unschedule', {}, 'Programmazione tolta: il video è in bozza.')}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-color)] px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {busy === 'unschedule' ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} Togli la programmazione
            </button>
          )}
          <button
            onClick={() => confirm('Eliminare il video? Non si può annullare.') && patch('delete')}
            disabled={busy !== null}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-[#FF3B30]/40 px-3 py-1.5 text-sm text-[#FF3B30] disabled:opacity-50"
          >
            {busy === 'delete' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Elimina
          </button>
        </div>
      )}
      {busy === 'publish' && <p className="text-xs text-[var(--text-secondary)]">Instagram elabora il video: può volerci fino a un minuto…</p>}
    </div>
  )
}
