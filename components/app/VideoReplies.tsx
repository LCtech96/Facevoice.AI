'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Clapperboard, Facebook, Film, Instagram, Loader2, Pencil, Trash2, X } from 'lucide-react'
import { useWorkspace } from '@/components/app/WorkspaceContext'
import { VIDEO_MAX_MB } from '@/lib/saas/video-shared'
import {
  MAX_VIDEO_MESSAGE,
  MAX_VIDEO_TITLE,
  MAX_VIDEO_TRIGGER,
  VIDEO_REPLY_CHANNEL_LABELS,
  VIDEO_REPLY_CHANNELS,
  formatSize,
  sizeWarning,
  type VideoReplyChannel,
  type VideoReplyView,
} from '@/lib/saas/video-replies-shared'

// Video risposte: video che l'AI manda nei messaggi diretti (Instagram, Messenger) quando la
// richiesta della persona corrisponde a "Quando mandarlo". Sezione della scheda "Video automazione"
// in Automazioni (elenco, carica, modifica, accendi/spegni, elimina) e pezzi usati da Omnichat e Assistente.

/** Caricamento diretto nell'archivio con l'avanzamento (indirizzo firmato dal server). */
export function putVideoFile(url: string, file: File, contentType: string, onProgress: (pct: number) => void): Promise<void> {
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

/** Controllo nel browser prima di caricare: formato e peso massimo dell'archivio. */
export function videoFileError(file: File): string | null {
  const okType = /^video\/(mp4|quicktime)$/i.test(file.type) || (!file.type && /\.(mp4|mov|m4v)$/i.test(file.name))
  if (!okType) return 'Formato non supportato: carica un video MP4 o MOV.'
  if (file.size > VIDEO_MAX_MB * 1024 * 1024) return `Il video supera ${VIDEO_MAX_MB} MB: accorcialo o esportalo in qualità più bassa.`
  return null
}

/**
 * Carica un video con l'indirizzo firmato di `endpoint` (POST action=upload_url) e restituisce
 * l'indirizzo pubblico. appFetch: quello dello spazio (WorkspaceContext).
 */
export async function uploadVideo(appFetch: (url: string, init?: RequestInit) => Promise<Response>, file: File, onProgress: (pct: number) => void, endpoint = '/api/app/video-replies'): Promise<string> {
  const problem = videoFileError(file)
  if (problem) throw new Error(problem)
  const res = await appFetch(endpoint, { method: 'POST', body: JSON.stringify({ action: 'upload_url', name: file.name, type: file.type, size: file.size }) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Caricamento non preparato, riprova.')
  await putVideoFile(data.uploadUrl, file, data.contentType, onProgress)
  return data.url as string
}

/** Piccola anteprima di un video (Omnichat, Assistente). */
export function VideoChip({ title, url, note, className = '' }: { title: string; url: string | null; note?: string; className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {url ? (
        <video src={url} controls playsInline preload="metadata" className="h-24 w-16 shrink-0 rounded-lg bg-black object-cover" />
      ) : (
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[var(--background)]">
          <Film className="h-5 w-5 text-[var(--text-secondary)]" />
        </span>
      )}
      <span className="min-w-0 text-xs">
        <span className="block font-semibold" translate="no">
          🎬 {title}
        </span>
        {note && <span className="block text-[var(--text-secondary)]">{note}</span>}
      </span>
    </div>
  )
}

const ICONS: Record<VideoReplyChannel, typeof Instagram> = { instagram: Instagram, facebook: Facebook }

type Form = { title: string; trigger: string; message: string; channels: VideoReplyChannel[]; oncePerPerson: boolean }
const EMPTY: Form = { title: '', trigger: '', message: '', channels: [...VIDEO_REPLY_CHANNELS], oncePerPerson: true }

function Fields({ form, onForm, disabled }: { form: Form; onForm: (f: Form) => void; disabled?: boolean }) {
  const input = 'w-full rounded-xl border border-[var(--border-color)] bg-[var(--background)] p-2.5 text-[16px] md:text-sm disabled:opacity-60'
  return (
    <div className="space-y-2">
      <input value={form.title} onChange={(e) => onForm({ ...form, title: e.target.value })} disabled={disabled} maxLength={MAX_VIDEO_TITLE} placeholder="Titolo (es. Trattamenti)" className={input} />
      <textarea
        value={form.trigger}
        onChange={(e) => onForm({ ...form, trigger: e.target.value })}
        disabled={disabled}
        maxLength={MAX_VIDEO_TRIGGER}
        rows={2}
        placeholder="Quando mandarlo (es. quando chiedono informazioni sui trattamenti o sui servizi)"
        className={input}
      />
      <textarea
        value={form.message}
        onChange={(e) => onForm({ ...form, message: e.target.value })}
        disabled={disabled}
        maxLength={MAX_VIDEO_MESSAGE}
        rows={2}
        placeholder="Messaggio da mandare con il video (facoltativo)"
        className={input}
      />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {VIDEO_REPLY_CHANNELS.map((c) => {
          const Icon = ICONS[c]
          const on = form.channels.includes(c)
          return (
            <button
              key={c}
              type="button"
              disabled={disabled}
              onClick={() => onForm({ ...form, channels: on ? form.channels.filter((x) => x !== c) : [...form.channels, c] })}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 ${on ? 'border-[var(--accent-blue)] text-[var(--accent-blue)]' : 'border-[var(--border-color)] text-[var(--text-secondary)]'}`}
            >
              <Icon className="h-4 w-4" /> {VIDEO_REPLY_CHANNEL_LABELS[c]}
            </button>
          )
        })}
        <label className="ml-auto inline-flex items-center gap-2 text-[var(--text-secondary)]">
          <input type="checkbox" checked={form.oncePerPerson} disabled={disabled} onChange={(e) => onForm({ ...form, oncePerPerson: e.target.checked })} />
          Una sola volta per persona
        </label>
      </div>
    </div>
  )
}

/** Elenco e gestione delle video risposte (scheda "Video automazione" in Automazioni). embedded: senza titolo, dentro la scheda. */
export function VideoRepliesSection({ canEdit, embedded = false }: { canEdit: boolean; embedded?: boolean }) {
  const { appFetch } = useWorkspace()
  const [videos, setVideos] = useState<VideoReplyView[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState<Form>(EMPTY)
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [uploaded, setUploaded] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const res = await appFetch('/api/app/video-replies').catch(() => null)
    const data = res?.ok ? await res.json().catch(() => null) : null
    if (!data) return setError('Video risposte non disponibili, ricarica la pagina.')
    setVideos(data.videos || [])
  }, [appFetch])

  useEffect(() => {
    load()
  }, [load])

  const reset = () => {
    setAdding(false)
    setEditing(null)
    setForm(EMPTY)
    setFile(null)
    setUploaded(null)
    setProgress(null)
  }

  const choose = async (picked: File | undefined) => {
    if (!picked) return
    setError(null)
    setUploaded(null)
    setFile(picked)
    setProgress(0)
    try {
      setUploaded(await uploadVideo(appFetch, picked, setProgress))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Caricamento non riuscito, riprova.')
      setFile(null)
    } finally {
      setProgress(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const send = async (method: 'POST' | 'PATCH' | 'DELETE', body: Record<string, unknown>, key: string) => {
    setBusy(key)
    setError(null)
    setNotice(null)
    const res = await appFetch('/api/app/video-replies', { method, body: JSON.stringify(body) }).catch(() => null)
    const data = res ? await res.json().catch(() => ({})) : {}
    setBusy(null)
    if (!res?.ok) {
      setError(data.error || 'Operazione non riuscita, riprova.')
      return false
    }
    if (data.warning) setNotice(data.warning)
    await load()
    return true
  }

  const create = async () => {
    if (!uploaded) return
    if (await send('POST', { action: 'create', url: uploaded, ...form }, 'create')) reset()
  }
  const save = async (id: string) => {
    if (await send('PATCH', { id, ...form }, `save:${id}`)) reset()
  }

  const warning = file ? sizeWarning(file.size, form.channels) : null

  return (
    <section className={embedded ? '' : 'mt-10'}>
      {!embedded && (
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Clapperboard className="h-5 w-5 text-[var(--accent-blue)]" /> Video risposte
        </h2>
      )}
      <p className="mt-1 text-sm text-[var(--text-secondary)]">
        Carica dei video e scrivi quando mandarli: se nei messaggi di Instagram o Messenger qualcuno chiede quella cosa, l’AI risponde e gli manda il video giusto (mai per email). Se hai l’Assistente, puoi farlo anche dalla chat: allega il video e scrivi quando mandarlo.
      </p>
      {error && <p className="mt-3 text-sm text-[#ff6b6b]">{error}</p>}
      {notice && <p className="mt-3 text-sm text-[#FF9500]">{notice}</p>}
      {videos === null ? (
        <Loader2 className="mt-4 h-5 w-5 animate-spin text-[var(--text-secondary)]" />
      ) : (
        <div className="mt-4 space-y-3">
          {!videos.length && !adding && <p className="text-sm text-[var(--text-secondary)]">Nessun video risposta.</p>}
          {videos.map((v) =>
            editing === v.id ? (
              <div key={v.id} className="rounded-2xl border border-[var(--accent-blue)] p-3">
                <Fields form={form} onForm={setForm} disabled={Boolean(busy)} />
                {sizeWarning(v.size, form.channels) && <p className="mt-2 text-xs text-[#FF9500]">{sizeWarning(v.size, form.channels)}</p>}
                <div className="mt-2 flex justify-end gap-2">
                  <button onClick={reset} className="rounded-full px-3 py-1.5 text-sm text-[var(--text-secondary)]">
                    Annulla
                  </button>
                  <button onClick={() => save(v.id)} disabled={Boolean(busy)} className="flex items-center gap-2 rounded-full bg-[var(--accent-blue)] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
                    {busy === `save:${v.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Salva
                  </button>
                </div>
              </div>
            ) : (
              <div key={v.id} className={`flex gap-3 rounded-2xl border border-[var(--border-color)] p-3 ${v.active ? '' : 'opacity-60'}`}>
                <video src={v.url} controls playsInline preload="metadata" className="h-28 w-20 shrink-0 rounded-lg bg-black object-cover" />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold" translate="no">
                    {v.title}
                  </p>
                  <p className="mt-0.5 text-[var(--text-secondary)]">Quando: {v.trigger}</p>
                  {v.message && <p className="mt-0.5 text-[var(--text-secondary)]">Messaggio: {v.message}</p>}
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    {v.channels.map((c) => VIDEO_REPLY_CHANNEL_LABELS[c]).join(' e ')} · {v.oncePerPerson ? 'una sola volta per persona' : 'anche più volte'} · {v.size ? formatSize(v.size) : 'peso non noto'}
                  </p>
                  {sizeWarning(v.size, v.channels) && <p className="mt-1 text-xs text-[#FF9500]">Troppo pesante per l’allegato: parte come link alla pagina del video.</p>}
                  {canEdit && (
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                      <label className="inline-flex items-center gap-1.5">
                        <input type="checkbox" checked={v.active} disabled={Boolean(busy)} onChange={(e) => send('PATCH', { id: v.id, active: e.target.checked }, `active:${v.id}`)} />
                        Attivo
                      </label>
                      <button
                        onClick={() => {
                          setAdding(false)
                          setEditing(v.id)
                          setForm({ title: v.title, trigger: v.trigger, message: v.message, channels: v.channels, oncePerPerson: v.oncePerPerson })
                        }}
                        className="inline-flex items-center gap-1 text-[var(--accent-blue)]"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Modifica
                      </button>
                      <button
                        onClick={() => confirm(`Eliminare il video «${v.title}»? L’AI non lo manderà più.`) && send('DELETE', { id: v.id }, `del:${v.id}`)}
                        disabled={Boolean(busy)}
                        className="inline-flex items-center gap-1 text-[#FF3B30]"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Elimina
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          )}
          {canEdit &&
            (adding ? (
              <div className="rounded-2xl border border-[var(--accent-blue)] p-3">
                <input ref={fileRef} type="file" accept="video/mp4,video/quicktime,.mp4,.mov,.m4v" className="hidden" onChange={(e) => choose(e.target.files?.[0])} />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={progress !== null}
                  className="mb-2 inline-flex items-center gap-2 rounded-full border border-[var(--border-color)] px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
                >
                  {progress !== null ? <Loader2 className="h-4 w-4 animate-spin" /> : <Film className="h-4 w-4" />}
                  {progress !== null ? `Caricamento… ${progress}%` : file ? `${file.name} (${formatSize(file.size)})` : 'Scegli il video (MP4 o MOV)'}
                </button>
                {uploaded && <Check className="ml-2 inline h-4 w-4 text-[#34C759]" />}
                {warning && <p className="mb-2 text-xs text-[#FF9500]">{warning}</p>}
                <Fields form={form} onForm={setForm} disabled={busy === 'create'} />
                <div className="mt-2 flex justify-end gap-2">
                  <button onClick={reset} className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm text-[var(--text-secondary)]">
                    <X className="h-4 w-4" /> Annulla
                  </button>
                  <button
                    onClick={create}
                    disabled={!uploaded || !form.title.trim() || form.trigger.trim().length < 8 || !form.channels.length || Boolean(busy)}
                    className="flex items-center gap-2 rounded-full bg-[var(--accent-blue)] px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {busy === 'create' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Salva video
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => {
                  reset()
                  setAdding(true)
                }}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--border-color)] px-4 py-2 text-sm font-semibold"
              >
                <Film className="h-4 w-4" /> Aggiungi un video
              </button>
            ))}
        </div>
      )}
    </section>
  )
}
